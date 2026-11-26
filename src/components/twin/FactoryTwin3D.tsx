import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ChevronDown,
  ChevronUp,
  Flame,
  Layers,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  X,
} from 'lucide-react';
import type { TwinScanResult } from '../../lib/counterfactual-engine';
import type { InspectionRecord } from '../../types/prometheus';
import type {
  FactoryLineStatusSummary,
  StationInspectionSummary,
  TwinStationId,
} from '../../lib/twin-station-mapper';
import { useTheme } from '../../context/ThemeContext';
import { heatmapCssGradient, sampleHeatmapRgb } from '../../lib/heatmap';

export type CameraPreset =
  | 'isometric'
  | 'station1'
  | 'station2'
  | 'station3'
  | 'scan'
  | 'conveyor'
  | 'top';

export interface FactoryTwin3DProps {
  factoryCode: string;
  factoryName: string;
  targetDefect: string;
  params: Record<string, number>;
  predictedDefectProb: number;
  riskDeltaPct: number;
  scanResult: TwinScanResult | null;
  isScanning: boolean;
  scanProgress: number;
  onTriggerScan: () => void;
  onDismissScan: () => void;
  cameraCommand?: { preset: CameraPreset; seq: number } | null;
  stationSummaries: Record<TwinStationId, StationInspectionSummary>;
  lineStatus: FactoryLineStatusSummary;
  selectedStationId: TwinStationId | null;
  onSelectStation: (stationId: TwinStationId | null) => void;
  defectiveWorkpieces: InspectionRecord[];
  onSelectWorkpiecePassport: (record: InspectionRecord) => void;
  simulationPhase: 'before' | 'after';
  onToggleSimulationPhase: (phase: 'before' | 'after') => void;
}

const CAMERA_PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  isometric: { pos: [10.5, 7.2, 11.5], target: [0, 1.3, 0] },
  station1: { pos: [-4.2, 4.0, 6.2], target: [-4.2, 1.5, 0] },
  station2: { pos: [0.4, 4.2, 6.4], target: [0, 1.7, 0] },
  station3: { pos: [4.6, 3.8, 6.0], target: [4.2, 1.5, 0] },
  scan: { pos: [5.65, 3.25, 4.15], target: [4.2, 1.35, 0] },
  conveyor: { pos: [7.6, 2.75, 4.85], target: [1.4, 1.18, 0] },
  top: { pos: [0, 14.5, 2.2], target: [0, 0.8, 0] },
};

// Module-scope reusable math helpers (zero GC inside animation loop)
const _tmpVec = new THREE.Vector3();
const _tmpTarget = new THREE.Vector3();
const _colorNominal = new THREE.Color('#2563eb');
const _colorPass = new THREE.Color('#16a34a');
const _colorWarn = new THREE.Color('#d97706');
const _colorCritical = new THREE.Color('#dc2626');
const _colorWork = new THREE.Color();

const _bgLight = new THREE.Color('#eef2f6');
const _bgDark = new THREE.Color('#0f172a');
const _padLight = new THREE.Color('#cbd5e1');
const _padDark = new THREE.Color('#1e293b');

function createFactoryFloorTexture(maxAnisotropy: number, dark: boolean): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Clean CAD industrial studio concrete/epoxy floor (light or dark)
  ctx.fillStyle = dark ? '#111827' : '#e8edf2';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = dark ? 'rgba(51, 65, 85, 0.7)' : 'rgba(148, 163, 184, 0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);

  ctx.strokeStyle = dark ? 'rgba(51, 65, 85, 0.35)' : 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 1;
  for (let p = 64; p < size; p += 64) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 10);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(15, 23, 42, 0.36)');
  grad.addColorStop(0.6, 'rgba(15, 23, 42, 0.14)');
  grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintFactoryFloorHeatmap(
  canvas: HTMLCanvasElement,
  s1Heat: number,
  s2Heat: number,
  s3Risk: number,
  originStation: 'station1' | 'station2' | 'station3' | null
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Map 3D safety pad X [-7.4, +7.4] and Z [-2.3, +2.3] onto canvas
  // Station 1: x=-4.2 (u=0.22), Station 2: x=0.0 (u=0.50), Station 3 AOI: x=4.2 (u=0.78)
  const sources = [
    {
      x: W * 0.22,
      y: H * 0.5,
      rx: W * 0.16,
      ry: H * 0.36,
      intensity: Math.min(1, s1Heat + (originStation === 'station1' ? 0.25 : 0)),
    },
    {
      x: W * 0.5,
      y: H * 0.5,
      rx: W * 0.15,
      ry: H * 0.34,
      intensity: Math.min(1, s2Heat + (originStation === 'station2' ? 0.25 : 0)),
    },
    {
      x: W * 0.78,
      y: H * 0.5,
      rx: W * 0.15,
      ry: H * 0.35,
      intensity: Math.min(1, s3Risk + (originStation === 'station3' ? 0.25 : 0)),
    },
  ];

  const img = ctx.createImageData(W, H);
  const data = img.data;

  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      let val = 0;
      for (let i = 0; i < sources.length; i += 1) {
        const s = sources[i];
        const dx = (x - s.x) / s.rx;
        const dy = (y - s.y) / s.ry;
        const d2 = dx * dx + dy * dy;
        if (d2 < 3.6) {
          val += s.intensity * Math.exp(-d2 * 1.15);
        }
      }
      val = Math.min(1, val);
      if (val < 0.08) continue;
      const [r, g, b] = sampleHeatmapRgb(val, 'thermal');
      const alpha = Math.round(Math.min(190, Math.pow(val, 0.85) * 195));
      for (let oy = 0; oy < 2 && y + oy < H; oy += 1) {
        for (let ox = 0; ox < 2 && x + ox < W; ox += 1) {
          const idx = ((y + oy) * W + (x + ox)) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = alpha;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function buildWorkpieceMesh(
  matBoard: THREE.MeshStandardMaterial,
  matChip: THREE.MeshStandardMaterial,
  matPad: THREE.MeshStandardMaterial,
  statusMat: THREE.MeshStandardMaterial
): THREE.Group {
  const wpGroup = new THREE.Group();
  wpGroup.userData = { action: 'scan' };

  const board = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.07, 0.78), matBoard);
  board.position.y = 0.035;
  board.castShadow = true;
  wpGroup.add(board);

  const chip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.34), matChip);
  chip.position.set(0, 0.09, 0);
  wpGroup.add(chip);

  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.56), matPad);
  pad.position.set(0.28, 0.07, 0);
  wpGroup.add(pad);

  const statusBar = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.04, 0.05), statusMat);
  statusBar.position.set(0, 0.08, 0.36);
  wpGroup.add(statusBar);

  return wpGroup;
}

export function FactoryTwin3D({
  factoryCode,
  factoryName,
  targetDefect,
  params,
  predictedDefectProb,
  riskDeltaPct,
  scanResult,
  isScanning,
  scanProgress,
  onTriggerScan,
  onDismissScan,
  cameraCommand,
  stationSummaries,
  lineStatus,
  selectedStationId,
  onSelectStation,
  defectiveWorkpieces,
  onSelectWorkpiecePassport,
  simulationPhase,
  onToggleSimulationPhase,
}: FactoryTwin3DProps) {
  const { isDark } = useTheme();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('isometric');
  const [isPlaying, setIsPlaying] = useState(true);
  const [cutaway, setCutaway] = useState(false);
  const [showHeatmap3D, setShowHeatmap3D] = useState(true);
  const [dockOpen, setDockOpen] = useState(true);
  const [selectedStation, setSelectedStation] = useState<string>('Line Overview');
  const [contextLost, setContextLost] = useState(false);

  const livePropsRef = useRef({
    factoryCode,
    params,
    predictedDefectProb,
    isPlaying,
    cutaway,
    showHeatmap3D,
    isScanning,
    scanProgress,
    scanResult,
    isDark,
    stationSummaries,
    selectedStationId,
    defectiveWorkpieces,
    simulationPhase,
  });
  livePropsRef.current = {
    factoryCode,
    params,
    predictedDefectProb,
    isPlaying,
    cutaway,
    showHeatmap3D,
    isScanning,
    scanProgress,
    scanResult,
    isDark,
    stationSummaries,
    selectedStationId,
    defectiveWorkpieces,
    simulationPhase,
  };

  const onTriggerScanRef = useRef(onTriggerScan);
  onTriggerScanRef.current = onTriggerScan;

  const onSelectStationRef = useRef(onSelectStation);
  onSelectStationRef.current = onSelectStation;

  const onSelectWorkpiecePassportRef = useRef(onSelectWorkpiecePassport);
  onSelectWorkpiecePassportRef.current = onSelectWorkpiecePassport;

  const targetCameraRef = useRef<{
    active: boolean;
    pos: [number, number, number];
    target: [number, number, number];
  }>({
    active: false,
    pos: CAMERA_PRESETS.isometric.pos,
    target: CAMERA_PRESETS.isometric.target,
  });

  const applyCameraPreset = useCallback(
    (preset: CameraPreset, notifyStation = true) => {
      setCameraPreset(preset);
      const cfg = CAMERA_PRESETS[preset];
      targetCameraRef.current = {
        active: true,
        pos: cfg.pos,
        target: cfg.target,
      };
      if (preset === 'station1') {
        setSelectedStation(stationSummaries.station1.meta.fullLabel);
        if (notifyStation) onSelectStationRef.current('station1');
      } else if (preset === 'station2') {
        setSelectedStation(stationSummaries.station2.meta.fullLabel);
        if (notifyStation) onSelectStationRef.current('station2');
      } else if (preset === 'station3' || preset === 'scan') {
        setSelectedStation(stationSummaries.station3.meta.fullLabel);
        if (notifyStation) onSelectStationRef.current('station3');
      } else if (preset === 'conveyor') {
        setSelectedStation('Conveyor Defect Stream');
      } else {
        setSelectedStation('Line Overview');
      }
    },
    [stationSummaries]
  );

  const applyCameraPresetRef = useRef(applyCameraPreset);
  applyCameraPresetRef.current = applyCameraPreset;

  useEffect(() => {
    if (!cameraCommand) return;
    applyCameraPreset(cameraCommand.preset, false);
  }, [cameraCommand, applyCameraPreset]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || 960;
    const height = container.clientHeight || 480;

    const scene = new THREE.Scene();
    const initialBg = livePropsRef.current.isDark ? _bgDark : _bgLight;
    scene.background = initialBg.clone();
    scene.fog = new THREE.FogExp2(initialBg.getHex(), 0.018);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 120);
    camera.position.set(...CAMERA_PRESETS.isometric.pos);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    pmrem.dispose();

    // Clean industrial CAD studio lighting rig
    const hemiLight = new THREE.HemisphereLight('#ffffff', '#cbd5e1', 0.9);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#fff8ed', 1.6);
    keyLight.position.set(11, 16, 9);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.left = -12;
      keyLight.shadow.camera.right = 12;
      keyLight.shadow.camera.top = 10;
      keyLight.shadow.camera.bottom = -10;
      keyLight.shadow.camera.near = 2;
      keyLight.shadow.camera.far = 36;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#cbd5e1', 0.8);
    rimLight.position.set(-10, 8, -9);
    scene.add(rimLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...CAMERA_PRESETS.isometric.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.06;
    controls.minDistance = 3.6;
    controls.maxDistance = 26;
    controls.update();

    const cancelScriptedCamera = () => {
      targetCameraRef.current.active = false;
    };
    controls.addEventListener('start', cancelScriptedCamera);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const floorTexLight = createFactoryFloorTexture(maxAniso, false);
    const floorTexDark = createFactoryFloorTexture(maxAniso, true);
    const contactShadowTex = createContactShadowTexture();
    let appliedDarkTheme = livePropsRef.current.isDark;

    const matFloor = new THREE.MeshStandardMaterial({
      map: appliedDarkTheme ? floorTexDark : floorTexLight,
      roughness: 0.82,
      metalness: 0.08,
    });
    const matDarkSteel = new THREE.MeshStandardMaterial({
      color: '#334155',
      roughness: 0.45,
      metalness: 0.65,
    });
    const matBrushedAlloy = new THREE.MeshStandardMaterial({
      color: '#94a3b8',
      roughness: 0.24,
      metalness: 0.85,
    });
    const matChassis = new THREE.MeshStandardMaterial({
      color: '#475569',
      roughness: 0.55,
      metalness: 0.4,
    });
    const matBelt = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.9,
      metalness: 0.05,
    });
    const matGlass = new THREE.MeshPhysicalMaterial({
      color: '#bfdbfe',
      roughness: 0.12,
      metalness: 0.05,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const matBlueAccent = new THREE.MeshStandardMaterial({
      color: '#2563eb',
      emissive: new THREE.Color('#2563eb'),
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.2,
    });
    const matThermalCore = new THREE.MeshStandardMaterial({
      color: '#d97706',
      emissive: new THREE.Color('#d97706'),
      emissiveIntensity: 0.9,
      roughness: 0.25,
      metalness: 0.35,
    });
    const matBeacon = new THREE.MeshStandardMaterial({
      color: '#2563eb',
      emissive: new THREE.Color('#2563eb'),
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.1,
    });
    const matScanCurtain = new THREE.MeshBasicMaterial({
      color: '#2563eb',
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const matScanCone = new THREE.MeshBasicMaterial({
      color: '#2563eb',
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const matSweepLaser = new THREE.MeshStandardMaterial({
      color: '#2563eb',
      emissive: new THREE.Color('#2563eb'),
      emissiveIntensity: 2.0,
      roughness: 0.15,
      metalness: 0.1,
    });
    const matSweepBeam = new THREE.MeshBasicMaterial({
      color: '#2563eb',
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const matHotspot = new THREE.MeshStandardMaterial({
      color: '#dc2626',
      emissive: new THREE.Color('#dc2626'),
      emissiveIntensity: 1.5,
      roughness: 0.2,
      metalness: 0.15,
    });
    const matHotspotRing = new THREE.MeshBasicMaterial({
      color: '#dc2626',
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const createStationRingMat = () =>
      new THREE.MeshBasicMaterial({
        color: '#dc2626',
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    const matS1FaultRing = createStationRingMat();
    const matS2FaultRing = createStationRingMat();
    const matS3FaultRing = createStationRingMat();
    const matPcbGreen = new THREE.MeshStandardMaterial({
      color: '#15803d',
      roughness: 0.45,
      metalness: 0.2,
    });
    const matCopper = new THREE.MeshStandardMaterial({
      color: '#b45309',
      roughness: 0.28,
      metalness: 0.85,
    });
    const matContactShadow = new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
    });

    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(56, 40), matFloor);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const safetyFrameMat = new THREE.MeshStandardMaterial({
      color: appliedDarkTheme ? '#1e293b' : '#cbd5e1',
      roughness: 0.72,
      metalness: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const safetyPad = new THREE.Mesh(new THREE.BoxGeometry(14.8, 0.04, 4.6), safetyFrameMat);
    safetyPad.position.set(0, 0.02, 0);
    safetyPad.receiveShadow = true;
    scene.add(safetyPad);

    // Live 3D Floor Thermal & Defect Density Heat Map Overlay
    const heatmapCanvas = document.createElement('canvas');
    heatmapCanvas.width = 256;
    heatmapCanvas.height = 128;
    paintFactoryFloorHeatmap(heatmapCanvas, 0.55, 0.4, 0.45, null);
    const floorHeatmapTex = new THREE.CanvasTexture(heatmapCanvas);
    floorHeatmapTex.colorSpace = THREE.SRGBColorSpace;
    const matFloorHeatmap = new THREE.MeshBasicMaterial({
      map: floorHeatmapTex,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const floorHeatmapPlane = new THREE.Mesh(new THREE.PlaneGeometry(14.6, 4.5), matFloorHeatmap);
    floorHeatmapPlane.rotation.x = -Math.PI / 2;
    floorHeatmapPlane.position.set(0, 0.046, 0);
    floorHeatmapPlane.visible = livePropsRef.current.showHeatmap3D;
    scene.add(floorHeatmapPlane);
    let lastHeatmapKey = '';

    // Conveyor System
    const conveyorGroup = new THREE.Group();
    scene.add(conveyorGroup);

    const beltDeck = new THREE.Mesh(new THREE.BoxGeometry(13.8, 0.12, 1.35), matBelt);
    beltDeck.position.set(0, 1.05, 0);
    beltDeck.receiveShadow = true;
    conveyorGroup.add(beltDeck);

    for (const zSign of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(14.0, 0.2, 0.1), matBrushedAlloy);
      rail.position.set(0, 1.1, zSign * 0.72);
      rail.castShadow = true;
      conveyorGroup.add(rail);
    }

    const legGeo = new THREE.CylinderGeometry(0.06, 0.08, 1.02, 12);
    for (const xPos of [-6.4, -3.8, -1.3, 1.3, 3.8, 6.4]) {
      for (const zSign of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, matDarkSteel);
        leg.position.set(xPos, 0.51, zSign * 0.65);
        leg.castShadow = true;
        conveyorGroup.add(leg);
      }
    }

    const rollerCount = 24;
    const rollerGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.3, 10);
    rollerGeo.rotateX(Math.PI / 2);
    const rollerInst = new THREE.InstancedMesh(rollerGeo, matBrushedAlloy, rollerCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < rollerCount; i += 1) {
      dummy.position.set(-6.5 + (i / (rollerCount - 1)) * 13.0, 0.96, 0);
      dummy.updateMatrix();
      rollerInst.setMatrixAt(i, dummy.matrix);
    }
    rollerInst.computeBoundingSphere();
    conveyorGroup.add(rollerInst);

    // Station 1
    const station1Group = new THREE.Group();
    station1Group.position.set(-4.2, 0, 0);
    station1Group.userData = { preset: 'station1' as CameraPreset };
    scene.add(station1Group);

    const s1Shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.6), matContactShadow);
    s1Shadow.rotation.x = -Math.PI / 2;
    s1Shadow.position.y = 0.045;
    station1Group.add(s1Shadow);

    const s1FaultRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.15, 0.048, 12, 48),
      matS1FaultRing
    );
    s1FaultRing.rotation.x = Math.PI / 2;
    s1FaultRing.position.y = 0.085;
    s1FaultRing.visible = false;
    station1Group.add(s1FaultRing);

    const s1Base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.0, 2.3), matChassis);
    s1Base.position.y = 0.5;
    s1Base.castShadow = true;
    s1Base.receiveShadow = true;
    station1Group.add(s1Base);

    const s1Hood = new THREE.Group();
    s1Hood.position.y = 1.65;
    station1Group.add(s1Hood);

    const hoodBody = new THREE.Mesh(new THREE.BoxGeometry(3.3, 1.15, 2.15), matDarkSteel);
    hoodBody.castShadow = true;
    s1Hood.add(hoodBody);

    const hoodWindow = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.52, 2.2), matGlass);
    hoodWindow.position.y = 0.05;
    s1Hood.add(hoodWindow);

    for (const xOff of [-0.95, 0.95]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.85, 16), matBrushedAlloy);
      stack.position.set(xOff, 0.95, -0.45);
      stack.castShadow = true;
      s1Hood.add(stack);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 10, 20), matCopper);
      collar.rotation.x = Math.PI / 2;
      collar.position.set(xOff, 0.62, -0.45);
      s1Hood.add(collar);
    }

    const s1CoreGroup = new THREE.Group();
    s1CoreGroup.position.set(0, 1.55, 0);
    station1Group.add(s1CoreGroup);

    const thermalBars: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i += 1) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 1.45), matThermalCore);
      bar.position.set(-1.05 + i * 0.7, 0.22, 0);
      s1CoreGroup.add(bar);
      thermalBars.push(bar);
    }

    const spindleGroup = new THREE.Group();
    spindleGroup.position.set(0, 0.15, 0);
    s1CoreGroup.add(spindleGroup);
    const spindleShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.09, 0.75, 16), matBrushedAlloy);
    spindleGroup.add(spindleShaft);
    const spindleCollar = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 12, 24), matThermalCore);
    spindleCollar.rotation.x = Math.PI / 2;
    spindleCollar.position.y = -0.18;
    spindleGroup.add(spindleCollar);

    // Station 2
    const station2Group = new THREE.Group();
    station2Group.position.set(0, 0, 0);
    station2Group.userData = { preset: 'station2' as CameraPreset };
    scene.add(station2Group);

    const s2Shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.6), matContactShadow);
    s2Shadow.rotation.x = -Math.PI / 2;
    s2Shadow.position.y = 0.045;
    station2Group.add(s2Shadow);

    const s2FaultRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.05, 0.048, 12, 48),
      matS2FaultRing
    );
    s2FaultRing.rotation.x = Math.PI / 2;
    s2FaultRing.position.y = 0.085;
    s2FaultRing.visible = false;
    station2Group.add(s2FaultRing);

    for (const xSign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.1, 0.24), matDarkSteel);
        col.position.set(xSign * 1.25, 1.55, zSign * 1.12);
        col.castShadow = true;
        station2Group.add(col);
      }
    }

    const s2Crown = new THREE.Group();
    s2Crown.position.y = 3.15;
    station2Group.add(s2Crown);

    const crownMain = new THREE.Mesh(new THREE.BoxGeometry(2.95, 0.42, 2.6), matChassis);
    crownMain.castShadow = true;
    s2Crown.add(crownMain);

    const crownTrim = new THREE.Mesh(new THREE.BoxGeometry(2.98, 0.06, 2.63), matBlueAccent);
    crownTrim.position.y = -0.18;
    s2Crown.add(crownTrim);

    const actuatorBridge = new THREE.Group();
    actuatorBridge.position.set(0, 2.45, 0);
    station2Group.add(actuatorBridge);

    const bridgeBeam = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 2.25), matBrushedAlloy);
    bridgeBeam.castShadow = true;
    actuatorBridge.add(bridgeBeam);

    const actuatorHead = new THREE.Group();
    actuatorHead.position.set(0, -0.35, 0);
    actuatorBridge.add(actuatorHead);

    const headBody = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.46), matDarkSteel);
    headBody.castShadow = true;
    actuatorHead.add(headBody);

    const nozzleTip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 14), matCopper);
    nozzleTip.rotation.x = Math.PI;
    nozzleTip.position.y = -0.44;
    actuatorHead.add(nozzleTip);

    // Station 3: Optical AOI Bridge
    const station3Group = new THREE.Group();
    station3Group.position.set(4.2, 0, 0);
    station3Group.userData = { preset: 'station3' as CameraPreset };
    scene.add(station3Group);

    const s3Shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), matContactShadow);
    s3Shadow.rotation.x = -Math.PI / 2;
    s3Shadow.position.y = 0.045;
    station3Group.add(s3Shadow);

    const s3FaultRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.9, 0.048, 12, 48),
      matS3FaultRing
    );
    s3FaultRing.rotation.x = Math.PI / 2;
    s3FaultRing.position.y = 0.085;
    s3FaultRing.visible = false;
    station3Group.add(s3FaultRing);

    for (const zSign of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.85, 0.42), matChassis);
      pillar.position.set(0, 1.425, zSign * 1.15);
      pillar.castShadow = true;
      station3Group.add(pillar);
    }

    const s3Arch = new THREE.Group();
    s3Arch.position.y = 2.85;
    station3Group.add(s3Arch);

    const archHeader = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.46, 2.75), matDarkSteel);
    archHeader.castShadow = true;
    s3Arch.add(archHeader);

    const cameraHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.55, 20), matBrushedAlloy);
    cameraHousing.position.set(0, -0.42, 0);
    s3Arch.add(cameraHousing);

    const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 12, 24), matBlueAccent);
    lensRing.rotation.x = Math.PI / 2;
    lensRing.position.set(0, -0.7, 0);
    s3Arch.add(lensRing);

    const beaconPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 12), matBrushedAlloy);
    beaconPole.position.set(0, 0.46, 0.9);
    s3Arch.add(beaconPole);
    const beaconBulb = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.28, 16), matBeacon);
    beaconBulb.position.set(0, 0.78, 0.9);
    s3Arch.add(beaconBulb);

    const scanCurtain = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), matScanCurtain);
    scanCurtain.rotation.y = Math.PI / 2;
    scanCurtain.position.set(0, 1.65, 0);
    station3Group.add(scanCurtain);

    const scanProjectionCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.68, 1.02, 24, 1, true),
      matScanCone
    );
    scanProjectionCone.position.set(0, 1.64, 0);
    scanProjectionCone.visible = false;
    station3Group.add(scanProjectionCone);

    const sweepLaserGroup = new THREE.Group();
    sweepLaserGroup.visible = false;
    station3Group.add(sweepLaserGroup);

    const sweepLaserBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.026, 0.96),
      matSweepLaser
    );
    sweepLaserBar.position.set(0, 1.24, 0);
    sweepLaserGroup.add(sweepLaserBar);

    const sweepBeamPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.92),
      matSweepBeam
    );
    sweepBeamPlane.rotation.y = Math.PI / 2;
    sweepBeamPlane.position.set(0, 1.68, 0);
    sweepLaserGroup.add(sweepBeamPlane);

    // Locked inspection workpiece & 3D defect hotspot marker
    const scanWpStatusMat = new THREE.MeshStandardMaterial({
      color: '#2563eb',
      emissive: new THREE.Color('#2563eb'),
      emissiveIntensity: 0.9,
      roughness: 0.25,
    });
    const scanWorkpieceGroup = buildWorkpieceMesh(
      matPcbGreen,
      matDarkSteel,
      matCopper,
      scanWpStatusMat
    );
    scanWorkpieceGroup.position.set(4.2, 1.115, 0);
    scanWorkpieceGroup.visible = false;
    scene.add(scanWorkpieceGroup);

    const hotspotGroup = new THREE.Group();
    hotspotGroup.position.set(4.2, 1.22, 0);
    hotspotGroup.visible = false;
    scene.add(hotspotGroup);

    const hotspotDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.022, 24),
      matHotspot
    );
    hotspotGroup.add(hotspotDisc);

    const hotspotInnerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.018, 10, 32),
      matHotspotRing
    );
    hotspotInnerRing.rotation.x = Math.PI / 2;
    hotspotInnerRing.position.y = 0.02;
    hotspotGroup.add(hotspotInnerRing);

    const hotspotOuterRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.011, 8, 32),
      matHotspotRing
    );
    hotspotOuterRing.rotation.x = Math.PI / 2;
    hotspotOuterRing.position.y = 0.02;
    hotspotGroup.add(hotspotOuterRing);

    const hotspotPin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.52, 8),
      matHotspot
    );
    hotspotPin.position.y = 0.27;
    hotspotGroup.add(hotspotPin);

    const hotspotDiamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.06),
      matHotspot
    );
    hotspotDiamond.position.y = 0.58;
    hotspotGroup.add(hotspotDiamond);

    // Conveyor Workpieces
    const workpieces: Array<{ group: THREE.Group; statusMat: THREE.MeshStandardMaterial; offset: number }> = [];
    for (let i = 0; i < 6; i += 1) {
      const wpStatusMat = new THREE.MeshStandardMaterial({
        color: '#2563eb',
        emissive: new THREE.Color('#2563eb'),
        emissiveIntensity: 0.7,
        roughness: 0.3,
      });
      const wpGroup = buildWorkpieceMesh(matPcbGreen, matDarkSteel, matCopper, wpStatusMat);
      wpGroup.position.set(-6.4 + i * 2.35, 1.11, 0);
      wpGroup.userData = { action: 'workpiece', slotIndex: i };
      scene.add(wpGroup);
      workpieces.push({ group: wpGroup, statusMat: wpStatusMat, offset: i });
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const clickableWorkpieces: THREE.Object3D[] = [
      scanWorkpieceGroup,
      ...workpieces.map((w) => w.group),
    ];
    const clickableStations: THREE.Object3D[] = [station1Group, station2Group, station3Group];
    const allClickables: THREE.Object3D[] = [...clickableWorkpieces, ...clickableStations];

    let pointerDownX = 0;
    let pointerDownY = 0;
    const onPointerDown = (event: PointerEvent) => {
      pointerDownX = event.clientX;
      pointerDownY = event.clientY;
    };

    const isEffectivelyVisible = (obj: THREE.Object3D): boolean => {
      let cur: THREE.Object3D | null = obj;
      while (cur) {
        if (!cur.visible) return false;
        cur = cur.parent;
      }
      return true;
    };

    const onPointerClick = (event: MouseEvent) => {
      if (Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY) > 6) {
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const wpHits = raycaster
        .intersectObjects(clickableWorkpieces, true)
        .filter((h) => isEffectivelyVisible(h.object));
      if (wpHits.length > 0) {
        let wpObj: THREE.Object3D | null = wpHits[0].object;
        while (wpObj && wpObj.userData.slotIndex === undefined && wpObj !== scanWorkpieceGroup) {
          wpObj = wpObj.parent;
        }
        if (wpObj && wpObj !== scanWorkpieceGroup && typeof wpObj.userData.slotIndex === 'number') {
          const slotIdx = wpObj.userData.slotIndex as number;
          const defects = livePropsRef.current.defectiveWorkpieces;
          const mappedRecord = defects[slotIdx];
          if (mappedRecord) {
            onSelectWorkpiecePassportRef.current(mappedRecord);
            return;
          }
        }
        onTriggerScanRef.current();
        return;
      }

      const hits = raycaster
        .intersectObjects(clickableStations, true)
        .filter((h) => isEffectivelyVisible(h.object));
      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && !obj.userData.preset) {
          obj = obj.parent;
        }
        if (obj?.userData.preset) {
          applyCameraPresetRef.current(obj.userData.preset as CameraPreset);
        }
      }
    };

    let lastHoverTs = 0;
    const onPointerMove = (event: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTs < 65) return;
      lastHoverTs = now;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster
        .intersectObjects(allClickables, true)
        .filter((h) => isEffectivelyVisible(h.object));
      renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('click', onPointerClick);
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();
    let elapsedSim = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.1);
      const state = livePropsRef.current;

      if (state.isDark !== appliedDarkTheme) {
        appliedDarkTheme = state.isDark;
        const targetBg = appliedDarkTheme ? _bgDark : _bgLight;
        (scene.background as THREE.Color).copy(targetBg);
        if (scene.fog instanceof THREE.FogExp2) {
          scene.fog.color.copy(targetBg);
        }
        matFloor.map = appliedDarkTheme ? floorTexDark : floorTexLight;
        matFloor.needsUpdate = true;
        safetyFrameMat.color.copy(appliedDarkTheme ? _padDark : _padLight);
        hemiLight.intensity = appliedDarkTheme ? 0.65 : 0.9;
      }

      const isAutoComp = state.factoryCode === 'FACTORY_B';
      const isAutoEcu = state.factoryCode === 'FACTORY_C';
      matPcbGreen.color.set(isAutoComp ? '#94a3b8' : isAutoEcu ? '#334155' : '#15803d');
      matPcbGreen.metalness = isAutoComp ? 0.8 : isAutoEcu ? 0.55 : 0.2;
      spindleGroup.visible = isAutoComp;
      for (const bar of thermalBars) {
        bar.visible = !isAutoComp;
      }

      const risk = state.predictedDefectProb;
      const speedNorm =
        state.factoryCode === 'FACTORY_A'
          ? (state.params.conveyorSpeedCmMin ?? 82) / 82
          : state.factoryCode === 'FACTORY_B'
            ? (state.params.spindleRpm ?? 8500) / 8500
            : 1.0;

      const heatFactor =
        state.factoryCode === 'FACTORY_A'
          ? THREE.MathUtils.clamp(((state.params.reflowPeakTempC ?? 245) - 230) / 38, 0, 1)
          : state.factoryCode === 'FACTORY_B'
            ? THREE.MathUtils.clamp((state.params.toolWearIndexPct ?? 40) / 95, 0, 1)
            : THREE.MathUtils.clamp(1 - ((state.params.fluxWashPressurePsi ?? 45) - 15) / 50, 0, 1);

      const vibrationAmt =
        state.factoryCode === 'FACTORY_B'
          ? ((state.params.spindleVibrationMmS ?? 1.2) / 6.0) * 0.06
          : 0;

      if (heatFactor < 0.5) {
        _colorWork.copy(_colorNominal).lerp(_colorWarn, heatFactor * 2);
      } else {
        _colorWork.copy(_colorWarn).lerp(_colorCritical, (heatFactor - 0.5) * 2);
      }
      matThermalCore.color.copy(_colorWork);
      matThermalCore.emissive.copy(_colorWork);
      matThermalCore.emissiveIntensity = 0.7 + heatFactor * 1.1;

      if (risk < 0.25) {
        _colorWork.copy(_colorPass);
      } else if (risk < 0.5) {
        _colorWork.copy(_colorWarn);
      } else {
        _colorWork.copy(_colorCritical);
      }
      matBeacon.color.copy(_colorWork);
      matBeacon.emissive.copy(_colorWork);
      matScanCurtain.color.copy(_colorWork);

      // Update 3D floor thermal heat map overlay only when parameters or scan change
      floorHeatmapPlane.visible = state.showHeatmap3D;
      if (state.showHeatmap3D) {
        const s2Stress =
          state.factoryCode === 'FACTORY_A'
            ? THREE.MathUtils.clamp(
                Math.abs((state.params.conveyorSpeedCmMin ?? 82) - 82) / 30 +
                  Math.max(0, (195 - (state.params.solderPasteViscosity ?? 195)) / 70),
                0.15,
                1
              )
            : state.factoryCode === 'FACTORY_B'
              ? THREE.MathUtils.clamp(
                  Math.abs((state.params.stampingDieForceKn ?? 620) - 620) / 260,
                  0.15,
                  1
                )
              : THREE.MathUtils.clamp(
                  ((state.params.cleanroomDustPpm ?? 28) - 10) / 130 +
                    Math.abs((state.params.conformalCureTempC ?? 88) - 88) / 45,
                  0.15,
                  1
                );
        const s1Load = THREE.MathUtils.clamp(0.25 + heatFactor * 0.72, 0.2, 1);
        const s3Load = THREE.MathUtils.clamp(0.2 + risk * 0.8, 0.18, 1);
        const originSt = state.scanResult?.defectDetected ? state.scanResult.originStation : null;
        const hmKey = `${s1Load.toFixed(2)}_${s2Stress.toFixed(2)}_${s3Load.toFixed(2)}_${originSt ?? 'none'}`;
        if (hmKey !== lastHeatmapKey) {
          lastHeatmapKey = hmKey;
          paintFactoryFloorHeatmap(heatmapCanvas, s1Load, s2Stress, s3Load, originSt);
          floorHeatmapTex.needsUpdate = true;
        }
      }

      const hoodTargetY = state.cutaway ? 3.25 : 1.65;
      const crownTargetY = state.cutaway ? 4.3 : 3.15;
      const archTargetY = state.cutaway ? 3.85 : 2.85;
      s1Hood.position.y = THREE.MathUtils.damp(s1Hood.position.y, hoodTargetY, 6, dt);
      s2Crown.position.y = THREE.MathUtils.damp(s2Crown.position.y, crownTargetY, 6, dt);
      s3Arch.position.y = THREE.MathUtils.damp(s3Arch.position.y, archTargetY, 6, dt);

      const scanActive = state.isScanning;
      const scanDone = !scanActive && Boolean(state.scanResult);
      const lockWorkpieceUnderAoi = scanActive || scanDone;

      scanWorkpieceGroup.visible = lockWorkpieceUnderAoi;
      scanCurtain.visible = !lockWorkpieceUnderAoi;

      if (scanActive) {
        scanProjectionCone.visible = true;
        matScanCone.color.copy(_colorNominal);
        matScanCone.opacity = 0.18;

        sweepLaserGroup.visible = true;
        const pNorm = THREE.MathUtils.clamp(state.scanProgress / 100, 0, 1);
        sweepLaserGroup.position.x = Math.sin(pNorm * Math.PI * 3.0) * 0.46;

        scanWpStatusMat.color.copy(_colorNominal);
        scanWpStatusMat.emissive.copy(_colorNominal);

        hotspotGroup.visible = false;
      } else if (scanDone && state.scanResult) {
        const res = state.scanResult;
        const sevColor =
          res.severity === 'CRITICAL' || res.severity === 'HIGH'
            ? _colorCritical
            : res.severity === 'MEDIUM' || res.severity === 'LOW'
              ? _colorWarn
              : _colorPass;

        sweepLaserGroup.visible = false;
        scanProjectionCone.visible = true;
        matScanCone.color.copy(sevColor);
        matScanCone.opacity = res.defectDetected ? 0.1 : 0.08;

        scanWpStatusMat.color.copy(sevColor);
        scanWpStatusMat.emissive.copy(sevColor);

        hotspotGroup.visible = true;
        hotspotGroup.position.set(4.2 + res.hotspotLocal.x, 1.22, res.hotspotLocal.z);
        matHotspot.color.copy(sevColor);
        matHotspot.emissive.copy(sevColor);
        matHotspotRing.color.copy(sevColor);

        hotspotInnerRing.rotation.z += dt * 1.4;
        hotspotOuterRing.rotation.z -= dt * 0.9;
        hotspotDiamond.rotation.y += dt * 2.2;
        hotspotDiamond.position.y = 0.56 + Math.sin(elapsedSim * 3.5) * 0.04;
      } else {
        scanProjectionCone.visible = false;
        sweepLaserGroup.visible = false;
        hotspotGroup.visible = false;
      }

      // Highlight stations directly from actual inspection alerts, active 3D scan origin, or station selection
      const ringPulse = 1 + Math.sin(elapsedSim * 3.6) * 0.022;
      const syncStationRing = (
        stationId: TwinStationId,
        ringMesh: THREE.Mesh,
        ringMat: THREE.MeshBasicMaterial
      ) => {
        const summary = state.stationSummaries[stationId];
        const isScanOrigin =
          scanDone && Boolean(state.scanResult?.defectDetected) && state.scanResult?.originStation === stationId;
        const isSelected = state.selectedStationId === stationId;
        const hasInspectionAlert = summary?.hasAlert ?? false;

        if (isScanOrigin || hasInspectionAlert) {
          ringMesh.visible = true;
          const isCrit =
            isScanOrigin ||
            summary?.alertSeverity === 'CRITICAL' ||
            summary?.alertSeverity === 'HIGH';
          ringMat.color.copy(isCrit ? _colorCritical : _colorWarn);
          ringMat.opacity = isSelected ? 0.95 : 0.78;
          ringMesh.scale.set(ringPulse, ringPulse, 1);
        } else if (isSelected) {
          ringMesh.visible = true;
          ringMat.color.copy(_colorNominal);
          ringMat.opacity = 0.75;
          ringMesh.scale.set(1, 1, 1);
        } else {
          ringMesh.visible = false;
        }
      };

      syncStationRing('station1', s1FaultRing, matS1FaultRing);
      syncStationRing('station2', s2FaultRing, matS2FaultRing);
      syncStationRing('station3', s3FaultRing, matS3FaultRing);

      if (state.isPlaying) {
        elapsedSim += dt;

        const conveyorSpeed = 1.35 * THREE.MathUtils.clamp(speedNorm, 0.55, 1.85);
        const defects = state.defectiveWorkpieces;
        const showReducedDefects = state.simulationPhase === 'after' && risk < 0.2;

        for (let i = 0; i < workpieces.length; i += 1) {
          const wp = workpieces[i];
          wp.group.position.x += conveyorSpeed * dt;
          if (wp.group.position.x > 6.8) {
            wp.group.position.x = -6.8;
          }
          const inAoiZone = wp.group.position.x > 3.25 && wp.group.position.x < 5.15;
          wp.group.visible = !(lockWorkpieceUnderAoi && inAoiZone);

          const linkedDefect = defects[i];
          const isRealDefectiveUnit = Boolean(linkedDefect) && !showReducedDefects;
          const isRiskFlagged = wp.group.position.x > 4.1 && ((i + 1) / workpieces.length) <= risk + 0.08;

          if (isRealDefectiveUnit) {
            const c =
              linkedDefect.severity === 'CRITICAL' || linkedDefect.severity === 'HIGH'
                ? _colorCritical
                : _colorWarn;
            wp.statusMat.color.copy(c);
            wp.statusMat.emissive.copy(c);
          } else if (isRiskFlagged) {
            wp.statusMat.color.copy(risk > 0.45 ? _colorCritical : _colorWarn);
            wp.statusMat.emissive.copy(risk > 0.45 ? _colorCritical : _colorWarn);
          } else {
            wp.statusMat.color.copy(_colorPass);
            wp.statusMat.emissive.copy(_colorPass);
          }
        }

        if (isAutoComp) {
          actuatorBridge.position.x = THREE.MathUtils.damp(actuatorBridge.position.x, 0, 8, dt);
          actuatorHead.position.y = -0.35 - Math.abs(Math.sin(elapsedSim * 2.8)) * 0.45;
        } else {
          actuatorBridge.position.x = Math.sin(elapsedSim * 2.1 * speedNorm) * 0.72;
          actuatorHead.position.z = Math.cos(elapsedSim * 3.1) * 0.32;
          actuatorHead.position.y = -0.32 - Math.max(0, Math.sin(elapsedSim * 4.2)) * 0.34;
        }

        spindleGroup.rotation.y += dt * 12 * speedNorm;
        spindleGroup.position.x = Math.sin(elapsedSim * 48) * vibrationAmt;
        scanCurtain.position.x = Math.sin(elapsedSim * 3.6) * 0.38;
      }

      if (targetCameraRef.current.active) {
        _tmpVec.set(...targetCameraRef.current.pos);
        _tmpTarget.set(...targetCameraRef.current.target);
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _tmpVec.x, 5.5, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _tmpVec.y, 5.5, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _tmpVec.z, 5.5, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, _tmpTarget.x, 5.5, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _tmpTarget.y, 5.5, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _tmpTarget.z, 5.5, dt);
        if (
          camera.position.distanceTo(_tmpVec) < 0.04 &&
          controls.target.distanceTo(_tmpTarget) < 0.04
        ) {
          targetCameraRef.current.active = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('start', cancelScriptedCamera);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('click', onPointerClick);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            m.material.dispose();
          }
        }
      });
      floorTexLight.dispose();
      floorTexDark.dispose();
      floorHeatmapTex.dispose();
      contactShadowTex.dispose();
      envRT.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const badgeTone =
    scanResult?.severity === 'CRITICAL' || scanResult?.severity === 'HIGH'
      ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-400'
      : scanResult?.severity === 'MEDIUM' || scanResult?.severity === 'LOW'
        ? 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400'
        : 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400';

  return (
    <div className="relative w-full h-[500px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 overflow-hidden select-none">
      <div ref={mountRef} className="w-full h-full" />

      {contextLost && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-100 dark:bg-slate-900 text-sm text-slate-600 dark:text-slate-300">
          3D viewport paused — restoring factory view...
        </div>
      )}

      {/* Minimal Top-Left Spec Bar (Solid surface — zero backdrop-filter over WebGL) */}
      <div className="pointer-events-none absolute top-4 left-4 z-10 rounded-md border border-slate-200 bg-white/95 dark:border-slate-700 dark:bg-slate-900/95 px-3.5 py-2 shadow-xs max-w-[440px]">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
          <span>{factoryName}</span>
          <span className="text-slate-400 dark:text-slate-500">·</span>
          <span className="text-blue-700 dark:text-blue-400">{selectedStation}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-medium">
          <span
            className={
              lineStatus.operationalStatus === 'ALERT'
                ? 'text-red-700 dark:text-red-400'
                : lineStatus.operationalStatus === 'WATCH'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
            }
          >
            Line: {lineStatus.operationalLabel}
          </span>
          <span className="text-slate-400 dark:text-slate-600">·</span>
          <span className="text-slate-700 dark:text-slate-300">{lineStatus.dataModeLabel}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
          <span>
            Mode:{' '}
            <strong className="text-slate-900 dark:text-slate-100 font-sans">
              {simulationPhase === 'before' ? 'Before (Baseline)' : 'After (Simulated)'}
            </strong>
          </span>
          <span>
            Target:{' '}
            <strong className="text-slate-900 dark:text-slate-100 font-sans">
              {targetDefect}
            </strong>
          </span>
          <span>
            Risk:{' '}
            <strong
              className={
                predictedDefectProb < 0.25
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : predictedDefectProb < 0.5
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-red-700 dark:text-red-400'
              }
            >
              {(predictedDefectProb * 100).toFixed(1)}%
            </strong>
          </span>
          <span>
            Shift:{' '}
            <strong
              className={
                riskDeltaPct <= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }
            >
              {riskDeltaPct > 0 ? '+' : ''}
              {riskDeltaPct.toFixed(1)} pp
            </strong>
          </span>
        </div>
        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          Click any station for inspection history or click a defective workpiece for its passport
        </div>
        {showHeatmap3D && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Thermal Map:</span>
            <span>Cool</span>
            <div
              className="h-2 w-24 rounded-sm border border-slate-200 dark:border-slate-700"
              style={{ background: heatmapCssGradient('thermal') }}
            />
            <span>Hotspot</span>
          </div>
        )}
      </div>

      {/* Compact Top-Right Scan Status Readout */}
      {isScanning && (
        <div className="pointer-events-none absolute top-4 right-4 z-10 rounded-md border border-blue-200 bg-white/95 dark:border-blue-800 dark:bg-slate-900/95 px-3 py-1.5 text-xs font-mono tabular-nums text-blue-700 dark:text-blue-400 shadow-xs flex items-center gap-2">
          <ScanLine className="h-3.5 w-3.5" />
          <span>Scanning · {Math.round(scanProgress)}%</span>
        </div>
      )}

      {!isScanning && scanResult && (
        <div
          className={`absolute top-4 right-4 z-10 rounded-md border bg-white/95 dark:bg-slate-900/95 px-3 py-1.5 text-xs font-medium shadow-xs flex items-center gap-2.5 ${badgeTone}`}
        >
          <ScanLine className="h-3.5 w-3.5 shrink-0" />
          <span>
            {scanResult.defectDetected ? 'Detected' : 'Verified'}:{' '}
            <strong className="text-slate-900 dark:text-slate-100">{scanResult.defectType}</strong>{' '}
            ·{' '}
            <span className="font-mono tabular-nums">
              {scanResult.severity} ({scanResult.confidencePct.toFixed(1)}%)
            </span>
          </span>
          <button
            type="button"
            onClick={onDismissScan}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            title="Clear scan marker"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock (Solid surface, zero backdrop-filter) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[96%]">
        <button
          type="button"
          onClick={() => setDockOpen((v) => !v)}
          className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white/95 dark:border-slate-700 dark:bg-slate-900/95 px-3 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-900 dark:hover:text-white shadow-xs cursor-pointer whitespace-nowrap"
        >
          {dockOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          {dockOpen ? 'Hide Controls' : 'Show Controls'}
        </button>

        {dockOpen && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 dark:border-slate-700 dark:bg-slate-900/95 px-3 py-2 shadow-sm">
            <button
              type="button"
              onClick={onTriggerScan}
              disabled={isScanning}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                isScanning
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <ScanLine className="h-3.5 w-3.5" />
              {isScanning ? `Scanning ${Math.round(scanProgress)}%` : 'Scan Defect'}
            </button>

            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 hidden sm:inline-block" />

            {/* Before / After Process Preview Switch */}
            <div className="inline-flex items-center rounded bg-slate-100 dark:bg-slate-800 p-0.5">
              <button
                type="button"
                onClick={() => onToggleSimulationPhase('before')}
                className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  simulationPhase === 'before'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                Before
              </button>
              <button
                type="button"
                onClick={() => onToggleSimulationPhase('after')}
                className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  simulationPhase === 'after'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                After
              </button>
            </div>

            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 hidden sm:inline-block" />

            {(
              [
                ['isometric', 'Overview', 0],
                ['station1', stationSummaries.station1.meta.shortLabel, stationSummaries.station1.alertCount],
                ['station2', stationSummaries.station2.meta.shortLabel, stationSummaries.station2.alertCount],
                ['station3', stationSummaries.station3.meta.shortLabel, stationSummaries.station3.alertCount],
                ['scan', 'AOI Lens', 0],
                ['conveyor', 'Workpieces', defectiveWorkpieces.length],
                ['top', 'Top Plan', 0],
              ] as Array<[CameraPreset, string, number]>
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyCameraPreset(key)}
                className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                  cameraPreset === key
                    ? 'bg-slate-900 text-white dark:bg-blue-600 dark:text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <span>{label}</span>
                {count > 0 && (
                  <span
                    className={`font-mono text-[10px] tabular-nums font-semibold ${
                      cameraPreset === key
                        ? 'text-amber-300'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    ({count})
                  </span>
                )}
              </button>
            ))}

            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 hidden sm:inline-block" />

            <button
              type="button"
              onClick={() => setShowHeatmap3D((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                showHeatmap3D
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <Flame className="h-3.5 w-3.5" />
              Heat Map
            </button>

            <button
              type="button"
              onClick={() => setCutaway((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                cutaway
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Cutaway
            </button>

            <button
              type="button"
              onClick={() => setIsPlaying((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 whitespace-nowrap cursor-pointer"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {isPlaying ? 'Pause' : 'Resume'}
            </button>

            <button
              type="button"
              onClick={() => applyCameraPreset('isometric')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 whitespace-nowrap cursor-pointer"
              title="Reset 3D camera"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

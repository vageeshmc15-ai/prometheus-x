import type { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import {
  evaluateCounterfactualTwin,
  FACTORY_TWIN_PROFILES,
} from './counterfactual-engine';
import type {
  AppRole,
  BillingRecordItem,
  CounterfactualScenarioRecord,
  DashboardTabId,
  FactoryRecord,
  InspectionRecord,
  InvitationRecord,
  MaintenanceForecastRecord,
  ManagedUserRecord,
  SecurityAuditRecord,
  UserProfile,
} from '../types/prometheus';
import type { SimulatedInspectionSample } from './cv-engine';

const STANDALONE_SAMPLES: SimulatedInspectionSample[] = [
  {
    id: 'pcb-solder-bridge',
    label: 'SMT Mainboard IC-14 Solder Bridge',
    factoryCode: 'FACTORY_A',
    sector: 'Electronics & Semiconductor',
    lineName: 'SMT Reflow Line A2',
    componentPrefix: 'PCB-IC14',
    imageUrl: '/src/assets/images/pcb_solder_bridge_1795602196841.jpg',
    expectedDefect: 'Solder Bridge',
    defaultSeverity: 'CRITICAL',
    defaultBox: { x: 50, y: 42, width: 16, height: 12 },
  },
  {
    id: 'pcb-component-misalign',
    label: 'QFN Module R103 Skewed Placement',
    factoryCode: 'FACTORY_A',
    sector: 'Electronics & Semiconductor',
    lineName: 'Pick-and-Place Line A4',
    componentPrefix: 'SMD-R103',
    imageUrl: '/src/assets/images/pcb_component_misalign_1795602200390.jpg',
    expectedDefect: 'Component Misalignment',
    defaultSeverity: 'HIGH',
    defaultBox: { x: 40, y: 49, width: 25, height: 17 },
  },
  {
    id: 'auto-machined-crack',
    label: 'CNC Aluminum Flange Bore Hairline Crack',
    factoryCode: 'FACTORY_B',
    sector: 'Automotive Components',
    lineName: '5-Axis CNC Cell B1',
    componentPrefix: 'TRN-FLG',
    imageUrl: '/src/assets/images/auto_machined_crack_1795602199591.jpg',
    expectedDefect: 'Hairline Crack',
    defaultSeverity: 'CRITICAL',
    defaultBox: { x: 60, y: 18, width: 18, height: 22 },
  },
  {
    id: 'auto-body-dent',
    label: 'Stamped Alloy Panel Surface Dent & Scratch',
    factoryCode: 'FACTORY_B',
    sector: 'Automotive Components',
    lineName: 'Stamping Press Line B3',
    componentPrefix: 'PNL-EXT',
    imageUrl: '/src/assets/images/auto_body_dent_1795602202234.jpg',
    expectedDefect: 'Surface Dent',
    defaultSeverity: 'HIGH',
    defaultBox: { x: 42, y: 47, width: 22, height: 12 },
  },
  {
    id: 'auto-ecu-contamination',
    label: 'Automotive ECU Header Flux Contamination',
    factoryCode: 'FACTORY_C',
    sector: 'Automotive Electronics',
    lineName: 'ECU Conformal Coat Line C2',
    componentPrefix: 'ECU-VG50',
    imageUrl: '/src/assets/images/auto_ecu_contamination_1795602200016.jpg',
    expectedDefect: 'Flux Contamination',
    defaultSeverity: 'HIGH',
    defaultBox: { x: 19, y: 63, width: 62, height: 13 },
  },
];

const SECTOR_DEFECT_CATALOG: Record<
  string,
  Array<{ name: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' }>
> = {
  'Electronics & Semiconductor': [
    { name: 'Solder Bridge', severity: 'CRITICAL' },
    { name: 'Missing Component', severity: 'CRITICAL' },
    { name: 'Component Misalignment', severity: 'HIGH' },
    { name: 'Flux Contamination', severity: 'MEDIUM' },
    { name: 'PCB Surface Damage', severity: 'HIGH' },
  ],
  'Automotive Components': [
    { name: 'Hairline Crack', severity: 'CRITICAL' },
    { name: 'Surface Dent', severity: 'HIGH' },
    { name: 'Micro Scratch', severity: 'MEDIUM' },
    { name: 'Machining Burr', severity: 'HIGH' },
    { name: 'Coating Void', severity: 'MEDIUM' },
  ],
  'Automotive Electronics': [
    { name: 'Flux Contamination', severity: 'HIGH' },
    { name: 'Solder Bridge', severity: 'CRITICAL' },
    { name: 'Connector Pin Skew', severity: 'HIGH' },
    { name: 'Conformal Coat Bubble', severity: 'MEDIUM' },
    { name: 'Thermal Pad Delamination', severity: 'CRITICAL' },
  ],
};

function round(val: number, decimals = 3): number {
  const f = Math.pow(10, decimals);
  return Math.round(val * f) / f;
}

function simpleHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function runBrowserCV(params: {
  sector: string;
  sampleId?: string;
  seedKey?: string;
  clientSignalStats?: {
    edgeDensity?: number;
    contrastVariance?: number;
    luminanceMean?: number;
  };
}) {
  const matched = params.sampleId
    ? STANDALONE_SAMPLES.find((s) => s.id === params.sampleId)
    : undefined;
  const h = simpleHash(`${params.sector}:${params.sampleId ?? params.seedKey ?? 'custom'}`);

  const byteMean = 95 + (h % 75);
  const byteVariance = 34 + ((h >>> 8) % 38);
  const gradientEnergy = 0.19 + ((h >>> 16) % 48) / 100;
  const entropySeed = 0.55 + ((h >>> 24) % 35) / 100;

  const edgeDensity = round(
    params.clientSignalStats?.edgeDensity ?? Math.min(0.92, gradientEnergy * 0.85 + 0.09),
    3
  );
  const contrastVariance = round(params.clientSignalStats?.contrastVariance ?? byteVariance, 2);
  const luminanceMean = round(params.clientSignalStats?.luminanceMean ?? byteMean, 1);
  const sobelPeak = round(Math.min(255, edgeDensity * 220 + contrastVariance * 0.65), 1);
  const anomalyEnergy = round(
    Math.min(
      0.98,
      Math.max(0.14, edgeDensity * 0.52 + (contrastVariance / 100) * 0.31 + entropySeed * 0.18)
    ),
    3
  );

  const catalog =
    SECTOR_DEFECT_CATALOG[params.sector] ?? SECTOR_DEFECT_CATALOG['Electronics & Semiconductor'];

  let defectType: string;
  let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'PASS';
  let box: { x: number; y: number; width: number; height: number };

  if (matched) {
    defectType = matched.expectedDefect;
    severity = matched.defaultSeverity;
    box = matched.defaultBox;
  } else if (anomalyEnergy < 0.24) {
    defectType = 'No Defect';
    severity = 'PASS';
    box = { x: 25, y: 25, width: 50, height: 50 };
  } else {
    const idx = Math.floor((edgeDensity * 100 + contrastVariance) % catalog.length);
    const chosen = catalog[idx];
    defectType = chosen.name;
    severity = chosen.severity;
    box = {
      x: Math.round(24 + ((byteMean * 7) % 34)),
      y: Math.round(22 + ((contrastVariance * 11) % 38)),
      width: Math.round(18 + edgeDensity * 16),
      height: Math.round(14 + anomalyEnergy * 14),
    };
  }

  const cvConfidence = round(
    Math.min(
      0.985,
      Math.max(0.68, 0.74 + anomalyEnergy * 0.23 - Math.abs(luminanceMean - 128) * 0.0005)
    ),
    3
  );
  const anomalyScore = round(
    defectType === 'No Defect' ? Math.max(0.05, anomalyEnergy * 0.4) : Math.min(0.99, anomalyEnergy * 1.08),
    3
  );

  const perturbationSpecs = [
    {
      name: 'Illumination Drop',
      type: 'brightness',
      severityParam: '-35% exposure',
      sensitivity: 0.045 + (luminanceMean < 110 ? 0.075 : 0.015),
    },
    {
      name: 'Specular Glare',
      type: 'glare',
      severityParam: '+30% specular gain',
      sensitivity: 0.052 + (contrastVariance > 55 ? 0.065 : 0.02),
    },
    {
      name: 'Gaussian Optical Blur',
      type: 'blur',
      severityParam: 'sigma = 2.2px',
      sensitivity: 0.068 + (edgeDensity < 0.28 ? 0.095 : 0.025),
    },
    {
      name: 'Sensor Shot Noise',
      type: 'noise',
      severityParam: 'ISO grain sigma = 18',
      sensitivity: 0.038 + (entropySeed > 0.78 ? 0.048 : 0.012),
    },
    {
      name: 'Rotational / Occlusion Shift',
      type: 'rotation',
      severityParam: '+7 deg / 8% mask',
      sensitivity: 0.058 + (box.width < 18 ? 0.088 : 0.022),
    },
  ];

  const altDefect = catalog.find((c) => c.name !== defectType)?.name ?? 'Surface Irregularity';
  const perturbationResults = perturbationSpecs.map((spec) => {
    const perturbedConf = round(Math.max(0.41, cvConfidence - spec.sensitivity), 3);
    const delta = round(perturbedConf - cvConfidence, 3);
    const consistent = perturbedConf >= 0.76 && Math.abs(delta) <= 0.13;
    return {
      name: spec.name,
      type: spec.type,
      severityParam: spec.severityParam,
      predictedDefect: consistent ? defectType : altDefect,
      confidence: perturbedConf,
      confidenceDelta: delta,
      consistent,
    };
  });

  const consistentCount = perturbationResults.filter((p) => p.consistent).length;
  const meanAbsDrift =
    perturbationResults.reduce((acc, p) => acc + Math.abs(p.confidenceDelta), 0) /
    perturbationResults.length;
  const reliabilityScore = round(
    Math.max(
      32,
      Math.min(99.2, (consistentCount / perturbationResults.length) * 70 + (1 - meanAbsDrift * 2.1) * 30)
    ),
    1
  );
  const reliabilityStatus: 'RELIABLE' | 'REVIEW_REQUIRED' | 'UNSTABLE' =
    reliabilityScore >= 82 ? 'RELIABLE' : reliabilityScore >= 65 ? 'REVIEW_REQUIRED' : 'UNSTABLE';

  return {
    defectType,
    severity,
    cvConfidence,
    anomalyScore,
    boundingBox: { ...box, label: `${defectType} (${Math.round(cvConfidence * 100)}%)` },
    cvMetrics: {
      edgeDensity,
      contrastVariance,
      luminanceMean,
      anomalyEnergy,
      sobelPeak,
      engineVersion: 'PX-CV-SobelPatch-1.4',
    },
    reliabilityScore,
    reliabilityStatus,
    perturbationResults,
  };
}

interface StandaloneState {
  initialized: boolean;
  currentUser: UserProfile | null;
  factories: FactoryRecord[];
  inspections: InspectionRecord[];
  maintenance: MaintenanceForecastRecord[];
  scenarios: CounterfactualScenarioRecord[];
  users: ManagedUserRecord[];
  invitations: InvitationRecord[];
  billing: BillingRecordItem[];
  auditLogs: SecurityAuditRecord[];
  nextId: number;
}

const state: StandaloneState = {
  initialized: false,
  currentUser: null,
  factories: [],
  inspections: [],
  maintenance: [],
  scenarios: [],
  users: [],
  invitations: [],
  billing: [],
  auditLogs: [],
  nextId: 100,
};

function initStandaloneState() {
  if (state.initialized) return;
  state.initialized = true;
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

  state.factories = [
    {
      id: 1,
      code: 'FACTORY_A',
      name: 'Factory A — Electronics Manufacturing',
      sector: 'Electronics & Semiconductor',
      location: 'Penang SMT Campus (Simulated)',
      subscriptionTier: 'ENTERPRISE',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: hoursAgo(72),
    },
    {
      id: 2,
      code: 'FACTORY_B',
      name: 'Factory B — Automotive Components',
      sector: 'Automotive Components',
      location: 'Stuttgart Precision Works (Simulated)',
      subscriptionTier: 'ENTERPRISE',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: hoursAgo(72),
    },
    {
      id: 3,
      code: 'FACTORY_C',
      name: 'Factory C — Automotive Electronics',
      sector: 'Automotive Electronics',
      location: 'Nagoya ECU Assembly (Simulated)',
      subscriptionTier: 'GROWTH',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: hoursAgo(72),
    },
  ];

  const seedDefs = [
    {
      id: 1,
      passportCode: 'PX-FA-2026-1001',
      factoryId: 1,
      sample: STANDALONE_SAMPLES[0],
      batchNumber: 'LOT-SMT-2611A',
      componentSerial: 'PCB-IC14-88412',
      reviewStatus: 'CONFIRMED' as const,
      humanLabel: 'Solder Bridge',
      humanNotes: 'Confirmed bridged pins 14-15 after reflow peak drift (+11°C).',
      geminiReport:
        '1. Root-Cause Engineering Diagnosis: Excessive solder paste volume combined with a +11°C reflow peak excursion on SMT Line A2 reduced paste viscosity, promoting bridging across fine-pitch QFP leads.\n\n2. Model Reliability Assessment: Self-Challenging stress perturbations confirmed stable localization under exposure and sensor noise shifts; optical blur marginally reduced boundary contrast.\n\n3. Immediate Containment & Preventive Action: Quarantine Lot LOT-SMT-2611A for automated X-ray verification, tighten stencil wipe frequency to every 5 boards, and recalibrate Zone 4 reflow profile to 245°C.',
      createdAt: hoursAgo(2),
    },
    {
      id: 2,
      passportCode: 'PX-FA-2026-1002',
      factoryId: 1,
      sample: STANDALONE_SAMPLES[1],
      batchNumber: 'LOT-SMT-2611B',
      componentSerial: 'SMD-R103-44907',
      reviewStatus: 'UNREVIEWED' as const,
      humanLabel: null,
      humanNotes: null,
      geminiReport:
        '1. Root-Cause Engineering Diagnosis: Asymmetric solder wetting and placement nozzle vacuum drift on Pick-and-Place Line A4 induced a 9-degree rotational skew on resistor R103.\n\n2. Model Reliability Assessment: High confidence on baseline frame; rotational perturbation indicates moderate sensitivity near small pad geometries.\n\n3. Immediate Containment & Preventive Action: Inspect feeder bank #3 nozzle alignment and verify pad coplanarity across the next 20 panels.',
      createdAt: hoursAgo(4),
    },
    {
      id: 3,
      passportCode: 'PX-FB-2026-2001',
      factoryId: 2,
      sample: STANDALONE_SAMPLES[2],
      batchNumber: 'LOT-CNC-2611C',
      componentSerial: 'TRN-FLG-31094',
      reviewStatus: 'CONFIRMED' as const,
      humanLabel: 'Hairline Crack',
      humanNotes: 'Verified via dye-penetrant check; spindle tool #7 exceeded 72% wear threshold.',
      geminiReport:
        '1. Root-Cause Engineering Diagnosis: Elevated spindle speed (11,400 RPM) paired with 72% carbide cutter wear and low coolant pressure generated thermal-mechanical stress cracking along the precision bore perimeter.\n\n2. Model Reliability Assessment: Strong edge-gradient contrast yields high structural detection stability across lighting and noise perturbations.\n\n3. Immediate Containment & Preventive Action: Halt 5-Axis CNC Cell B1 immediately, replace carbide insert #7, restore coolant nozzle pressure to 32 bar, and ultrasonic-scan remaining Lot LOT-CNC-2611C housings.',
      createdAt: hoursAgo(6),
    },
    {
      id: 4,
      passportCode: 'PX-FB-2026-2002',
      factoryId: 2,
      sample: STANDALONE_SAMPLES[3],
      batchNumber: 'LOT-STP-2611D',
      componentSerial: 'PNL-EXT-01288',
      reviewStatus: 'RECLASSIFIED' as const,
      humanLabel: 'Surface Dent',
      humanNotes: 'Confirmed shallow 0.18mm dent + secondary handling scratch from transfer gripper.',
      geminiReport:
        '1. Root-Cause Engineering Diagnosis: Localized die cushion pressure imbalance combined with debris on transfer press gripper caused a 0.18mm panel indentation and adjacent 12µm linear scratch.\n\n2. Model Reliability Assessment: Specular glare on brushed aluminum increases confidence variance; engineer verification confirmed true positive.\n\n3. Immediate Containment & Preventive Action: Clean upper die face on Stamping Press B3 and recalibrate cushion force to 620 kN.',
      createdAt: hoursAgo(9),
    },
    {
      id: 5,
      passportCode: 'PX-FC-2026-3001',
      factoryId: 3,
      sample: STANDALONE_SAMPLES[4],
      batchNumber: 'LOT-ECU-2611E',
      componentSerial: 'ECU-VG50-77210',
      reviewStatus: 'UNREVIEWED' as const,
      humanLabel: null,
      humanNotes: null,
      geminiReport:
        '1. Root-Cause Engineering Diagnosis: Post-solder aqueous wash pressure dropped to 26 PSI while coating cell humidity rose to 58% RH, leaving ionic white flux residue across TE Connectivity pins P1-P7.\n\n2. Model Reliability Assessment: Cross-factory signature matches Factory A flux thermal breakdown patterns; reliability remains stable under exposure shifts.\n\n3. Immediate Containment & Preventive Action: Hold ECU batch LOT-ECU-2611E from potting, raise wash pressure to 45 PSI, and inspect inline filtration cartridges.',
      createdAt: hoursAgo(12),
    },
  ];

  state.inspections = seedDefs.map((d) => {
    const fac = state.factories.find((f) => f.id === d.factoryId)!;
    const cv = runBrowserCV({ sector: d.sample.sector, sampleId: d.sample.id });
    return {
      id: d.id,
      passportCode: d.passportCode,
      factoryId: d.factoryId,
      factoryName: fac.name,
      factoryCode: fac.code,
      inspectorUid: 'system-simulated-aoi',
      sector: d.sample.sector,
      lineName: d.sample.lineName,
      batchNumber: d.batchNumber,
      componentSerial: d.componentSerial,
      imageUrl: d.sample.imageUrl,
      defectType: cv.defectType,
      severity: cv.severity,
      cvConfidence: cv.cvConfidence,
      anomalyScore: cv.anomalyScore,
      boundingBox: cv.boundingBox,
      cvMetrics: cv.cvMetrics,
      reliabilityScore: cv.reliabilityScore,
      reliabilityStatus: cv.reliabilityStatus,
      perturbationResults: cv.perturbationResults,
      geminiReport: d.geminiReport,
      humanReviewStatus: d.reviewStatus,
      humanLabel: d.humanLabel,
      humanNotes: d.humanNotes,
      reviewedByUid: d.reviewStatus !== 'UNREVIEWED' ? 'system-qa-lead' : null,
      reviewedAt: d.reviewStatus !== 'UNREVIEWED' ? hoursAgo(1) : null,
      isSimulated: true,
      createdAt: d.createdAt,
    };
  });

  state.maintenance = [
    {
      id: 1,
      factoryId: 1,
      equipmentCode: 'EQ-FA-RF02',
      equipmentName: '10-Zone Nitrogen Reflow Oven #2',
      lineName: 'SMT Reflow Line A2',
      healthScore: 68.4,
      failureProb7d: 0.29,
      failureProb30d: 0.64,
      rulHours: 148,
      primaryRiskFactor: 'Zone 4 thermocouple drift (+11°C) correlating with Solder Bridge spikes',
      recommendedAction: 'Replace Zone 4 heater SSR & run thermal profiler before next shift',
      status: 'MAINTENANCE_REQUIRED',
      lastServicedAt: hoursAgo(120),
      isSimulated: true,
      updatedAt: hoursAgo(1),
    },
    {
      id: 2,
      factoryId: 1,
      equipmentCode: 'EQ-FA-PP04',
      equipmentName: 'High-Speed Pick-and-Place Gantry A4',
      lineName: 'Pick-and-Place Line A4',
      healthScore: 81.2,
      failureProb7d: 0.14,
      failureProb30d: 0.37,
      rulHours: 410,
      primaryRiskFactor: 'Nozzle bank #3 vacuum decay causing 0402/0603 placement skew',
      recommendedAction: 'Clean rotary vacuum manifold & calibrate fiducial vision camera',
      status: 'WATCH',
      lastServicedAt: hoursAgo(96),
      isSimulated: true,
      updatedAt: hoursAgo(2),
    },
    {
      id: 3,
      factoryId: 2,
      equipmentCode: 'EQ-FB-CNC1',
      equipmentName: '5-Axis CNC Machining Center B1',
      lineName: '5-Axis CNC Cell B1',
      healthScore: 59.5,
      failureProb7d: 0.42,
      failureProb30d: 0.78,
      rulHours: 84,
      primaryRiskFactor: 'Spindle RMS vibration 3.6 mm/s & 72% cutter wear linked to bore cracks',
      recommendedAction: 'Immediate tool carousel swap & spindle bearing harmonic check',
      status: 'MAINTENANCE_REQUIRED',
      lastServicedAt: hoursAgo(144),
      isSimulated: true,
      updatedAt: hoursAgo(1),
    },
    {
      id: 4,
      factoryId: 2,
      equipmentCode: 'EQ-FB-STP3',
      equipmentName: '800-Ton Servo Stamping Press B3',
      lineName: 'Stamping Press Line B3',
      healthScore: 86.0,
      failureProb7d: 0.09,
      failureProb30d: 0.24,
      rulHours: 620,
      primaryRiskFactor: 'Minor hydraulic die cushion drift (+140 kN peak overshoot)',
      recommendedAction: 'Re-zero hydraulic pressure transducer during weekend PM window',
      status: 'WATCH',
      lastServicedAt: hoursAgo(72),
      isSimulated: true,
      updatedAt: hoursAgo(3),
    },
    {
      id: 5,
      factoryId: 3,
      equipmentCode: 'EQ-FC-CC02',
      equipmentName: 'Inline Aqueous Flux Washer & Coater C2',
      lineName: 'ECU Conformal Coat Line C2',
      healthScore: 72.8,
      failureProb7d: 0.24,
      failureProb30d: 0.55,
      rulHours: 196,
      primaryRiskFactor: 'Spray manifold pressure drop (26 PSI) leaving ionic flux residue on ECU headers',
      recommendedAction: 'Replace 5-micron inline DI water filter & descale spray nozzles',
      status: 'WATCH',
      lastServicedAt: hoursAgo(110),
      isSimulated: true,
      updatedAt: hoursAgo(2),
    },
    {
      id: 6,
      factoryId: 3,
      equipmentCode: 'EQ-FC-AOI1',
      equipmentName: '3D Structured-Light AOI Bridge C1',
      lineName: 'ECU Final Inspection Line C1',
      healthScore: 94.6,
      failureProb7d: 0.03,
      failureProb30d: 0.09,
      rulHours: 1420,
      primaryRiskFactor: 'Nominal LED coaxial illuminator intensity within 1.2% tolerance',
      recommendedAction: 'Continue routine weekly optical target calibration',
      status: 'NOMINAL',
      lastServicedAt: hoursAgo(24),
      isSimulated: true,
      updatedAt: hoursAgo(1),
    },
  ];

  const baseA = Object.fromEntries(FACTORY_TWIN_PROFILES.FACTORY_A.parameters.map((p) => [p.key, p.baseline]));
  const cfA = { ...baseA, reflowPeakTempC: 245, solderPasteViscosity: 195, stencilWipeInterval: 5 };
  const evalA = evaluateCounterfactualTwin('FACTORY_A', baseA, cfA);

  const baseB = Object.fromEntries(FACTORY_TWIN_PROFILES.FACTORY_B.parameters.map((p) => [p.key, p.baseline]));
  const cfB = { ...baseB, spindleRpm: 8600, toolWearIndexPct: 22, coolantPressureBar: 32 };
  const evalB = evaluateCounterfactualTwin('FACTORY_B', baseB, cfB);

  state.scenarios = [
    {
      id: 2,
      factoryId: 2,
      inspectionId: 3,
      createdByUid: 'system-simulated-twin',
      title: 'Carbide Tool Swap & Coolant Pressure Restoration',
      targetDefect: 'Hairline Crack',
      baselineParams: baseB,
      counterfactualParams: cfB,
      ...evalB,
      aiInvestigationSummary:
        'Swapping the worn carbide insert (72% to 22% wear), lowering spindle speed to 8,600 RPM, and restoring coolant pressure to 32 bar sharply mitigates thermal micro-cracking around precision bore edges.',
      isSimulated: true,
      createdAt: hoursAgo(5),
    },
    {
      id: 1,
      factoryId: 1,
      inspectionId: 1,
      createdByUid: 'system-simulated-twin',
      title: 'Reflow Profile & Stencil Wipe Stabilization',
      targetDefect: 'Solder Bridge',
      baselineParams: baseA,
      counterfactualParams: cfA,
      ...evalA,
      aiInvestigationSummary:
        'Restoring Reflow Peak Temperature to 245°C, increasing solder paste viscosity to 195 Pa·s, and tightening stencil wipe intervals to every 5 boards reduces predicted Solder Bridge probability by eliminating paste slump.',
      isSimulated: true,
      createdAt: hoursAgo(8),
    },
  ];

  state.users = [
    {
      id: 1,
      uid: 'simple-super_admin-a-sharma',
      email: 'a.sharma.super_admin@prometheus-sim.local',
      displayName: 'A. Sharma',
      role: 'SUPER_ADMIN',
      accountStatus: 'ACTIVE',
      emailVerified: true,
      createdAt: hoursAgo(72),
      factoryIds: [1, 2, 3],
    },
    {
      id: 2,
      uid: 'simple-quality_engineer-e-park',
      email: 'e.park.quality_engineer@prometheus-sim.local',
      displayName: 'E. Park',
      role: 'QUALITY_ENGINEER',
      accountStatus: 'ACTIVE',
      emailVerified: true,
      createdAt: hoursAgo(48),
      factoryIds: [1, 2, 3],
    },
    {
      id: 3,
      uid: 'simple-operator-m-lin',
      email: 'm.lin.operator@prometheus-sim.local',
      displayName: 'M. Lin',
      role: 'OPERATOR',
      accountStatus: 'ACTIVE',
      emailVerified: true,
      createdAt: hoursAgo(36),
      factoryIds: [1],
    },
  ];

  state.billing = [
    {
      id: 1,
      factoryId: 1,
      tier: 'ENTERPRISE',
      monthlyAmountUsd: 4800,
      billingPeriod: '2026-11',
      status: 'PAID',
      invoiceRef: 'INV-FA-202611',
      createdAt: hoursAgo(72),
    },
    {
      id: 2,
      factoryId: 2,
      tier: 'ENTERPRISE',
      monthlyAmountUsd: 4800,
      billingPeriod: '2026-11',
      status: 'PAID',
      invoiceRef: 'INV-FB-202611',
      createdAt: hoursAgo(72),
    },
    {
      id: 3,
      factoryId: 3,
      tier: 'GROWTH',
      monthlyAmountUsd: 2400,
      billingPeriod: '2026-11',
      status: 'PAID',
      invoiceRef: 'INV-FC-202611',
      createdAt: hoursAgo(72),
    },
  ];

  state.auditLogs = [
    {
      id: 1,
      requestId: 'req_standalone_init',
      actorUid: 'system',
      actorEmail: 'system@prometheus-sim.local',
      action: 'WORKSPACE_BOOTSTRAP',
      resourceType: 'SYSTEM',
      resourceId: null,
      factoryId: null,
      outcome: 'ALLOW',
      details: 'Initialized PROMETHEUS-X standalone deployment runtime.',
      createdAt: hoursAgo(1),
    },
  ];
}

function logAudit(action: string, resourceType: string, details: string, outcome: 'ALLOW' | 'DENY' = 'ALLOW', factoryId: number | null = null) {
  state.auditLogs.unshift({
    id: state.nextId++,
    requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
    actorUid: state.currentUser?.uid ?? 'anonymous',
    actorEmail: state.currentUser?.email ?? 'anonymous@prometheus-sim.local',
    action,
    resourceType,
    resourceId: null,
    factoryId,
    outcome,
    details,
    createdAt: new Date().toISOString(),
  });
}

function makeResponse<T>(config: AxiosRequestConfig, data: T, status = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: status === 201 ? 'Created' : 'OK',
    headers: {},
    config: config as InternalAxiosRequestConfig,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : STANDALONE_SAMPLES[0].imageUrl);
    reader.onerror = () => resolve(STANDALONE_SAMPLES[0].imageUrl);
    reader.readAsDataURL(file);
  });
}

function buildStandaloneAssistantReply(body: {
  activeTab: DashboardTabId;
  factoryId?: number | null;
  focusWidget?: string;
  message?: string;
}): string {
  const scopedFacs = body.factoryId
    ? state.factories.filter((f) => f.id === body.factoryId)
    : state.factories;
  const scopedIds = new Set(scopedFacs.map((f) => f.id));
  const ins = state.inspections.filter((i) => scopedIds.has(i.factoryId));
  const maint = state.maintenance.filter((m) => scopedIds.has(m.factoryId));
  const critIns = ins.filter((i) => i.severity === 'CRITICAL');
  const unstable = ins.filter((i) => i.reliabilityStatus !== 'RELIABLE');
  const critMaint = maint.filter((m) => m.status === 'MAINTENANCE_REQUIRED');
  const scopeLabel = scopedFacs.length === 1 ? scopedFacs[0].name : `All ${scopedFacs.length} Factories`;

  const topDefectMap = new Map<string, number>();
  for (const r of ins) {
    if (r.severity !== 'PASS') topDefectMap.set(r.defectType, (topDefectMap.get(r.defectType) ?? 0) + 1);
  }
  const topDefect = [...topDefectMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'None';
  const focusNote = body.focusWidget ? ` (Focused on **${body.focusWidget}**)` : '';

  return [
    `### What Is Shown on ${body.activeTab.toUpperCase()}${focusNote}`,
    `- **Active Scope:** ${scopeLabel} — **${ins.length} inspection passports**, **${critIns.length} critical defects**, and **${unstable.length} flagged for model reliability review**.`,
    `- **Dominant Defect Pattern:** **${topDefect}** is currently the leading defect class across the selected telemetry window.`,
    `- **Equipment Risk Status:** **${critMaint.length} asset(s)** currently require immediate maintenance (${critMaint.map((m) => `${m.equipmentName} — RUL ${m.rulHours}h`).join('; ') || 'all equipment nominal or watch'}).`,
    '',
    '### Diagnosis & Recommended Solution',
    `- **Root Cause:** Process drift in upstream thermal/mechanical parameters (reflow peak temperature +11°C on Line A2, carbide tool wear at 72% on CNC Cell B1, and 26 PSI wash pressure on ECU Line C2) is directly driving **${topDefect}** detections.`,
    `- **Immediate Fix:** ${critMaint[0]?.recommendedAction ?? 'Stabilize nominal process parameters in the 3D Factory Twin and confirm pending human review passports.'}`,
    body.message ? `- **Regarding your question ("${body.message.slice(0, 90)}"):** Cross-check the Defect Heat Map concentration against the 3D Factory Twin before/after sliders to validate defect probability reduction before applying changes on the physical line.` : '',
    '',
    '### What Should Be Made Next',
    `- Quarantine affected lots linked to **${critIns[0]?.passportCode ?? ins[0]?.passportCode ?? 'latest passport'}** and complete QA sign-off in **Human Review**.`,
    '- Apply the nominal target setpoints in **3D Factory Twin** (Reflow 245°C / Tool Wear <25% / Wash Pressure 45 PSI) and dispatch preventive work orders in **Maintenance**.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function handleStaticDemoRequest(
  config: AxiosRequestConfig
): Promise<AxiosResponse> {
  initStandaloneState();

  const method = (config.method || 'get').toUpperCase();
  const rawUrl = config.url || '/';
  const [pathOnly, queryString] = rawUrl.split('?');
  const path = pathOnly.replace(/^\/api/, '') || '/';
  const query = new URLSearchParams(queryString || '');
  if (config.params && typeof config.params === 'object') {
    for (const [k, v] of Object.entries(config.params as Record<string, unknown>)) {
      if (v !== undefined && v !== null) query.set(k, String(v));
    }
  }

  const parsedBody =
    typeof config.data === 'string'
      ? (() => {
          try {
            return JSON.parse(config.data);
          } catch {
            return {};
          }
        })()
      : config.data || {};

  // Public health endpoint
  if (method === 'GET' && path === '/health') {
    return makeResponse(config, {
      status: 'ok',
      service: 'PROMETHEUS-X API (Standalone Deployment Runtime)',
      database: 'in-browser-seeded',
      timestamp: new Date().toISOString(),
      counts: {
        factories: state.factories.length,
        inspections: state.inspections.length,
        maintenanceForecasts: state.maintenance.length,
        counterfactualScenarios: state.scenarios.length,
      },
    });
  }

  // Simple login
  if (method === 'POST' && path === '/auth/simple-login') {
    const role: AppRole = ['SUPER_ADMIN', 'FACTORY_ADMIN', 'QUALITY_ENGINEER', 'OPERATOR'].includes(
      parsedBody.role
    )
      ? parsedBody.role
      : 'SUPER_ADMIN';
    const displayName =
      typeof parsedBody.displayName === 'string' && parsedBody.displayName.trim()
        ? parsedBody.displayName.trim().slice(0, 60)
        : role === 'SUPER_ADMIN'
          ? 'A. Sharma'
          : role === 'QUALITY_ENGINEER'
            ? 'E. Park'
            : 'M. Lin';

    const authorizedFactoryIds =
      role === 'OPERATOR' ? [state.factories[0]?.id ?? 1] : state.factories.map((f) => f.id);
    const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'user';
    const uid = `simple-${role.toLowerCase()}-${slug}`;
    const email = `${slug}.${role.toLowerCase()}@prometheus-sim.local`;

    state.currentUser = {
      id: 1,
      uid,
      email,
      displayName,
      role,
      accountStatus: 'ACTIVE',
      emailVerified: true,
      authorizedFactoryIds,
    };

    const accessibleFactories = state.factories.filter((f) =>
      authorizedFactoryIds.includes(f.id)
    );
    logAudit('SIMPLE_WORKSPACE_LOGIN', 'SESSION', `Started standalone workspace session for ${role}.`);

    return makeResponse(config, {
      token: `standalone.${btoa(uid)}`,
      user: state.currentUser,
      factories: accessibleFactories,
      twinProfiles: FACTORY_TWIN_PROFILES,
    });
  }

  // Ensure session exists
  const user = state.currentUser;
  if (!user) {
    throw Object.assign(new Error('Authentication required.'), {
      isAxiosError: true,
      response: { status: 401, data: { error: 'Authentication required.' } },
    });
  }

  const allowedIds = new Set(user.authorizedFactoryIds);
  const scopedFactories = state.factories.filter((f) => allowedIds.has(f.id));

  if (method === 'GET' && path === '/me') {
    return makeResponse(config, {
      user,
      factories: scopedFactories,
      twinProfiles: FACTORY_TWIN_PROFILES,
    });
  }

  if (method === 'GET' && path === '/factories') {
    return makeResponse(config, scopedFactories);
  }

  if (method === 'GET' && path === '/samples') {
    return makeResponse(config, STANDALONE_SAMPLES);
  }

  if (method === 'GET' && path === '/inspections') {
    const fId = query.get('factoryId');
    let list = state.inspections.filter((i) => allowedIds.has(i.factoryId));
    if (fId) {
      const n = Number(fId);
      list = list.filter((i) => i.factoryId === n);
    }
    return makeResponse(config, list);
  }

  if (method === 'POST' && path === '/inspections/analyze') {
    const fd = config.data instanceof FormData ? config.data : null;
    const factoryId = Number(fd ? fd.get('factoryId') : parsedBody.factoryId) || scopedFactories[0]?.id || 1;
    const sampleId = String((fd ? fd.get('sampleId') : parsedBody.sampleId) || '');
    const lineNameInput = String((fd ? fd.get('lineName') : parsedBody.lineName) || '').trim();
    const batchInput = String((fd ? fd.get('batchNumber') : parsedBody.batchNumber) || '').trim();
    const serialInput = String((fd ? fd.get('componentSerial') : parsedBody.componentSerial) || '').trim();
    const statsRaw = fd ? fd.get('clientSignalStats') : parsedBody.clientSignalStats;
    const imageFile = fd ? fd.get('image') : null;

    let clientSignalStats:
      | { edgeDensity?: number; contrastVariance?: number; luminanceMean?: number }
      | undefined;
    if (typeof statsRaw === 'string' && statsRaw.trim()) {
      try {
        clientSignalStats = JSON.parse(statsRaw);
      } catch {}
    }

    const factory = state.factories.find((f) => f.id === factoryId) ?? scopedFactories[0];
    const matchedSample = STANDALONE_SAMPLES.find((s) => s.id === sampleId);
    const isSimulated = !(imageFile instanceof File);
    const imageUrl =
      imageFile instanceof File
        ? await readFileAsDataUrl(imageFile)
        : matchedSample?.imageUrl ?? STANDALONE_SAMPLES[0].imageUrl;

    const cv = runBrowserCV({
      sector: factory.sector,
      sampleId: matchedSample?.id,
      seedKey: imageFile instanceof File ? `${imageFile.name}:${imageFile.size}` : `${factory.code}:${Date.now()}`,
      clientSignalStats,
    });

    const prefix =
      factory.code === 'FACTORY_A' ? 'FA' : factory.code === 'FACTORY_B' ? 'FB' : 'FC';
    const newId = state.nextId++;
    const record: InspectionRecord = {
      id: newId,
      passportCode: `PX-${prefix}-2026-${String(100000 + newId).slice(-6)}`,
      factoryId: factory.id,
      factoryName: factory.name,
      factoryCode: factory.code,
      inspectorUid: user.uid,
      sector: factory.sector,
      lineName: lineNameInput || matchedSample?.lineName || `${factory.code} Inspection Line`,
      batchNumber: batchInput || `LOT-${prefix}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`,
      componentSerial: serialInput || `${matchedSample?.componentPrefix ?? 'UNIT'}-${newId}`,
      imageUrl,
      defectType: cv.defectType,
      severity: cv.severity,
      cvConfidence: cv.cvConfidence,
      anomalyScore: cv.anomalyScore,
      boundingBox: cv.boundingBox,
      cvMetrics: cv.cvMetrics,
      reliabilityScore: cv.reliabilityScore,
      reliabilityStatus: cv.reliabilityStatus,
      perturbationResults: cv.perturbationResults,
      geminiReport: null,
      humanReviewStatus: 'UNREVIEWED',
      humanLabel: null,
      humanNotes: null,
      reviewedByUid: null,
      reviewedAt: null,
      isSimulated,
      createdAt: new Date().toISOString(),
    };

    state.inspections.unshift(record);
    logAudit('INSPECTION_ANALYZE', 'INSPECTION', `Recorded ${record.passportCode} (${record.defectType}).`, 'ALLOW', factory.id);
    return makeResponse(config, record, 201);
  }

  const explainMatch = path.match(/^\/inspections\/(\d+)\/explain$/);
  if (method === 'POST' && explainMatch) {
    const id = Number(explainMatch[1]);
    const rec = state.inspections.find((i) => i.id === id);
    if (!rec) {
      throw Object.assign(new Error('Inspection not found.'), {
        isAxiosError: true,
        response: { status: 404, data: { error: 'Inspection not found.' } },
      });
    }
    const drifted = rec.perturbationResults.filter((p) => !p.consistent).map((p) => p.name);
    rec.geminiReport = [
      `1. Root-Cause Engineering Diagnosis: Detected **${rec.defectType}** (${rec.severity}) on ${rec.lineName} (${rec.factoryName}) with ${Math.round(rec.cvConfidence * 100)}% CV confidence and Sobel peak ${rec.cvMetrics.sobelPeak}. Signal anomalies point to upstream process drift in thermal/mechanical tolerances.`,
      '',
      `2. Model Reliability Assessment: Self-Challenging 5-perturbation score is ${rec.reliabilityScore.toFixed(1)}% (${rec.reliabilityStatus}). ${drifted.length > 0 ? `Confidence drifted under: ${drifted.join(', ')}. Recommend QA visual confirmation.` : 'All 5 optical perturbations remained consistent.'}`,
      '',
      `3. Immediate Containment & Preventive Action: Hold lot ${rec.batchNumber} for secondary verification, run a before/after setpoint simulation in the 3D Factory Twin, and schedule targeted preventive calibration on ${rec.lineName}.`,
    ].join('\n');
    return makeResponse(config, { ...rec });
  }

  const feedbackMatch = path.match(/^\/inspections\/(\d+)\/feedback$/);
  if (method === 'PATCH' && feedbackMatch) {
    if (user.role === 'OPERATOR') {
      throw Object.assign(new Error('Quality Engineer or Admin role required.'), {
        isAxiosError: true,
        response: { status: 403, data: { error: 'Quality Engineer or Admin role required.' } },
      });
    }
    const id = Number(feedbackMatch[1]);
    const rec = state.inspections.find((i) => i.id === id);
    if (!rec) {
      throw Object.assign(new Error('Inspection not found.'), {
        isAxiosError: true,
        response: { status: 404, data: { error: 'Inspection not found.' } },
      });
    }
    rec.humanReviewStatus = parsedBody.humanReviewStatus || 'CONFIRMED';
    rec.humanLabel = parsedBody.humanLabel ?? rec.defectType;
    rec.humanNotes = parsedBody.humanNotes ?? '';
    rec.reviewedByUid = user.uid;
    rec.reviewedAt = new Date().toISOString();
    logAudit('HUMAN_FEEDBACK_VERDICT', 'INSPECTION', `Marked ${rec.passportCode} as ${rec.humanReviewStatus}.`, 'ALLOW', rec.factoryId);
    return makeResponse(config, { ...rec });
  }

  if (method === 'GET' && path === '/counterfactuals') {
    return makeResponse(
      config,
      state.scenarios.filter((s) => allowedIds.has(s.factoryId))
    );
  }

  if (method === 'POST' && path === '/counterfactuals') {
    const factory = state.factories.find((f) => f.id === Number(parsedBody.factoryId)) ?? scopedFactories[0];
    const evalOut = evaluateCounterfactualTwin(
      factory.code,
      parsedBody.baselineParams || {},
      parsedBody.counterfactualParams || {}
    );
    const created: CounterfactualScenarioRecord = {
      id: state.nextId++,
      factoryId: factory.id,
      inspectionId: parsedBody.inspectionId ?? null,
      createdByUid: user.uid,
      title: parsedBody.title || 'Counterfactual Process Optimization',
      targetDefect: parsedBody.targetDefect || 'Defect',
      baselineParams: parsedBody.baselineParams || {},
      counterfactualParams: parsedBody.counterfactualParams || {},
      ...evalOut,
      aiInvestigationSummary: `Simulated Twin Brief: Adjusting process parameters shifts predicted ${parsedBody.targetDefect || 'defect'} probability from ${(evalOut.baselineDefectProb * 100).toFixed(1)}% to ${(evalOut.predictedDefectProb * 100).toFixed(1)}% (${evalOut.riskDeltaPct > 0 ? '+' : ''}${evalOut.riskDeltaPct.toFixed(1)} pp).`,
      isSimulated: true,
      createdAt: new Date().toISOString(),
    };
    state.scenarios.unshift(created);
    return makeResponse(config, created, 201);
  }

  if (method === 'GET' && path === '/maintenance') {
    return makeResponse(
      config,
      state.maintenance.filter((m) => allowedIds.has(m.factoryId))
    );
  }

  const maintMatch = path.match(/^\/maintenance\/(\d+)\/schedule$/);
  if (method === 'POST' && maintMatch) {
    if (user.role === 'OPERATOR') {
      throw Object.assign(new Error('Quality Engineer or Admin role required.'), {
        isAxiosError: true,
        response: { status: 403, data: { error: 'Quality Engineer or Admin role required.' } },
      });
    }
    const id = Number(maintMatch[1]);
    const item = state.maintenance.find((m) => m.id === id);
    if (!item) {
      throw Object.assign(new Error('Maintenance asset not found.'), {
        isAxiosError: true,
        response: { status: 404, data: { error: 'Maintenance asset not found.' } },
      });
    }
    item.status = 'SCHEDULED';
    item.updatedAt = new Date().toISOString();
    logAudit('MAINTENANCE_SCHEDULED', 'EQUIPMENT', `Scheduled work order for ${item.equipmentCode}.`, 'ALLOW', item.factoryId);
    return makeResponse(config, { ...item });
  }

  if (method === 'GET' && path === '/cross-factory/analytics') {
    const insRows = state.inspections.filter((i) => allowedIds.has(i.factoryId));
    const maintRows = state.maintenance.filter((m) => allowedIds.has(m.factoryId));
    const factorySummaries = scopedFactories.map((f) => {
      const fIns = insRows.filter((i) => i.factoryId === f.id);
      const defects = fIns.filter((i) => i.severity !== 'PASS');
      const avgRel =
        fIns.length > 0 ? fIns.reduce((acc, r) => acc + r.reliabilityScore, 0) / fIns.length : 100;
      const counts = new Map<string, number>();
      for (const d of defects) counts.set(d.defectType, (counts.get(d.defectType) ?? 0) + 1);
      const topDefect = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'None';
      return {
        id: f.id,
        code: f.code,
        name: f.name,
        sector: f.sector,
        location: f.location,
        isSimulated: f.isSimulated,
        totalInspections: fIns.length,
        defectCount: defects.length,
        defectRatePct: fIns.length > 0 ? Math.round((defects.length / fIns.length) * 1000) / 10 : 0,
        avgReliability: Math.round(avgRel * 10) / 10,
        reviewFlaggedCount: fIns.filter((i) => i.reliabilityStatus !== 'RELIABLE').length,
        topDefect,
        criticalEquipment: maintRows.filter((m) => m.factoryId === f.id && m.status === 'MAINTENANCE_REQUIRED').length,
      };
    });

    const defectMap = new Map<string, { defectType: string; count: number; avgConfidence: number }>();
    for (const r of insRows) {
      if (r.severity === 'PASS') continue;
      const cur = defectMap.get(r.defectType) ?? { defectType: r.defectType, count: 0, avgConfidence: 0 };
      cur.avgConfidence = (cur.avgConfidence * cur.count + r.cvConfidence * 100) / (cur.count + 1);
      cur.count += 1;
      defectMap.set(r.defectType, cur);
    }

    const reviewed = insRows.filter((i) => i.humanReviewStatus !== 'UNREVIEWED');
    const confirmed = reviewed.filter((i) => i.humanReviewStatus === 'CONFIRMED').length;

    return makeResponse(config, {
      factories: factorySummaries,
      defectDistribution: [...defectMap.values()].map((d) => ({
        ...d,
        avgConfidence: Math.round(d.avgConfidence * 10) / 10,
      })),
      feedbackSummary: {
        totalInspections: insRows.length,
        reviewedCount: reviewed.length,
        pendingReviewCount: insRows.length - reviewed.length,
        confirmedCount: confirmed,
        falsePositiveCount: reviewed.filter((i) => i.humanReviewStatus === 'FALSE_POSITIVE').length,
        reclassifiedCount: reviewed.filter((i) => i.humanReviewStatus === 'RECLASSIFIED').length,
        agreementRatePct: reviewed.length > 0 ? Math.round((confirmed / reviewed.length) * 1000) / 10 : 100,
      },
    });
  }

  if (method === 'POST' && path === '/cross-factory/digest') {
    return makeResponse(config, {
      digest:
        'Cross-Factory Transfer Summary:\n• Factory A (SMT Electronics) thermal solder-flux drift transfers directly to Factory C (Automotive ECU) header contamination patterns, accelerating detection calibration across sites.\n• Factory B (Automotive Components) specular-glare edge detectors strengthen AOI glare resilience on Factory C brushed aluminum housings.\n• Priority Next-Shift Action: Stabilize Reflow Oven #2 (+11°C Zone 4 drift), replace CNC Cell B1 worn carbide tool #7, and raise ECU Flux Washer C2 manifold pressure to 45 PSI.',
      generatedAt: new Date().toISOString(),
    });
  }

  if (method === 'POST' && path === '/assistant/chat') {
    const reply = buildStandaloneAssistantReply(parsedBody);
    return makeResponse(config, {
      reply,
      dashboardLabel: String(parsedBody.activeTab || 'overview'),
      scopeLabel: parsedBody.factoryId ? `Factory #${parsedBody.factoryId}` : 'All Sites',
      generatedAt: new Date().toISOString(),
    });
  }

  if (method === 'GET' && path === '/dataset/export') {
    const format = query.get('format') === 'csv' ? 'csv' : 'json';
    const insRows = state.inspections.filter((i) => allowedIds.has(i.factoryId));
    if (format === 'csv') {
      const headers = [
        'id', 'passportCode', 'factoryCode', 'factoryName', 'lineName', 'batchNumber',
        'componentSerial', 'defectType', 'severity', 'cvConfidence', 'anomalyScore',
        'reliabilityScore', 'reliabilityStatus', 'humanReviewStatus', 'humanLabel',
        'isSimulated', 'createdAt',
      ];
      const csvCell = (val: unknown) => {
        if (val === null || val === undefined) return '';
        let s = String(val);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [
        headers.join(','),
        ...insRows.map((r) =>
          [
            r.id, r.passportCode, r.factoryCode, r.factoryName, r.lineName, r.batchNumber,
            r.componentSerial, r.defectType, r.severity, r.cvConfidence, r.anomalyScore,
            r.reliabilityScore, r.reliabilityStatus, r.humanReviewStatus, r.humanLabel,
            r.isSimulated, r.createdAt,
          ]
            .map(csvCell)
            .join(',')
        ),
      ];
      return makeResponse(config, new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    }
    const payload = JSON.stringify(
      {
        dataset: 'PROMETHEUS-X Industrial Quality & Reliability Dataset',
        exportedAt: new Date().toISOString(),
        counts: {
          factories: scopedFactories.length,
          inspections: insRows.length,
          maintenanceForecasts: state.maintenance.length,
          counterfactualScenarios: state.scenarios.length,
        },
        factories: scopedFactories,
        inspections: insRows,
        maintenanceForecasts: state.maintenance,
        counterfactualScenarios: state.scenarios,
        simulatedSamples: STANDALONE_SAMPLES,
      },
      null,
      2
    );
    return makeResponse(config, new Blob([payload], { type: 'application/json;charset=utf-8' }));
  }

  // Admin endpoints
  if (method === 'GET' && path === '/admin/overview') {
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'FACTORY_ADMIN') {
      throw Object.assign(new Error('Admin role required.'), {
        isAxiosError: true,
        response: { status: 403, data: { error: 'Admin role required.' } },
      });
    }
    return makeResponse(config, {
      users: state.users,
      factories: scopedFactories,
      invitations: state.invitations,
      billing: state.billing,
      auditLogs: state.auditLogs,
    });
  }

  if (method === 'POST' && path === '/admin/factories') {
    if (user.role !== 'SUPER_ADMIN') {
      throw Object.assign(new Error('Super Admin role required.'), {
        isAxiosError: true,
        response: { status: 403, data: { error: 'Super Admin role required.' } },
      });
    }
    const newFac: FactoryRecord = {
      id: state.nextId++,
      code: String(parsedBody.code || 'FACTORY_NEW').toUpperCase(),
      name: String(parsedBody.name || 'New Manufacturing Site'),
      sector: String(parsedBody.sector || 'Electronics & Semiconductor'),
      location: String(parsedBody.location || 'Global Site'),
      subscriptionTier: parsedBody.subscriptionTier || 'GROWTH',
      status: 'ACTIVE',
      isSimulated: true,
      createdAt: new Date().toISOString(),
    };
    state.factories.push(newFac);
    user.authorizedFactoryIds.push(newFac.id);
    return makeResponse(config, newFac, 201);
  }

  const tierMatch = path.match(/^\/admin\/factories\/(\d+)\/tier$/);
  if (method === 'PATCH' && tierMatch) {
    const id = Number(tierMatch[1]);
    const fac = state.factories.find((f) => f.id === id);
    if (fac) fac.subscriptionTier = parsedBody.subscriptionTier || fac.subscriptionTier;
    return makeResponse(config, fac ?? {});
  }

  if (method === 'POST' && path === '/admin/invitations') {
    const inv: InvitationRecord = {
      id: state.nextId++,
      email: String(parsedBody.email || 'user@prometheus-sim.local'),
      factoryId: Number(parsedBody.factoryId) || 1,
      assignedRole: parsedBody.assignedRole || 'QUALITY_ENGINEER',
      invitedByUid: user.uid,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    state.invitations.unshift(inv);
    return makeResponse(config, inv, 201);
  }

  const userMatch = path.match(/^\/admin\/users\/(\d+)$/);
  if (method === 'PATCH' && userMatch) {
    const id = Number(userMatch[1]);
    const target = state.users.find((u) => u.id === id);
    if (target) {
      if (parsedBody.role) target.role = parsedBody.role;
      if (parsedBody.accountStatus) target.accountStatus = parsedBody.accountStatus;
    }
    return makeResponse(config, target ?? {});
  }

  throw Object.assign(new Error(`Unsupported endpoint ${method} ${path}`), {
    isAxiosError: true,
    response: { status: 404, data: { error: 'API endpoint not found.' } },
  });
}

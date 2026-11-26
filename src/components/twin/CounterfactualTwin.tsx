import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Crosshair,
  FileCheck2,
  FileText,
  RotateCcw,
  Save,
  ScanLine,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { apiClient, extractApiError } from '../../lib/api';
import {
  evaluateCounterfactualTwin,
  FACTORY_TWIN_PROFILES,
  scanFactoryTwinDefect,
  type TwinScanResult,
} from '../../lib/counterfactual-engine';
import {
  buildFactoryLineStatus,
  buildStationSummaries,
  mapInspectionToStation,
  type TwinStationId,
} from '../../lib/twin-station-mapper';
import type {
  CounterfactualScenarioRecord,
  FactoryRecord,
  InspectionRecord,
  MaintenanceForecastRecord,
} from '../../types/prometheus';
import {
  formatDateTime,
  formatPercent,
  reliabilityTextClass,
  severityTextClass,
} from '../../lib/utils';
import { useTheme } from '../../context/ThemeContext';
import { Button, Input, Select } from '../ui/primitives';
import { FactoryTwin3D, type CameraPreset } from './FactoryTwin3D';

export function CounterfactualTwin({
  factories,
  globalFactoryId = 'ALL',
  inspections,
  maintenance,
  scenarios,
  onScenarioSaved,
  onInspectionCreated,
  onOpenPassport,
}: {
  factories: FactoryRecord[];
  globalFactoryId?: number | 'ALL';
  inspections: InspectionRecord[];
  maintenance: MaintenanceForecastRecord[];
  scenarios: CounterfactualScenarioRecord[];
  onScenarioSaved: (record: CounterfactualScenarioRecord) => void;
  onInspectionCreated?: (record: InspectionRecord) => void;
  onOpenPassport?: (record: InspectionRecord) => void;
}) {
  const { isDark } = useTheme();
  const [selectedFactoryId, setSelectedFactoryId] = useState<number>(
    globalFactoryId !== 'ALL' ? globalFactoryId : (factories[0]?.id ?? 0)
  );

  useEffect(() => {
    if (globalFactoryId !== 'ALL') {
      setSelectedFactoryId(globalFactoryId);
    } else if (!selectedFactoryId && factories.length > 0) {
      setSelectedFactoryId(factories[0].id);
    }
  }, [globalFactoryId, factories, selectedFactoryId]);

  const selectedFactory = factories.find((f) => f.id === selectedFactoryId) ?? factories[0];
  const profile =
    FACTORY_TWIN_PROFILES[selectedFactory?.code || 'FACTORY_A'] ??
    FACTORY_TWIN_PROFILES.FACTORY_A;

  const baselineParams = useMemo(
    () => Object.fromEntries(profile.parameters.map((p) => [p.key, p.baseline])),
    [profile]
  );

  const nominalParamsMap = useMemo(
    () => Object.fromEntries(profile.parameters.map((p) => [p.key, p.nominal])),
    [profile]
  );

  const [cfParams, setCfParams] = useState<Record<string, number>>(baselineParams);
  const [simulationPhase, setSimulationPhase] = useState<'before' | 'after'>('after');
  const [selectedStationId, setSelectedStationId] = useState<TwinStationId | null>('station1');
  const [title, setTitle] = useState('');
  const [includeGemini, setIncludeGemini] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestSaved, setLatestSaved] = useState<CounterfactualScenarioRecord | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanResult, setScanResult] = useState<TwinScanResult | null>(null);
  const [cameraCommand, setCameraCommand] = useState<{ preset: CameraPreset; seq: number } | null>(
    null
  );
  const [loggingPassport, setLoggingPassport] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const scanTimerRef = useRef<number | null>(null);
  const latestParamsRef = useRef(cfParams);
  latestParamsRef.current = cfParams;

  const stopActiveScanTimer = useCallback(() => {
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    stopActiveScanTimer();
    setIsScanning(false);
    setScanProgress(0);
    setScanResult(null);
    setScanError(null);
    setCfParams(baselineParams);
    setSimulationPhase('after');
    setTitle(`${profile.defaultTargetDefect} Stabilization`);
  }, [baselineParams, profile.defaultTargetDefect, stopActiveScanTimer]);

  useEffect(() => () => stopActiveScanTimer(), [stopActiveScanTimer]);

  // Filter actual inspection & maintenance records for the selected factory
  const factoryInspections = useMemo(
    () =>
      inspections
        .filter((i) => !selectedFactory || i.factoryId === selectedFactory.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [inspections, selectedFactory]
  );

  const factoryMaintenance = useMemo(
    () =>
      maintenance.filter((m) => !selectedFactory || m.factoryId === selectedFactory.id),
    [maintenance, selectedFactory]
  );

  const stationSummaries = useMemo(
    () => buildStationSummaries(profile.factoryCode, factoryInspections, factoryMaintenance),
    [profile.factoryCode, factoryInspections, factoryMaintenance]
  );

  const lineStatus = useMemo(
    () => buildFactoryLineStatus(factoryInspections, factoryMaintenance),
    [factoryInspections, factoryMaintenance]
  );

  const defectiveWorkpieces = useMemo(
    () => factoryInspections.filter((i) => i.severity !== 'PASS'),
    [factoryInspections]
  );

  const liveSim = useMemo(
    () => evaluateCounterfactualTwin(profile.factoryCode, baselineParams, cfParams),
    [profile.factoryCode, baselineParams, cfParams]
  );

  // Before/After values sent into the 3D scene
  const active3DParams = simulationPhase === 'before' ? baselineParams : cfParams;
  const active3DRisk =
    simulationPhase === 'before' ? liveSim.baselineDefectProb : liveSim.predictedDefectProb;
  const active3DDelta = simulationPhase === 'before' ? 0 : liveSim.riskDeltaPct;

  const issueCameraCommand = useCallback((preset: CameraPreset) => {
    setCameraCommand((prev) => ({ preset, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleSelectStationWithCamera = useCallback(
    (stationId: TwinStationId | null) => {
      setSelectedStationId(stationId);
      if (stationId) {
        issueCameraCommand(stationId);
      } else {
        issueCameraCommand('isometric');
      }
    },
    [issueCameraCommand]
  );

  const runOpticalDefectScan = useCallback(
    (overrideParams?: Record<string, number>) => {
      stopActiveScanTimer();
      setScanError(null);
      setIsScanning(true);
      setScanProgress(0);
      issueCameraCommand('scan');

      const startedAt = performance.now();
      const durationMs = 1450;

      scanTimerRef.current = window.setInterval(() => {
        const elapsed = performance.now() - startedAt;
        const pct = Math.min(100, (elapsed / durationMs) * 100);
        setScanProgress(pct);

        if (pct >= 100) {
          stopActiveScanTimer();
          const activeParams =
            overrideParams ??
            (simulationPhase === 'before' ? baselineParams : latestParamsRef.current);
          const result = scanFactoryTwinDefect(profile.factoryCode, activeParams);
          setScanResult(result);
          setIsScanning(false);
          if (result.defectDetected) {
            setTitle(`${result.defectType} 3D Scan Stabilization`);
            setSelectedStationId(result.originStation);
          }
        }
      }, 45);
    },
    [baselineParams, issueCameraCommand, profile.factoryCode, simulationPhase, stopActiveScanTimer]
  );

  const handleApplyNominal = () => {
    setCfParams(nominalParamsMap);
    setSimulationPhase('after');
  };

  const handleFixNominalAndRescan = () => {
    setCfParams(nominalParamsMap);
    setSimulationPhase('after');
    latestParamsRef.current = nominalParamsMap;
    runOpticalDefectScan(nominalParamsMap);
  };

  const handleLogDefectPassport = async () => {
    if (!selectedFactory || !scanResult) return;
    setLoggingPassport(true);
    setScanError(null);
    try {
      const formData = new FormData();
      formData.append('factoryId', String(selectedFactory.id));
      formData.append('sampleId', scanResult.sampleIdForPassport);
      formData.append('lineName', scanResult.originStationLabel);
      formData.append('batchNumber', `TWIN-${scanResult.scanId.replace('SCAN-', '')}`);
      formData.append(
        'clientSignalStats',
        JSON.stringify({
          edgeDensity: Math.min(0.95, Math.max(0.08, scanResult.measuredTelemetry.surfaceAnomalyIdx)),
          contrastVariance: Math.min(
            110,
            Math.max(12, 24 + scanResult.measuredTelemetry.deviationMicrons * 0.45)
          ),
          luminanceMean: 118,
        })
      );

      const { data } = await apiClient.post<InspectionRecord>('/inspections/analyze', formData);
      onInspectionCreated?.(data);
      setSelectedStationId(scanResult.originStation);
      onOpenPassport?.(data);
    } catch (err) {
      setScanError(extractApiError(err, 'Unable to create Digital Defect Passport from 3D scan.'));
    } finally {
      setLoggingPassport(false);
    }
  };

  const handleSaveScenario = async () => {
    if (!selectedFactory) return;
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiClient.post<CounterfactualScenarioRecord>('/counterfactuals', {
        factoryId: selectedFactory.id,
        title: title.trim() || `${profile.defaultTargetDefect} 3D Twin Scenario`,
        targetDefect: scanResult?.defectDetected ? scanResult.defectType : profile.defaultTargetDefect,
        baselineParams,
        counterfactualParams: cfParams,
        includeGeminiBrief: includeGemini,
      });
      setLatestSaved(data);
      onScenarioSaved(data);
    } catch (err) {
      setError(extractApiError(err, 'Unable to save counterfactual simulation.'));
    } finally {
      setSaving(false);
    }
  };

  const severityColorClass =
    scanResult?.severity === 'CRITICAL' || scanResult?.severity === 'HIGH'
      ? 'text-red-700 dark:text-red-400'
      : scanResult?.severity === 'MEDIUM' || scanResult?.severity === 'LOW'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-emerald-700 dark:text-emerald-400';

  const activeStationSummary = selectedStationId ? stationSummaries[selectedStationId] : null;
  const displayedStationInspections = activeStationSummary
    ? activeStationSummary.inspections
    : factoryInspections;

  const beforeYieldPct = Math.max(0, (1 - liveSim.baselineDefectProb) * 100);
  const afterYieldPct = Math.max(0, (1 - liveSim.predictedDefectProb) * 100);
  const yieldGainPct = afterYieldPct - beforeYieldPct;
  const defectsAvoidedPer10k = Math.round(
    (liveSim.baselineDefectProb - liveSim.predictedDefectProb) * 10000
  );

  return (
    <div className="space-y-6">
      <FactoryTwin3D
        factoryCode={selectedFactory?.code || 'FACTORY_A'}
        factoryName={selectedFactory?.name || 'Factory A — Electronics Manufacturing'}
        targetDefect={scanResult?.defectDetected ? scanResult.defectType : profile.defaultTargetDefect}
        params={active3DParams}
        predictedDefectProb={active3DRisk}
        riskDeltaPct={active3DDelta}
        scanResult={scanResult}
        isScanning={isScanning}
        scanProgress={scanProgress}
        onTriggerScan={() => runOpticalDefectScan()}
        onDismissScan={() => setScanResult(null)}
        cameraCommand={cameraCommand}
        stationSummaries={stationSummaries}
        lineStatus={lineStatus}
        selectedStationId={selectedStationId}
        onSelectStation={setSelectedStationId}
        defectiveWorkpieces={defectiveWorkpieces}
        onSelectWorkpiecePassport={(rec) => {
          setSelectedStationId(mapInspectionToStation(rec, profile.factoryCode));
          onOpenPassport?.(rec);
        }}
        simulationPhase={simulationPhase}
        onToggleSimulationPhase={setSimulationPhase}
      />

      {/* Explicit Live / Simulated Line Status & Station Camera Bar */}
      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400 block">Line Status</span>
              <span
                className={`font-semibold ${
                  lineStatus.operationalStatus === 'ALERT'
                    ? 'text-red-700 dark:text-red-400'
                    : lineStatus.operationalStatus === 'WATCH'
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {lineStatus.operationalLabel}
              </span>
            </div>

            <div className="h-7 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

            <div>
              <span className="text-slate-500 dark:text-slate-400 block">Telemetry Source</span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {lineStatus.dataModeLabel}
              </span>
            </div>

            <div className="h-7 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

            <div>
              <span className="text-slate-500 dark:text-slate-400 block">Active Alerts</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                {lineStatus.activeAlertCount} alerts · {lineStatus.defectiveCount} defective units
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <Camera className="h-3.5 w-3.5" />
              Station Presets:
            </span>
            {(
              [
                ['station1', stationSummaries.station1],
                ['station2', stationSummaries.station2],
                ['station3', stationSummaries.station3],
              ] as Array<[TwinStationId, (typeof stationSummaries)['station1']]>
            ).map(([id, summary]) => (
              <button
                key={id}
                type="button"
                onClick={() => handleSelectStationWithCamera(id)}
                className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap cursor-pointer transition-colors inline-flex items-center gap-1.5 border ${
                  selectedStationId === id
                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                    : summary.hasAlert
                      ? 'border-red-200 bg-red-50/60 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                <span>{summary.meta.shortLabel}</span>
                {summary.hasAlert && (
                  <span className="font-mono tabular-nums text-[11px] font-semibold">
                    {summary.alertCount} alert{summary.alertCount === 1 ? '' : 's'}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Station Inspection History & Defective Workpieces Linked to Real Passports */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Clicked Station Inspection History */}
        <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {activeStationSummary
                    ? `${activeStationSummary.meta.fullLabel} — Inspection History`
                    : 'All Stations — Inspection History'}
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {activeStationSummary
                  ? `${activeStationSummary.meta.role} · Click any 3D station to switch history`
                  : 'Complete inspection ledger mapped across all stations on this line'}
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 p-1">
              <button
                type="button"
                onClick={() => handleSelectStationWithCamera(null)}
                className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap cursor-pointer transition-colors ${
                  selectedStationId === null
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                All ({factoryInspections.length})
              </button>
              {(['station1', 'station2', 'station3'] as TwinStationId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectStationWithCamera(id)}
                  className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap cursor-pointer transition-colors ${
                    selectedStationId === id
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {stationSummaries[id].meta.shortLabel} ({stationSummaries[id].inspections.length})
                </button>
              ))}
            </div>
          </div>

          {/* Alert Callout When Station Has Active Inspection or Maintenance Alerts */}
          {activeStationSummary?.hasAlert && (
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-red-50/70 dark:bg-red-950/30 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  <strong>Station Alert Active:</strong> {activeStationSummary.alertInspections.length}{' '}
                  high-priority or reliability-flagged inspection
                  {activeStationSummary.alertInspections.length === 1 ? '' : 's'}
                  {activeStationSummary.maintenanceAlert
                    ? ` · ${activeStationSummary.maintenanceAlert.equipmentName} (${activeStationSummary.maintenanceAlert.rulHours}h RUL)`
                    : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => issueCameraCommand(activeStationSummary.meta.id)}
                className="font-medium text-red-700 dark:text-red-300 hover:underline whitespace-nowrap cursor-pointer"
              >
                Focus in 3D
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-medium">
                  <th className="py-2.5 px-4">Passport</th>
                  <th className="py-2.5 px-3">Defect Class</th>
                  <th className="py-2.5 px-3">Severity</th>
                  <th className="py-2.5 px-3 text-right">Conf.</th>
                  <th className="py-2.5 px-3 text-right">Reliability</th>
                  <th className="py-2.5 px-3">Source</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {displayedStationInspections.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-8 text-center text-slate-500 dark:text-slate-400"
                    >
                      No inspection records logged for this station yet. Run a 3D scan or log an
                      optical inspection to populate history.
                    </td>
                  </tr>
                ) : (
                  displayedStationInspections.slice(0, 8).map((rec) => (
                    <tr
                      key={rec.id}
                      onClick={() => onOpenPassport?.(rec)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4 font-mono font-medium text-blue-700 dark:text-blue-400 whitespace-nowrap">
                        {rec.passportCode}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {rec.defectType}
                      </td>
                      <td className={`py-2.5 px-3 whitespace-nowrap ${severityTextClass(rec.severity)}`}>
                        {rec.severity}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {formatPercent(rec.cvConfidence)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap ${reliabilityTextClass(
                          rec.reliabilityStatus
                        )}`}
                      >
                        {rec.reliabilityScore.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {rec.isSimulated ? 'Simulated' : 'Live'}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenPassport?.(rec);
                          }}
                          className="inline-flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap cursor-pointer"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Passport
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Defective Workpieces & Corresponding Passports */}
        <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Defective Workpieces &amp; Passports
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Mapped directly onto the 3D conveyor units · Click any unit to open passport
              </p>
            </div>
            <button
              type="button"
              onClick={() => issueCameraCommand('conveyor')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap cursor-pointer"
            >
              Track Conveyor
            </button>
          </div>

          <div className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
            {defectiveWorkpieces.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No defective workpieces recorded on this factory line.
              </p>
            ) : (
              defectiveWorkpieces.slice(0, 5).map((wp, idx) => {
                const originStation = mapInspectionToStation(wp, profile.factoryCode);
                return (
                  <div
                    key={wp.id}
                    className="py-3 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpenPassport?.(wp)}
                        className="relative h-12 w-12 shrink-0 overflow-hidden rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 cursor-pointer"
                        title={`Open ${wp.passportCode}`}
                      >
                        <img
                          src={wp.imageUrl}
                          alt={wp.defectType}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute bottom-0 inset-x-0 bg-slate-900/80 text-[9px] font-mono text-white text-center">
                          #{idx + 1}
                        </span>
                      </button>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {wp.defectType}
                          </span>
                          <span className={`text-[11px] shrink-0 ${severityTextClass(wp.severity)}`}>
                            · {wp.severity}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          <span className="font-mono text-blue-700 dark:text-blue-400">
                            {wp.passportCode}
                          </span>{' '}
                          · {stationSummaries[originStation].meta.shortLabel} ·{' '}
                          {wp.isSimulated ? 'Simulated' : 'Live'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSelectStationWithCamera(originStation)}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 cursor-pointer whitespace-nowrap"
                        title="Focus origin station in 3D"
                      >
                        Focus
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenPassport?.(wp)}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer whitespace-nowrap"
                      >
                        Passport
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* Before / After Process Simulation Panel */}
      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Before / After Process Simulation
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Toggle the 3D factory twin between observed drift baseline (Before) and counterfactual
              process settings (After)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 p-1">
              <button
                type="button"
                onClick={() => setSimulationPhase('before')}
                className={`px-3 py-1 text-xs font-medium rounded whitespace-nowrap cursor-pointer transition-colors ${
                  simulationPhase === 'before'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                Preview Before (Baseline)
              </button>
              <button
                type="button"
                onClick={() => setSimulationPhase('after')}
                className={`px-3 py-1 text-xs font-medium rounded whitespace-nowrap cursor-pointer transition-colors ${
                  simulationPhase === 'after'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                Preview After (Simulated)
              </button>
            </div>

            <Button size="sm" variant="secondary" onClick={handleApplyNominal}>
              <Wrench className="h-3.5 w-3.5" />
              Simulate Nominal Fix
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Before vs After Outcome Comparison */}
          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div
              className={`rounded-md border p-4 transition-colors ${
                simulationPhase === 'before'
                  ? 'border-amber-400 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-950/20'
                  : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950'
              }`}
            >
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Before · Observed Baseline
              </div>
              <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-amber-700 dark:text-amber-400">
                {(liveSim.baselineDefectProb * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400">Defect probability</div>
              <div className="mt-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
                First-Pass Yield: {beforeYieldPct.toFixed(1)}%
              </div>
            </div>

            <div
              className={`rounded-md border p-4 transition-colors ${
                simulationPhase === 'after'
                  ? 'border-blue-500 bg-blue-50/40 dark:border-blue-700 dark:bg-blue-950/20'
                  : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950'
              }`}
            >
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                After · Counterfactual State
              </div>
              <div
                className={`mt-2 text-2xl font-semibold font-mono tabular-nums ${
                  liveSim.predictedDefectProb < liveSim.baselineDefectProb
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-blue-700 dark:text-blue-400'
                }`}
              >
                {(liveSim.predictedDefectProb * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400">
                {yieldGainPct >= 0
                  ? `+${yieldGainPct.toFixed(1)} pp yield · ${defectsAvoidedPer10k.toLocaleString()} fewer defects/10k`
                  : `${yieldGainPct.toFixed(1)} pp yield change`}
              </div>
              <div className="mt-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
                First-Pass Yield: {afterYieldPct.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Parameter-by-Parameter Before -> After Diff Table */}
          <div className="lg:col-span-7 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-medium">
                  <th className="py-2 px-3">Process Parameter</th>
                  <th className="py-2 px-3 text-right">Before (Baseline)</th>
                  <th className="py-2 px-2 text-center" aria-label="Change arrow" />
                  <th className="py-2 px-3 text-right">After (Simulated)</th>
                  <th className="py-2 px-3 text-right">Nominal Spec</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {profile.parameters.map((spec) => {
                  const beforeVal = baselineParams[spec.key] ?? spec.baseline;
                  const afterVal = cfParams[spec.key] ?? spec.baseline;
                  const changed = Math.abs(afterVal - beforeVal) > 1e-6;
                  return (
                    <tr key={spec.key}>
                      <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                        {spec.label}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {beforeVal} {spec.unit}
                      </td>
                      <td className="py-2 px-2 text-center text-slate-400">
                        <ArrowRight className="h-3 w-3 inline" />
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums font-medium ${
                          changed
                            ? 'text-blue-700 dark:text-blue-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {afterVal} {spec.unit}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {spec.nominal} {spec.unit}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 3D Optical Defect Scanner Diagnostic Panel */}
      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5">
        {!isScanning && !scanResult && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                3D Optical Defect Scanner
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Scan a live workpiece under Station 03 AOI Bridge to identify the exact defect,
                3D hotspot coordinates, and upstream root-cause machine.
              </p>
            </div>
            <Button onClick={() => runOpticalDefectScan()} className="shrink-0">
              <ScanLine className="h-4 w-4" />
              Scan 3D Factory Twin
            </Button>
          </div>
        )}

        {isScanning && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Scanning workpiece under Station 03 AOI Bridge...
                </span>
              </div>
              <span className="font-mono tabular-nums text-xs font-semibold text-blue-700 dark:text-blue-400">
                {Math.round(scanProgress)}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden border border-slate-200 dark:border-slate-700">
              <div
                className="h-full bg-blue-600 transition-all duration-75"
                style={{ width: `${scanProgress}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>
                {scanProgress < 35
                  ? 'Step 1 of 3 · Locking workpiece under coaxial AOI camera'
                  : scanProgress < 75
                    ? 'Step 2 of 3 · Sweeping structured laser across surface geometry'
                    : 'Step 3 of 3 · Identifying defect class and origin station'}
              </span>
              <span className="font-mono">{profile.factoryCode.replace('_', ' ')} · Simulated</span>
            </div>
          </div>
        )}

        {!isScanning && scanResult && (
          <div className="space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 shrink-0 ${
                    scanResult.defectDetected
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {scanResult.defectDetected ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono">{scanResult.scanId}</span>
                    <span aria-hidden="true">·</span>
                    <span className={`font-semibold ${severityColorClass}`}>
                      {scanResult.severity}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {scanResult.confidencePct.toFixed(1)}% confidence
                    </span>
                  </div>
                  <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                    {scanResult.defectDetected
                      ? `Defect Detected: ${scanResult.defectType}`
                      : 'Nominal Pass — No Defect Detected'}
                  </h2>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {scanResult.defectDetected && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleSelectStationWithCamera(scanResult.originStation)}
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                      Focus Origin Station
                    </Button>
                    <Button size="sm" onClick={handleFixNominalAndRescan}>
                      <Wrench className="h-3.5 w-3.5" />
                      Fix to Nominal &amp; Re-Scan
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleLogDefectPassport()}
                      disabled={loggingPassport}
                    >
                      <FileCheck2 className="h-3.5 w-3.5" />
                      {loggingPassport ? 'Logging...' : 'Log Defect Passport'}
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant={scanResult.defectDetected ? 'ghost' : 'primary'}
                  onClick={() => runOpticalDefectScan()}
                >
                  <ScanLine className="h-3.5 w-3.5" />
                  Re-Scan
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-1">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Origin Station &amp; Zone
                </div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {scanResult.originStationLabel}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {scanResult.zoneLabel}
                </div>
                <div className="pt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Hotspot: X {scanResult.hotspotLocal.x >= 0 ? '+' : ''}
                  {(scanResult.hotspotLocal.x * 100).toFixed(0)} mm, Z{' '}
                  {scanResult.hotspotLocal.z >= 0 ? '+' : ''}
                  {(scanResult.hotspotLocal.z * 100).toFixed(0)} mm
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Root-Cause Parameter
                </div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {scanResult.primaryDriver.label}
                </div>
                <div className="text-xs font-mono tabular-nums text-amber-700 dark:text-amber-400">
                  Measured: {scanResult.primaryDriver.currentValue} {scanResult.primaryDriver.unit}{' '}
                  <span className="text-slate-500 dark:text-slate-400">
                    (Spec: {scanResult.primaryDriver.nominalValue} {scanResult.primaryDriver.unit})
                  </span>
                </div>
                {scanResult.secondaryDriver && (
                  <div className="pt-1 text-xs text-slate-500 dark:text-slate-400">
                    Secondary: {scanResult.secondaryDriver.label} (
                    {scanResult.secondaryDriver.currentValue} {scanResult.secondaryDriver.unit})
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Laser Micro-Metrology
                </div>
                <div className="grid grid-cols-3 gap-3 pt-0.5">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Deviation</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {scanResult.measuredTelemetry.deviationMicrons} µm
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Thermal Δ</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
                      +{scanResult.measuredTelemetry.thermalDeltaC}°C
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Anomaly</div>
                    <div className="text-sm font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {scanResult.measuredTelemetry.surfaceAnomalyIdx.toFixed(3)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="text-slate-700 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-slate-100 mr-1.5">
                  Recommended Fix:
                </span>
                {scanResult.correctiveAction}
              </div>
              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                Defect Risk: {scanResult.defectProbPct.toFixed(1)}%
              </span>
            </div>

            {scanError && <p className="text-xs text-red-600 dark:text-red-400">{scanError}</p>}
          </div>
        )}
      </section>

      {/* Parameter Sliders + Risk & Sensitivity Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6 space-y-5">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Process Parameters
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Adjust parameters below to test counterfactual interventions on the 3D factory floor.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Factory Line
            </label>
            <Select
              value={String(selectedFactory?.id ?? '')}
              onChange={(e) => setSelectedFactoryId(Number(e.target.value))}
            >
              {factories.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-4 pt-1">
            {profile.parameters.map((spec) => {
              const current = cfParams[spec.key] ?? spec.baseline;
              return (
                <div key={spec.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {spec.label}
                    </span>
                    <span className="font-mono tabular-nums text-blue-700 dark:text-blue-400 font-medium">
                      {current} {spec.unit}{' '}
                      <span className="text-slate-400 dark:text-slate-500 font-normal">
                        (Base {spec.baseline} · Spec {spec.nominal})
                      </span>
                    </span>
                  </div>
                  <input
                    type="range"
                    className="px-slider"
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    value={current}
                    onChange={(e) => {
                      setSimulationPhase('after');
                      setCfParams((prev) => ({ ...prev, [spec.key]: Number(e.target.value) }));
                    }}
                  />
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Scenario Title
              </label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={includeGemini}
                onChange={(e) => setIncludeGemini(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-600 accent-blue-600"
              />
              Generate engineering summary when saving
            </label>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button onClick={() => void handleSaveScenario()} disabled={saving}>
                {includeGemini ? <Sparkles className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving...' : 'Save Scenario'}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleApplyNominal}>
                Apply Nominal Spec
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCfParams(baselineParams)}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        </div>

        <div className="lg:col-span-7 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Baseline Defect Prob.
              </p>
              <p className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {(liveSim.baselineDefectProb * 100).toFixed(1)}%
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Observed drift state</p>
            </div>
            <div className="p-5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Projected Risk
              </p>
              <p className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-blue-700 dark:text-blue-400">
                {(liveSim.predictedDefectProb * 100).toFixed(1)}%
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Simulated twin state</p>
            </div>
            <div className="p-5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Net Risk Shift
              </p>
              <p
                className={`mt-1.5 text-2xl font-semibold font-mono tabular-nums ${
                  liveSim.riskDeltaPct < 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : liveSim.riskDeltaPct > 0
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {liveSim.riskDeltaPct > 0 ? '+' : ''}
                {liveSim.riskDeltaPct.toFixed(1)} pp
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {liveSim.riskDeltaPct < 0
                  ? 'Projected risk reduction'
                  : liveSim.riskDeltaPct > 0
                    ? 'Projected risk increase'
                    : 'No parameter change'}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Parameter Sensitivity Breakdown (Percentage Points)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Blue bars reduce projected defect risk; amber bars increase risk
            </p>
            <div className="mt-4 h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={liveSim.sensitivityBreakdown}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 24, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={isDark ? '#1E293B' : '#E2E8F0'}
                    horizontal={false}
                  />
                  <XAxis type="number" tick={{ fontSize: 12, fill: isDark ? '#94A3B8' : '#64748B' }} />
                  <YAxis
                    type="category"
                    dataKey="parameter"
                    width={155}
                    tick={{ fontSize: 11, fill: isDark ? '#CBD5E1' : '#334155' }}
                  />
                  <ReferenceLine x={0} stroke={isDark ? '#475569' : '#94A3B8'} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                      borderColor: isDark ? '#334155' : '#E2E8F0',
                      borderRadius: 6,
                      fontSize: 12,
                      color: isDark ? '#F1F5F9' : '#0F172A',
                    }}
                  />
                  <Bar dataKey="contributionPct" name="Risk Shift (pp)" maxBarSize={22}>
                    {liveSim.sensitivityBreakdown.map((entry) => (
                      <Cell
                        key={entry.parameter}
                        fill={
                          entry.contributionPct <= 0
                            ? isDark
                              ? '#3B82F6'
                              : '#2563EB'
                            : isDark
                              ? '#F59E0B'
                              : '#D97706'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {latestSaved?.aiInvestigationSummary && (
            <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Engineering Brief · {latestSaved.title}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                {latestSaved.aiInvestigationSummary}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Saved Scenarios Table */}
      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Saved Twin Scenarios
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Persisted counterfactual simulations across authorized sites
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Scenario Title</th>
                <th className="py-3 px-4">Target Defect</th>
                <th className="py-3 px-4 text-right">Baseline</th>
                <th className="py-3 px-4 text-right">Projected</th>
                <th className="py-3 px-4 text-right">Net Shift</th>
                <th className="py-3 px-4">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {scenarios
                .filter((s) => !selectedFactory || globalFactoryId === 'ALL' || s.factoryId === selectedFactory.id)
                .map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 dark:text-slate-100 text-xs">
                      {s.title}
                    </div>
                    {s.aiInvestigationSummary && (
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-1 max-w-xl">
                        {s.aiInvestigationSummary}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {s.targetDefect} · Simulated
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-900 dark:text-slate-100">
                    {(s.baselineDefectProb * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-blue-700 dark:text-blue-400">
                    {(s.predictedDefectProb * 100).toFixed(1)}%
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-mono tabular-nums text-xs font-medium ${
                      s.riskDeltaPct <= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {s.riskDeltaPct > 0 ? '+' : ''}
                    {s.riskDeltaPct.toFixed(1)} pp
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {formatDateTime(s.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

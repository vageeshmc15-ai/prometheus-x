import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, Download, FileText, Search } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { downloadDatasetFile, type DatasetExportFormat } from '../../lib/dataset-export';
import type {
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
import { Button, Input } from '../ui/primitives';
import { DefectHeatmapPanel } from '../heatmap/DefectHeatmapPanel';

const DONUT_COLORS = ['#2563EB', '#0D9488', '#D97706', '#64748B', '#DC2626'];

const SIMULATED_TREND_SERIES = [
  { day: '18 Nov', inspected: 12400, reliability: 92.4 },
  { day: '19 Nov', inspected: 17900, reliability: 93.8 },
  { day: '20 Nov', inspected: 16200, reliability: 93.1 },
  { day: '21 Nov', inspected: 19600, reliability: 94.4 },
  { day: '22 Nov', inspected: 14800, reliability: 92.9 },
  { day: '23 Nov', inspected: 20400, reliability: 94.9 },
  { day: '24 Nov', inspected: 26800, reliability: 95.3 },
];

const SIMULATED_THROUGHPUT_BARS = [
  { hr: '01', v: 24 },
  { hr: '02', v: 31 },
  { hr: '03', v: 42 },
  { hr: '04', v: 38 },
  { hr: '05', v: 55 },
  { hr: '06', v: 49 },
  { hr: '07', v: 64 },
  { hr: '08', v: 58 },
  { hr: '09', v: 71 },
  { hr: '10', v: 67 },
  { hr: '11', v: 79 },
  { hr: '12', v: 84 },
];

export function CommandOverview({
  factories,
  inspections,
  maintenance,
  onSelectPassport,
  onNavigateTwin,
  onNavigateMaintenance,
}: {
  factories: FactoryRecord[];
  inspections: InspectionRecord[];
  maintenance: MaintenanceForecastRecord[];
  onSelectPassport: (record: InspectionRecord) => void;
  onNavigateInspection: () => void;
  onNavigateTwin: () => void;
  onNavigateMaintenance: () => void;
}) {
  const { isDark } = useTheme();
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [exporting, setExporting] = useState<DatasetExportFormat | null>(null);

  const handleExport = async (format: DatasetExportFormat) => {
    setExporting(format);
    try {
      await downloadDatasetFile(format);
    } finally {
      setExporting(null);
    }
  };

  const chartGrid = isDark ? '#1E293B' : '#E2E8F0';
  const chartTick = isDark ? '#94A3B8' : '#64748B';
  const tooltipStyle = {
    backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
    borderColor: isDark ? '#334155' : '#E2E8F0',
    borderRadius: 6,
    fontSize: 12,
    color: isDark ? '#F1F5F9' : '#0F172A',
  };

  const kpis = useMemo(() => {
    const total = inspections.length;
    const defects = inspections.filter((i) => i.severity !== 'PASS').length;
    const flagged = inspections.filter((i) => i.reliabilityStatus !== 'RELIABLE').length;
    const awaiting = inspections.filter((i) => i.humanReviewStatus === 'UNREVIEWED').length;
    const reviewed = inspections.filter((i) => i.humanReviewStatus !== 'UNREVIEWED');
    const falsePos = reviewed.filter((i) => i.humanReviewStatus === 'FALSE_POSITIVE').length;
    const fpRate = reviewed.length > 0 ? (falsePos / reviewed.length) * 100 : 2.35;
    const avgReliability =
      total > 0
        ? inspections.reduce((acc, i) => acc + i.reliabilityScore, 0) / total
        : 94.6;

    return {
      totalInspectedDisplay: 1248500 + total,
      defectsDetectedDisplay: 18737 + defects,
      flaggedCount: flagged,
      awaitingCount: awaiting,
      fpRate,
      avgReliability,
    };
  }, [inspections]);

  const defectDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of inspections) {
      if (item.severity === 'PASS') continue;
      map.set(item.defectType, (map.get(item.defectType) ?? 0) + 1);
    }
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, c]) => sum + c, 0) || 1;
    return entries.map(([name, value]) => ({
      name,
      value,
      pct: Math.round((value / total) * 100),
    }));
  }, [inspections]);

  const lineStatuses = useMemo(() => {
    const lines = [
      { id: 'Line 01', label: 'SMT Reflow A2', status: 'Running', alert: false },
      { id: 'Line 02', label: 'Pick & Place A4', status: 'Running', alert: false },
      { id: 'Line 03', label: '5-Axis CNC B1', status: 'Alert', alert: true },
      { id: 'Line 04', label: 'Stamping B3', status: 'Running', alert: false },
      { id: 'Line 05', label: 'ECU Coater C2', status: 'Watch', alert: true },
    ];
    const criticalLines = new Set(
      maintenance
        .filter((m) => m.status === 'MAINTENANCE_REQUIRED')
        .map((m) => m.lineName.toLowerCase())
    );
    return lines.map((line) => {
      const hasMaintAlert = [...criticalLines].some((name) =>
        name.includes(line.label.split(' ')[0].toLowerCase())
      );
      return {
        ...line,
        status: hasMaintAlert ? 'Alert' : line.status,
        alert: hasMaintAlert || line.alert,
      };
    });
  }, [maintenance]);

  const activeAlerts = useMemo(
    () =>
      maintenance
        .filter((m) => m.status === 'MAINTENANCE_REQUIRED' || m.status === 'WATCH')
        .slice(0, 3),
    [maintenance]
  );

  const filteredInspections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inspections.filter((item) => {
      if (severityFilter !== 'ALL' && item.severity !== severityFilter) return false;
      if (!q) return true;
      return (
        item.passportCode.toLowerCase().includes(q) ||
        item.defectType.toLowerCase().includes(q) ||
        item.lineName.toLowerCase().includes(q) ||
        item.batchNumber.toLowerCase().includes(q) ||
        (item.factoryName || '').toLowerCase().includes(q)
      );
    });
  }, [inspections, search, severityFilter]);

  return (
    <div className="space-y-6">
      {/* KPI Summary Strip */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Inspected</p>
          <p className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kpis.totalInspectedDisplay.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono text-emerald-700 dark:text-emerald-400">+12.8%</span> simulated shift
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Defects Detected</p>
          <p className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kpis.defectsDetectedDisplay.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono text-slate-700 dark:text-slate-300">{inspections.length}</span> passports logged
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Flagged Reliability</p>
          <p className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kpis.flaggedCount}
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Perturbation drift check</p>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Awaiting Review</p>
          <p className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kpis.awaitingCount}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">QA review queue</p>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">False Positive Rate</p>
          <p className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kpis.fpRate.toFixed(2)}%
          </p>
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">-0.8% vs baseline</p>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Model Reliability</p>
          <p className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kpis.avgReliability.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            {kpis.avgReliability >= 82 ? 'Within target' : 'Needs calibration'}
          </p>
        </div>
      </section>

      {/* Primary Charts & Production Line Status */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Inspection Trend
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              7-day simulated volume
            </span>
          </div>
          <div className="mt-4 h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={SIMULATED_TREND_SERIES}
                margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: chartTick }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: chartTick }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="inspected"
                  name="Inspected Units"
                  stroke={isDark ? '#3B82F6' : '#2563EB'}
                  strokeWidth={2}
                  dot={{ r: 3, fill: isDark ? '#3B82F6' : '#2563EB', strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: isDark ? '#60A5FA' : '#1D4ED8' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Defect Distribution
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {factories.length} active plants
            </span>
          </div>
          <div className="mt-3 grid grid-cols-12 items-center gap-2">
            <div className="col-span-6 relative h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={defectDistribution}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={2}
                    stroke={isDark ? '#0F172A' : '#FFFFFF'}
                    strokeWidth={2}
                  >
                    {defectDistribution.map((entry, idx) => (
                      <Cell key={entry.name} fill={DONUT_COLORS[idx % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {inspections.filter((i) => i.severity !== 'PASS').length}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">Defects</span>
              </div>
            </div>

            <div className="col-span-6 space-y-2.5 text-xs">
              {defectDistribution.slice(0, 5).map((item, idx) => (
                <div key={item.name} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: DONUT_COLORS[idx % DONUT_COLORS.length] }}
                    />
                    <span className="text-slate-700 dark:text-slate-300 truncate">{item.name}</span>
                  </div>
                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                    {item.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Production Lines
              </h2>
              <button
                type="button"
                onClick={onNavigateTwin}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Open 3D Twin
              </button>
            </div>
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {lineStatuses.map((line) => (
                <div
                  key={line.id}
                  className="py-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{line.id}</div>
                    <div className="text-slate-500 dark:text-slate-400 truncate">{line.label}</div>
                  </div>
                  <span
                    className={
                      line.alert
                        ? 'font-medium text-amber-700 dark:text-amber-400 shrink-0'
                        : 'font-medium text-emerald-700 dark:text-emerald-400 shrink-0'
                    }
                  >
                    {line.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Defect & Spatial Heat Map */}
      <DefectHeatmapPanel
        factories={factories}
        inspections={inspections}
        maintenance={maintenance}
        onSelectPassport={onSelectPassport}
        onFilterByDefect={(query) => {
          setSearch(query);
          setSeverityFilter('ALL');
        }}
      />

      {/* Secondary Row: Alerts, Throughput, Recent Evidence */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Equipment Alerts
            </h2>
            <button
              type="button"
              onClick={onNavigateMaintenance}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              View all
            </button>
          </div>
          <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {activeAlerts.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                All manufacturing assets are nominal.
              </p>
            ) : (
              activeAlerts.map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  onClick={onNavigateMaintenance}
                  className="w-full text-left py-2.5 flex items-start justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {alert.equipmentName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {alert.primaryRiskFactor}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-amber-700 dark:text-amber-400 shrink-0 tabular-nums">
                    {alert.rulHours}h RUL
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Hourly Throughput
            </h2>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                58,482
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                units/hour · simulated
              </span>
            </div>
          </div>
          <div className="mt-3 h-24 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={SIMULATED_THROUGHPUT_BARS}
                margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
              >
                <Bar
                  dataKey="v"
                  fill={isDark ? '#3B82F6' : '#2563EB'}
                  radius={[2, 2, 0, 0]}
                  maxBarSize={14}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-4 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Recent Inspection Frames
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Select to open passport
            </span>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2.5">
            {inspections.slice(0, 4).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectPassport(item)}
                className="group relative aspect-square overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:border-blue-500 transition-colors cursor-pointer"
                title={`${item.passportCode} — ${item.defectType}`}
              >
                <img
                  src={item.imageUrl}
                  alt={item.defectType}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-mono text-white truncate">
                  {Math.round(item.cvConfidence * 100)}%
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Digital Defect Passport Table */}
      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Digital Defect Passports
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Select any record to inspect evidence, perturbation audit, and engineering summary
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-60">
              <Search className="h-4 w-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search passport, defect, lot..."
                className="h-9 pl-9 text-xs"
              />
            </div>

            <div className="flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 p-1">
              {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'PASS'].map((sev) => (
                <button
                  key={sev}
                  type="button"
                  onClick={() => setSeverityFilter(sev)}
                  className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap cursor-pointer transition-colors ${
                    severityFilter === sev
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {sev === 'ALL' ? 'All' : sev.charAt(0) + sev.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleExport('csv')}
                disabled={exporting !== null}
              >
                <Download className="h-3.5 w-3.5" />
                {exporting === 'csv' ? 'Exporting...' : 'CSV'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleExport('json')}
                disabled={exporting !== null}
              >
                <Download className="h-3.5 w-3.5" />
                {exporting === 'json' ? 'Exporting...' : 'JSON'}
              </Button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4">Passport ID</th>
                <th className="py-3 px-4">Facility / Line</th>
                <th className="py-3 px-4">Defect Class</th>
                <th className="py-3 px-4">Severity</th>
                <th className="py-3 px-4 text-right">Confidence</th>
                <th className="py-3 px-4 text-right">Reliability</th>
                <th className="py-3 px-4">Review</th>
                <th className="py-3 px-4">Recorded</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
              {filteredInspections.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    No defect passports match the current filter.
                  </td>
                </tr>
              ) : (
                filteredInspections.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onSelectPassport(row)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4 font-mono text-xs font-medium text-blue-700 dark:text-blue-400 whitespace-nowrap">
                      {row.passportCode}
                      {row.isSimulated && (
                        <span className="ml-1.5 font-sans text-xs font-normal text-slate-400 dark:text-slate-500">
                          · Sim
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs text-slate-900 dark:text-slate-100 font-medium truncate max-w-[200px]">
                        {row.factoryCode?.replace('_', ' ') || `Factory #${row.factoryId}`}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                        {row.lineName}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {row.defectType}
                    </td>
                    <td
                      className={`py-3 px-4 text-xs whitespace-nowrap ${severityTextClass(
                        row.severity
                      )}`}
                    >
                      {row.severity}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-900 dark:text-slate-100">
                      {formatPercent(row.cvConfidence)}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums text-xs whitespace-nowrap ${reliabilityTextClass(
                        row.reliabilityStatus
                      )}`}
                    >
                      {row.reliabilityScore.toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {row.humanReviewStatus.replace('_', ' ')}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectPassport(row);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap cursor-pointer"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Open
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

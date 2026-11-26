import React, { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from '@xyflow/react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Sparkles, RefreshCw } from 'lucide-react';
import { apiClient, extractApiError } from '../../lib/api';
import { useTheme } from '../../context/ThemeContext';
import { Button } from '../ui/primitives';

interface CrossFactoryAnalytics {
  factories: Array<{
    id: number;
    code: string;
    name: string;
    sector: string;
    location: string;
    isSimulated: boolean;
    totalInspections: number;
    defectCount: number;
    defectRatePct: number;
    avgReliability: number;
    reviewFlaggedCount: number;
    topDefect: string;
    criticalEquipment: number;
  }>;
  defectDistribution: Array<{
    defectType: string;
    count: number;
    avgConfidence: number;
  }>;
  feedbackSummary: {
    totalInspections: number;
    reviewedCount: number;
    pendingReviewCount: number;
    confirmedCount: number;
    falsePositiveCount: number;
    reclassifiedCount: number;
    agreementRatePct: number;
  } | null;
}

export function CrossFactoryView() {
  const { isDark } = useTheme();
  const [analytics, setAnalytics] = useState<CrossFactoryAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [digest, setDigest] = useState<string | null>(null);
  const [generatingDigest, setGeneratingDigest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get<CrossFactoryAnalytics>('/cross-factory/analytics');
      setAnalytics(data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load cross-factory analytics.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAnalytics();
  }, []);

  const handleGenerateDigest = async () => {
    setGeneratingDigest(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ digest: string }>('/cross-factory/digest');
      setDigest(data.digest);
    } catch (err) {
      setError(extractApiError(err, 'Unable to generate cross-factory digest.'));
    } finally {
      setGeneratingDigest(false);
    }
  };

  const { nodes, edges } = useMemo(() => {
    const fa = analytics?.factories.find((f) => f.code === 'FACTORY_A');
    const fb = analytics?.factories.find((f) => f.code === 'FACTORY_B');
    const fc = analytics?.factories.find((f) => f.code === 'FACTORY_C');

    const blueStroke = isDark ? '#3B82F6' : '#2563EB';
    const amberStroke = isDark ? '#F59E0B' : '#D97706';
    const labelText = isDark ? '#CBD5E1' : '#334155';
    const labelBg = isDark ? '#0F172A' : '#FFFFFF';

    const baseNodeStyle: React.CSSProperties = {
      background: isDark ? '#0F172A' : '#FFFFFF',
      border: isDark ? '1px solid #334155' : '1px solid #CBD5E1',
      borderRadius: 6,
      padding: '10px 14px',
      fontSize: 12,
      color: isDark ? '#F1F5F9' : '#0F172A',
      width: 225,
      fontFamily: '"Public Sans", sans-serif',
      whiteSpace: 'pre-line',
    };

    const sigStyle: React.CSSProperties = {
      background: isDark ? '#172554' : '#EFF6FF',
      border: `1px solid ${blueStroke}`,
      borderRadius: 6,
      padding: '10px 14px',
      fontSize: 12,
      color: isDark ? '#F1F5F9' : '#0F172A',
      width: 235,
      fontFamily: '"Public Sans", sans-serif',
      whiteSpace: 'pre-line',
    };

    const graphNodes: Node[] = [
      {
        id: 'fa',
        position: { x: 20, y: 20 },
        data: {
          label: `Factory A · Electronics (Simulated)\nTop: ${fa?.topDefect || 'Solder Bridge'} · Rel ${fa?.avgReliability ?? 0}%`,
        },
        style: baseNodeStyle,
      },
      {
        id: 'fb',
        position: { x: 20, y: 210 },
        data: {
          label: `Factory B · Auto Components (Simulated)\nTop: ${fb?.topDefect || 'Hairline Crack'} · Rel ${fb?.avgReliability ?? 0}%`,
        },
        style: baseNodeStyle,
      },
      {
        id: 'sig-thermal',
        position: { x: 320, y: 40 },
        data: {
          label: 'Shared Thermal & Flux Signature\nSMT Reflow Drift ↔ Wash Pressure',
        },
        style: sigStyle,
      },
      {
        id: 'sig-mech',
        position: { x: 320, y: 195 },
        data: {
          label: 'Mechanical & Enclosure Stress\nSpindle Vibration ↔ Housing Tolerance',
        },
        style: {
          ...sigStyle,
          background: isDark ? '#451A03' : '#FFFBEB',
          border: `1px solid ${amberStroke}`,
        },
      },
      {
        id: 'fc',
        position: { x: 630, y: 115 },
        data: {
          label: `Factory C · Automotive ECU (Simulated)\nTop: ${fc?.topDefect || 'Flux Contamination'} · Rel ${fc?.avgReliability ?? 0}%`,
        },
        style: {
          ...baseNodeStyle,
          border: `1.5px solid ${blueStroke}`,
        },
      },
    ];

    const graphEdges: Edge[] = [
      {
        id: 'e-fa-thermal',
        source: 'fa',
        target: 'sig-thermal',
        label: 'SMT Reflow Transfer',
        markerEnd: { type: MarkerType.ArrowClosed, color: blueStroke },
        style: { stroke: blueStroke, strokeWidth: 1.5 },
        labelStyle: { fontSize: 11, fill: labelText },
        labelBgStyle: { fill: labelBg, fillOpacity: 0.95 },
      },
      {
        id: 'e-thermal-fc',
        source: 'sig-thermal',
        target: 'fc',
        label: 'ECU Solder/Flux Risk',
        markerEnd: { type: MarkerType.ArrowClosed, color: blueStroke },
        style: { stroke: blueStroke, strokeWidth: 1.5 },
        labelStyle: { fontSize: 11, fill: labelText },
        labelBgStyle: { fill: labelBg, fillOpacity: 0.95 },
      },
      {
        id: 'e-fb-mech',
        source: 'fb',
        target: 'sig-mech',
        label: 'CNC & Die Stress',
        markerEnd: { type: MarkerType.ArrowClosed, color: amberStroke },
        style: { stroke: amberStroke, strokeWidth: 1.5 },
        labelStyle: { fontSize: 11, fill: labelText },
        labelBgStyle: { fill: labelBg, fillOpacity: 0.95 },
      },
      {
        id: 'e-mech-fc',
        source: 'sig-mech',
        target: 'fc',
        label: 'Chassis Mount Tolerance',
        markerEnd: { type: MarkerType.ArrowClosed, color: amberStroke },
        style: { stroke: amberStroke, strokeWidth: 1.5 },
        labelStyle: { fontSize: 11, fill: labelText },
        labelBgStyle: { fill: labelBg, fillOpacity: 0.95 },
      },
    ];

    return { nodes: graphNodes, edges: graphEdges };
  }, [analytics, isDark]);

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
        Loading cross-factory analytics...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Three Factories Summary Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {(analytics?.factories || []).map((f) => (
          <div
            key={f.id}
            className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-5"
          >
            <div className="flex items-baseline justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono text-blue-700 dark:text-blue-400 font-medium">
                {f.code.replace('_', ' ')} · {f.isSimulated ? 'Simulated' : 'Live'}
              </span>
              <span>{f.sector}</span>
            </div>
            <h2 className="mt-1.5 text-base font-semibold text-slate-900 dark:text-slate-100">
              {f.name}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{f.location}</p>

            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Passports</span>
                <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {f.totalInspections}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Defect Rate</span>
                <span className="font-mono font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                  {f.defectRatePct.toFixed(1)}%
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Reliability</span>
                <span className="font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {f.avgReliability.toFixed(1)}%
                </span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-700 dark:text-slate-300">
              <span>Top Defect: {f.topDefect}</span>
              <span className="font-mono text-amber-700 dark:text-amber-400">
                {f.criticalEquipment} alerts
              </span>
            </div>
          </div>
        ))}
      </section>

      {/* React Flow Causal Transfer Graph */}
      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Cross-Factory Defect Signature Transfer Graph
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Shared electronics and automotive failure patterns across Factory A, Factory B, and
              Factory C
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void loadAnalytics()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <div className="mt-4 h-[330px] w-full rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
          <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false}>
            <Background color={isDark ? '#334155' : '#CBD5E1'} gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </section>

      {/* Bottom Row: Distribution Chart + Executive Digest */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Defect Distribution by Class
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Aggregated passport occurrences across authorized plants
          </p>
          <div className="mt-5 h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics?.defectDistribution || []}
                layout="vertical"
                margin={{ top: 4, right: 20, left: 20, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={isDark ? '#1E293B' : '#E2E8F0'}
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: isDark ? '#94A3B8' : '#64748B' }}
                />
                <YAxis
                  type="category"
                  dataKey="defectType"
                  width={135}
                  tick={{ fontSize: 12, fill: isDark ? '#CBD5E1' : '#334155' }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 6,
                    border: `1px solid ${isDark ? '#334155' : '#E2E8F0'}`,
                    backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                    color: isDark ? '#F1F5F9' : '#0F172A',
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="count"
                  name="Passports"
                  fill={isDark ? '#3B82F6' : '#2563EB'}
                  radius={[0, 4, 4, 0]}
                  maxBarSize={24}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-6 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Cross-Factory Executive Summary
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Synthesizes multi-plant risk transfer and reliability gaps
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => void handleGenerateDigest()}
                disabled={generatingDigest}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {generatingDigest ? 'Generating...' : 'Generate Summary'}
              </Button>
            </div>

            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 p-4 text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line min-h-[180px]">
              {digest ||
                'Click "Generate Summary" to summarize cross-factory defect transfer risks, review priorities, and next-shift actions across authorized sites.'}
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Simulated cross-factory telemetry · Predictions verified by deterministic computer
            vision scoring.
          </p>
        </div>
      </section>
    </div>
  );
}

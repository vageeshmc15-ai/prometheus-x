import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Wrench, CheckCircle2 } from 'lucide-react';
import { apiClient, extractApiError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import type { FactoryRecord, MaintenanceForecastRecord } from '../../types/prometheus';
import { formatDateTime } from '../../lib/utils';
import { Button } from '../ui/primitives';

export function MaintenanceView({
  factories,
  forecasts,
  onUpdated,
}: {
  factories: FactoryRecord[];
  forecasts: MaintenanceForecastRecord[];
  onUpdated: (record: MaintenanceForecastRecord) => void;
}) {
  const { profile } = useAuth();
  const { isDark } = useTheme();
  const canSchedule =
    profile?.role === 'SUPER_ADMIN' ||
    profile?.role === 'FACTORY_ADMIN' ||
    profile?.role === 'QUALITY_ENGINEER';

  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const factoryNameById = useMemo(
    () => new Map(factories.map((f) => [f.id, f.code.replace('_', ' ')])),
    [factories]
  );

  const chartData = useMemo(
    () =>
      forecasts.map((f) => ({
        code: f.equipmentCode,
        prob7d: Math.round(f.failureProb7d * 100),
        prob30d: Math.round(f.failureProb30d * 100),
      })),
    [forecasts]
  );

  const handleAction = async (id: number, action: 'schedule' | 'complete') => {
    setBusyId(id);
    setError(null);
    try {
      const { data } = await apiClient.post<MaintenanceForecastRecord>(
        `/maintenance/${id}/schedule`,
        { action }
      );
      onUpdated(data);
    } catch (err) {
      setError(extractApiError(err, 'Unable to update maintenance status.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/50 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Failure Probability Forecast Chart */}
      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Equipment Failure Probability Forecast
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              7-day vs. 30-day predicted failure probability (%) correlated with optical defect drift
            </p>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Simulated Predictive Data
          </span>
        </div>

        <div className="mt-5 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={isDark ? '#1E293B' : '#E2E8F0'}
                vertical={false}
              />
              <XAxis dataKey="code" tick={{ fontSize: 12, fill: isDark ? '#94A3B8' : '#64748B' }} />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 12, fill: isDark ? '#94A3B8' : '#64748B' }}
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
              <Legend wrapperStyle={{ fontSize: 12, color: isDark ? '#CBD5E1' : '#475569' }} />
              <Bar
                dataKey="prob7d"
                name="7-Day Failure Risk (%)"
                fill={isDark ? '#EF4444' : '#DC2626'}
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
              <Bar
                dataKey="prob30d"
                name="30-Day Failure Risk (%)"
                fill={isDark ? '#F59E0B' : '#D97706'}
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Equipment Registry & Intervention Table */}
      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Asset Health, Remaining Useful Life &amp; Maintenance Dispatch
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Sorted by lowest health score first · All equipment maintenance updates are saved persistently
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-medium text-slate-600 dark:text-slate-400">
                <th className="py-3 px-4">Equipment / Line</th>
                <th className="py-3 px-4 text-right">Health</th>
                <th className="py-3 px-4 text-right">RUL (hrs)</th>
                <th className="py-3 px-4">Primary Degradation Driver</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {forecasts.map((eq) => {
                const statusClass =
                  eq.status === 'MAINTENANCE_REQUIRED'
                    ? 'text-red-700 dark:text-red-400 font-semibold'
                    : eq.status === 'WATCH'
                      ? 'text-amber-700 dark:text-amber-400 font-medium'
                      : eq.status === 'SCHEDULED'
                        ? 'text-blue-700 dark:text-blue-400 font-medium'
                        : 'text-emerald-700 dark:text-emerald-400 font-medium';

                return (
                  <tr
                    key={eq.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {eq.equipmentName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {eq.equipmentCode} · {factoryNameById.get(eq.factoryId) || `F#${eq.factoryId}`} ·{' '}
                        {eq.lineName}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {eq.healthScore.toFixed(1)}%
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                      {eq.rulHours}h
                    </td>
                    <td className="py-3.5 px-4 max-w-sm">
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                        {eq.primaryRiskFactor}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        Action: {eq.recommendedAction}
                      </div>
                    </td>
                    <td className={`py-3.5 px-4 text-xs whitespace-nowrap ${statusClass}`}>
                      {eq.status.replace('_', ' ')}
                      <div className="font-mono text-[11px] font-normal text-slate-500 dark:text-slate-400">
                        Serviced {formatDateTime(eq.lastServicedAt)}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {canSchedule ? (
                        <div className="inline-flex items-center gap-2">
                          {eq.status !== 'SCHEDULED' && eq.status !== 'NOMINAL' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyId === eq.id}
                              onClick={() => void handleAction(eq.id, 'schedule')}
                            >
                              <Wrench className="h-3.5 w-3.5" />
                              Schedule
                            </Button>
                          )}
                          {eq.status !== 'NOMINAL' && (
                            <Button
                              size="sm"
                              disabled={busyId === eq.id}
                              onClick={() => void handleAction(eq.id, 'complete')}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Complete PM
                            </Button>
                          )}
                          {eq.status === 'NOMINAL' && (
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              Nominal
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Read-only
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

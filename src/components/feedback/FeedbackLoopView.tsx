import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { apiClient, extractApiError } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import type { InspectionRecord } from '../../types/prometheus';
import {
  formatDateTime,
  formatPercent,
  reliabilityTextClass,
  severityTextClass,
} from '../../lib/utils';
import { Button, Input, Select, Textarea } from '../ui/primitives';

export function FeedbackLoopView({
  inspections,
  onUpdated,
}: {
  inspections: InspectionRecord[];
  onUpdated: (record: InspectionRecord) => void;
}) {
  const { profile } = useAuth();
  const canReview =
    profile?.role === 'SUPER_ADMIN' ||
    profile?.role === 'FACTORY_ADMIN' ||
    profile?.role === 'QUALITY_ENGINEER';

  const [queueFilter, setQueueFilter] = useState<'UNREVIEWED' | 'FLAGGED' | 'ALL'>('UNREVIEWED');
  const [selectedId, setSelectedId] = useState<number | null>(
    inspections.find((i) => i.humanReviewStatus === 'UNREVIEWED')?.id ?? inspections[0]?.id ?? null
  );
  const [verdict, setVerdict] = useState<'CONFIRMED' | 'FALSE_POSITIVE' | 'RECLASSIFIED'>('CONFIRMED');
  const [humanLabel, setHumanLabel] = useState('');
  const [humanNotes, setHumanNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const metrics = useMemo(() => {
    const reviewed = inspections.filter((i) => i.humanReviewStatus !== 'UNREVIEWED');
    const confirmed = reviewed.filter((i) => i.humanReviewStatus === 'CONFIRMED').length;
    const falsePositives = reviewed.filter((i) => i.humanReviewStatus === 'FALSE_POSITIVE').length;
    const reclassified = reviewed.filter((i) => i.humanReviewStatus === 'RECLASSIFIED').length;
    return {
      reviewedCount: reviewed.length,
      pendingCount: inspections.length - reviewed.length,
      agreementPct: reviewed.length > 0 ? (confirmed / reviewed.length) * 100 : 100,
      falsePositives,
      reclassified,
    };
  }, [inspections]);

  const queue = useMemo(() => {
    return inspections.filter((item) => {
      if (queueFilter === 'UNREVIEWED') return item.humanReviewStatus === 'UNREVIEWED';
      if (queueFilter === 'FLAGGED') return item.reliabilityStatus !== 'RELIABLE';
      return true;
    });
  }, [inspections, queueFilter]);

  const selected = inspections.find((i) => i.id === selectedId) ?? queue[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    setVerdict(
      selected.humanReviewStatus === 'UNREVIEWED' ? 'CONFIRMED' : selected.humanReviewStatus
    );
    setHumanLabel(selected.humanLabel || selected.defectType);
    setHumanNotes(selected.humanNotes || '');
    setMessage(null);
    setError(null);
  }, [selected?.id]);

  const handleSelectRow = (row: InspectionRecord) => {
    setSelectedId(row.id);
    setVerdict(
      row.humanReviewStatus === 'UNREVIEWED' ? 'CONFIRMED' : row.humanReviewStatus
    );
    setHumanLabel(row.humanLabel || row.defectType);
    setHumanNotes(row.humanNotes || '');
    setMessage(null);
    setError(null);
  };

  const handleSubmitVerdict = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !canReview) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await apiClient.patch<InspectionRecord>(
        `/inspections/${selected.id}/feedback`,
        {
          humanReviewStatus: verdict,
          humanLabel: verdict === 'RECLASSIFIED' ? humanLabel : selected.defectType,
          humanNotes,
        }
      );
      onUpdated({
        ...data,
        factoryName: selected.factoryName,
        factoryCode: selected.factoryCode,
      });
      setMessage(`Saved review verdict for ${selected.passportCode}.`);
    } catch (err) {
      setError(extractApiError(err, 'Unable to submit review verdict.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Calibration KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Model-Engineer Agreement
          </p>
          <p className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {metrics.agreementPct.toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Across {metrics.reviewedCount} reviewed items
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Pending Review</p>
          <p className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {metrics.pendingCount}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Awaiting QA sign-off</p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">False Positives</p>
          <p className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-amber-700 dark:text-amber-400">
            {metrics.falsePositives}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Queued for threshold tuning
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Reclassified</p>
          <p className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-blue-700 dark:text-blue-400">
            {metrics.reclassified}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Added to calibration dataset
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Verification Queue
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Select a passport to verify localization and record ground-truth labels
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 p-1">
              {(
                [
                  ['UNREVIEWED', 'Pending'],
                  ['FLAGGED', 'Low Reliability'],
                  ['ALL', 'All Passports'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setQueueFilter(key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap transition-colors ${
                    queueFilter === key
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Passport</th>
                  <th className="py-3 px-4">Predicted Defect</th>
                  <th className="py-3 px-4 text-right">Reliability</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {queue.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-10 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      All inspections in this filter view have been reviewed.
                    </td>
                  </tr>
                ) : (
                  queue.map((row) => {
                    const active = selected?.id === row.id;
                    return (
                      <tr
                        key={row.id}
                        onClick={() => handleSelectRow(row)}
                        className={`cursor-pointer transition-colors ${
                          active
                            ? 'bg-blue-50/70 dark:bg-blue-950/40'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-mono text-xs font-medium text-blue-700 dark:text-blue-400">
                            {row.passportCode}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {row.lineName}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900 dark:text-slate-100 text-xs">
                            {row.defectType}
                          </div>
                          <div className={`text-xs ${severityTextClass(row.severity)}`}>
                            {row.severity} · {formatPercent(row.cvConfidence)}
                          </div>
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono tabular-nums text-xs ${reliabilityTextClass(
                            row.reliabilityStatus
                          )}`}
                        >
                          {row.reliabilityScore.toFixed(1)}%
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {row.humanReviewStatus.replace('_', ' ')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6">
          {!selected ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Select a passport from the queue to review.
            </p>
          ) : (
            <form onSubmit={(e) => void handleSubmitVerdict(e)} className="space-y-4">
              <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                <p className="text-xs font-mono text-blue-700 dark:text-blue-400">
                  {selected.passportCode} · {selected.isSimulated ? 'Simulated' : 'Uploaded'}
                </p>
                <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {selected.defectType}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selected.lineName} · {formatDateTime(selected.createdAt)}
                </p>
              </div>

              <div className="relative overflow-hidden rounded-md border border-slate-200 dark:border-slate-800 bg-slate-900">
                <img
                  src={selected.imageUrl}
                  alt={`Evidence frame for ${selected.passportCode}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-48 object-cover"
                />
                <div
                  style={{
                    left: `${selected.boundingBox.x}%`,
                    top: `${selected.boundingBox.y}%`,
                    width: `${selected.boundingBox.width}%`,
                    height: `${selected.boundingBox.height}%`,
                  }}
                  className="absolute border-2 border-red-500 pointer-events-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Review Verdict
                </label>
                <Select
                  value={verdict}
                  onChange={(e) =>
                    setVerdict(e.target.value as 'CONFIRMED' | 'FALSE_POSITIVE' | 'RECLASSIFIED')
                  }
                  disabled={!canReview}
                >
                  <option value="CONFIRMED">Confirmed True Defect</option>
                  <option value="FALSE_POSITIVE">False Positive (No Defect)</option>
                  <option value="RECLASSIFIED">Reclassified Defect Category</option>
                </Select>
              </div>

              {verdict === 'RECLASSIFIED' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Corrected Defect Label
                  </label>
                  <Input
                    value={humanLabel}
                    onChange={(e) => setHumanLabel(e.target.value)}
                    placeholder="e.g. Component Misalignment"
                    disabled={!canReview}
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Engineering Notes
                </label>
                <Textarea
                  rows={3}
                  value={humanNotes}
                  onChange={(e) => setHumanNotes(e.target.value)}
                  placeholder="Document visual confirmation, fixture check, or lighting anomaly..."
                  disabled={!canReview}
                />
              </div>

              {!canReview && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Operator role has read-only access to the review queue. Quality Engineer or Admin
                  privileges are required to save verdicts.
                </p>
              )}

              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
              {message && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {message}
                </p>
              )}

              <Button type="submit" disabled={!canReview || submitting} className="w-full">
                {submitting ? 'Saving...' : 'Save Verdict'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

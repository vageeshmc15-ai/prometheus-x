import React, { useEffect, useRef, useState } from 'react';
import { Download, Flame, Sparkles } from 'lucide-react';
import { apiClient, extractApiError } from '../../lib/api';
import type { InspectionRecord } from '../../types/prometheus';
import {
  formatDateTime,
  formatPercent,
  reliabilityTextClass,
  severityTextClass,
} from '../../lib/utils';
import { heatmapCssGradient, sampleHeatmapRgb } from '../../lib/heatmap';
import { Button, Dialog } from '../ui/primitives';

export function DefectPassportDrawer({
  passport,
  onClose,
  onUpdated,
}: {
  passport: InspectionRecord | null;
  onClose: () => void;
  onUpdated: (record: InspectionRecord) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!passport || !showHeatmap) return;
    const canvas = heatmapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = 320;
    const H = 220;
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    const cx = ((passport.boundingBox.x + passport.boundingBox.width / 2) / 100) * W;
    const cy = ((passport.boundingBox.y + passport.boundingBox.height / 2) / 100) * H;
    const sigma = Math.max(24, ((passport.boundingBox.width + passport.boundingBox.height) / 200) * W * 0.95);
    const twoSigmaSq = 2 * sigma * sigma;
    const peakIntensity = Math.max(0.45, Math.min(1, passport.anomalyScore));

    const imgData = ctx.createImageData(W, H);
    const data = imgData.data;

    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const dx = x - cx;
        const dy = y - cy;
        const val = peakIntensity * Math.exp(-(dx * dx + dy * dy) / twoSigmaSq);
        if (val < 0.08) continue;
        const [r, g, b] = sampleHeatmapRgb(val, 'thermal');
        const a = Math.round(Math.min(205, val * 215));
        for (let oy = 0; oy < 2 && y + oy < H; oy += 1) {
          for (let ox = 0; ox < 2 && x + ox < W; ox += 1) {
            const idx = ((y + oy) * W + (x + ox)) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = a;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [passport, showHeatmap]);

  if (!passport) return null;

  const handleGenerateReport = async () => {
    setGenerating(true);
    setError(null);
    try {
      const { data } = await apiClient.post<InspectionRecord>(
        `/inspections/${passport.id}/explain`
      );
      onUpdated({
        ...data,
        factoryName: passport.factoryName,
        factoryCode: passport.factoryCode,
      });
    } catch (err) {
      setError(extractApiError(err, 'Failed to generate investigation summary.'));
    } finally {
      setGenerating(false);
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(passport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${passport.passportCode}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      open={Boolean(passport)}
      onClose={onClose}
      title={`Digital Defect Passport · ${passport.passportCode}`}
      subtitle={`${passport.factoryName || `Factory #${passport.factoryId}`} · ${passport.lineName} · ${
        passport.isSimulated ? 'Simulated Record' : 'Uploaded Inspection'
      }`}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Evidence Plate */}
          <div className="md:col-span-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Optical Evidence
              </span>
              <button
                type="button"
                onClick={() => setShowHeatmap((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  showHeatmap
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <Flame className="h-3 w-3" />
                {showHeatmap ? 'Heat Map On' : 'Heat Map Off'}
              </button>
            </div>
            <div className="relative overflow-hidden rounded-md border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950">
              <img
                src={passport.imageUrl}
                alt={`Inspection evidence for ${passport.passportCode}`}
                referrerPolicy="no-referrer"
                className="w-full h-auto block"
              />
              {showHeatmap && (
                <canvas
                  ref={heatmapCanvasRef}
                  className="absolute inset-0 h-full w-full pointer-events-none"
                />
              )}
              <div
                style={{
                  left: `${passport.boundingBox.x}%`,
                  top: `${passport.boundingBox.y}%`,
                  width: `${passport.boundingBox.width}%`,
                  height: `${passport.boundingBox.height}%`,
                }}
                className="absolute border-2 border-red-600 pointer-events-none"
              />
            </div>
            {showHeatmap && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Low</span>
                <div
                  className="h-1.5 flex-1 rounded-sm"
                  style={{ background: heatmapCssGradient('thermal') }}
                />
                <span>Peak Anomaly</span>
              </div>
            )}
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Batch: {passport.batchNumber}</span>
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {passport.componentSerial}
              </span>
            </div>
          </div>

          {/* Traceability & Telemetry Metadata */}
          <div className="md:col-span-7 space-y-4">
            <div className="grid grid-cols-2 gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">CV Classification</p>
                <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {passport.defectType}
                </p>
                <p className={`text-xs ${severityTextClass(passport.severity)}`}>
                  Severity: {passport.severity}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Model Reliability</p>
                <p
                  className={`mt-1 text-lg font-semibold font-mono tabular-nums ${reliabilityTextClass(
                    passport.reliabilityStatus
                  )}`}
                >
                  {passport.reliabilityScore.toFixed(1)}%
                </p>
                <p className={`text-xs ${reliabilityTextClass(passport.reliabilityStatus)}`}>
                  {passport.reliabilityStatus.replace('_', ' ')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-xs">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">CV Confidence</span>
                <span className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                  {formatPercent(passport.cvConfidence)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Anomaly Score</span>
                <span className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                  {passport.anomalyScore.toFixed(3)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Edge Density</span>
                <span className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                  {passport.cvMetrics.edgeDensity.toFixed(3)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Contrast Variance</span>
                <span className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                  {passport.cvMetrics.contrastVariance.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Human Review</span>
                <span className="font-medium text-blue-700 dark:text-blue-400">
                  {passport.humanReviewStatus.replace('_', ' ')}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Recorded At</span>
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  {formatDateTime(passport.createdAt)}
                </span>
              </div>
            </div>

            {passport.humanNotes && (
              <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Quality Engineer Verification Notes ({passport.humanLabel || passport.defectType})
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {passport.humanNotes}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Perturbation Audit Log */}
        <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Perturbation Stress Matrix
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                  <th className="py-2 px-3 font-medium">Perturbation</th>
                  <th className="py-2 px-3 font-medium">Parameter</th>
                  <th className="py-2 px-3 font-medium">Predicted Class</th>
                  <th className="py-2 px-3 font-medium text-right">Confidence</th>
                  <th className="py-2 px-3 font-medium text-right">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {passport.perturbationResults.map((p) => (
                  <tr key={p.name}>
                    <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                      {p.name}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-500 dark:text-slate-400">
                      {p.severityParam}
                    </td>
                    <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                      {p.predictedDefect}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatPercent(p.confidence)} ({(p.confidenceDelta * 100).toFixed(1)}%)
                    </td>
                    <td
                      className={`py-2 px-3 text-right font-medium ${
                        p.consistent
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {p.consistent ? 'Consistent' : 'Drift Detected'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Root-Cause Investigation Summary */}
        <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Root-Cause &amp; Containment Summary
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Generated server-side from deterministic CV inspection measurements
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleGenerateReport()}
                disabled={generating}
              >
                <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                {generating
                  ? 'Generating...'
                  : passport.geminiReport
                    ? 'Regenerate Report'
                    : 'Generate Report'}
              </Button>
              <Button size="sm" variant="secondary" onClick={handleExportJson}>
                <Download className="h-3.5 w-3.5" />
                Export JSON
              </Button>
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 p-4 text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
            {passport.geminiReport ||
              'No investigation summary attached to this passport yet. Click "Generate Report" to create an engineering diagnosis and corrective action brief.'}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

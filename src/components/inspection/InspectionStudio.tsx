import React, { useEffect, useRef, useState } from 'react';
import { Upload, ScanEye, ShieldAlert, FileText, Sparkles, Layers } from 'lucide-react';
import { apiClient, extractApiError } from '../../lib/api';
import type { FactoryRecord, InspectionRecord } from '../../types/prometheus';
import type { SimulatedInspectionSample } from '../../lib/cv-engine';
import { formatPercent, reliabilityTextClass, severityTextClass } from '../../lib/utils';
import { heatmapCssGradient, sampleHeatmapRgb } from '../../lib/heatmap';
import { Button, Input, Select } from '../ui/primitives';

type PerturbationView = 'baseline' | 'brightness' | 'glare' | 'blur' | 'noise' | 'rotation';

export function InspectionStudio({
  factories,
  samples,
  onInspectionCreated,
  onOpenPassport,
}: {
  factories: FactoryRecord[];
  samples: SimulatedInspectionSample[];
  onInspectionCreated: (record: InspectionRecord) => void;
  onOpenPassport: (record: InspectionRecord) => void;
}) {
  const [selectedFactoryId, setSelectedFactoryId] = useState<number>(factories[0]?.id ?? 0);
  const [mode, setMode] = useState<'sample' | 'upload'>('sample');
  const [selectedSampleId, setSelectedSampleId] = useState<string>(samples[0]?.id ?? '');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [lineName, setLineName] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [componentSerial, setComponentSerial] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InspectionRecord | null>(null);

  const [showBoundingBox, setShowBoundingBox] = useState(true);
  const [showSobelHeatmap, setShowSobelHeatmap] = useState(true);
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.62);
  const [activePerturbation, setActivePerturbation] = useState<PerturbationView>('baseline');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [liveSignalStats, setLiveSignalStats] = useState<{
    edgeDensity: number;
    contrastVariance: number;
    luminanceMean: number;
  } | null>(null);

  useEffect(() => {
    if (!selectedFactoryId && factories.length > 0) {
      setSelectedFactoryId(factories[0].id);
    }
  }, [factories, selectedFactoryId]);

  useEffect(() => {
    if (!selectedSampleId && samples.length > 0) {
      setSelectedSampleId(samples[0].id);
    }
  }, [samples, selectedSampleId]);

  const activeSample = samples.find((s) => s.id === selectedSampleId);
  const previewSrc = mode === 'upload' ? uploadPreviewUrl : activeSample?.imageUrl || null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewSrc) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const targetW = 640;
      const targetH = Math.round((img.height / Math.max(1, img.width)) * targetW) || 480;
      canvas.width = targetW;
      canvas.height = targetH;

      ctx.save();
      ctx.clearRect(0, 0, targetW, targetH);

      if (activePerturbation === 'brightness') {
        ctx.filter = 'brightness(0.65) contrast(0.95)';
      } else if (activePerturbation === 'glare') {
        ctx.filter = 'brightness(1.32) contrast(1.18)';
      } else if (activePerturbation === 'blur') {
        ctx.filter = 'blur(2.2px)';
      } else {
        ctx.filter = 'none';
      }

      if (activePerturbation === 'rotation') {
        ctx.translate(targetW / 2, targetH / 2);
        ctx.rotate((7 * Math.PI) / 180);
        ctx.drawImage(img, -targetW / 2, -targetH / 2, targetW, targetH);
      } else {
        ctx.drawImage(img, 0, 0, targetW, targetH);
      }
      ctx.restore();

      try {
        const frame = ctx.getImageData(0, 0, targetW, targetH);
        const data = frame.data;
        const gray = new Float32Array(targetW * targetH);
        let lumSum = 0;

        for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
          const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          gray[p] = g;
          lumSum += g;
        }
        const lumMean = lumSum / gray.length;
        let sqSum = 0;
        for (let p = 0; p < gray.length; p += 1) {
          const d = gray[p] - lumMean;
          sqSum += d * d;
        }
        const contrastStd = Math.sqrt(sqSum / gray.length);

        let highEdgeCount = 0;
        const activeBox =
          result?.boundingBox ||
          (activeSample ? { ...activeSample.defaultBox, label: activeSample.expectedDefect } : null);
        const roiCx = activeBox ? ((activeBox.x + activeBox.width / 2) / 100) * targetW : targetW * 0.5;
        const roiCy = activeBox ? ((activeBox.y + activeBox.height / 2) / 100) * targetH : targetH * 0.5;
        const roiSigma = activeBox
          ? Math.max(36, ((activeBox.width + activeBox.height) / 200) * targetW * 0.9)
          : targetW * 0.16;
        const roiTwoSigmaSq = 2 * roiSigma * roiSigma;

        if (showSobelHeatmap || activePerturbation === 'noise') {
          const overlay = ctx.getImageData(0, 0, targetW, targetH);
          const out = overlay.data;

          for (let y = 1; y < targetH - 1; y += 1) {
            for (let x = 1; x < targetW - 1; x += 1) {
              const idx = y * targetW + x;
              const gx =
                -gray[idx - targetW - 1] +
                gray[idx - targetW + 1] -
                2 * gray[idx - 1] +
                2 * gray[idx + 1] -
                gray[idx + targetW - 1] +
                gray[idx + targetW + 1];
              const gy =
                -gray[idx - targetW - 1] -
                2 * gray[idx - targetW] -
                gray[idx - targetW + 1] +
                gray[idx + targetW - 1] +
                2 * gray[idx + targetW] +
                gray[idx + targetW + 1];
              const mag = Math.sqrt(gx * gx + gy * gy);
              if (mag > 95) highEdgeCount += 1;

              const px = idx * 4;
              if (activePerturbation === 'noise') {
                const n = ((x * 37 + y * 91) % 36) - 18;
                out[px] = Math.max(0, Math.min(255, out[px] + n));
                out[px + 1] = Math.max(0, Math.min(255, out[px + 1] + n));
                out[px + 2] = Math.max(0, Math.min(255, out[px + 2] + n));
              }
              if (showSobelHeatmap) {
                const dx = x - roiCx;
                const dy = y - roiCy;
                const roiHeat = Math.exp(-(dx * dx + dy * dy) / roiTwoSigmaSq);
                const edgeHeat = Math.min(1, Math.max(0, (mag - 55) / 220));
                const combined = Math.min(1, roiHeat * 0.78 + edgeHeat * 0.52);
                if (combined > 0.14) {
                  const [hr, hg, hb] = sampleHeatmapRgb(combined, 'thermal');
                  const alpha = Math.min(0.85, combined * heatmapOpacity);
                  out[px] = Math.round(out[px] * (1 - alpha) + hr * alpha);
                  out[px + 1] = Math.round(out[px + 1] * (1 - alpha) + hg * alpha);
                  out[px + 2] = Math.round(out[px + 2] * (1 - alpha) + hb * alpha);
                }
              }
            }
          }
          ctx.putImageData(overlay, 0, 0);
        } else {
          for (let y = 2; y < targetH - 2; y += 2) {
            for (let x = 2; x < targetW - 2; x += 2) {
              const idx = y * targetW + x;
              const gx = gray[idx + 1] - gray[idx - 1];
              const gy = gray[idx + targetW] - gray[idx - targetW];
              if (Math.sqrt(gx * gx + gy * gy) > 28) highEdgeCount += 4;
            }
          }
        }

        if (activePerturbation === 'rotation') {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
          ctx.fillRect(targetW * 0.72, targetH * 0.68, targetW * 0.16, targetH * 0.14);
        }

        setLiveSignalStats({
          edgeDensity: Math.round((highEdgeCount / gray.length) * 1000) / 1000,
          contrastVariance: Math.round(contrastStd * 100) / 100,
          luminanceMean: Math.round(lumMean * 10) / 10,
        });
      } catch {
        setLiveSignalStats(null);
      }

      const box =
        result?.boundingBox ||
        (activeSample ? { ...activeSample.defaultBox, label: activeSample.expectedDefect } : null);
      if (showBoundingBox && box) {
        const bx = (box.x / 100) * targetW;
        const by = (box.y / 100) * targetH;
        const bw = (box.width / 100) * targetW;
        const bh = (box.height / 100) * targetH;

        ctx.strokeStyle = result?.severity === 'PASS' ? '#16A34A' : '#DC2626';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(bx, by, bw, bh);

        const labelText = result ? result.boundingBox.label : `${box.label} (Preview ROI)`;
        ctx.font = '600 12px "IBM Plex Mono", monospace';
        const textWidth = ctx.measureText(labelText).width;
        ctx.fillStyle = result?.severity === 'PASS' ? '#16A34A' : '#DC2626';
        ctx.fillRect(bx, Math.max(0, by - 22), textWidth + 14, 22);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(labelText, bx + 7, Math.max(15, by - 7));
      }
    };
    img.src = previewSrc;
    return () => {
      cancelled = true;
    };
  }, [previewSrc, activePerturbation, showSobelHeatmap, heatmapOpacity, showBoundingBox, result, activeSample]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Only JPEG, PNG, or WebP inspection images are permitted.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image exceeds the 5 MB upload ceiling.');
      return;
    }
    setError(null);
    setUploadedFile(file);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => setUploadPreviewUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const handleSampleSelect = (sampleId: string) => {
    setSelectedSampleId(sampleId);
    setResult(null);
    setActivePerturbation('baseline');
    const matched = samples.find((s) => s.id === sampleId);
    if (matched) {
      const targetFactory = factories.find((f) => f.code === matched.factoryCode);
      if (targetFactory) setSelectedFactoryId(targetFactory.id);
      setLineName(matched.lineName);
    }
  };

  const handleRunInspection = async () => {
    setError(null);
    setAnalyzing(true);
    try {
      const formData = new FormData();
      formData.append('factoryId', String(selectedFactoryId));
      if (lineName.trim()) formData.append('lineName', lineName.trim());
      if (batchNumber.trim()) formData.append('batchNumber', batchNumber.trim());
      if (componentSerial.trim()) formData.append('componentSerial', componentSerial.trim());
      if (liveSignalStats) {
        formData.append('clientSignalStats', JSON.stringify(liveSignalStats));
      }

      if (mode === 'upload' && uploadedFile) {
        formData.append('image', uploadedFile);
      } else {
        formData.append('sampleId', selectedSampleId);
      }

      const { data } = await apiClient.post<InspectionRecord>('/inspections/analyze', formData);
      setResult(data);
      onInspectionCreated(data);
    } catch (err) {
      setError(extractApiError(err, 'Computer-vision inspection failed.'));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGenerateGeminiReport = async () => {
    if (!result) return;
    setExplaining(true);
    setError(null);
    try {
      const { data } = await apiClient.post<InspectionRecord>(`/inspections/${result.id}/explain`);
      setResult(data);
      onInspectionCreated(data);
    } catch (err) {
      setError(extractApiError(err, 'Unable to generate engineering report.'));
    } finally {
      setExplaining(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Input Configuration & Live Optical Viewport */}
        <div className="lg:col-span-7 space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Optical Inspection Workbench
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Deterministic Sobel localization and anomaly scoring with perturbation verification
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setMode('sample');
                    setResult(null);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded cursor-pointer whitespace-nowrap transition-colors ${
                    mode === 'sample'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Simulated Samples
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('upload');
                    setResult(null);
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded cursor-pointer whitespace-nowrap transition-colors ${
                    mode === 'upload'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  Upload Image
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Manufacturing Site
                </label>
                <Select
                  value={String(selectedFactoryId)}
                  onChange={(e) => setSelectedFactoryId(Number(e.target.value))}
                >
                  {factories.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>

              {mode === 'sample' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Simulated AOI Frame
                  </label>
                  <Select
                    value={selectedSampleId}
                    onChange={(e) => handleSampleSelect(e.target.value)}
                  >
                    {samples.map((s) => (
                      <option key={s.id} value={s.id}>
                        [Simulated] {s.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Inspection Image (JPEG, PNG, WebP · Max 5 MB)
                  </label>
                  <label className="flex h-10 items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 px-3 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-blue-500 hover:bg-blue-50/40 dark:hover:bg-blue-950/30 cursor-pointer transition-colors">
                    <Upload className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="truncate">
                      {uploadedFile ? uploadedFile.name : 'Choose inspection image...'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileChange}
                      className="sr-only"
                    />
                  </label>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Production Line
                </label>
                <Input
                  value={lineName}
                  onChange={(e) => setLineName(e.target.value)}
                  placeholder="e.g. SMT Reflow Line A2"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Batch / Lot Number
                </label>
                <Input
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  placeholder="Auto-generated if empty"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showBoundingBox}
                    onChange={(e) => setShowBoundingBox(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-600 accent-blue-600"
                  />
                  Bounding Box
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSobelHeatmap}
                    onChange={(e) => setShowSobelHeatmap(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-600 accent-blue-600"
                  />
                  Thermal Anomaly Heat Map
                </label>
                {showSobelHeatmap && (
                  <label className="inline-flex items-center gap-2 text-slate-500 dark:text-slate-400">
                    <span>Opacity</span>
                    <input
                      type="range"
                      min={0.25}
                      max={0.9}
                      step={0.05}
                      value={heatmapOpacity}
                      onChange={(e) => setHeatmapOpacity(Number(e.target.value))}
                      className="w-20 accent-blue-600 cursor-pointer"
                    />
                    <span className="font-mono tabular-nums w-8">
                      {Math.round(heatmapOpacity * 100)}%
                    </span>
                  </label>
                )}
              </div>

              <Button onClick={() => void handleRunInspection()} disabled={analyzing || !previewSrc}>
                <ScanEye className="h-4 w-4" />
                {analyzing ? 'Running Inspection...' : 'Run Inspection'}
              </Button>
            </div>

            {error && (
              <p className="mt-3 text-xs text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}

            <div className="mt-5 overflow-hidden rounded-md border border-slate-200 dark:border-slate-800 bg-slate-900">
              {previewSrc ? (
                <canvas
                  ref={canvasRef}
                  className="w-full h-auto block max-h-[420px] object-contain mx-auto"
                />
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-sm gap-2 bg-slate-50 dark:bg-slate-950">
                  <Layers className="h-6 w-6 text-slate-400 dark:text-slate-500" />
                  <span>Select a simulated AOI frame or upload an image to inspect</span>
                </div>
              )}
            </div>

            {showSobelHeatmap && previewSrc && (
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <span>Low Energy</span>
                  <div
                    className="h-2 w-32 rounded-sm border border-slate-200 dark:border-slate-700"
                    style={{ background: heatmapCssGradient('thermal') }}
                  />
                  <span>Peak Anomaly</span>
                </div>
                <span className="font-mono tabular-nums">
                  Sobel gradient + Gaussian ROI heat map
                </span>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Perturbation Preview:
              </span>
              <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 p-1">
                {(
                  [
                    ['baseline', 'Baseline'],
                    ['brightness', 'Exposure -35%'],
                    ['glare', 'Glare +30%'],
                    ['blur', 'Blur σ2.2'],
                    ['noise', 'ISO Noise'],
                    ['rotation', 'Rotate +7°'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActivePerturbation(key)}
                    className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer whitespace-nowrap transition-colors ${
                      activePerturbation === key
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Self-Challenging Reliability Audit */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 p-6">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Model Reliability Audit
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  5-perturbation prediction stability and confidence drift check
                </p>
              </div>
              {result && (
                <Button size="sm" variant="secondary" onClick={() => onOpenPassport(result)}>
                  <FileText className="h-3.5 w-3.5" />
                  Open Passport
                </Button>
              )}
            </div>

            {!result ? (
              <div className="py-12 text-center space-y-2">
                <ShieldAlert className="h-7 w-7 text-slate-400 dark:text-slate-500 mx-auto" />
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Ready to inspect
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                  Run an inspection on the left to record a defect passport and evaluate stability
                  across five optical stress tests.
                </p>
                {liveSignalStats && (
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-500 dark:text-slate-400 flex justify-center gap-4 tabular-nums">
                    <span>Edge: {liveSignalStats.edgeDensity}</span>
                    <span>Contrast: {liveSignalStats.contrastVariance}</span>
                    <span>Lum: {liveSignalStats.luminanceMean}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-5">
                <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Detected Defect</p>
                    <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                      {result.defectType}
                    </p>
                    <p className={`mt-0.5 text-xs ${severityTextClass(result.severity)}`}>
                      Severity: {result.severity} · {result.passportCode}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Reliability Score</p>
                    <p
                      className={`mt-1 text-2xl font-semibold font-mono tabular-nums ${reliabilityTextClass(
                        result.reliabilityStatus
                      )}`}
                    >
                      {result.reliabilityScore.toFixed(1)}%
                    </p>
                    <p className={`text-xs ${reliabilityTextClass(result.reliabilityStatus)}`}>
                      {result.reliabilityStatus.replace('_', ' ')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block">Confidence</span>
                    <span className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                      {formatPercent(result.cvConfidence)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block">Anomaly Energy</span>
                    <span className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                      {result.cvMetrics.anomalyEnergy.toFixed(3)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block">Sobel Peak</span>
                    <span className="font-mono font-medium tabular-nums text-slate-900 dark:text-slate-100">
                      {result.cvMetrics.sobelPeak.toFixed(1)}
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-800 pt-4">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Perturbation Battery (Select row to preview frame)
                  </p>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                        <th className="py-2 pr-2 font-medium">Stress Test</th>
                        <th className="py-2 px-2 font-medium text-right">Conf.</th>
                        <th className="py-2 px-2 font-medium text-right">Drift</th>
                        <th className="py-2 pl-2 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {result.perturbationResults.map((p) => (
                        <tr
                          key={p.name}
                          onClick={() => setActivePerturbation(p.type as PerturbationView)}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                        >
                          <td className="py-2 pr-2">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {p.name}
                            </div>
                            <div className="text-slate-500 dark:text-slate-400">
                              {p.severityParam}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {formatPercent(p.confidence)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                            {(p.confidenceDelta * 100).toFixed(1)}%
                          </td>
                          <td
                            className={`py-2 pl-2 text-right font-medium ${
                              p.consistent
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-red-700 dark:text-red-400'
                            }`}
                          >
                            {p.consistent ? 'Stable' : 'Drifted'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Engineering Investigation Summary
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleGenerateGeminiReport()}
                      disabled={explaining}
                    >
                      <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      {explaining
                        ? 'Generating...'
                        : result.geminiReport
                          ? 'Regenerate'
                          : 'Generate Summary'}
                    </Button>
                  </div>
                  {result.geminiReport ? (
                    <p className="mt-3 text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                      {result.geminiReport}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      Generate a concise root-cause and containment summary from the inspection
                      telemetry above.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

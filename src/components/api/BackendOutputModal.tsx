import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, RefreshCw, Server } from 'lucide-react';
import { API_BASE_URL, apiClient, extractApiError } from '../../lib/api';
import { downloadDatasetFile, type DatasetExportFormat } from '../../lib/dataset-export';
import { useAuth } from '../../context/AuthContext';
import { Button, Dialog } from '../ui/primitives';

interface EndpointDef {
  id: string;
  method: 'GET';
  path: string;
  label: string;
  adminOnly?: boolean;
}

const ENDPOINTS: EndpointDef[] = [
  { id: 'health', method: 'GET', path: '/health', label: 'Health & DB' },
  { id: 'factories', method: 'GET', path: '/factories', label: 'Factories' },
  { id: 'inspections', method: 'GET', path: '/inspections', label: 'Inspections' },
  { id: 'maintenance', method: 'GET', path: '/maintenance', label: 'Maintenance' },
  { id: 'counterfactuals', method: 'GET', path: '/counterfactuals', label: 'Counterfactuals' },
  { id: 'cross-factory', method: 'GET', path: '/cross-factory/analytics', label: 'Cross-Factory' },
  { id: 'admin', method: 'GET', path: '/admin/overview', label: 'Admin Overview', adminOnly: true },
];

export function BackendOutputModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'SUPER_ADMIN' || profile?.role === 'FACTORY_ADMIN';
  const visibleEndpoints = ENDPOINTS.filter((e) => !e.adminOnly || isAdmin);

  const [activeId, setActiveId] = useState<string>('health');
  const [loading, setLoading] = useState(false);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [payloadText, setPayloadText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<DatasetExportFormat | null>(null);

  const activeEndpoint =
    visibleEndpoints.find((e) => e.id === activeId) ?? visibleEndpoints[0];

  const fetchEndpoint = useCallback(async (ep: EndpointDef) => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const res = await apiClient.get(ep.path);
      setStatusCode(res.status);
      setLatencyMs(Math.round(performance.now() - start));
      setPayloadText(JSON.stringify(res.data, null, 2));
    } catch (err) {
      setStatusCode(null);
      setLatencyMs(Math.round(performance.now() - start));
      setError(extractApiError(err, `Failed to query ${ep.path}.`));
      setPayloadText('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !activeEndpoint) return;
    void fetchEndpoint(activeEndpoint);
  }, [open, activeEndpoint, fetchEndpoint]);

  const handleCopy = async () => {
    if (!payloadText) return;
    try {
      await navigator.clipboard.writeText(payloadText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API may be blocked in restricted iframes
    }
  };

  const handleDownloadDataset = async (format: DatasetExportFormat) => {
    setExporting(format);
    setError(null);
    try {
      await downloadDatasetFile(format);
    } catch (err) {
      setError(extractApiError(err, `Failed to export ${format.toUpperCase()} dataset.`));
    } finally {
      setExporting(null);
    }
  };

  const displayUrl = `${API_BASE_URL}${activeEndpoint.path}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Live Backend API Output"
      subtitle="Real-time JSON responses from the Express + PostgreSQL server on port 3000"
      maxWidthClass="max-w-5xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {visibleEndpoints.map((ep) => (
            <button
              key={ep.id}
              type="button"
              onClick={() => setActiveId(ep.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                activeEndpoint.id === ep.id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {ep.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="flex items-center gap-2.5 font-mono text-xs min-w-0">
            <Server className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {activeEndpoint.method}
            </span>
            <span className="text-slate-900 dark:text-slate-100 truncate">{displayUrl}</span>
            {statusCode !== null && (
              <span
                className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                  statusCode >= 200 && statusCode < 300
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                }`}
              >
                HTTP {statusCode}
              </span>
            )}
            {latencyMs !== null && (
              <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                {latencyMs} ms
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleDownloadDataset('csv')}
              disabled={exporting !== null}
            >
              <Download className="h-3.5 w-3.5" />
              {exporting === 'csv' ? 'Exporting...' : 'Download CSV'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleDownloadDataset('json')}
              disabled={exporting !== null}
            >
              <Download className="h-3.5 w-3.5" />
              {exporting === 'json' ? 'Exporting...' : 'Download JSON'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void fetchEndpoint(activeEndpoint)}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void handleCopy()}
              disabled={!payloadText}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy JSON'}
            </Button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-400"
          >
            {error}
          </div>
        )}

        <div className="rounded-md border border-slate-200 bg-slate-950 text-slate-100 dark:border-slate-800 overflow-hidden">
          <pre className="max-h-[55vh] overflow-auto p-4 text-xs font-mono leading-relaxed">
            {loading && !payloadText ? 'Fetching live backend response...' : payloadText || '{}'}
          </pre>
        </div>
      </div>
    </Dialog>
  );
}

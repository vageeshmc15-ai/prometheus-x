import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function severityTextClass(severity: string): string {
  switch (severity) {
    case 'CRITICAL':
      return 'text-red-700 dark:text-red-400 font-semibold';
    case 'HIGH':
      return 'text-amber-700 dark:text-amber-400 font-semibold';
    case 'MEDIUM':
      return 'text-amber-600 dark:text-amber-300 font-medium';
    case 'LOW':
      return 'text-slate-600 dark:text-slate-400 font-medium';
    case 'PASS':
      return 'text-emerald-700 dark:text-emerald-400 font-medium';
    default:
      return 'text-slate-600 dark:text-slate-400';
  }
}

export function reliabilityTextClass(status: string): string {
  switch (status) {
    case 'RELIABLE':
      return 'text-emerald-700 dark:text-emerald-400 font-medium';
    case 'REVIEW_REQUIRED':
      return 'text-amber-700 dark:text-amber-400 font-medium';
    case 'UNSTABLE':
      return 'text-red-700 dark:text-red-400 font-semibold';
    default:
      return 'text-slate-600 dark:text-slate-400';
  }
}

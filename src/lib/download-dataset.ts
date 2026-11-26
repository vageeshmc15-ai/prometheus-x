import { apiClient } from './api';

export async function downloadDataset(format: 'json' | 'csv'): Promise<void> {
  const response = await apiClient.get('/dataset/export', {
    params: { format },
    responseType: 'blob',
  });

  const mimeType =
    format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
  const blob =
    response.data instanceof Blob
      ? response.data
      : new Blob([response.data], { type: mimeType });

  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename =
    format === 'csv'
      ? `prometheus-x-inspections-${dateStamp}.csv`
      : `prometheus-x-dataset-${dateStamp}.json`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import axios from 'axios';

// Held strictly in JS memory — never persisted to localStorage or sessionStorage
let memorySessionToken: string | null = null;

export function setMemorySessionToken(token: string | null) {
  memorySessionToken = token;
}

export function getMemorySessionToken(): string | null {
  return memorySessionToken;
}

const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
export const API_BASE_URL = rawBaseUrl ? rawBaseUrl.replace(/\/+$/, '') : '/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45000,
  headers: {
    'X-Requested-With': 'PROMETHEUS-X',
  },
});

apiClient.interceptors.request.use((config) => {
  if (memorySessionToken) {
    config.headers.Authorization = `Bearer ${memorySessionToken}`;
  }
  return config;
});

export function extractApiError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const serverMsg = (error.response?.data as { error?: string } | undefined)?.error;
    if (serverMsg && typeof serverMsg === 'string') return serverMsg;
    if (error.response?.status === 404) {
      return 'Backend API server is not running on this host (HTTP 404). Deploy as a full-stack Node.js service running "npm start" (e.g., Cloud Run, Render, or Railway), or set VITE_API_BASE_URL to your backend API URL.';
    }
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

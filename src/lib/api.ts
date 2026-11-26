import axios from 'axios';

// Held strictly in JS memory — never persisted to localStorage or sessionStorage
let memorySessionToken: string | null = null;

export function setMemorySessionToken(token: string | null) {
  memorySessionToken = token;
}

export function getMemorySessionToken(): string | null {
  return memorySessionToken;
}

export const apiClient = axios.create({
  baseURL: '/api',
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
    if (error.message) return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

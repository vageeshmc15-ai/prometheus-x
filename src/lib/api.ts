import axios, { type AxiosRequestConfig } from 'axios';
import { handleStaticDemoRequest } from './static-demo-adapter';

// Held strictly in JS memory — never persisted to localStorage or sessionStorage
let memorySessionToken: string | null = null;
let staticStandaloneMode = false;

export function setMemorySessionToken(token: string | null) {
  memorySessionToken = token;
}

export function getMemorySessionToken(): string | null {
  return memorySessionToken;
}

export function isStaticStandaloneActive(): boolean {
  return staticStandaloneMode;
}

const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
export const API_BASE_URL = rawBaseUrl ? rawBaseUrl.replace(/\/+$/, '') : '/api';

const rawClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45000,
  headers: {
    'X-Requested-With': 'PROMETHEUS-X',
  },
});

rawClient.interceptors.request.use((config) => {
  if (memorySessionToken) {
    config.headers.Authorization = `Bearer ${memorySessionToken}`;
  }
  return config;
});

function isMissingBackendResponse(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.code === 'ERR_NETWORK') return true;
  const status = error.response?.status;
  // Express backend always returns JSON with { error: string } or X-Request-Id header
  const hasExpressJson =
    typeof (error.response?.data as { error?: unknown } | undefined)?.error === 'string';
  if ((status === 404 || status === 405 || status === 501) && !hasExpressJson) {
    return true;
  }
  return false;
}

function isHtmlSpaFallback(data: unknown): boolean {
  return typeof data === 'string' && /^\s*<!doctype html|^\s*<html/i.test(data);
}

async function requestWithFallback<T = unknown>(config: AxiosRequestConfig) {
  if (staticStandaloneMode) {
    return handleStaticDemoRequest(config) as Promise<{
      data: T;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      config: AxiosRequestConfig;
    }>;
  }

  try {
    const res = await rawClient.request<T>(config);
    if (isHtmlSpaFallback(res.data)) {
      staticStandaloneMode = true;
      return handleStaticDemoRequest(config) as Promise<typeof res>;
    }
    return res;
  } catch (err) {
    if (isMissingBackendResponse(err)) {
      staticStandaloneMode = true;
      return handleStaticDemoRequest(config) as Promise<{
        data: T;
        status: number;
        statusText: string;
        headers: Record<string, string>;
        config: AxiosRequestConfig;
      }>;
    }
    throw err;
  }
}

export const apiClient = {
  get: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
    requestWithFallback<T>({ ...config, method: 'GET', url }),
  post: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    requestWithFallback<T>({ ...config, method: 'POST', url, data }),
  patch: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    requestWithFallback<T>({ ...config, method: 'PATCH', url, data }),
  put: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    requestWithFallback<T>({ ...config, method: 'PUT', url, data }),
  delete: <T = unknown>(url: string, config?: AxiosRequestConfig) =>
    requestWithFallback<T>({ ...config, method: 'DELETE', url }),
};

export function extractApiError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const serverMsg = (error.response?.data as { error?: string } | undefined)?.error;
    if (serverMsg && typeof serverMsg === 'string') return serverMsg;
    if (error.message) return error.message;
  }
  const respErr = (error as { response?: { data?: { error?: string } } } | undefined)?.response?.data
    ?.error;
  if (respErr && typeof respErr === 'string') return respErr;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

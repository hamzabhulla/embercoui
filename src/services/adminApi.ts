import { API_URL, apiRequest, fetchWithTimeout } from './api';
import { supabase } from '../lib/supabase';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function adminGet<T>(path: string): Promise<T> {
  const res = await apiRequest<T>(path);
  if (!res.ok || !res.data) throw new ApiError(res.status, res.error ?? 'Request failed');
  return res.data;
}

export async function adminSend<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await apiRequest<T>(path, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, res.error ?? 'Request failed');
  return (res.data ?? ({} as T));
}

export async function adminDownloadCsv(path: string, filename = 'newsletter-subscribers.csv'): Promise<void> {
  const headers: Record<string, string> = {};
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  // A file transfer gets a longer deadline than the 10s API default,
  // but still a deadline — a stalled download must not hang forever.
  const res = await fetchWithTimeout(`${API_URL}${path}`, { headers }, 30_000);
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

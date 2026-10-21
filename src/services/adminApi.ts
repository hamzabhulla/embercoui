import { API_URL, apiRequest } from './api';
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

export async function adminSend<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await apiRequest<T>(path, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, res.error ?? 'Request failed');
  return (res.data ?? ({} as T));
}

export async function adminDownloadCsv(path: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'newsletter-subscribers.csv';
  a.click();
  URL.revokeObjectURL(url);
}

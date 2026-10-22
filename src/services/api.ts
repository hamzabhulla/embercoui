import type { MenuItem } from '../data/menu.ts';
import { supabase } from '../lib/supabase.ts';

// Explicit override wins. Otherwise: local dev talks to the standalone
// backend on :4000; production is same-origin — the API ships as Vercel
// functions inside this very project, so a relative base is correct.
export const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : '');

export interface PublicSettings {
  kitchenOpen: boolean;
  waitMin: number;
  waitMax: number;
  currency: string;
  restaurantName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  whatsappNumber: string | null;
  openingHours: Record<string, unknown>;
}

export interface ApprovedReview {
  id: string;
  name: string;
  rating: number;
  comment: string;
  country: string | null;
  createdAt: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const TIMEOUT_MESSAGE = 'Request timed out — please try again';

/**
 * fetch with a hard deadline. Without one, a hung connection (captive
 * portal, dead proxy, stalled cold start) leaves every caller spinning
 * forever; the abort turns that into a normal, explainable failure.
 * When the caller supplies their own signal it wins — the deadline is
 * only the default safety net.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  if (init.signal) return fetch(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetchWithTimeout(`${API_URL}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * The live menu. Three outcomes, kept distinct (audit H-1):
 *  - an array (possibly EMPTY — the restaurant genuinely has no items
 *    available right now) when the API answered successfully;
 *  - null ONLY when the fetch failed (network error, non-2xx, bad body).
 * Callers must not conflate "empty" with "failed": an empty menu is a
 * real state to present honestly, never a reason to substitute another
 * list, and a failure must never be dressed up as menu data.
 */
export async function fetchMenuItems(): Promise<MenuItem[] | null> {
  const data = await getJson<{ items: (MenuItem & { tags?: string[] })[] }>('/api/v1/menu');
  if (!data || !Array.isArray(data.items)) return null;
  return data.items.map((i) => ({
    id: i.id, name: i.name, description: i.description, price: i.price,
    image: i.image, category: i.category,
    tags: Array.isArray(i.tags) ? i.tags : undefined,
  }));
}

export async function fetchPublicSettings(): Promise<PublicSettings | null> {
  const data = await getJson<{ settings: PublicSettings }>('/api/v1/settings/public');
  return data?.settings ?? null;
}

export async function fetchApprovedReviews(): Promise<ApprovedReview[] | null> {
  const data = await getJson<{ reviews: ApprovedReview[] }>('/api/v1/reviews/approved');
  if (!data || !Array.isArray(data.reviews) || data.reviews.length === 0) return null;
  return data.reviews;
}

// ─── Authenticated + form endpoints ──────────────────────────────────────────

async function authHeaders(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: { timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetchWithTimeout(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(init.headers ?? {}) },
    }, options.timeoutMs);
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    return {
      ok: res.ok,
      status: res.status,
      data: body,
      error: res.ok ? null : (body?.error ?? 'Something went wrong — please try again'),
    };
  } catch (err) {
    if (isTimeoutError(err)) {
      return { ok: false, status: 0, data: null, error: TIMEOUT_MESSAGE };
    }
    return { ok: false, status: 0, data: null, error: 'We could not reach the server — please check your connection and try again' };
  }
}

export const submitReservation = (payload: {
  name: string; email: string; phone: string; date: string; time: string; guests: number;
}) => apiRequest('/api/v1/reservations', { method: 'POST', body: JSON.stringify(payload) });

export const subscribeNewsletter = (email: string) =>
  apiRequest('/api/v1/newsletter', { method: 'POST', body: JSON.stringify({ email }) });

export const sendContactMessage = (payload: {
  name: string; email: string; phone?: string; subject?: string; message: string;
}) => apiRequest('/api/v1/contact', { method: 'POST', body: JSON.stringify(payload) });

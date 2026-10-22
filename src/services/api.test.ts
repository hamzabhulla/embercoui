import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, fetchMenuItems } from './api';

// Audit-2 fix 10 — the API client's status/error surface. TrackOrder
// (fix 7) branches on exactly these three outcomes, so they are
// pinned as a contract: a real 404 keeps its status (→ not-found
// screen), a network/timeout failure reports status 0 (→ error
// screen with Retry), and a 5xx keeps its status with an honest
// message. fetch is stubbed; no network is touched.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('a 2xx returns ok with the parsed body and no error', async () => {
    stubFetch(async () => jsonResponse(200, { order: { id: 'ord-1' } }));
    const res = await apiRequest<{ order: { id: string } }>('/api/v1/orders/ord-1');
    expect(res).toEqual({ ok: true, status: 200, data: { order: { id: 'ord-1' } }, error: null });
  });

  it('a 404 keeps its status and surfaces the server’s own error message', async () => {
    stubFetch(async () => jsonResponse(404, { error: 'Order not found' }));
    const res = await apiRequest('/api/v1/orders/nope');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404); // TrackOrder: → the not-found screen
    expect(res.error).toBe('Order not found');
  });

  it('a 5xx without an error body keeps its status with the generic message', async () => {
    stubFetch(async () => new Response('boom', { status: 500 }));
    const res = await apiRequest('/api/v1/orders/ord-1');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500); // TrackOrder: → the error screen, NOT not-found
    expect(res.error).toBe('Something went wrong — please try again');
    expect(res.data).toBeNull();
  });

  it('a network failure maps to status 0 with the reachability message', async () => {
    stubFetch(async () => { throw new TypeError('fetch failed'); });
    const res = await apiRequest('/api/v1/orders/ord-1');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0); // TrackOrder: → the error screen (offline ≠ nonexistent)
    expect(res.error).toBe('We could not reach the server — please check your connection and try again');
    expect(res.data).toBeNull();
  });

  it('a timeout maps to status 0 with the timeout message', async () => {
    stubFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    const res = await apiRequest('/api/v1/orders/ord-1', {}, { timeoutMs: 25 });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.error).toBe('Request timed out — please try again');
  });
});

describe('fetchMenuItems — three outcomes, never conflated', () => {
  it('a successful response maps the items (tags optional)', async () => {
    stubFetch(async () => jsonResponse(200, {
      items: [
        { id: 1, name: 'Ember Classic', description: 'Beef', price: 24, image: 'i1', category: 'Burgers', tags: ['Spicy'] },
        { id: 2, name: 'Plain', description: 'Simple', price: 10, image: 'i2', category: 'Mains' },
      ],
    }));
    const items = await fetchMenuItems();
    expect(items).toHaveLength(2);
    expect(items?.[0]).toEqual({ id: 1, name: 'Ember Classic', description: 'Beef', price: 24, image: 'i1', category: 'Burgers', tags: ['Spicy'] });
    expect(items?.[1].tags).toBeUndefined();
  });

  it('an EMPTY menu is a real answer — [] not null', async () => {
    stubFetch(async () => jsonResponse(200, { items: [] }));
    await expect(fetchMenuItems()).resolves.toEqual([]);
  });

  it('a failed fetch is null — never dressed up as menu data', async () => {
    stubFetch(async () => jsonResponse(500, { error: 'boom' }));
    await expect(fetchMenuItems()).resolves.toBeNull();
    stubFetch(async () => { throw new TypeError('fetch failed'); });
    await expect(fetchMenuItems()).resolves.toBeNull();
    stubFetch(async () => jsonResponse(200, { nope: true }));
    await expect(fetchMenuItems()).resolves.toBeNull();
  });
});

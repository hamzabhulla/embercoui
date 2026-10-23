import express from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { ChatService } from '../src/lib/chat';
import {
  SupabaseRateLimitStore,
  type RateLimitBackend,
} from '../src/lib/rateLimitStore';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';

// OPS-M1 — the shared rate-limit store. The fake backend below is a
// faithful miniature of migration 0018's rate_limit_hit: one map
// standing in for the shared table, fixed windows, a hit rolls the
// window (count → 1, fresh expiry) when the stored one has expired
// and increments it otherwise. Two app instances built over ONE
// fake backend are two "serverless instances" sharing one database.

interface FakeRow { count: number; expiresAt: number }

class FakeRateLimitBackend implements RateLimitBackend {
  rows = new Map<string, FakeRow>();
  fail = false;
  hang = false;
  hitCalls = 0;
  hitDelayMs = 0;
  malformed: (() => unknown) | null = null;

  private guard(): void {
    if (this.fail) throw new Error('rate_limit_hit failed: function public.rate_limit_hit(text, bigint) does not exist');
  }

  async hit(key: string, windowMs: number) {
    this.hitCalls += 1;
    if (this.hang) return new Promise<never>(() => undefined);
    this.guard();
    if (this.hitDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.hitDelayMs));
    if (this.malformed) return this.malformed() as { totalHits: number; resetTime: Date };
    const now = Date.now();
    const row = this.rows.get(key);
    if (!row || row.expiresAt <= now) {
      const fresh = { count: 1, expiresAt: now + windowMs };
      this.rows.set(key, fresh);
      return { totalHits: 1, resetTime: new Date(fresh.expiresAt) };
    }
    row.count += 1;
    return { totalHits: row.count, resetTime: new Date(row.expiresAt) };
  }

  async get(key: string) {
    this.guard();
    const row = this.rows.get(key);
    if (!row || row.expiresAt <= Date.now()) return undefined;
    return { totalHits: row.count, resetTime: new Date(row.expiresAt) };
  }

  async reset(key: string) {
    this.guard();
    this.rows.delete(key);
  }

  async decrement(key: string) {
    this.guard();
    const row = this.rows.get(key);
    if (row && row.count > 0) row.count -= 1;
  }
}

class StubChatService implements ChatService {
  async reply(): Promise<string> {
    return 'The Ember Classic is an excellent choice.';
  }
}

const userMsg = { messages: [{ role: 'user', content: 'What burgers do you have?' }] };
const chatApp = (backend: RateLimitBackend | null) =>
  createApp({
    env: testEnv(),
    repo: new FakeRepository(),
    verifyToken: fakeVerifyToken,
    chat: new StubChatService(),
    rateLimitBackend: backend,
  });
const chat = (app: ReturnType<typeof createApp>) => request(app).post('/api/v1/chat').send(userMsg);

const initStore = (store: SupabaseRateLimitStore, windowMs: number) =>
  store.init({ windowMs } as unknown as Options);

describe('OPS-M1 shared rate-limit store — cross-instance agreement', () => {
  it('(a) hits through instance A count against instance B; the combined (limit+1)th request is 429 with the usual shape', async () => {
    const backend = new FakeRateLimitBackend();
    const appA = chatApp(backend);
    const appB = chatApp(backend);
    // 10 hits through A + 10 through B = the full 20-message budget.
    for (let i = 0; i < 10; i += 1) expect((await chat(appA)).status).toBe(200);
    for (let i = 0; i < 10; i += 1) expect((await chat(appB)).status).toBe(200);
    // The 21st combined request is refused by BOTH instances, with
    // exactly the response shape the in-memory limiter always sent.
    const refusedB = await chat(appB);
    expect(refusedB.status).toBe(429);
    expect(refusedB.body).toEqual({ error: 'You are sending messages too quickly — please wait a few minutes.' });
    const refusedA = await chat(appA);
    expect(refusedA.status).toBe(429);
    expect(refusedA.body).toEqual(refusedB.body);
  });

  it('(d) two limiters sharing the backend keep isolated budgets (store prefixes)', async () => {
    const backend = new FakeRateLimitBackend();
    const chatStore = new SupabaseRateLimitStore({ prefix: 'chat:', backend });
    const ordersStore = new SupabaseRateLimitStore({ prefix: 'orders:', backend });
    initStore(chatStore, 60_000);
    initStore(ordersStore, 60_000);
    await chatStore.increment('203.0.113.7');
    await chatStore.increment('203.0.113.7');
    await chatStore.increment('203.0.113.7');
    // The orders budget for the same IP is untouched…
    expect(await ordersStore.get('203.0.113.7')).toBeUndefined();
    expect((await ordersStore.increment('203.0.113.7')).totalHits).toBe(1);
    // …and the chat budget still reads its own count.
    expect((await chatStore.get('203.0.113.7'))?.totalHits).toBe(3);
  });
});

describe('OPS-M1 shared rate-limit store — window semantics', () => {
  it('(b) window expiry resets the budget', async () => {
    const backend = new FakeRateLimitBackend();
    const store = new SupabaseRateLimitStore({ prefix: 'chat:', backend });
    initStore(store, 120);
    expect((await store.increment('198.51.100.2')).totalHits).toBe(1);
    expect((await store.increment('198.51.100.2')).totalHits).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 160));
    const after = await store.increment('198.51.100.2');
    expect(after.totalHits).toBe(1);
    expect(after.resetTime).toBeInstanceOf(Date);
    expect((after.resetTime as Date).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('OPS-M1 degradation contract — store error falls back, never fails closed', () => {
  it('(c) a failing backend (pre-0018: function missing) still serves requests; the in-memory fallback enforces per-instance, with no 500s and no lockout below the limit', async () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const backend = new FakeRateLimitBackend();
      backend.fail = true;
      const app = chatApp(backend);
      // The full per-instance budget is served…
      for (let i = 0; i < 20; i += 1) {
        const res = await chat(app);
        expect(res.status).toBe(200);
      }
      // …and the fallback refuses the 21st, exactly like today's app.
      const refused = await chat(app);
      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({ error: 'You are sending messages too quickly — please wait a few minutes.' });
      // Degradation was logged, but throttled — never one line per
      // request (21 requests × 2 failing limiters would be 42).
      const degradeLines = noise.mock.calls.filter((args) =>
        args.some((a) => typeof a === 'string' && a.includes('rate-limit store')),
      );
      expect(degradeLines.length).toBeGreaterThanOrEqual(1);
      expect(degradeLines.length).toBeLessThanOrEqual(4);
    } finally {
      noise.mockRestore();
    }
  });

  it('(c2) a hanging backend is bounded by the store timeout and still falls back', async () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const backend = new FakeRateLimitBackend();
      backend.hang = true;
      const store = new SupabaseRateLimitStore({ prefix: 'chat:', backend, timeoutMs: 50 });
      initStore(store, 60_000);
      const started = Date.now();
      const info = await store.increment('192.0.2.9');
      expect(info.totalHits).toBe(1);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      noise.mockRestore();
    }
  });

  it('(c3) recovery: once the backend answers again, shared counting resumes', async () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const backend = new FakeRateLimitBackend();
      // AUDIT CORRECTION adjustment (disclosed): the failure cooldown
      // (default 30 s) now legitimately delays recovery probing, so
      // this test injects a 0 ms cooldown — its intent (shared
      // counting resumes without a restart once the backend answers)
      // is unchanged and still asserted below.
      const store = new SupabaseRateLimitStore({ prefix: 'chat:', backend, failureCooldownMs: 0 });
      initStore(store, 60_000);
      backend.fail = true;
      expect((await store.increment('192.0.2.10')).totalHits).toBe(1); // fallback
      backend.fail = false;
      // Shared store takes over (its own counter starts at 1 — the
      // two counters are never merged, per the contract).
      expect((await store.increment('192.0.2.10')).totalHits).toBe(1);
      expect((await store.increment('192.0.2.10')).totalHits).toBe(2);
      expect(backend.rows.get('chat:192.0.2.10')?.count).toBe(2);
    } finally {
      noise.mockRestore();
    }
  });
});

describe('OPS-M1 store — express-rate-limit 7.x Store interface contract', () => {
  it('(e) increment returns { totalHits, resetTime: Date }; get / decrement / resetKey behave', async () => {
    const backend = new FakeRateLimitBackend();
    const store = new SupabaseRateLimitStore({ prefix: 'chat:', backend });
    initStore(store, 60_000);
    expect(store.localKeys).toBe(false);
    expect(store.prefix).toBe('chat:');

    const first = await store.increment('203.0.113.99');
    expect(first.totalHits).toBe(1);
    expect(first.resetTime).toBeInstanceOf(Date);
    expect((await store.increment('203.0.113.99')).totalHits).toBe(2);

    expect((await store.get('203.0.113.99'))?.totalHits).toBe(2);
    expect(await store.get('203.0.113.100')).toBeUndefined();

    await store.decrement('203.0.113.99');
    expect((await store.get('203.0.113.99'))?.totalHits).toBe(1);

    await store.resetKey('203.0.113.99');
    expect(await store.get('203.0.113.99')).toBeUndefined();
    expect((await store.increment('203.0.113.99')).totalHits).toBe(1);
  });

  it('(e2) the store drives the real middleware — stacked limiters with distinct prefixes do not double-count', async () => {
    const backend = new FakeRateLimitBackend();
    const app = express();
    app.use(rateLimit({
      windowMs: 60_000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false,
      store: new SupabaseRateLimitStore({ prefix: 'global:', backend }),
    }));
    app.use(rateLimit({
      windowMs: 60_000, limit: 2, standardHeaders: 'draft-7', legacyHeaders: false,
      store: new SupabaseRateLimitStore({ prefix: 'chat:', backend }),
      message: { error: 'slow down' },
    }));
    app.get('/', (_req, res) => { res.json({ ok: true }); });
    // Two stacked limiters over the same class + same IP key must not
    // trip ERR_ERL_DOUBLE_COUNT (a 500) — the distinct store
    // prefixes are what separate them.
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);
    const refused = await request(app).get('/');
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: 'slow down' });
    // The shared counters show both budgets counted independently.
    expect(backend.rows.get('global:::ffff:127.0.0.1')?.count ?? backend.rows.get('global:127.0.0.1')?.count).toBe(3);
    expect(backend.rows.get('chat:::ffff:127.0.0.1')?.count ?? backend.rows.get('chat:127.0.0.1')?.count).toBe(3);
  });
});

describe('OPS-M1 audit correction — failure cooldown (circuit breaker)', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('(f1) hanging backend: the first request pays the race timeout; requests inside the cooldown are served by the fallback with NO further backend attempt', async () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const backend = new FakeRateLimitBackend();
      backend.hang = true;
      const store = new SupabaseRateLimitStore({ prefix: 'chat:', backend, timeoutMs: 50, failureCooldownMs: 60_000 });
      initStore(store, 60_000);
      const first = await store.increment('192.0.2.20');
      expect(first.totalHits).toBe(1); // fallback decision
      expect(backend.hitCalls).toBe(1);
      const started = Date.now();
      // Counts are read at resolution time: the MemoryStore returns
      // one shared object per key, mutated by later increments.
      const rest: number[] = [];
      for (let i = 0; i < 4; i += 1) rest.push((await store.increment('192.0.2.20')).totalHits);
      // Fallback counts keep ascending (fallback limit still applies)…
      expect(rest).toEqual([2, 3, 4, 5]);
      // …the backend was never re-attempted inside the cooldown…
      expect(backend.hitCalls).toBe(1);
      // …and none of them paid the 50 ms race timeout again.
      expect(Date.now() - started).toBeLessThan(400);
    } finally {
      noise.mockRestore();
    }
  });

  it('(f2) after the cooldown expires, exactly ONE probe is attempted even under concurrent requests; the rest keep using the fallback', async () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const backend = new FakeRateLimitBackend();
      const store = new SupabaseRateLimitStore({ prefix: 'chat:', backend, timeoutMs: 500, failureCooldownMs: 50 });
      initStore(store, 60_000);
      backend.fail = true;
      expect((await store.increment('192.0.2.21')).totalHits).toBe(1); // fallback; cooldown starts
      expect(backend.hitCalls).toBe(1);
      backend.fail = false;
      backend.hitDelayMs = 80; // the probe is SLOW — herd pressure is real
      await sleep(110); // cooldown expired
      // Distinct keys per request so the shared-vs-fallback landing
      // of each is directly observable in the backend's rows (the
      // first caller becomes the probe).
      const keys = ['192.0.2.21', '192.0.2.24', '192.0.2.25', '192.0.2.26', '192.0.2.27'];
      const batch = await Promise.all(keys.map((k) => store.increment(k)));
      expect(batch.every((r) => r.totalHits === 1)).toBe(true); // all served
      // Exactly one probe hit the backend for all five requests…
      expect(backend.hitCalls).toBe(2);
      // …it landed in the SHARED store for the probe's key, while
      // the other four were decided by the fallback (no shared rows).
      expect(backend.rows.get('chat:192.0.2.21')?.count).toBe(1);
      for (const k of keys.slice(1)) expect(backend.rows.has(`chat:${k}`)).toBe(false);
      // And the successful probe resumed shared mode.
      expect((await store.increment('192.0.2.21')).totalHits).toBe(2);
      expect(backend.hitCalls).toBe(3);
    } finally {
      noise.mockRestore();
    }
  });

  it('(f3) probe success → shared counting resumes; inside the cooldown the (now healthy) backend is not attempted at all', async () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const backend = new FakeRateLimitBackend();
      const store = new SupabaseRateLimitStore({ prefix: 'chat:', backend, timeoutMs: 50, failureCooldownMs: 50 });
      initStore(store, 60_000);
      backend.fail = true;
      expect((await store.increment('192.0.2.22')).totalHits).toBe(1); // fallback
      backend.fail = false;
      // Still inside the cooldown: fallback serves, backend untouched.
      expect((await store.increment('192.0.2.22')).totalHits).toBe(2);
      expect(backend.hitCalls).toBe(1);
      await sleep(110); // cooldown expired
      // The probe succeeds — shared counting resumes from the shared
      // counter (starting at 1; counters never merge).
      expect((await store.increment('192.0.2.22')).totalHits).toBe(1);
      expect((await store.increment('192.0.2.22')).totalHits).toBe(2);
      expect(backend.rows.get('chat:192.0.2.22')?.count).toBe(2);
      expect(backend.hitCalls).toBe(3);
    } finally {
      noise.mockRestore();
    }
  });

  it('(f4) probe failure → a fresh cooldown begins (exactly one backend attempt per cooldown window)', async () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const backend = new FakeRateLimitBackend();
      backend.fail = true;
      const store = new SupabaseRateLimitStore({ prefix: 'chat:', backend, timeoutMs: 50, failureCooldownMs: 50 });
      initStore(store, 60_000);
      await store.increment('192.0.2.23');
      expect(backend.hitCalls).toBe(1);
      await store.increment('192.0.2.23'); // inside cooldown — no attempt
      expect(backend.hitCalls).toBe(1);
      await sleep(110);
      await store.increment('192.0.2.23'); // the probe — fails
      expect(backend.hitCalls).toBe(2);
      await store.increment('192.0.2.23'); // fresh cooldown — no attempt
      expect(backend.hitCalls).toBe(2);
      await sleep(110);
      await store.increment('192.0.2.23'); // next window's probe
      expect(backend.hitCalls).toBe(3);
    } finally {
      noise.mockRestore();
    }
  });
});

describe('OPS-M1 audit correction — malformed shared replies degrade to the fallback', () => {
  const future = () => new Date(Date.now() + 60_000);
  const shapes: Array<[string, () => unknown]> = [
    ['totalHits is 0', () => ({ totalHits: 0, resetTime: future() })],
    ['totalHits is a non-integer', () => ({ totalHits: 1.5, resetTime: future() })],
    ['resetTime is an invalid Date', () => ({ totalHits: 1, resetTime: new Date(NaN) })],
    ['resetTime is not a Date at all', () => ({ totalHits: 1, resetTime: 'in a minute' })],
    ['the whole result is null', () => null],
  ];

  it.each(shapes)('malformed shape (%s): the request is still served by the fallback, whose counts keep enforcing', async (_name, make) => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const backend = new FakeRateLimitBackend();
      backend.malformed = make;
      const store = new SupabaseRateLimitStore({ prefix: 'chat:', backend });
      initStore(store, 60_000);
      // Below-limit requests pass — decided by the in-memory
      // fallback, whose ascending counts are what the limiter's
      // limit check enforces (middleware-level enforcement of the
      // fallback is pinned by test (c)).
      expect((await store.increment('192.0.2.30')).totalHits).toBe(1);
      expect((await store.increment('192.0.2.30')).totalHits).toBe(2);
      expect((await store.increment('192.0.2.30')).totalHits).toBe(3);
    } finally {
      noise.mockRestore();
    }
  });
});

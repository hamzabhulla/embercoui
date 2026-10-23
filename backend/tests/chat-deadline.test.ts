import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import {
  createGeminiChatService, GEMINI_MODEL_CHAIN, UPSTREAM_ERROR,
  type ChatMessage, type ChatService,
} from '../src/lib/chat';
import type { PublicSettingsDTO } from '../src/repositories/types';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';

// ── OPS-M2: the chat request's overall upstream deadline ─────────────
// vercel.json caps the function at 30 s, but grounding fetches plus a
// 4-model chain of 20 s per-attempt aborts could sum far past it, so
// the platform killed the function instead of the service answering
// its honest 502. These tests pin the shared 25 s budget (injected
// small, via the modules' existing configuration patterns) at both
// seams: the Gemini chain (lib/chat.ts timing options) and the route
// (chatDeadlineMs, the rateLimitMax pattern). Assertions are on the
// BOUND — call counts and budget-relative elapsed — never on
// wall-clock luck against the real 25 s.

const INPUT = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }] };

function abortError(): Error {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

interface StubResult { status: number; text?: string; hang?: boolean; delayMs?: number }

/** Fetch stub honouring the AbortSignal like undici does: a hanging call settles ONLY by aborting. */
function stubFetch(handler: (model: string) => StubResult) {
  const calls: string[] = [];
  const fetchMock = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
    const model = /models\/([^:]+):generateContent/.exec(url)?.[1] ?? '?';
    calls.push(model);
    const r = handler(model);
    const signal = init?.signal;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError());
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      const settle = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve({
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async () => ({ candidates: [{ content: { parts: [{ text: r.text ?? '' }] } }] }),
        });
      };
      if (r.hang) return; // never settles unless the attempt's abort fires
      if (r.delayMs) setTimeout(settle, r.delayMs);
      else settle();
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('Gemini chain — overall deadline (OPS-M2)', () => {
  it('(a) a hanging first model is aborted at the per-attempt bound and the next model answers', async () => {
    const calls = stubFetch((model) =>
      model === GEMINI_MODEL_CHAIN[0] ? { status: 0, hang: true } : { status: 200, text: 'Answered by the fallback.' },
    );
    const svc = createGeminiChatService('test-key', null, { totalBudgetMs: 5_000, perAttemptTimeoutMs: 150, minAttemptMs: 50 });
    const started = Date.now();
    await expect(svc.reply(INPUT)).resolves.toBe('Answered by the fallback.');
    const elapsed = Date.now() - started;
    expect(calls).toEqual([GEMINI_MODEL_CHAIN[0], GEMINI_MODEL_CHAIN[1]]);
    // The hang was cut at ~150 ms, not left to any platform cap.
    expect(elapsed).toBeLessThan(2_000);
  });

  it('(b) ALL models hang → the honest 502 inside the total budget, chain stops when the budget does', async () => {
    const calls = stubFetch(() => ({ status: 0, hang: true }));
    const svc = createGeminiChatService('test-key', null, { totalBudgetMs: 400, perAttemptTimeoutMs: 120, minAttemptMs: 50 });
    const started = Date.now();
    const err = await svc.reply(INPUT).catch((e: unknown) => e);
    const elapsed = Date.now() - started;
    // Same error shape as today's upstream failure — status AND message.
    expect(err).toMatchObject({ status: 502 });
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(UPSTREAM_ERROR);
    // Attempts at 120 ms each: three fit the 400 ms budget; the fourth
    // would start with ~40 ms left — below the 50 ms minimum window —
    // so it never starts. Without the deadline this count is 4 (and
    // with the production per-attempt cap the elapsed would be ~80 s).
    expect(calls).toHaveLength(3);
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(400 + 250);
  });

  it('(b2) a route-supplied deadlineAt bounds the chain even when the service budget is larger', async () => {
    const calls = stubFetch(() => ({ status: 0, hang: true }));
    const svc = createGeminiChatService('test-key', null, { perAttemptTimeoutMs: 120, minAttemptMs: 50 });
    const started = Date.now();
    const err = await svc.reply({ ...INPUT, deadlineAt: started + 250 }).catch((e: unknown) => e);
    const elapsed = Date.now() - started;
    expect(err).toMatchObject({ status: 502 });
    // Two 120 ms attempts fit the 250 ms deadline; a third would start
    // below the minimum attempt window, so the chain stops at two.
    expect(calls).toHaveLength(2);
    expect(elapsed).toBeLessThan(250 + 250);
  });

  it('(d) a slow-but-in-budget first-model success answers 200-shaped, unchanged', async () => {
    const calls = stubFetch(() => ({ status: 200, text: 'A considered answer.', delayMs: 150 }));
    const svc = createGeminiChatService('test-key', null, { totalBudgetMs: 5_000, perAttemptTimeoutMs: 2_000, minAttemptMs: 50 });
    await expect(svc.reply(INPUT)).resolves.toBe('A considered answer.');
    expect(calls).toEqual([GEMINI_MODEL_CHAIN[0]]);
  });

  it('(e) a fast-failure chain (all 404 immediately) keeps the exact 502 shape and chain order', async () => {
    const calls = stubFetch(() => ({ status: 404 }));
    const svc = createGeminiChatService('test-key', null, { totalBudgetMs: 5_000, perAttemptTimeoutMs: 2_000, minAttemptMs: 50 });
    const err = await svc.reply(INPUT).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502 });
    expect((err as Error).message).toBe(UPSTREAM_ERROR);
    expect(calls).toEqual([...GEMINI_MODEL_CHAIN]);
  });
});

// ── Route seam: grounding fetches share the same deadline ───────────

class RouteFakeChat implements ChatService {
  calls: { system: string; messages: ChatMessage[]; deadlineAt?: number }[] = [];
  async reply(input: { system: string; messages: ChatMessage[]; deadlineAt?: number }): Promise<string> {
    this.calls.push(input);
    return 'The Ember Classic is an excellent choice.';
  }
}

const userMsg = { messages: [{ role: 'user', content: 'What burgers do you have?' }] };

describe('POST /api/v1/chat — grounding deadline (OPS-M2)', () => {
  it('(c1) a hanging REQUIRED grounding fetch is bounded: honest 502, model chain never starts', async () => {
    class HangingSettingsRepo extends FakeRepository {
      override async getSettings(): Promise<PublicSettingsDTO> {
        return new Promise<PublicSettingsDTO>(() => { /* never settles */ });
      }
    }
    const fakeChat = new RouteFakeChat();
    const target = createApp({
      env: testEnv(), repo: new HangingSettingsRepo(), verifyToken: fakeVerifyToken,
      chat: fakeChat, chatDeadlineMs: 300,
    });
    const started = Date.now();
    const res = await request(target).post('/api/v1/chat').send(userMsg);
    const elapsed = Date.now() - started;
    expect(res.status).toBe(502);
    // The same honest upstream error the model chain produces.
    expect(res.body.error).toBe(UPSTREAM_ERROR);
    expect(fakeChat.calls).toHaveLength(0);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('(c2) a hanging BEST-EFFORT grounding fetch degrades like a failed one: 200, section omitted', async () => {
    class HangingReservationsRepo extends FakeRepository {
      override async adminListReservations(): Promise<never> {
        return new Promise<never>(() => { /* never settles */ });
      }
    }
    const fakeChat = new RouteFakeChat();
    const target = createApp({
      env: testEnv(), repo: new HangingReservationsRepo(), verifyToken: fakeVerifyToken,
      chat: fakeChat, chatDeadlineMs: 300,
    });
    const started = Date.now();
    const res = await request(target).post('/api/v1/chat').send(userMsg);
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(res.body.reply).toContain('Ember Classic');
    expect(fakeChat.calls).toHaveLength(1);
    // The availability section is omitted — the hang degraded exactly
    // like the pre-existing fetch-failure path.
    expect(fakeChat.calls[0].system).not.toContain('Table availability');
    // The route's deadline reached the service, ~300 ms out.
    expect(fakeChat.calls[0].deadlineAt).toBeTypeOf('number');
    expect((fakeChat.calls[0].deadlineAt as number) - started).toBeLessThan(1_000);
    expect(elapsed).toBeLessThan(2_000);
  });
});

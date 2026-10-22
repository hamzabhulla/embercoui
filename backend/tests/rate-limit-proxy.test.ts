import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { ChatService } from '../src/lib/chat';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';

// Production audit Fix 12 — rate limiting must key per visitor behind
// Vercel's edge (TRUST_PROXY), and the global limiter must count requests
// before their bodies are parsed. Each test builds a fresh app, so every
// limiter starts from a zero counter (the established limiter-test
// pattern in chat.test.ts / orders-hardening.test.ts).

class StubChatService implements ChatService {
  async reply(): Promise<string> {
    return 'The Ember Classic is an excellent choice.';
  }
}

const userMsg = { messages: [{ role: 'user', content: 'What burgers do you have?' }] };
const chatFrom = (app: ReturnType<typeof createApp>, ip: string) =>
  request(app).post('/api/v1/chat').set('X-Forwarded-For', ip).send(userMsg);

describe('rate limiting behind a proxy (TRUST_PROXY)', () => {
  it('keys the chat budget per forwarded visitor IP when TRUST_PROXY=1', async () => {
    const app = createApp({
      env: testEnv({ trustProxy: 1 }),
      repo: new FakeRepository(),
      verifyToken: fakeVerifyToken,
      chat: new StubChatService(),
    });
    // One visitor exhausts the 20-message chat budget…
    let last = 0;
    for (let i = 0; i < 20; i += 1) {
      last = (await chatFrom(app, '1.1.1.1')).status;
    }
    expect(last).toBe(200);
    expect((await chatFrom(app, '1.1.1.1')).status).toBe(429);
    // …while a different visitor still has a full budget of their own.
    // Before this fix both shared the proxy's single bucket.
    expect((await chatFrom(app, '2.2.2.2')).status).toBe(200);
  });

  it('ignores X-Forwarded-For without TRUST_PROXY (one shared socket-IP bucket)', async () => {
    // express-rate-limit logs ERR_ERL_UNEXPECTED_X_FORWARDED_FOR for this
    // exact misconfiguration (header present, trust proxy off) — that
    // warning is the library doing its job; keep the test output clean.
    const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const app = createApp({
        env: testEnv(),
        repo: new FakeRepository(),
        verifyToken: fakeVerifyToken,
        chat: new StubChatService(),
      });
      let last = 0;
      for (let i = 0; i < 20; i += 1) {
        last = (await chatFrom(app, '1.1.1.1')).status;
      }
      expect(last).toBe(200);
      // A forged different XFF buys nothing: the bucket is the socket IP,
      // which both "visitors" share through supertest.
      expect((await chatFrom(app, '2.2.2.2')).status).toBe(429);
    } finally {
      noise.mockRestore();
    }
  });
});

describe('global limiter runs before the body parsers', () => {
  it('counts malformed-JSON posts and answers 429 (not 400) once the budget is spent', async () => {
    const app = createApp({
      env: testEnv(),
      repo: new FakeRepository(),
      verifyToken: fakeVerifyToken,
      globalRateLimitMax: 3,
    });
    const malformed = () =>
      request(app)
        .post('/api/v1/newsletter')
        .set('Content-Type', 'application/json')
        .send('{"email": ');
    // Within budget, each garbage body reaches the parser and gets the
    // honest 400…
    for (let i = 0; i < 3; i += 1) {
      const res = await malformed();
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid JSON body');
    }
    // …and past the budget the limiter refuses the request before the
    // parser ever sees it — proof the limiter sits ahead of the parsers.
    const refused = await malformed();
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatch(/too many requests/i);
  });

  it('still parses and routes valid requests normally under the moved limiter', async () => {
    const app = createApp({
      env: testEnv(),
      repo: new FakeRepository(),
      verifyToken: fakeVerifyToken,
      globalRateLimitMax: 3,
    });
    const health = await request(app).get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    const subscribed = await request(app).post('/api/v1/newsletter').send({ email: 'fan@example.com' });
    expect(subscribed.status).toBe(200);
    expect(subscribed.body.subscribed).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiChatService, GEMINI_MODEL_CHAIN } from '../src/lib/chat';

const INPUT = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }] };

function stubFetch(handler: (model: string) => { status: number; text?: string }) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    const model = /models\/([^:]+):generateContent/.exec(url)?.[1] ?? '?';
    calls.push(model);
    const r = handler(model);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => ({ candidates: [{ content: { parts: [{ text: r.text ?? '' }] } }] }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('Gemini model fallback chain', () => {
  it('walks past a retired (404) model and answers from the next one', async () => {
    const calls = stubFetch((model) =>
      model === GEMINI_MODEL_CHAIN[0] ? { status: 404 } : { status: 200, text: 'Hello from the fallback.' },
    );
    const svc = createGeminiChatService('test-key');
    await expect(svc.reply(INPUT)).resolves.toBe('Hello from the fallback.');
    expect(calls).toEqual([GEMINI_MODEL_CHAIN[0], GEMINI_MODEL_CHAIN[1]]);
  });

  it('remembers the working model — the next reply goes straight to it', async () => {
    const calls = stubFetch((model) =>
      model === GEMINI_MODEL_CHAIN[0] ? { status: 404 } : { status: 200, text: 'ok' },
    );
    const svc = createGeminiChatService('test-key');
    await svc.reply(INPUT);
    calls.length = 0;
    await expect(svc.reply(INPUT)).resolves.toBe('ok');
    expect(calls).toEqual([GEMINI_MODEL_CHAIN[1]]);
  });

  it('fails honestly (502) when every model in the chain is unavailable', async () => {
    stubFetch(() => ({ status: 404 }));
    const svc = createGeminiChatService('test-key');
    await expect(svc.reply(INPUT)).rejects.toMatchObject({ status: 502 });
  });

  it('does NOT walk the chain for a bad key (400 fails fast)', async () => {
    const calls = stubFetch(() => ({ status: 400 }));
    const svc = createGeminiChatService('test-key');
    await expect(svc.reply(INPUT)).rejects.toMatchObject({ status: 502 });
    expect(calls).toHaveLength(1);
  });

  it('an operator-pinned model is used alone', async () => {
    const calls = stubFetch(() => ({ status: 404 }));
    const svc = createGeminiChatService('test-key', 'gemini-pinned-x');
    await expect(svc.reply(INPUT)).rejects.toMatchObject({ status: 502 });
    expect(calls).toEqual(['gemini-pinned-x']);
  });

  it('an empty completion (safety block) is a 502, not an empty reply', async () => {
    stubFetch(() => ({ status: 200, text: '' }));
    const svc = createGeminiChatService('test-key');
    await expect(svc.reply(INPUT)).rejects.toMatchObject({ status: 502 });
  });
});

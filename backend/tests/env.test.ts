import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv({});
    expect(env.port).toBe(4000);
    expect(env.supabaseConfigured).toBe(false);
    expect(env.stripeConfigured).toBe(false);
    expect(env.corsOrigins).toEqual(['http://localhost:5173']);
  });
  it('throws when only half the Supabase config is set', () => {
    expect(() => loadEnv({ SUPABASE_URL: 'https://x.supabase.co' })).toThrow(/must be set together/);
    expect(() => loadEnv({ SUPABASE_SERVICE_ROLE_KEY: 'k' })).toThrow(/must be set together/);
  });
  it('accepts a complete Supabase config', () => {
    const env = loadEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    expect(env.supabaseConfigured).toBe(true);
  });
  it('rejects invalid ports', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/Invalid PORT/);
    expect(() => loadEnv({ PORT: '70000' })).toThrow(/Invalid PORT/);
  });
  it('parses CORS origins', () => {
    const env = loadEnv({ CORS_ORIGIN: 'https://a.com, https://b.com' });
    expect(env.corsOrigins).toEqual(['https://a.com', 'https://b.com']);
  });
  it('parses TRUST_PROXY as an integer hop count', () => {
    expect(loadEnv({}).trustProxy).toBeUndefined();
    expect(loadEnv({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadEnv({ TRUST_PROXY: ' 2 ' }).trustProxy).toBe(2);
    expect(loadEnv({ TRUST_PROXY: '0' }).trustProxy).toBe(0);
  });
  it('treats an invalid TRUST_PROXY as unset', () => {
    expect(loadEnv({ TRUST_PROXY: '' }).trustProxy).toBeUndefined();
    expect(loadEnv({ TRUST_PROXY: 'true' }).trustProxy).toBeUndefined();
    expect(loadEnv({ TRUST_PROXY: 'abc' }).trustProxy).toBeUndefined();
    expect(loadEnv({ TRUST_PROXY: '1.5' }).trustProxy).toBeUndefined();
    expect(loadEnv({ TRUST_PROXY: '-1' }).trustProxy).toBeUndefined();
  });
});

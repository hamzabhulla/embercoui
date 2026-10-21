import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';

const repo = new FakeRepository();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken });
const unconfigured = createApp({
  env: testEnv({ supabaseConfigured: false, supabaseUrl: null, supabaseServiceRoleKey: null }),
  repo: null,
  verifyToken: fakeVerifyToken,
});

describe('health', () => {
  it('responds ok and reports configuration', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.supabaseConfigured).toBe(true);
  });
  it('still responds when Supabase is not configured', async () => {
    const res = await request(unconfigured).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.supabaseConfigured).toBe(false);
  });
});

describe('public menu', () => {
  it('lists only available items in the frontend shape', async () => {
    const res = await request(app).get('/api/v1/menu');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ id: 1, name: 'Ember Classic', price: 24, image: 'img1', category: 'Burgers' });
  });
  it('gets one item', async () => {
    const res = await request(app).get('/api/v1/menu/2');
    expect(res.status).toBe(200);
    expect(res.body.item.name).toBe('Forest Truffle Burger');
  });
  it('404s for missing items', async () => {
    const res = await request(app).get('/api/v1/menu/999');
    expect(res.status).toBe(404);
  });
  it('404s for unavailable items', async () => {
    const res = await request(app).get('/api/v1/menu/3');
    expect(res.status).toBe(404);
  });
  it('400s for a non-numeric id', async () => {
    const res = await request(app).get('/api/v1/menu/abc');
    expect(res.status).toBe(400);
  });
  it('503s when Supabase is not configured', async () => {
    const res = await request(unconfigured).get('/api/v1/menu');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Supabase not configured');
  });
});

describe('public settings + reviews', () => {
  it('returns public settings', async () => {
    const res = await request(app).get('/api/v1/settings/public');
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ kitchenOpen: true, waitMin: 20, waitMax: 30 });
  });
  it('returns only approved reviews', async () => {
    const res = await request(app).get('/api/v1/reviews/approved');
    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0].name).toBe('Amélie Fontaine');
  });
});

import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';

const repo = new FakeRepository();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken });
const asUser = (r: request.Test) => r.set('Authorization', 'Bearer token-user');

beforeAll(async () => {
  await repo.createOrder({
    userId: 'user-1', customerName: 'Test User', customerEmail: 'user@example.com', customerPhone: null,
    address: null, notes: null, couponCode: null,
    items: [{ menuItemId: 1, name: 'Ember Classic', unitPrice: 24, quantity: 1 }],
    subtotal: 24, deliveryFee: 0, discount: 0, total: 24,
  });
  await repo.createOrder({
    userId: 'admin-1', customerName: 'Admin', customerEmail: 'admin@example.com', customerPhone: null,
    address: null, notes: null, couponCode: null,
    items: [{ menuItemId: 2, name: 'Forest Truffle Burger', unitPrice: 38, quantity: 1 }],
    subtotal: 38, deliveryFee: 0, discount: 0, total: 38,
  });
});

describe('account profile', () => {
  it('401s anonymously', async () => {
    expect((await request(app).get('/api/v1/account/profile')).status).toBe(401);
  });
  it('returns the profile with email', async () => {
    const res = await asUser(request(app).get('/api/v1/account/profile'));
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ id: 'user-1', fullName: 'Test User', email: 'user@example.com', role: 'customer' });
  });
  it('patches name and addresses', async () => {
    const res = await asUser(request(app).patch('/api/v1/account/profile')).send({
      fullName: 'Renamed User',
      addresses: [{ label: 'Home', line1: '1 Forest Way', city: 'Portland' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.fullName).toBe('Renamed User');
    expect(res.body.profile.addresses).toHaveLength(1);
  });
  it('rejects an address without a line', async () => {
    const res = await asUser(request(app).patch('/api/v1/account/profile')).send({ addresses: [{ city: 'Portland' }] });
    expect(res.status).toBe(400);
  });
});

describe('account orders + favorites', () => {
  it('lists only the caller’s orders', async () => {
    const res = await asUser(request(app).get('/api/v1/account/orders'));
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].customerEmail).toBe('user@example.com');
  });
  it('toggles favorites and resolves them to menu items', async () => {
    const add = await asUser(request(app).post('/api/v1/account/favorites')).send({ menuItemId: 1 });
    expect(add.body.favorites).toEqual([1]);
    const list = await asUser(request(app).get('/api/v1/account/favorites'));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].name).toBe('Ember Classic');
    const remove = await asUser(request(app).post('/api/v1/account/favorites')).send({ menuItemId: 1 });
    expect(remove.body.favorites).toEqual([]);
  });
});

describe('account hardening (audit minors)', () => {
  it('ignores mass-assignment attempts on PATCH /profile', async () => {
    const res = await asUser(request(app).patch('/api/v1/account/profile')).send({
      fullName: 'Still Me', role: 'admin', email: 'evil@example.com', id: 'admin-1',
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.role).toBe('customer');
    expect(res.body.profile.email).toBe('user@example.com');
    expect(res.body.profile.id).toBe('user-1');
  });
  it('rejects more than 10 addresses', async () => {
    const addresses = Array.from({ length: 11 }, (_, i) => ({ line1: `${i} Street`, city: 'Portland' }));
    const res = await asUser(request(app).patch('/api/v1/account/profile')).send({ addresses });
    expect(res.status).toBe(400);
  });
  it('rejects non-integer favorites', async () => {
    const res = await asUser(request(app).post('/api/v1/account/favorites')).send({ menuItemId: '1' });
    expect(res.status).toBe(400);
  });
  it('rejects favorites for dishes that do not exist', async () => {
    const res = await asUser(request(app).post('/api/v1/account/favorites')).send({ menuItemId: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('That dish is not available');
  });
  it('strips unknown keys from addresses', async () => {
    const res = await asUser(request(app).patch('/api/v1/account/profile')).send({
      addresses: [{ line1: '9 Pine St', city: 'Portland', evil: 'key' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.addresses[0]).not.toHaveProperty('evil');
  });
});

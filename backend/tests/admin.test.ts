import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';
import { FakeStorageService } from './fakeStorage';

const repo = new FakeRepository();
const storage = new FakeStorageService();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, stripe: new FakeStripeService(), storage });
const noStorage = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, storage: null });

const as = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
let paidOrderId = '';

beforeAll(async () => {
  const order = await repo.createOrder({
    userId: 'user-1', customerName: 'Test User', customerEmail: 'user@example.com', customerPhone: null,
    address: null, notes: null, couponCode: null,
    items: [{ menuItemId: 1, name: 'Ember Classic', unitPrice: 24, quantity: 2 }],
    subtotal: 48, deliveryFee: 0, discount: 0, total: 48,
  });
  paidOrderId = order.id;
  await repo.setOrderPaymentIntent(order.id, 'pi_seed');
  await repo.markOrderPaidByPaymentIntent('pi_seed');
  await repo.createReservation({ userId: null, name: 'Guest', email: 'g@example.com', phone: '1234567', date: '2026-11-02', time: '19:00', guests: 3 });
  await repo.addNewsletterSubscriber('fan@example.com');
});

describe('admin guards', () => {
  it('401s anonymously and 403s customers everywhere', async () => {
    expect((await request(app).get('/api/v1/admin/dashboard')).status).toBe(401);
    expect((await as(request(app).get('/api/v1/admin/dashboard'), 'token-user')).status).toBe(403);
    expect((await as(request(app).get('/api/v1/admin/orders'), 'token-user')).status).toBe(403);
  });
  it('allows staff to read but not destructive admin actions', async () => {
    expect((await as(request(app).get('/api/v1/admin/orders'), 'token-staff')).status).toBe(200);
    expect((await as(request(app).delete('/api/v1/admin/menu/1'), 'token-staff')).status).toBe(403);
    expect((await as(request(app).post('/api/v1/admin/coupons').send({ code: 'NEW10', type: 'percent', value: 10 }), 'token-staff')).status).toBe(403);
    expect((await as(request(app).patch('/api/v1/admin/staff/user-1/role').send({ role: 'admin' }), 'token-staff')).status).toBe(403);
  });
});

describe('admin dashboard + orders', () => {
  it('aggregates real numbers', async () => {
    const res = await as(request(app).get('/api/v1/admin/dashboard'), 'token-admin');
    expect(res.status).toBe(200);
    expect(res.body.stats.revenue).toBe(48);
    expect(res.body.stats.totalOrders).toBe(1);
    expect(res.body.stats.pendingOrders).toBe(1);
    expect(res.body.stats.pendingReservations).toBe(1);
    expect(res.body.recentOrders).toHaveLength(1);
  });
  it('updates order status and validates the enum', async () => {
    const ok = await as(request(app).patch(`/api/v1/admin/orders/${paidOrderId}/status`).send({ status: 'preparing' }), 'token-staff');
    expect(ok.status).toBe(200);
    expect(ok.body.order.status).toBe('preparing');
    const bad = await as(request(app).patch(`/api/v1/admin/orders/${paidOrderId}/status`).send({ status: 'flying' }), 'token-admin');
    expect(bad.status).toBe(400);
    const missing = await as(request(app).patch('/api/v1/admin/orders/order-nope/status').send({ status: 'ready' }), 'token-admin');
    expect(missing.status).toBe(404);
  });
  it('filters orders by status', async () => {
    const res = await as(request(app).get('/api/v1/admin/orders?status=preparing'), 'token-admin');
    expect(res.body.orders).toHaveLength(1);
    const badFilter = await as(request(app).get('/api/v1/admin/orders?status=bogus'), 'token-admin');
    expect(badFilter.status).toBe(400);
  });
});

describe('admin menu + upload', () => {
  it('creates, edits and (admin-only) deletes items', async () => {
    const created = await as(request(app).post('/api/v1/admin/menu').send({
      name: 'New Dish', description: 'Tasty', price: 19.5, image: 'x', category: 'Pizza', tags: ['Vegan'], isAvailable: true, sortOrder: 9,
    }), 'token-staff');
    expect(created.status).toBe(201);
    const id = created.body.item.id as number;
    const edited = await as(request(app).patch(`/api/v1/admin/menu/${id}`).send({ price: 21 }), 'token-staff');
    expect(edited.body.item.price).toBe(21);
    expect(edited.body.item.isAvailable).toBe(true);
    const deleted = await as(request(app).delete(`/api/v1/admin/menu/${id}`), 'token-admin');
    expect(deleted.status).toBe(200);
  });
  it('uploads images via storage and validates type/size', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    const ok = await as(request(app).post('/api/v1/admin/menu/upload').send({ filename: 'dish.png', contentType: 'image/png', dataBase64: png }), 'token-admin');
    expect(ok.status).toBe(201);
    expect(ok.body.url).toContain('storage.example');
    const badType = await as(request(app).post('/api/v1/admin/menu/upload').send({ filename: 'x.exe', contentType: 'application/octet-stream', dataBase64: png }), 'token-admin');
    expect(badType.status).toBe(400);
    const unconfigured = await as(request(noStorage).post('/api/v1/admin/menu/upload').send({ filename: 'dish.png', contentType: 'image/png', dataBase64: png }), 'token-admin');
    expect(unconfigured.status).toBe(503);
  });
});

describe('admin reservations, reviews, newsletter, coupons, finance, staff, settings', () => {
  it('confirms reservations', async () => {
    const list = await as(request(app).get('/api/v1/admin/reservations'), 'token-admin');
    const id = list.body.reservations[0].id as string;
    const res = await as(request(app).patch(`/api/v1/admin/reservations/${id}/status`).send({ status: 'confirmed' }), 'token-admin');
    expect(res.body.reservation.status).toBe('confirmed');
  });
  it('moderates reviews', async () => {
    const list = await as(request(app).get('/api/v1/admin/reviews'), 'token-admin');
    const pending = list.body.reviews.find((r: { isApproved: boolean }) => !r.isApproved);
    const res = await as(request(app).patch(`/api/v1/admin/reviews/${pending.id}`).send({ isApproved: true }), 'token-staff');
    expect(res.status).toBe(200);
    const pub = await request(app).get('/api/v1/reviews/approved');
    expect(pub.body.reviews.some((r: { id: string }) => r.id === pending.id)).toBe(true);
  });
  it('exports the newsletter as CSV', async () => {
    const res = await as(request(app).get('/api/v1/admin/newsletter.csv'), 'token-admin');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('fan@example.com');
  });
  it('manages coupons (admin only)', async () => {
    const created = await as(request(app).post('/api/v1/admin/coupons').send({ code: 'feast25', type: 'percent', value: 25 }), 'token-admin');
    expect(created.status).toBe(201);
    expect(created.body.coupon.code).toBe('FEAST25');
    const id = created.body.coupon.id as string;
    const edited = await as(request(app).patch(`/api/v1/admin/coupons/${id}`).send({ isActive: false }), 'token-admin');
    expect(edited.body.coupon.isActive).toBe(false);
    expect((await as(request(app).delete(`/api/v1/admin/coupons/${id}`), 'token-admin')).status).toBe(200);
  });
  it('reports finance from paid orders only', async () => {
    const res = await as(request(app).get('/api/v1/admin/finance'), 'token-admin');
    expect(res.status).toBe(200);
    expect(res.body.totalRevenue).toBe(48);
    expect(res.body.totalPaidOrders).toBe(1);
    expect(res.body.averageOrderValue).toBe(48);
    expect(res.body.byDay.length).toBeGreaterThan(0);
  });
  it('changes roles (admin only) and they take effect', async () => {
    const res = await as(request(app).patch('/api/v1/admin/staff/user-2/role').send({ role: 'staff' }), 'token-admin');
    expect(res.status).toBe(200);
    expect(res.body.profile.role).toBe('staff');
    const staffList = await as(request(app).get('/api/v1/admin/staff'), 'token-admin');
    expect(staffList.body.staff.some((p: { id: string }) => p.id === 'user-2')).toBe(true);
  });
  it('updates settings that drive the public LiveStatus', async () => {
    const res = await as(request(app).patch('/api/v1/admin/settings').send({ kitchenOpen: false, waitMin: 35, waitMax: 45 }), 'token-staff');
    expect(res.status).toBe(200);
    const pub = await request(app).get('/api/v1/settings/public');
    expect(pub.body.settings).toMatchObject({ kitchenOpen: false, waitMin: 35, waitMax: 45 });
    const invalid = await as(request(app).patch('/api/v1/admin/settings').send({ waitMin: 50, waitMax: 40 }), 'token-admin');
    expect(invalid.status).toBe(400);
  });
});

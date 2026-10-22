import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStorageService } from './fakeStorage';

const repo = new FakeRepository();
const storage = new FakeStorageService();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, storage });
const as = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

describe('phase 4 audit fixes', () => {
  it('staff list contains everyone with email + createdAt (promotion is possible)', async () => {
    const res = await as(request(app).get('/api/v1/admin/staff'), 'token-admin');
    expect(res.status).toBe(200);
    const customer = res.body.staff.find((p: { id: string }) => p.id === 'user-1');
    expect(customer).toBeTruthy();
    expect(customer.email).toContain('@');
    expect(Number.isNaN(Date.parse(customer.createdAt))).toBe(false);
    const promoted = await as(request(app).patch('/api/v1/admin/staff/user-1/role').send({ role: 'staff' }), 'token-admin');
    expect(promoted.status).toBe(200);
  });

  it('customers list has valid createdAt and cent-rounded totals', async () => {
    const res = await as(request(app).get('/api/v1/admin/customers'), 'token-admin');
    expect(res.status).toBe(200);
    for (const c of res.body.customers) {
      expect(Number.isNaN(Date.parse(c.createdAt))).toBe(false);
      expect(Math.round(c.totalSpent * 100) / 100).toBe(c.totalSpent);
      expect(c.role).toBe('customer');
    }
  });

  it('last-admin guard: the only admin cannot be demoted', async () => {
    const res = await as(request(app).patch('/api/v1/admin/staff/admin-1/role').send({ role: 'customer' }), 'token-admin');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/At least one admin/);
    // Promote someone else first — then demotion is allowed.
    await as(request(app).patch('/api/v1/admin/staff/user-2/role').send({ role: 'admin' }), 'token-admin');
    const ok = await as(request(app).patch('/api/v1/admin/staff/admin-1/role').send({ role: 'staff' }), 'token-admin');
    expect(ok.status).toBe(200);
    // Restore for other suites sharing nothing (this file has its own repo, but keep tidy)
    await as(request(app).patch('/api/v1/admin/staff/admin-1/role').send({ role: 'admin' }), 'token-user2');
  });

  it('settings: one-sided PATCH cannot invert the wait range', async () => {
    const bad = await as(request(app).patch('/api/v1/admin/settings').send({ waitMin: 200 }), 'token-admin');
    expect(bad.status).toBe(400);
    const pub = await request(app).get('/api/v1/settings/public');
    expect(pub.body.settings.waitMin).toBeLessThanOrEqual(pub.body.settings.waitMax);
  });

  it('upload: a ~800 KB image succeeds; a >5 MB file is refused by the body limit', async () => {
    // Buffers carry a real PNG signature — Fix 11 sniffs content, so a
    // fixture declared image/png must actually look like one.
    const pngOf = (size: number) => {
      const b = Buffer.alloc(size, 7);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
      return b.toString('base64');
    };
    const ok = await as(request(app).post('/api/v1/admin/menu/upload').send({ filename: 'big.png', contentType: 'image/png', dataBase64: pngOf(800 * 1024) }), 'token-admin');
    expect(ok.status).toBe(201);
    // A 5 MB file is a ~7 MB base64 body: Fix 11 caps the upload parser
    // at 4.4 MB (below the platform's 4.5 MB cap), so the refusal is now
    // the API's own 413 before decoding. The storage-level 5 MB rule
    // itself is unit-tested in settings-integrity.test.ts.
    const res = await as(request(app).post('/api/v1/admin/menu/upload').send({ filename: 'huge.png', contentType: 'image/png', dataBase64: pngOf(5 * 1024 * 1024 + 1) }), 'token-admin');
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/);
  });

  it('oversized bodies on normal routes get 413 JSON, not a bare 500', async () => {
    const res = await request(app).post('/api/v1/contact').send({ name: 'A', email: 'a@example.com', message: 'x'.repeat(1_100_000) });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/);
  });

  it('percent coupons above 100 are rejected', async () => {
    const res = await as(request(app).post('/api/v1/admin/coupons').send({ code: 'TOOMUCH', type: 'percent', value: 150 }), 'token-admin');
    expect(res.status).toBe(400);
  });

  it('CSV export quotes fields and neutralises formula-leading emails', async () => {
    await repo.addNewsletterSubscriber('+tag@example.com');
    const res = await as(request(app).get('/api/v1/admin/newsletter.csv'), 'token-admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`"'+tag@example.com"`);
  });
});

describe('coupon PATCH merged cap (re-audit fix)', () => {
  it('rejects value-only and type-switch patches that exceed 100% percent', async () => {
    // cpn-1 = WELCOME10 (percent 10) in FakeRepository seeds
    const list = await as(request(app).get('/api/v1/admin/coupons'), 'token-admin');
    const percent = list.body.coupons.find((c: { code: string }) => c.code === 'WELCOME10');
    const valueOnly = await as(request(app).patch(`/api/v1/admin/coupons/${percent.id}`).send({ value: 150 }), 'token-admin');
    expect(valueOnly.status).toBe(400);
    const fixed = list.body.coupons.find((c: { code: string }) => c.code === 'FIXED5');
    const typeSwitch = await as(request(app).patch(`/api/v1/admin/coupons/${fixed.id}`).send({ type: 'percent', value: 150 }), 'token-admin');
    expect(typeSwitch.status).toBe(400);
    const okPatch = await as(request(app).patch(`/api/v1/admin/coupons/${percent.id}`).send({ value: 15 }), 'token-admin');
    expect(okPatch.status).toBe(200);
    expect(okPatch.body.coupon.value).toBe(15);
  });
});

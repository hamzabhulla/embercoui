import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';

const repo = new FakeRepository();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken });
const ADMIN_TOKEN = ['Bearer', 'token-admin'].join(' ');
const postReservation = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/admin/reservations').set('Authorization', ADMIN_TOKEN).send(body);
const walkIn = { name: 'Walk-in Guest', phone: '+1 555 111 2222', date: '2026-11-02', time: '19:00', guests: 4 };

describe('Admin-created (walk-in / phone) reservations', () => {
  it('creates a confirmed booking without an email', async () => {
    const res = await postReservation(walkIn);
    expect(res.status).toBe(201);
    expect(res.body.reservation).toMatchObject({
      name: 'Walk-in Guest', email: null, phone: '+1 555 111 2222',
      date: '2026-11-02', time: '19:00', guests: 4,
      status: 'confirmed', source: 'admin', notes: null, userId: null,
    });
  });

  it('appears in the admin list with source admin', async () => {
    const res = await request(app).get('/api/v1/admin/reservations').set('Authorization', ADMIN_TOKEN);
    expect(res.status).toBe(200);
    const found = (res.body.reservations as { name: string; source: string }[]).find((r) => r.name === 'Walk-in Guest');
    expect(found?.source).toBe('admin');
  });

  it('keeps an optional email and notes, and honours an explicit pending status', async () => {
    const res = await postReservation({ ...walkIn, name: 'Phone Booking', email: 'phone@example.com', notes: 'Window seat', status: 'pending' });
    expect(res.status).toBe(201);
    expect(res.body.reservation).toMatchObject({ email: 'phone@example.com', notes: 'Window seat', status: 'pending', source: 'admin' });
  });

  it('normalizes an empty-string email to null', async () => {
    const res = await postReservation({ ...walkIn, name: 'No Email', email: '' });
    expect(res.status).toBe(201);
    expect(res.body.reservation.email).toBeNull();
  });

  it('rejects invalid payloads', async () => {
    expect((await postReservation({ ...walkIn, guests: 0 })).status).toBe(400);
    expect((await postReservation({ ...walkIn, guests: 21 })).status).toBe(400);
    expect((await postReservation({ ...walkIn, date: '2026-13-40' })).status).toBe(400);
    expect((await postReservation({ ...walkIn, date: 'Nov 2' })).status).toBe(400);
    expect((await postReservation({ ...walkIn, phone: '123' })).status).toBe(400);
    expect((await postReservation({ ...walkIn, email: 'not-an-email' })).status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/admin/reservations').send(walkIn);
    expect(res.status).toBe(401);
  });

  it('rejects non-admin users', async () => {
    const res = await request(app).post('/api/v1/admin/reservations').set('Authorization', ['Bearer', 'token-user'].join(' ')).send(walkIn);
    expect(res.status).toBe(403);
  });
});

describe('Reservation slot capacity in settings', () => {
  it('defaults to 40', async () => {
    const res = await request(app).get('/api/v1/admin/settings').set('Authorization', ADMIN_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.settings.reservationSlotCapacity).toBe(40);
  });

  it('round-trips through the settings PATCH', async () => {
    const patched = await request(app).patch('/api/v1/admin/settings').set('Authorization', ADMIN_TOKEN).send({ reservationSlotCapacity: 60 });
    expect(patched.status).toBe(200);
    expect(patched.body.settings.reservationSlotCapacity).toBe(60);
    const after = await request(app).get('/api/v1/admin/settings').set('Authorization', ADMIN_TOKEN);
    expect(after.body.settings.reservationSlotCapacity).toBe(60);
  });

  it('rejects capacities outside 1..500', async () => {
    const patch = (v: number) => request(app).patch('/api/v1/admin/settings').set('Authorization', ADMIN_TOKEN).send({ reservationSlotCapacity: v });
    expect((await patch(0)).status).toBe(400);
    expect((await patch(501)).status).toBe(400);
  });
});

describe('Public reservations stay website-sourced', () => {
  it('public POST still works and yields source website', async () => {
    const res = await request(app).post('/api/v1/reservations').send({
      name: 'Jane Guest', email: 'jane@example.com', phone: '+1 555 000 1234', date: '2026-11-01', time: '19:00', guests: 2,
    });
    expect(res.status).toBe(201);
    expect(res.body.reservation.source).toBe('website');
    expect(res.body.reservation.email).toBe('jane@example.com');
  });
});

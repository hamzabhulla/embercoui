import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';

const repo = new FakeRepository();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken });
const reservation = { name: 'Jane Guest', email: 'jane@example.com', phone: '+1 555 000 1234', date: '2026-11-01', time: '19:00', guests: 2 };

describe('POST /reservations', () => {
  it('creates a guest reservation as pending', async () => {
    const res = await request(app).post('/api/v1/reservations').send(reservation);
    expect(res.status).toBe(201);
    expect(res.body.reservation).toMatchObject({ name: 'Jane Guest', status: 'pending', userId: null, guests: 2 });
  });
  it('attaches the user when signed in', async () => {
    const res = await request(app).post('/api/v1/reservations').set('Authorization', 'Bearer token-user').send(reservation);
    expect(res.status).toBe(201);
    expect(res.body.reservation.userId).toBe('user-1');
  });
  it('rejects an invalid email with the frontend wording', async () => {
    const res = await request(app).post('/api/v1/reservations').send({ ...reservation, email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid email format');
  });
  it('rejects parties over 20', async () => {
    const res = await request(app).post('/api/v1/reservations').send({ ...reservation, guests: 25 });
    expect(res.status).toBe(400);
  });
  it('rejects a malformed date', async () => {
    const res = await request(app).post('/api/v1/reservations').send({ ...reservation, date: 'Nov 1' });
    expect(res.status).toBe(400);
  });
});

describe('POST /newsletter', () => {
  it('subscribes a new email', async () => {
    const res = await request(app).post('/api/v1/newsletter').send({ email: 'Fan@Example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subscribed: true, alreadySubscribed: false });
    expect(repo.newsletter.has('fan@example.com')).toBe(true);
  });
  it('reports duplicates without erroring', async () => {
    const res = await request(app).post('/api/v1/newsletter').send({ email: 'fan@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.alreadySubscribed).toBe(true);
  });
  it('rejects a bad email', async () => {
    const res = await request(app).post('/api/v1/newsletter').send({ email: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('POST /contact', () => {
  it('accepts a message', async () => {
    const res = await request(app).post('/api/v1/contact').send({ name: 'A', email: 'a@b.com', message: 'Hello there' });
    expect(res.status).toBe(201);
    expect(repo.contactMessages).toHaveLength(1);
  });
  it('requires a message', async () => {
    const res = await request(app).post('/api/v1/contact').send({ name: 'A', email: 'a@b.com', message: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Message is required');
  });
});

describe('POST /reviews', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/reviews').send({ rating: 5, comment: 'Great food' });
    expect(res.status).toBe(401);
  });
  it('creates an unapproved review for a signed-in user', async () => {
    const res = await request(app).post('/api/v1/reviews').set('Authorization', 'Bearer token-user').send({ rating: 5, comment: 'Great food', country: 'Canada' });
    expect(res.status).toBe(201);
    const stored = repo.reviews.find((r) => r.comment === 'Great food');
    expect(stored?.isApproved).toBe(false);
    expect(stored?.name).toBe('Test User');
  });
});

describe('form hardening (audit minors)', () => {
  it('ignores a spoofed userId on guest reservations', async () => {
    const res = await request(app).post('/api/v1/reservations').send({ ...reservation, userId: 'admin-1', status: 'confirmed' });
    expect(res.status).toBe(201);
    expect(res.body.reservation.userId).toBeNull();
    expect(res.body.reservation.status).toBe('pending');
  });
  it('rejects impossible calendar dates', async () => {
    const res = await request(app).post('/api/v1/reservations').send({ ...reservation, date: '2026-13-40' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Please choose a valid date');
  });
  it('rejects impossible times', async () => {
    const res = await request(app).post('/api/v1/reservations').send({ ...reservation, time: '99:99' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Please choose a valid time');
  });
  it('asserts the large-party wording', async () => {
    const res = await request(app).post('/api/v1/reservations').send({ ...reservation, guests: 25 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('For parties over 20, please contact us directly');
  });
});

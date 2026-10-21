import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { optionalAuth, requireAuth, requireRole, type AuthedRequest } from '../src/lib/auth';
import { errorHandler } from '../src/middleware/errors';
import { FakeRepository, fakeVerifyToken } from './fakeRepository';

function protectedApp(verifyToken = fakeVerifyToken) {
  const repo = new FakeRepository();
  const app = express();
  app.use(express.json());
  app.get('/protected', requireAuth({ repo, verifyToken }), (req: AuthedRequest, res) => {
    res.json({ userId: req.user?.id, role: req.user?.role });
  });
  app.get('/admin-only', requireAuth({ repo, verifyToken }), requireRole('admin'), (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/optional', optionalAuth({ repo, verifyToken }), (req: AuthedRequest, res) => {
    res.json({ userId: req.user?.id ?? null });
  });
  app.use(errorHandler);
  return app;
}

describe('requireAuth', () => {
  const app = protectedApp();
  it('401s without a token', async () => {
    expect((await request(app).get('/protected')).status).toBe(401);
  });
  it('401s with an invalid token', async () => {
    expect((await request(app).get('/protected').set('Authorization', 'Bearer nope')).status).toBe(401);
  });
  it('accepts a valid token and exposes the profile role', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer token-user');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'user-1', role: 'customer' });
  });
  it('503s when the auth verifier itself fails', async () => {
    const throwing = protectedApp(async () => { throw new Error('network down'); });
    const res = await request(throwing).get('/protected').set('Authorization', 'Bearer token-user');
    expect(res.status).toBe(503);
  });
  it('503s when Supabase is not configured (repo is null)', async () => {
    const repo = null;
    const app2 = express();
    app2.get('/protected', requireAuth({ repo, verifyToken: fakeVerifyToken }), (_req, res) => res.json({}));
    app2.use(errorHandler);
    const res = await request(app2).get('/protected').set('Authorization', 'Bearer token-user');
    expect(res.status).toBe(503);
  });
});

describe('requireRole', () => {
  const app = protectedApp();
  it('403s customers on admin routes', async () => {
    const res = await request(app).get('/admin-only').set('Authorization', 'Bearer token-user');
    expect(res.status).toBe(403);
  });
  it('allows admins', async () => {
    const res = await request(app).get('/admin-only').set('Authorization', 'Bearer token-admin');
    expect(res.status).toBe(200);
  });
  it('403s staff on admin-only routes', async () => {
    const res = await request(app).get('/admin-only').set('Authorization', 'Bearer token-staff');
    expect(res.status).toBe(403);
  });
});

describe('optionalAuth', () => {
  const app = protectedApp();
  it('passes anonymously without a token', async () => {
    const res = await request(app).get('/optional');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBeNull();
  });
  it('attaches the user when a valid token is present', async () => {
    const res = await request(app).get('/optional').set('Authorization', 'Bearer token-user');
    expect(res.body.userId).toBe('user-1');
  });
});

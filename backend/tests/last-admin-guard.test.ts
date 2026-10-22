import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStorageService } from './fakeStorage';

// Audit fix 15 — the last-admin guard on PATCH /admin/staff/:id/role.
// (admin-fixes.test.ts covers the same rule inside a broader suite; this
// file pins the four cases on their own, each against a fresh repo.)
const setup = () => {
  const repo = new FakeRepository();
  const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, storage: new FakeStorageService() });
  return { app };
};
const as = (r: request.Test, token: string) => r.set('Authorization', [`Bearer`, token].join(' '));
const roleOf = async (app: ReturnType<typeof setup>['app'], id: string, token: string) => {
  const res = await as(request(app).get('/api/v1/admin/staff'), token);
  expect(res.status).toBe(200);
  return res.body.staff.find((p: { id: string }) => p.id === id)?.role as string | undefined;
};

describe('last-admin guard', () => {
  it('sole admin cannot demote themselves — 400 and the role is unchanged', async () => {
    const { app } = setup();
    // token-admin IS admin-1, the only admin in the fake repo.
    const toCustomer = await as(request(app).patch('/api/v1/admin/staff/admin-1/role').send({ role: 'customer' }), 'token-admin');
    expect(toCustomer.status).toBe(400);
    expect(toCustomer.body.error).toMatch(/last admin|At least one admin/i);
    const toStaff = await as(request(app).patch('/api/v1/admin/staff/admin-1/role').send({ role: 'staff' }), 'token-admin');
    expect(toStaff.status).toBe(400);
    expect(await roleOf(app, 'admin-1', 'token-admin')).toBe('admin');
  });

  it('with two admins, demoting one succeeds', async () => {
    const { app } = setup();
    const promote = await as(request(app).patch('/api/v1/admin/staff/user-2/role').send({ role: 'admin' }), 'token-admin');
    expect(promote.status).toBe(200);
    const demote = await as(request(app).patch('/api/v1/admin/staff/admin-1/role').send({ role: 'staff' }), 'token-admin');
    expect(demote.status).toBe(200);
    // admin-1 is staff now, so read the list back as the remaining admin.
    expect(await roleOf(app, 'admin-1', 'token-user2')).toBe('staff');
    expect(await roleOf(app, 'user-2', 'token-user2')).toBe('admin');
  });

  it('promoting staff (or a customer) still works', async () => {
    const { app } = setup();
    const staffUp = await as(request(app).patch('/api/v1/admin/staff/staff-1/role').send({ role: 'admin' }), 'token-admin');
    expect(staffUp.status).toBe(200);
    expect(await roleOf(app, 'staff-1', 'token-admin')).toBe('admin');
    const customerUp = await as(request(app).patch('/api/v1/admin/staff/user-1/role').send({ role: 'staff' }), 'token-admin');
    expect(customerUp.status).toBe(200);
    expect(await roleOf(app, 'user-1', 'token-admin')).toBe('staff');
  });
});

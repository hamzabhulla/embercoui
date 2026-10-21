import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';

const repo = new FakeRepository();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken });
const ADMIN_TOKEN = ['Bearer', 'token-admin'].join(' ');
const patchSettings = (body: Record<string, unknown>) =>
  request(app).patch('/api/v1/admin/settings').set('Authorization', ADMIN_TOKEN).send(body);
const publicSettings = () => request(app).get('/api/v1/settings/public');

describe('WhatsApp number in settings', () => {
  it('is null by default (button hidden)', async () => {
    const res = await publicSettings();
    expect(res.status).toBe(200);
    expect(res.body.settings.whatsappNumber).toBeNull();
  });

  it('round-trips through the admin settings PATCH to the public settings', async () => {
    const patched = await patchSettings({ whatsappNumber: '+92 300 1234567' });
    expect(patched.status).toBe(200);
    expect(patched.body.settings.whatsappNumber).toBe('+92 300 1234567');
    const pub = await publicSettings();
    expect(pub.body.settings.whatsappNumber).toBe('+92 300 1234567');
  });

  it('rejects a number without enough digits', async () => {
    expect((await patchSettings({ whatsappNumber: 'call-me' })).status).toBe(400);
    expect((await patchSettings({ whatsappNumber: '123' })).status).toBe(400);
  });

  it('can be cleared back to null', async () => {
    const res = await patchSettings({ whatsappNumber: null });
    expect(res.status).toBe(200);
    expect(res.body.settings.whatsappNumber).toBeNull();
  });
});

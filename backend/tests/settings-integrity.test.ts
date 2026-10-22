import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { assertImageUpload } from '../src/lib/storage';
import { isMissingSiteLocationsError } from '../src/repositories/supabaseRepository';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStorageService } from './fakeStorage';

const as = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
const buildApp = (repo = new FakeRepository()) =>
  createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, storage: new FakeStorageService() });

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngBuffer = (extra = 16) => Buffer.concat([Buffer.from(PNG_HEAD), Buffer.alloc(extra, 3)]);
const JPEG_BUFFER = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 3)]);
const WEBP_BUFFER = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4, 0), Buffer.from('WEBP', 'ascii'), Buffer.alloc(8, 3)]);

describe('settings integrity (audit fix 11)', () => {
  it('reads fall back to defaults while the settings row is missing', async () => {
    const repo = new FakeRepository();
    repo.settings = null; // seed never ran / row deleted
    const app = buildApp(repo);
    const res = await as(request(app).get('/api/v1/admin/settings'), 'token-admin');
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ waitMin: 20, waitMax: 30, currency: 'USD', restaurantName: 'Ember & Co.' });
  });

  it('a PATCH with the row missing persists — later reads return the saved values, not defaults', async () => {
    const repo = new FakeRepository();
    repo.settings = null;
    const app = buildApp(repo);
    const patched = await as(request(app).patch('/api/v1/admin/settings').send({ restaurantName: 'Saved Name', waitMin: 15, waitMax: 25 }), 'token-admin');
    expect(patched.status).toBe(200);
    expect(patched.body.settings).toMatchObject({ restaurantName: 'Saved Name', waitMin: 15, waitMax: 25 });
    const after = await as(request(app).get('/api/v1/admin/settings'), 'token-admin');
    expect(after.body.settings).toMatchObject({ restaurantName: 'Saved Name', waitMin: 15, waitMax: 25 });
    const pub = await request(app).get('/api/v1/settings/public');
    expect(pub.body.settings.restaurantName).toBe('Saved Name');
    expect(repo.settings).not.toBeNull();
  });

  it('wait times of 0 round-trip as 0, not as the 20/30 fallback', async () => {
    const app = buildApp();
    const patched = await as(request(app).patch('/api/v1/admin/settings').send({ waitMin: 0, waitMax: 0 }), 'token-admin');
    expect(patched.status).toBe(200);
    expect(patched.body.settings.waitMin).toBe(0);
    expect(patched.body.settings.waitMax).toBe(0);
    const pub = await request(app).get('/api/v1/settings/public');
    expect(pub.body.settings.waitMin).toBe(0);
    expect(pub.body.settings.waitMax).toBe(0);
  });

  it('merged validation: PATCHing only waitMax below the stored waitMin is a 400', async () => {
    const app = buildApp(); // stored defaults: waitMin 20, waitMax 30
    const bad = await as(request(app).patch('/api/v1/admin/settings').send({ waitMax: 10 }), 'token-admin');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Maximum wait/);
    const ok = await as(request(app).patch('/api/v1/admin/settings').send({ waitMax: 45 }), 'token-admin');
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ waitMin: 20, waitMax: 45 });
  });
});

describe('per-location website contacts (migration 0010)', () => {
  const locations = {
    footer: { phone: '+1 555 010 1111', email: 'footer@example.com', address: '1 Footer Way\nFootertown' },
    contact: {
      phone: '+1 555 010 2222', email: 'hello@example.com', address: '2 Contact Road',
      hours: 'Mon–Sun: 9am – 10pm', mapLocation: '2 Contact Road, Springfield',
    },
    reservation: {
      phone: '+1 555 010 3333', address: '3 Reservation Lane', hours: 'Tue–Sun: 5pm – 11pm', locationLabel: 'Downtown',
    },
  };

  it('a valid siteLocations PATCH round-trips through GET (admin + public)', async () => {
    const app = buildApp();
    const patched = await as(request(app).patch('/api/v1/admin/settings').send({ siteLocations: locations }), 'token-admin');
    expect(patched.status).toBe(200);
    expect(patched.body.settings.siteLocations).toEqual(locations);
    const admin = await as(request(app).get('/api/v1/admin/settings'), 'token-admin');
    expect(admin.body.settings.siteLocations).toEqual(locations);
    const pub = await request(app).get('/api/v1/settings/public');
    expect(pub.body.settings.siteLocations).toEqual(locations);
  });

  it('settings reads carry the full all-null siteLocations shape by default', async () => {
    const app = buildApp();
    const pub = await request(app).get('/api/v1/settings/public');
    expect(pub.body.settings.siteLocations).toEqual({
      footer: { phone: null, email: null, address: null },
      contact: { phone: null, email: null, address: null, hours: null, mapLocation: null },
      reservation: { phone: null, address: null, hours: null, locationLabel: null },
    });
  });

  it('an over-cap location field is a 400 (footer address over 300 chars)', async () => {
    const app = buildApp();
    const res = await as(
      request(app).patch('/api/v1/admin/settings').send({ siteLocations: { footer: { address: 'x'.repeat(301) } } }),
      'token-admin',
    );
    expect(res.status).toBe(400);
  });

  it('an invalid location email is a 400 (footer and contact)', async () => {
    const app = buildApp();
    const footer = await as(
      request(app).patch('/api/v1/admin/settings').send({ siteLocations: { footer: { email: 'not-an-email' } } }),
      'token-admin',
    );
    expect(footer.status).toBe(400);
    const contact = await as(
      request(app).patch('/api/v1/admin/settings').send({ siteLocations: { contact: { email: 'also@not' } } }),
      'token-admin',
    );
    expect(contact.status).toBe(400);
  });

  it('an empty-string location phone normalizes to null (use the profile value)', async () => {
    const app = buildApp();
    const patched = await as(
      request(app).patch('/api/v1/admin/settings').send({ siteLocations: { footer: { phone: '' } } }),
      'token-admin',
    );
    expect(patched.status).toBe(200);
    expect(patched.body.settings.siteLocations.footer.phone).toBeNull();
    const pub = await request(app).get('/api/v1/settings/public');
    expect(pub.body.settings.siteLocations.footer.phone).toBeNull();
  });
});

describe('isMissingSiteLocationsError (migration 0010 degradation)', () => {
  it('matches the PostgREST/PG missing-column signals', () => {
    expect(isMissingSiteLocationsError({ code: '42703' })).toBe(true);
    expect(isMissingSiteLocationsError({ code: 'PGRST204' })).toBe(true);
    expect(
      isMissingSiteLocationsError({ message: "Could not find the 'site_locations' column of 'restaurant_settings' in the schema cache" }),
    ).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isMissingSiteLocationsError({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false);
    expect(isMissingSiteLocationsError({ message: 'connection reset by peer' })).toBe(false);
    expect(isMissingSiteLocationsError({})).toBe(false);
    expect(isMissingSiteLocationsError(null)).toBe(false);
    expect(isMissingSiteLocationsError(undefined)).toBe(false);
  });
});

describe('image content sniffing (audit fix 11)', () => {
  const upload = (app: ReturnType<typeof buildApp>, filename: string, contentType: string, data: Buffer) =>
    as(request(app).post('/api/v1/admin/menu/upload').send({ filename, contentType, dataBase64: data.toString('base64') }), 'token-admin');

  it('a genuine minimal PNG passes', async () => {
    const res = await upload(buildApp(), 'dish.png', 'image/png', pngBuffer());
    expect(res.status).toBe(201);
  });

  it('a text buffer declared as image/png is a 400', async () => {
    const res = await upload(buildApp(), 'dish.png', 'image/png', Buffer.from('this is plainly not an image'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match/);
  });

  it('JPEG bytes declared as image/png are a 400; declared as image/jpeg they pass', async () => {
    const app = buildApp();
    const wrong = await upload(app, 'dish.png', 'image/png', JPEG_BUFFER);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/does not match/);
    const right = await upload(app, 'dish.jpg', 'image/jpeg', JPEG_BUFFER);
    expect(right.status).toBe(201);
  });

  it('a genuine WebP header passes', async () => {
    const res = await upload(buildApp(), 'dish.webp', 'image/webp', WEBP_BUFFER);
    expect(res.status).toBe(201);
  });
});

describe('upload body limit (audit fix 11)', () => {
  it('a body above the 4.4 MB parser limit gets the API 413; a near-limit legitimate body passes', async () => {
    const app = buildApp();
    const over = await as(request(app).post('/api/v1/admin/menu/upload').send({ filename: 'x.png', contentType: 'image/png', dataBase64: 'A'.repeat(4_500_000) }), 'token-admin');
    expect(over.status).toBe(413);
    expect(over.body.error).toMatch(/too large/);
    // 4,100,000 base64 chars = 3,075,000 raw bytes — under the client's
    // 4.2M-char cap, so this is the largest shape a legitimate upload
    // can take, and it must pass end to end.
    const raw = Buffer.alloc(3_075_000, 3);
    Buffer.from(PNG_HEAD).copy(raw);
    const ok = await as(request(app).post('/api/v1/admin/menu/upload').send({ filename: 'big.png', contentType: 'image/png', dataBase64: raw.toString('base64') }), 'token-admin');
    expect(ok.status).toBe(201);
  });
});

describe('assertImageUpload storage-level rules (audit fix 11)', () => {
  it('keeps the 5 MB cap (the HTTP route caps bodies lower; direct calls still enforce it)', () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 3);
    Buffer.from(PNG_HEAD).copy(big);
    expect(() => assertImageUpload('image/png', big)).toThrowError(/5 MB or smaller/);
  });

  it('rejects an empty file and an unlisted type before sniffing', () => {
    expect(() => assertImageUpload('image/png', Buffer.alloc(0))).toThrowError(/empty/);
    expect(() => assertImageUpload('application/octet-stream', pngBuffer())).toThrowError(/PNG, JPEG, WebP or GIF/);
  });
});

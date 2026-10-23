import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';

// The generated GEO files (2026-10-23 pivot): robots.txt, sitemap.xml,
// llms.txt and llms-full.txt are rendered per request from the LIVE
// settings + menu. The pins that matter most are the CHANGE pins —
// mutate the fake repository and the served file must change with it.
// A static file in disguise would fail every one of them.

function buildApp(repo: FakeRepository | null, envOverrides: Parameters<typeof testEnv>[0] = {}) {
  return createApp({ env: testEnv(envOverrides), repo, verifyToken: fakeVerifyToken });
}

function liveRepo(): FakeRepository {
  const repo = new FakeRepository();
  repo.settings = {
    ...repo.settings!,
    restaurantName: 'Ember & Co.',
    phone: '+923494103037',
    whatsappNumber: '+923494103037',
    email: 'hello@emberandco.com',
    address: 'USA, New York 12c',
    openingHours: { weekdays: '11:00 AM – 11:00 PM', weekends: '10:00 AM – 12:00 AM' },
  };
  return repo;
}

describe('SITE_URL env', () => {
  it('defaults to the demo origin, strips trailing slashes, rejects junk', () => {
    expect(loadEnv({}).siteUrl).toBe('https://embercoui.vercel.app');
    expect(loadEnv({ SITE_URL: 'https://client-restaurant.com/' }).siteUrl).toBe('https://client-restaurant.com');
    expect(loadEnv({ SITE_URL: '  https://client-restaurant.com  ' }).siteUrl).toBe('https://client-restaurant.com');
    expect(loadEnv({ SITE_URL: 'not a url' }).siteUrl).toBe('https://embercoui.vercel.app');
    expect(loadEnv({ SITE_URL: 'ftp://example.com' }).siteUrl).toBe('https://embercoui.vercel.app');
    expect(loadEnv({ SITE_URL: '' }).siteUrl).toBe('https://embercoui.vercel.app');
  });
});

describe('GET robots.txt', () => {
  it('serves the directives as text/plain with a cache header, at /api and at the root', async () => {
    const app = buildApp(liveRepo());
    for (const path of ['/api/robots.txt', '/robots.txt']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.headers['cache-control']).toContain('max-age=300');
      expect(res.text).toContain('User-agent: *');
      expect(res.text).toContain('Disallow: /admin');
      expect(res.text).toContain('Disallow: /api/');
      expect(res.text).toContain('Disallow: /account');
      expect(res.text).toContain('Disallow: /checkout');
      expect(res.text).toContain('Sitemap: https://embercoui.vercel.app/sitemap.xml');
    }
  });

  it('follows SITE_URL — a client domain rewrites the sitemap line', async () => {
    const app = buildApp(liveRepo(), { siteUrl: 'https://client-restaurant.com' });
    const res = await request(app).get('/api/robots.txt');
    expect(res.text).toContain('Sitemap: https://client-restaurant.com/sitemap.xml');
    expect(res.text).not.toContain('embercoui');
  });

  it('serves even with no database configured (it needs only the env)', async () => {
    const app = buildApp(null, { supabaseConfigured: false, supabaseUrl: null, supabaseServiceRoleKey: null });
    const res = await request(app).get('/api/robots.txt');
    expect(res.status).toBe(200);
  });
});

describe('GET sitemap.xml', () => {
  it('is application/xml listing exactly the four public routes on SITE_URL', async () => {
    const app = buildApp(liveRepo(), { siteUrl: 'https://client-restaurant.com' });
    const res = await request(app).get('/api/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    const locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      'https://client-restaurant.com/',
      'https://client-restaurant.com/menu',
      'https://client-restaurant.com/our-story',
      'https://client-restaurant.com/contact',
    ]);
    expect(res.text).not.toContain('lastmod'); // a render cannot know it — never fabricated
    expect(res.text).not.toContain('/account');
    expect(res.text).not.toContain('/admin');
  });
});

describe('GET llms.txt — rendered from live settings', () => {
  it('carries the settings facts in the llmstxt shape', async () => {
    const res = await request(buildApp(liveRepo())).get('/api/llms.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text.startsWith('# Ember & Co.\n')).toBe(true);
    expect(res.text).toMatch(/\n> Ember & Co\. is a forest-to-table restaurant/);
    for (const section of ['## About', '## Ordering', '## Reservations', '## Contact & Hours', '## Links']) {
      expect(res.text).toContain(section);
    }
    expect(res.text).toContain('- Address: USA, New York 12c');
    expect(res.text).toContain('- Phone and WhatsApp: +923494103037');
    expect(res.text).toContain('- Email: hello@emberandco.com');
    expect(res.text).toContain('Monday to Friday: 11:00 AM – 11:00 PM');
    expect(res.text).toContain('Saturday and Sunday: 10:00 AM – 12:00 AM');
    expect(res.text).toContain('- [Menu](https://embercoui.vercel.app/menu)');
    // Concise means NO menu detail: categories are named, prices are not listed.
    expect(res.text).not.toContain('USD 24.00');
    expect(res.text).not.toMatch(/\b(best|amazing|#1|finest|unforgettable)\b/i);
  });

  it('CHANGES when the settings change — the core pin of the pivot', async () => {
    const repo = liveRepo();
    const app = buildApp(repo);
    const before = (await request(app).get('/api/llms.txt')).text;
    repo.settings = {
      ...repo.settings!,
      restaurantName: 'Osteria Nova',
      phone: '+1 555 0100',
      whatsappNumber: '+1 555 0100',
      openingHours: { weekdays: '9:00 AM – 5:00 PM', weekends: '10:00 AM – 2:00 PM' },
    };
    const after = (await request(app).get('/api/llms.txt')).text;
    expect(after).not.toBe(before);
    expect(after.startsWith('# Osteria Nova\n')).toBe(true);
    expect(after).toContain('or by phone at +1 555 0100');
    expect(after).toContain('Monday to Friday: 9:00 AM – 5:00 PM');
    expect(after).not.toContain('+923494103037');
    expect(after).not.toContain('11:00 AM – 11:00 PM');
  });

  it('omits contact fields the restaurant has not set instead of inventing them', async () => {
    const res = await request(buildApp(new FakeRepository())).get('/api/llms.txt');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('- Phone');
    expect(res.text).not.toContain('- Email');
    expect(res.text).not.toContain('- Address');
    expect(res.text).not.toContain('Opening hours');
  });
});

describe('GET llms-full.txt — the live menu, grouped and priced', () => {
  it('lists available items by category in the settings currency; unavailable items never appear', async () => {
    const repo = liveRepo();
    const res = await request(buildApp(repo)).get('/api/llms-full.txt');
    expect(res.status).toBe(200);
    expect(res.text).toContain('### Burgers');
    expect(res.text).toContain('- Ember Classic — USD 24.00');
    expect(res.text).toContain('- Forest Truffle Burger — USD 38.00');
    // The fake's third item is is_available=false — the kitchen's
    // hidden dish must not leak into the file.
    expect(res.text).not.toContain('Secret Special');
  });

  it('CHANGES when the menu changes — price edit, new item, unpublishing', async () => {
    const repo = liveRepo();
    const app = buildApp(repo);
    repo.menu = repo.menu.map((m) => (m.id === 1 ? { ...m, price: 26 } : m));
    repo.menu.push({ id: 9, name: 'Charred Leeks', description: 'New', price: 12, image: 'img9', category: 'Starters', tags: [], isAvailable: true, sortOrder: 9 });
    let text = (await request(app).get('/api/llms-full.txt')).text;
    expect(text).toContain('- Ember Classic — USD 26.00');
    expect(text).toContain('### Starters');
    expect(text).toContain('- Charred Leeks — USD 12.00');

    repo.menu = repo.menu.map((m) => (m.id === 1 ? { ...m, isAvailable: false } : m));
    text = (await request(app).get('/api/llms-full.txt')).text;
    expect(text).not.toContain('Ember Classic');
  });

  it('prices follow the settings currency, exponent included', async () => {
    const repo = liveRepo();
    repo.settings = { ...repo.settings!, currency: 'JPY' };
    const res = await request(buildApp(repo)).get('/api/llms-full.txt');
    expect(res.text).toContain('- Ember Classic — JPY 24'); // 0-decimal currency, no .00
    expect(res.text).toContain('All prices are in JPY.');
  });
});

describe('the reservation-fee sentence reads the EFFECTIVE rule', () => {
  it('no fee in force → booking described as free unless a fee is set', async () => {
    const res = await request(buildApp(liveRepo())).get('/api/llms.txt');
    expect(res.text).toContain('Booking a table is free of charge unless the restaurant sets a booking fee.');
  });

  it('fee genuinely in force → the exact amount is stated, from the live settings', async () => {
    const repo = liveRepo();
    repo.settings = { ...repo.settings!, reservationFeeEnabled: true, reservationFeeAmount: 7 };
    // testEnv has stripeConfigured: true, so the effective rule fires.
    const res = await request(buildApp(repo)).get('/api/llms.txt');
    expect(res.text).toContain('Booking a table carries a fee of USD 7.00, charged online by card when the booking is made.');
    expect(res.text).not.toContain('free of charge unless');
  });

  it('toggle on but NO card provider → still described as free (the fee cannot be charged)', async () => {
    const repo = liveRepo();
    repo.settings = { ...repo.settings!, reservationFeeEnabled: true, reservationFeeAmount: 7 };
    const res = await request(buildApp(repo, { stripeConfigured: false, stripeSecretKey: null })).get('/api/llms.txt');
    expect(res.text).toContain('Booking a table is free of charge unless the restaurant sets a booking fee.');
  });
});

describe('llms without a database', () => {
  it('answers the honest 503 like every other data route', async () => {
    const app = buildApp(null, { supabaseConfigured: false, supabaseUrl: null, supabaseServiceRoleKey: null });
    for (const path of ['/api/llms.txt', '/api/llms-full.txt']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(503);
    }
  });
});

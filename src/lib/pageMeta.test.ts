import { describe, expect, it } from 'vitest';
import { DEFAULT_DESCRIPTION, pageMetaFor } from './pageMeta';

const BRAND = 'Ember & Co.';

describe('pageMetaFor — the four public routes', () => {
  it('home keeps the established brand title and gets its own description', () => {
    const meta = pageMetaFor('/', BRAND);
    expect(meta.title).toBe('Ember & Co. | Forest-to-Table Dining');
    expect(meta.description).toBe(
      'Ember & Co. is a forest-to-table restaurant. Browse the seasonal menu, order online for delivery, or reserve a table from the homepage.',
    );
  });

  it('menu, our-story and contact each get a distinct title and description', () => {
    expect(pageMetaFor('/menu', BRAND).title).toBe('Menu | Ember & Co.');
    expect(pageMetaFor('/our-story', BRAND).title).toBe('Our Story | Ember & Co.');
    expect(pageMetaFor('/contact', BRAND).title).toBe('Contact | Ember & Co.');

    const descriptions = ['/', '/menu', '/our-story', '/contact'].map((p) => pageMetaFor(p, BRAND).description);
    expect(new Set(descriptions).size).toBe(4);
    for (const d of descriptions) {
      expect(d.length).toBeGreaterThanOrEqual(100);
      expect(d.length).toBeLessThanOrEqual(170);
    }
  });

  it('descriptions state facts only — no superlatives or filler', () => {
    for (const p of ['/', '/menu', '/our-story', '/contact']) {
      const { description } = pageMetaFor(p, BRAND);
      expect(description.toLowerCase()).not.toMatch(/\b(best|amazing|#1|finest|unforgettable|world-class)\b/);
    }
  });

  it('the restaurant name from settings flows into every title', () => {
    expect(pageMetaFor('/', 'Osteria Nova').title).toBe('Osteria Nova | Forest-to-Table Dining');
    expect(pageMetaFor('/menu', 'Osteria Nova').title).toBe('Menu | Osteria Nova');
  });

  it('a renamed brand flows into every description — the demo brand appears nowhere', () => {
    for (const p of ['/', '/menu', '/our-story', '/contact']) {
      const { description } = pageMetaFor(p, 'Osteria Nova');
      expect(description).toContain('Osteria Nova');
      expect(description).not.toContain('Ember & Co.');
    }
    // The fallback description is the home description for the live
    // brand, so unmapped routes stay on-brand after a rename too.
    const fallback = pageMetaFor('/account', 'Osteria Nova');
    expect(fallback.description).toContain('Osteria Nova');
    expect(fallback.description).not.toContain('Ember & Co.');
  });

  it('paths are canonicalised like the app does (trailing slash, case)', () => {
    expect(pageMetaFor('/MENU/', BRAND).title).toBe('Menu | Ember & Co.');
    expect(pageMetaFor('/contact/', BRAND).title).toBe('Contact | Ember & Co.');
  });
});

describe('pageMetaFor — fallback routes keep the old behaviour', () => {
  it('unmapped routes keep the brand title and the shipped description', () => {
    for (const p of ['/account', '/checkout', '/track-order/abc', '/login', '/no-such-page']) {
      const meta = pageMetaFor(p, BRAND);
      expect(meta.title).toBe('Ember & Co. | Forest-to-Table Dining');
      expect(meta.description).toBe(DEFAULT_DESCRIPTION);
    }
    // The shipped (index.html) description IS the home description.
    expect(DEFAULT_DESCRIPTION).toBe(pageMetaFor('/', BRAND).description);
  });
});

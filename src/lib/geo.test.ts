import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DESCRIPTION } from './pageMeta';

// GEO shell pins (2026-10-23 pivot): index.html is one static shell
// for every client install, so it must carry NO restaurant facts of
// its own — the JSON-LD is generated at runtime from live sources
// (lib/restaurantSchema.ts, pinned in restaurantSchema.test.ts) and
// the txt/xml files are rendered by the backend from the database.
// What index.html DOES own is the base meta, which must equal the
// home route's meta so the shell and pageMeta.ts can never drift.
const root = fileURLToPath(new URL('../..', import.meta.url));
const html = readFileSync(`${root}index.html`, 'utf8');
const unescapeHtml = (s: string) => s.replace(/&amp;/g, '&');

describe('index.html — no hard-coded restaurant data', () => {
  it('contains no static JSON-LD block (it is generated at runtime)', () => {
    expect(html).not.toContain('application/ld+json');
    expect(html).not.toContain('+923494103037');
  });

  it('the shipped base meta equals the home route meta (no drift)', () => {
    const description = html.match(/<meta name="description" content="([^"]*)"/);
    const ogTitle = html.match(/<meta property="og:title" content="([^"]*)"/);
    const ogDescription = html.match(/<meta property="og:description" content="([^"]*)"/);
    expect(description).not.toBeNull();
    expect(unescapeHtml(description![1])).toBe(DEFAULT_DESCRIPTION);
    expect(unescapeHtml(ogTitle![1])).toBe('Ember & Co. | Forest-to-Table Dining');
    expect(unescapeHtml(ogDescription![1])).toBe(DEFAULT_DESCRIPTION);
  });
});

/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { applyPageMeta, DEFAULT_DESCRIPTION } from './pageMeta';

function metaContent(selector: string): string | null {
  return document.head.querySelector(selector)?.getAttribute('content') ?? null;
}

describe('applyPageMeta — the head follows the route', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.title = '';
  });

  it('sets title, description and og/twitter tags for a mapped route', () => {
    const meta = applyPageMeta('/menu', 'Ember & Co.');
    expect(document.title).toBe('Menu | Ember & Co.');
    expect(metaContent('meta[name="description"]')).toBe(meta.description);
    expect(metaContent('meta[property="og:title"]')).toBe('Menu | Ember & Co.');
    expect(metaContent('meta[property="og:description"]')).toBe(meta.description);
    expect(metaContent('meta[name="twitter:title"]')).toBe('Menu | Ember & Co.');
  });

  it('updates existing tags in place instead of duplicating them', () => {
    document.head.innerHTML =
      '<meta name="description" content="old"><meta property="og:title" content="old">';
    applyPageMeta('/contact', 'Ember & Co.');
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(metaContent('meta[name="description"]')).toContain('Contact Ember & Co.');
    expect(metaContent('meta[property="og:title"]')).toBe('Contact | Ember & Co.');
  });

  it('og:url follows the origin the page is served from, plus the route path', () => {
    applyPageMeta('/menu', 'Ember & Co.');
    expect(metaContent('meta[property="og:url"]')).toBe(`${window.location.origin}/menu`);
    applyPageMeta('/our-story', 'Ember & Co.');
    expect(metaContent('meta[property="og:url"]')).toBe(`${window.location.origin}/our-story`);
    // Updated in place on navigation, never duplicated.
    expect(document.head.querySelectorAll('meta[property="og:url"]')).toHaveLength(1);
  });

  it('a renamed brand flows into the applied descriptions — no demo brand in the head', () => {
    applyPageMeta('/contact', 'Osteria Nova');
    expect(metaContent('meta[name="description"]')).toContain('Osteria Nova');
    expect(metaContent('meta[property="og:description"]')).toContain('Osteria Nova');
    expect(metaContent('meta[name="description"]')).not.toContain('Ember & Co.');
    expect(metaContent('meta[property="og:description"]')).not.toContain('Ember & Co.');
  });

  it('leaving for an unmapped route restores the brand title + shipped description', () => {
    applyPageMeta('/menu', 'Ember & Co.');
    applyPageMeta('/account', 'Ember & Co.');
    expect(document.title).toBe('Ember & Co. | Forest-to-Table Dining');
    expect(metaContent('meta[name="description"]')).toBe(DEFAULT_DESCRIPTION);
    expect(metaContent('meta[property="og:description"]')).toBe(DEFAULT_DESCRIPTION);
  });
});

import { describe, expect, it } from 'vitest';
import { dietaryTagMatches, itemMatchesDietaryFilter, normalizeDietaryTag } from './dietaryTags';

// Mega-audit Area 2, M1 — the spellings matrix. The admin placeholder
// used to teach "Gluten-Free" (hyphen) while the /menu filter is
// "Gluten Free" (space): a tag typed exactly as taught never matched.
// Every reasonable spelling of the same tag must now match, and a
// genuinely different tag must not.

describe('normalizeDietaryTag', () => {
  it('lowercases, turns hyphens/underscores into spaces, collapses whitespace and trims', () => {
    expect(normalizeDietaryTag('Gluten-Free')).toBe('gluten free');
    expect(normalizeDietaryTag('gluten_free')).toBe('gluten free');
    expect(normalizeDietaryTag('GLUTEN  FREE')).toBe('gluten free');
    expect(normalizeDietaryTag('  Vegan  ')).toBe('vegan');
    expect(normalizeDietaryTag('Gluten Free')).toBe('gluten free');
    expect(normalizeDietaryTag('')).toBe('');
    expect(normalizeDietaryTag('   ')).toBe('');
    expect(normalizeDietaryTag('-')).toBe('');
  });
});

describe('dietaryTagMatches — filter "Gluten Free"', () => {
  it('matches every spelling of the same tag', () => {
    for (const tag of ['Gluten-Free', 'gluten free', 'GLUTEN  FREE', 'gluten_free', 'Gluten Free', ' gluten-free ']) {
      expect(dietaryTagMatches('Gluten Free', tag)).toBe(true);
    }
  });

  it('normalises the filter side too', () => {
    expect(dietaryTagMatches('gluten-free', 'Gluten Free')).toBe(true);
    expect(dietaryTagMatches('GLUTEN_FREE', 'gluten free')).toBe(true);
  });

  it('does not over-match a partial tag', () => {
    expect(dietaryTagMatches('Gluten Free', 'Gluten')).toBe(false);
    expect(dietaryTagMatches('Gluten Free', 'Free')).toBe(false);
    expect(dietaryTagMatches('Gluten Free', 'Gluten Free Plus')).toBe(false);
  });

  it('does not match a different tag', () => {
    expect(dietaryTagMatches('Gluten Free', 'Vegan')).toBe(false);
    expect(dietaryTagMatches('Gluten Free', 'Spicy')).toBe(false);
  });
});

describe('dietaryTagMatches — case and padding', () => {
  it('"Vegan" matches its spellings', () => {
    expect(dietaryTagMatches('Vegan', 'Vegan')).toBe(true);
    expect(dietaryTagMatches('Vegan', 'vegan')).toBe(true);
    expect(dietaryTagMatches('Vegan', ' VEGAN ')).toBe(true);
    expect(dietaryTagMatches('vegan', 'VEGAN')).toBe(true);
  });

  it('empty tags and empty filters never match', () => {
    expect(dietaryTagMatches('Vegan', '')).toBe(false);
    expect(dietaryTagMatches('Vegan', '   ')).toBe(false);
    expect(dietaryTagMatches('', 'Vegan')).toBe(false);
    expect(dietaryTagMatches('', '')).toBe(false);
  });
});

describe('itemMatchesDietaryFilter', () => {
  it('matches when any of the item’s tags matches', () => {
    expect(itemMatchesDietaryFilter(['Spicy', 'Gluten-Free'], 'Gluten Free')).toBe(true);
    expect(itemMatchesDietaryFilter(['vegan'], 'Vegan')).toBe(true);
    expect(itemMatchesDietaryFilter(['Spicy'], 'Gluten Free')).toBe(false);
  });

  it('an item with no tags never matches', () => {
    expect(itemMatchesDietaryFilter([], 'Vegan')).toBe(false);
    expect(itemMatchesDietaryFilter(undefined, 'Vegan')).toBe(false);
    expect(itemMatchesDietaryFilter(null, 'Vegan')).toBe(false);
    expect(itemMatchesDietaryFilter([''], 'Vegan')).toBe(false);
  });
});

/**
 * Canonical dietary-tag normalisation (mega-audit Area 2, M1).
 *
 * Menu-item tags are free text typed by the owner in Admin → Menu
 * (the backend stores them verbatim and nothing normalises them),
 * while the storefront's dietary filters use fixed spellings
 * ("Gluten Free"). An exact string comparison therefore misses a
 * tag typed exactly as the old admin placeholder taught it —
 * "Gluten-Free" never equalled "Gluten Free".
 *
 * THE rule, applied to BOTH sides of every comparison:
 *   1. lowercase;
 *   2. hyphens and underscores become spaces ("gluten-free",
 *      "gluten_free" → "gluten free");
 *   3. runs of whitespace collapse to a single space;
 *   4. leading/trailing whitespace is trimmed.
 *
 * Matching is then exact equality of the normalised forms — never a
 * substring/prefix check, so "Gluten" alone does NOT match the
 * "Gluten Free" filter, and an empty tag/filter never matches.
 *
 * Display is unaffected: cards and the admin list keep showing the
 * owner's spelling exactly as stored; only matching normalises.
 */

export function normalizeDietaryTag(tag: string): string {
  if (typeof tag !== 'string') return '';
  return tag
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when a single stored tag satisfies the given dietary filter. */
export function dietaryTagMatches(filter: string, tag: string): boolean {
  const wanted = normalizeDietaryTag(filter);
  const actual = normalizeDietaryTag(tag);
  return wanted !== '' && actual !== '' && wanted === actual;
}

/** True when any of an item's stored tags satisfies the filter. */
export function itemMatchesDietaryFilter(
  tags: readonly string[] | undefined | null,
  filter: string,
): boolean {
  if (!tags || tags.length === 0) return false;
  return tags.some((tag) => dietaryTagMatches(filter, tag));
}

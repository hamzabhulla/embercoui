import type { ContactContacts } from '../services/api.ts';

/**
 * What the Contact page map (and its directions link) points at, in
 * priority order:
 *   1. the exact pin the admin dropped in the map picker (mapLat/mapLng),
 *   2. the free-text "Map location" override,
 *   3. the Contact page's own address,
 *   4. the global Restaurant profile address.
 * A null result hides the map entirely — there is no hardcoded stand-in.
 * The pair is all-or-nothing: a lone half (never stored by the API, but
 * cheap to guard) does not count as a pin.
 */
export function resolveMapTarget(
  contact: ContactContacts | null | undefined,
  profileAddress: string | null | undefined,
): string | null {
  if (contact && typeof contact.mapLat === 'number' && typeof contact.mapLng === 'number') {
    return `${contact.mapLat},${contact.mapLng}`;
  }
  return contact?.mapLocation ?? contact?.address ?? profileAddress ?? null;
}

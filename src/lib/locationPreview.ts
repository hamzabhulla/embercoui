import { openingHoursLines } from '../hooks/usePublicSettings.ts';
import { resolveMapTarget } from './mapTarget.ts';
import type { PublicSettings, SiteLocations } from '../services/api.ts';

/**
 * Admin Settings — "what is live right now" for every Website locations
 * override field. The Settings form stores null for "no override", and a
 * null override means the website falls back to the Restaurant profile —
 * so a blank field on its own tells the admin nothing. These resolved
 * values are used ONLY as input placeholders and one live line: form
 * state, save payloads and semantics are untouched (an untouched empty
 * field still saves as null).
 *
 * MIRROR NOTE: the `??` chains below copy the consumers exactly —
 * Footer.tsx, Contact.tsx and Reservation.tsx resolve the public
 * settings the same way, and the hours derivation reuses the consumers'
 * own openingHoursLines. The consumers are deliberately NOT refactored
 * to use this helper (they were audited as-is); if a consumer's chain
 * ever changes, this mirror must change with it.
 *
 * The profile source is whatever the caller passes — AdminSettings
 * passes the CURRENT form state, so editing the Restaurant profile
 * section updates these previews live, before anything is saved.
 */

/** Placeholder shown when neither the override nor its fallback has a value. */
export const NOTHING_LIVE = 'Nothing is live on the website yet';

/** The Restaurant-profile side of every fallback chain. */
export interface LocationProfileSource {
  phone: string | null;
  email: string | null;
  address: string | null;
  openingHours: Record<string, unknown>;
}

export interface LiveLocationValues {
  footer: { phone: string; email: string; address: string };
  contact: {
    phone: string;
    email: string;
    address: string;
    hours: string;
    /** What the Map location text falls back to when left empty (pin aside). */
    mapTextFallback: string;
    /** The effective Contact map target, pin included — null hides the map. */
    mapTarget: string | null;
  };
  reservation: { phone: string; address: string; hours: string; locationLabel: string };
}

// A resolved value that is null — or an empty string, which renders as
// nothing on the site — becomes the honest marker, never an example.
const orNothing = (v: string | null | undefined): string => (v != null && v !== '' ? v : NOTHING_LIVE);

export function liveLocationValues(profile: LocationProfileSource, locations: SiteLocations): LiveLocationValues {
  const { footer, contact, reservation } = locations;
  // The consumers' own derivation: labelled opening-hours lines from the
  // profile's openingHours record (Contact renders them as lines, the
  // Reservation section joins them on one line with ' · ').
  const hoursLines = openingHoursLines({ openingHours: profile.openingHours } as PublicSettings);
  // Reservation.tsx: the label falls back to the RESOLVED reservation
  // address (its own override first), not to the profile address.
  const resAddress = reservation.address ?? profile.address;
  return {
    footer: {
      // Footer.tsx: footer.X ?? settings.X
      phone: orNothing(footer.phone ?? profile.phone),
      email: orNothing(footer.email ?? profile.email),
      address: orNothing(footer.address ?? profile.address),
    },
    contact: {
      // Contact.tsx: contact.X ?? settings.X
      phone: orNothing(contact.phone ?? profile.phone),
      email: orNothing(contact.email ?? profile.email),
      address: orNothing(contact.address ?? profile.address),
      // Contact.tsx: the free-text hours win, else the opening-hours lines.
      hours: orNothing(contact.hours ?? (hoursLines.length > 0 ? hoursLines.join('\n') : null)),
      mapTextFallback: orNothing(contact.address ?? profile.address),
      mapTarget: resolveMapTarget(contact, profile.address),
    },
    reservation: {
      // Reservation.tsx: reservation.X ?? settings.X
      phone: orNothing(reservation.phone ?? profile.phone),
      address: orNothing(reservation.address ?? profile.address),
      hours: orNothing(reservation.hours ?? (hoursLines.length > 0 ? hoursLines.join(' · ') : null)),
      locationLabel: orNothing(reservation.locationLabel ?? resAddress),
    },
  };
}

import type { MenuItem } from '../data/menu.ts';
import type { PublicSettings } from '../services/api.ts';

/**
 * The Restaurant JSON-LD builder (GEO, 2026-10-23 pivot): index.html
 * is a static shell shared by every client install, so the schema is
 * GENERATED in the browser from the same live sources the site
 * itself renders — the public settings and the available menu — and
 * injected by components/StructuredData.tsx. Nothing is hard-coded:
 * a field the restaurant has not set is omitted, never invented.
 *
 * Known limit, stated plainly: crawlers that do not run JavaScript
 * never see this script tag. The server-rendered llms.txt (backend
 * lib/geoFiles.ts) is the GEO anchor for those readers; this JSON-LD
 * serves the crawlers that do render.
 *
 * Hours: the admin stores display strings ("11:00 AM – 11:00 PM").
 * schema.org wants 24-hour "HH:MM", with a midnight close expressed
 * as 24:00 — parseHoursRange does that mapping, and an unparseable
 * string drops the specification entirely rather than guessing.
 */

export interface RestaurantSchemaInput {
  settings: PublicSettings;
  /** Available dishes only, as the API returns them. */
  menu: MenuItem[];
  /** The origin the site is actually served from. */
  siteUrl: string;
}

/** "11:00" for an opening 11 AM; a closing 12:00 AM is "24:00". */
function parseTime(part: string, isClose: boolean): string | null {
  const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2];
  if (hour < 1 || hour > 12 || Number(minute) > 59) return null;
  if (m[3].toUpperCase() === 'AM') {
    if (hour === 12) return isClose ? '24:00' : '00:00';
  } else if (hour !== 12) {
    hour += 12;
  }
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

/** "11:00 AM – 11:00 PM" → { opens: '11:00', closes: '23:00' } (or null). */
export function parseHoursRange(raw: unknown): { opens: string; closes: string } | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(/\s*[–—-]\s*/);
  if (parts.length !== 2) return null;
  const opens = parseTime(parts[0], false);
  const closes = parseTime(parts[1], true);
  if (!opens || !closes) return null;
  return { opens, closes };
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const WEEKENDS = ['Saturday', 'Sunday'];

function openingHoursSpecification(settings: PublicSettings): Array<Record<string, unknown>> {
  const hours = settings.openingHours;
  if (!hours || typeof hours !== 'object') return [];
  const specs: Array<Record<string, unknown>> = [];
  const weekday = parseHoursRange(hours.weekdays);
  if (weekday) specs.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: WEEKDAYS, ...weekday });
  const weekend = parseHoursRange(hours.weekends);
  if (weekend) specs.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: WEEKENDS, ...weekend });
  return specs;
}

// Menu category → the cuisine it honestly evidences. Course-style
// categories (Desserts, Drinks) and anything unmapped are skipped —
// a cuisine claim needs the dishes to back it.
const CATEGORY_CUISINES: Record<string, string> = {
  Burgers: 'American',
  Pizza: 'Italian',
  Pasta: 'Italian',
};

function servesCuisine(menu: MenuItem[]): string[] {
  const cuisines: string[] = [];
  for (const item of menu) {
    const cuisine = CATEGORY_CUISINES[item.category];
    if (cuisine && !cuisines.includes(cuisine)) cuisines.push(cuisine);
  }
  return cuisines;
}

/** Price band from the menu's own average — no menu, no claim. */
function priceRange(menu: MenuItem[]): string | null {
  if (!menu.length) return null;
  const average = menu.reduce((sum, item) => sum + item.price, 0) / menu.length;
  if (average < 15) return '$';
  if (average < 30) return '$$';
  if (average < 50) return '$$$';
  return '$$$$';
}

/** Build the schema.org Restaurant object from live sources. */
export function buildRestaurantJsonLd({ settings, menu, siteUrl }: RestaurantSchemaInput): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: settings.restaurantName,
    url: siteUrl,
  };
  if (settings.phone) ld.telephone = settings.phone;
  if (settings.email) ld.email = settings.email;
  if (settings.address) ld.address = { '@type': 'PostalAddress', streetAddress: settings.address };
  const cuisines = servesCuisine(menu);
  if (cuisines.length) ld.servesCuisine = cuisines;
  const range = priceRange(menu);
  if (range) ld.priceRange = range;
  ld.currenciesAccepted = settings.currency;
  const specs = openingHoursSpecification(settings);
  if (specs.length) ld.openingHoursSpecification = specs;
  ld.menu = `${siteUrl}/menu`;
  ld.acceptsReservations = 'True';
  return ld;
}

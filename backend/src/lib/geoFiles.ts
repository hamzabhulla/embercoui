import { currencyExponent } from './currency';
import { effectiveReservationFee } from './reservationFee';
import type { MenuItemDTO, PublicSettingsDTO } from '../repositories/types';

/**
 * The GEO file generators (2026-10-23, owner pivot): robots.txt,
 * sitemap.xml, llms.txt and llms-full.txt are RENDERED PER REQUEST
 * from the live repository — restaurant settings + the available
 * menu — never from hard-coded facts. The product is a per-client
 * template with a ~2-minute go-live: a new restaurant changes its
 * name, phone, hours, currency and menu in the admin panel (and its
 * domain via the SITE_URL env) and every AI/search-facing file is
 * correct immediately, with no file for anyone to hand-edit and let
 * go stale.
 *
 * Honesty rules, same bar as every other surface:
 *  - pay on delivery is stated because it is always available; card
 *    payment is mentioned only as "offered when enabled" — the
 *    generator never claims a live card flow.
 *  - the reservation-fee sentence comes from the Phase F EFFECTIVE
 *    rule (lib/reservationFee.ts): a fee is stated, with its amount,
 *    only when a booking would actually be charged one; otherwise
 *    booking is described as free unless the restaurant sets a fee.
 *  - no ratings, no review claims, no superlatives, no invented
 *    details. A settings field that is null simply does not appear.
 */

export interface GeoSources {
  settings: PublicSettingsDTO;
  /** Available dishes only (Repository.listMenuItems). */
  menu: MenuItemDTO[];
  /** Public origin, no trailing slash (env.siteUrl). */
  siteUrl: string;
  cardProviderConfigured: boolean;
}

/** The chat route's money format: "USD 24.00", exponent-aware. */
function money(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(currencyExponent(currency))}`;
}

function hoursOf(settings: PublicSettingsDTO): { weekdays?: string; weekends?: string } {
  const hours = settings.openingHours;
  const pick = (key: string): string | undefined =>
    typeof hours?.[key] === 'string' && (hours[key] as string).trim() ? (hours[key] as string).trim() : undefined;
  return { weekdays: pick('weekdays'), weekends: pick('weekends') };
}

/** "Monday to Friday 11:00 AM – 11:00 PM" lines for whichever ranges exist. */
function hoursLines(settings: PublicSettingsDTO): string[] {
  const { weekdays, weekends } = hoursOf(settings);
  const lines: string[] = [];
  if (weekdays) lines.push(`Monday to Friday: ${weekdays}`);
  if (weekends) lines.push(`Saturday and Sunday: ${weekends}`);
  return lines;
}

function feeSentence(src: GeoSources): string {
  const fee = effectiveReservationFee(src.settings, src.cardProviderConfigured);
  if (fee) {
    return `Booking a table carries a fee of ${money(fee.amount, fee.currency)}, charged online by card when the booking is made.`;
  }
  return 'Booking a table is free of charge unless the restaurant sets a booking fee.';
}

function contactLines(src: GeoSources): string[] {
  const s = src.settings;
  const lines: string[] = [];
  if (s.address) lines.push(`- Address: ${s.address}`);
  if (s.phone) {
    lines.push(s.whatsappNumber && s.whatsappNumber !== s.phone
      ? `- Phone: ${s.phone}`
      : `- Phone and WhatsApp: ${s.phone}`);
  }
  if (s.whatsappNumber && s.whatsappNumber !== s.phone) lines.push(`- WhatsApp: ${s.whatsappNumber}`);
  if (s.email) lines.push(`- Email: ${s.email}`);
  for (const line of hoursLines(s)) lines.push(`- Opening hours — ${line}`);
  lines.push(`- Prices are in ${s.currency}.`);
  return lines;
}

function linkLines(siteUrl: string): string[] {
  return [
    `- [Home](${siteUrl}/): Overview, featured dishes and the Reservations section`,
    `- [Menu](${siteUrl}/menu): The full menu with prices, ready to order online`,
    `- [Our Story](${siteUrl}/our-story): The restaurant's story and forest-to-table philosophy`,
    `- [Contact](${siteUrl}/contact): Address, phone, email, opening hours and a contact form`,
  ];
}

function headerLines(src: GeoSources): string[] {
  const name = src.settings.restaurantName;
  return [
    `# ${name}`,
    '',
    `> ${name} is a forest-to-table restaurant. Guests can order online for delivery, pay on delivery, and reserve a table from the website. An on-site AI concierge, Ember AI, answers questions about the menu and reservations.`,
    '',
  ];
}

function aboutLines(src: GeoSources): string[] {
  const categories: string[] = [];
  for (const item of src.menu) {
    if (!categories.includes(item.category)) categories.push(item.category);
  }
  const menuLine = categories.length
    ? ` The menu is grouped by category: ${categories.join(', ')}.`
    : '';
  return [
    '## About',
    '',
    `${src.settings.restaurantName} is a forest-to-table restaurant. The kitchen works to a seasonal menu, with prices listed on the menu page.${menuLine} The restaurant takes table reservations and online orders through its website.`,
    '',
  ];
}

const ORDERING_LINE =
  'Orders are placed online from the menu page: add dishes to the cart and check out. Pay on delivery (cash) is available for every order. Card payment is offered at checkout when the restaurant has enabled it.';

export function renderRobots(siteUrl: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /account',
    'Disallow: /checkout',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

/** The four indexable public routes — the same set the static sitemap carried. */
const SITEMAP_ROUTES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/menu', changefreq: 'weekly', priority: '0.9' },
  { path: '/our-story', changefreq: 'monthly', priority: '0.6' },
  { path: '/contact', changefreq: 'monthly', priority: '0.6' },
];

export function renderSitemap(siteUrl: string): string {
  const urls = SITEMAP_ROUTES.map(({ path, changefreq, priority }) =>
    [
      '  <url>',
      `    <loc>${siteUrl}${path}</loc>`,
      `    <changefreq>${changefreq}</changefreq>`,
      `    <priority>${priority}</priority>`,
      '  </url>',
    ].join('\n'),
  );
  // No <lastmod>: a per-request render cannot know when the site's
  // content last changed, and stamping "today" on every fetch would
  // claim a freshness that is not true.
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

export function renderLlms(src: GeoSources): string {
  const s = src.settings;
  return [
    ...headerLines(src),
    ...aboutLines(src),
    '## Ordering',
    '',
    ORDERING_LINE,
    '',
    '## Reservations',
    '',
    `Tables can be reserved in the Reservations section of the homepage${s.phone ? ` or by phone at ${s.phone}` : ''}. ${feeSentence(src)}`,
    '',
    '## Contact & Hours',
    '',
    ...contactLines(src),
    '',
    '## Links',
    '',
    ...linkLines(src.siteUrl),
    '',
  ].join('\n');
}

export function renderLlmsFull(src: GeoSources): string {
  const s = src.settings;
  const lines: string[] = [
    ...headerLines(src),
    ...aboutLines(src),
    '## Menu',
    '',
    `All prices are in ${s.currency}.`,
    '',
  ];
  // The full live menu, grouped by category (first-seen category
  // order, menu order within each group — the repository orders by
  // sort order, so categories are grouped explicitly rather than
  // assumed contiguous). An item the kitchen has made unavailable
  // never reaches this file: listMenuItems returns available only.
  const categories: string[] = [];
  for (const item of src.menu) {
    if (!categories.includes(item.category)) categories.push(item.category);
  }
  for (const category of categories) {
    lines.push(`### ${category}`, '');
    for (const item of src.menu) {
      if (item.category === category) lines.push(`- ${item.name} — ${money(item.price, s.currency)}`);
    }
    lines.push('');
  }
  lines.push(
    '## Ordering',
    '',
    'How online ordering works:',
    '',
    `1. Browse the menu at ${src.siteUrl}/menu and add dishes to the cart.`,
    '2. Review the cart and go to checkout.',
    '3. Place the order. Pay on delivery (cash) is available for every order; card payment is offered at checkout when the restaurant has enabled it.',
    '4. Signed-in customers can follow the order\u2019s progress from their account; a tracking page shows each order\u2019s status after checkout.',
    '',
    '## Reservations',
    '',
    'How table reservations work:',
    '',
    `1. Open the Reservations section of the homepage and choose a date, time and party size${s.phone ? `, or call ${s.phone}` : ''}.`,
    `2. Submit the booking. ${feeSentence(src)}`,
    '3. Signed-in customers can see their reservations in their account and send a change request if the date, time or party size needs to change.',
    '',
    '## Ember AI',
    '',
    'The website includes an AI concierge, Ember AI. It answers questions about the menu, prices, opening hours and reservations, and can add dishes to the visitor\u2019s cart.',
    '',
    '## Contact & Hours',
    '',
    ...contactLines(src),
    '',
    '## Links',
    '',
    ...linkLines(src.siteUrl),
    '',
  );
  return lines.join('\n');
}

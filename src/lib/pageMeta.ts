// Per-route document titles + meta descriptions (GEO, 2026-10-23):
// before this, every route shared index.html's single title/description,
// so search engines and AI readers could not tell the pages apart. The
// four public content routes get a distinct factual title/description
// each; every other route keeps the pre-existing behaviour exactly —
// the brand title the Navbar has always set, and index.html's shipped
// description (which IS the home description for the shell's own brand
// — see DEFAULT_DESCRIPTION — so the base page and the home route can
// never drift apart).
//
// Titles AND descriptions are built from the live brand name: a client
// install renamed in Settings must not leak the demo brand anywhere.
//
// Copy rule: premium and plain. Each description states what the page
// is, in facts — no superlatives, no marketing filler.

export interface PageMeta {
  title: string;
  description: string;
}

// '/menu/' and '/MENU' are the same page as '/menu' (the same
// canonicalisation App applies for its display decisions).
function canonical(pathname: string): string {
  return (pathname.replace(/\/+$/, '') || '/').toLowerCase();
}

const ROUTE_META: Record<
  string,
  { title: (brand: string) => string; description: (brand: string) => string }
> = {
  '/': {
    title: (brand) => `${brand} | Forest-to-Table Dining`,
    description: (brand) =>
      `${brand} is a forest-to-table restaurant. Browse the seasonal menu, order online for delivery, or reserve a table from the homepage.`,
  },
  '/menu': {
    title: (brand) => `Menu | ${brand}`,
    description: (brand) =>
      `The ${brand} menu — seasonal burgers, pizzas, pastas, desserts and drinks, each with its price. Add dishes to an order for delivery.`,
  },
  '/our-story': {
    title: (brand) => `Our Story | ${brand}`,
    description: (brand) =>
      `Our Story at ${brand} — the people behind the restaurant, its forest-to-table philosophy, and how each season shapes the menu.`,
  },
  '/contact': {
    title: (brand) => `Contact | ${brand}`,
    description: (brand) =>
      `Contact ${brand} — address, phone, email and opening hours, with a form for questions about reservations, events and catering.`,
  },
};

// The brand index.html itself ships with: the static shell is the demo
// install, so its baked-in base meta is the home meta built for this
// name. geo.test.ts pins the shell's description/title to these values,
// so shell and builder can never drift apart.
const SHELL_BRAND = 'Ember & Co.';

// The description index.html ships with; unmapped routes restore the
// home description for the live brand, which reproduces the pre-GEO
// behaviour (one shared description) under whatever name the install
// actually runs.
export const DEFAULT_DESCRIPTION = ROUTE_META['/'].description(SHELL_BRAND);

/** The title + description for a path; unmapped routes get the fallback. */
export function pageMetaFor(pathname: string, brandName: string): PageMeta {
  const entry = ROUTE_META[canonical(pathname)];
  if (entry) return { title: entry.title(brandName), description: entry.description(brandName) };
  return {
    title: `${brandName} | Forest-to-Table Dining`,
    description: ROUTE_META['/'].description(brandName),
  };
}

function setMeta(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/**
 * Apply a route's title + description to the document head: the tab
 * title, the search description, and the Open Graph / Twitter titles
 * and description follow the same values so shared links describe the
 * page actually being shared. Tags that exist are updated in place;
 * a missing tag is created.
 *
 * og:url is set from the origin the page is actually served from
 * (the same source the runtime JSON-LD takes its url from), so a
 * client install on its own domain advertises its own URL in share
 * cards — index.html's static og:url is only the pre-JS fallback
 * for this demo deployment.
 */
export function applyPageMeta(pathname: string, brandName: string): PageMeta {
  const meta = pageMetaFor(pathname, brandName);
  document.title = meta.title;
  setMeta('meta[name="description"]', 'name', 'description', meta.description);
  setMeta('meta[property="og:title"]', 'property', 'og:title', meta.title);
  setMeta('meta[property="og:description"]', 'property', 'og:description', meta.description);
  setMeta('meta[property="og:url"]', 'property', 'og:url', `${window.location.origin}${pathname}`);
  setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', meta.title);
  return meta;
}

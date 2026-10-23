import { describe, expect, it } from 'vitest';
import type { MenuItem } from '../data/menu.ts';
import type { PublicSettings } from '../services/api.ts';
import { buildRestaurantJsonLd, parseHoursRange } from './restaurantSchema';

const SETTINGS: PublicSettings = {
  kitchenOpen: true,
  waitMin: 20,
  waitMax: 30,
  currency: 'USD',
  restaurantName: 'Ember & Co.',
  phone: '+923494103037',
  email: 'hello@emberandco.com',
  address: 'USA, New York 12c',
  whatsappNumber: '+923494103037',
  openingHours: { weekdays: '11:00 AM – 11:00 PM', weekends: '10:00 AM – 12:00 AM' },
  siteLocations: {
    footer: { phone: null, email: null, address: null },
    contact: { phone: null, email: null, address: null, hours: null, mapLocation: null, mapLat: null, mapLng: null },
    reservation: { phone: null, address: null, hours: null, locationLabel: null },
  },
  reservationFee: null,
};

const item = (name: string, price: number, category: string): MenuItem =>
  ({ id: 0, name, description: '', price, image: '', category });

const MENU: MenuItem[] = [
  item('Ember Classic', 24, 'Burgers'), item('Forest Truffle Burger', 38, 'Burgers'), item('Smoked Mushroom Stack', 20, 'Burgers'),
  item('Margherita di Stagione', 22, 'Pizza'), item('Tartufo Bianco', 36, 'Pizza'), item('Ember Wild Mushroom', 28, 'Pizza'),
  item('Pappardelle al Ragù', 32, 'Pasta'), item('Cacio e Pepe Moderno', 24, 'Pasta'), item('Lobster Tagliolini', 48, 'Pasta'),
  item('Valrhona Chocolate Fondant', 16, 'Desserts'), item('Seasonal Tart', 14, 'Desserts'), item('Panna Cotta al Bosco', 13, 'Desserts'),
  item('Forest Negroni', 18, 'Drinks'), item('Ember Sour', 17, 'Drinks'), item('House Sparkling Water', 5, 'Drinks'),
];

const build = (overrides: Partial<Parameters<typeof buildRestaurantJsonLd>[0]> = {}) =>
  buildRestaurantJsonLd({ settings: SETTINGS, menu: MENU, siteUrl: 'https://embercoui.vercel.app', ...overrides });

describe('parseHoursRange — display strings to schema.org 24-hour times', () => {
  it('maps the live ranges, with the midnight close as 24:00', () => {
    expect(parseHoursRange('11:00 AM – 11:00 PM')).toEqual({ opens: '11:00', closes: '23:00' });
    expect(parseHoursRange('10:00 AM – 12:00 AM')).toEqual({ opens: '10:00', closes: '24:00' });
  });

  it('handles noon, an after-midnight opening, and hyphen separators', () => {
    expect(parseHoursRange('12:00 PM – 10:30 PM')).toEqual({ opens: '12:00', closes: '22:30' });
    expect(parseHoursRange('12:00 AM - 8:00 AM')).toEqual({ opens: '00:00', closes: '08:00' });
  });

  it('refuses anything it cannot parse instead of guessing', () => {
    expect(parseHoursRange('Open late')).toBeNull();
    expect(parseHoursRange('11 AM – 11 PM')).toBeNull();
    expect(parseHoursRange('')).toBeNull();
    expect(parseHoursRange(null)).toBeNull();
    expect(parseHoursRange(42)).toBeNull();
  });
});

describe('buildRestaurantJsonLd — fields from the live fixture', () => {
  it('produces the Restaurant schema with every live fact', () => {
    const ld = build();
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Restaurant');
    expect(ld.name).toBe('Ember & Co.');
    expect(ld.url).toBe('https://embercoui.vercel.app');
    expect(ld.telephone).toBe('+923494103037');
    expect(ld.email).toBe('hello@emberandco.com');
    expect(ld.address).toEqual({ '@type': 'PostalAddress', streetAddress: 'USA, New York 12c' });
    expect(ld.menu).toBe('https://embercoui.vercel.app/menu');
    expect(ld.acceptsReservations).toBe('True');
    expect(ld.currenciesAccepted).toBe('USD');
  });

  it('serialises to valid JSON (round-trip)', () => {
    const ld = build();
    expect(JSON.parse(JSON.stringify(ld))).toEqual(ld);
  });

  it('opening hours: Mon–Fri and Sat–Sun specs from the settings strings', () => {
    const specs = build().openingHoursSpecification as Array<Record<string, unknown>>;
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ opens: '11:00', closes: '23:00' });
    expect(specs[0].dayOfWeek).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    expect(specs[1]).toMatchObject({ opens: '10:00', closes: '24:00' });
    expect(specs[1].dayOfWeek).toEqual(['Saturday', 'Sunday']);
  });

  it('cuisines are derived from the menu categories actually present', () => {
    expect(build().servesCuisine).toEqual(['American', 'Italian']);
    const pastaOnly = build({ menu: [item('Cacio e Pepe Moderno', 24, 'Pasta'), item('Seasonal Tart', 14, 'Desserts')] });
    expect(pastaOnly.servesCuisine).toEqual(['Italian']);
    const dessertsOnly = build({ menu: [item('Seasonal Tart', 14, 'Desserts')] });
    expect('servesCuisine' in dessertsOnly).toBe(false);
  });

  it('price range is derived from the menu average; an empty menu makes no claim', () => {
    expect(build().priceRange).toBe('$$'); // the live menu averages ~USD 23.67
    const cheap = build({ menu: [item('Soup', 9, 'Starters'), item('Salad', 11, 'Starters')] });
    expect(cheap.priceRange).toBe('$');
    const empty = build({ menu: [] });
    expect('priceRange' in empty).toBe(false);
  });

  it('follows a different restaurant\u2019s settings — nothing is hard-coded', () => {
    const ld = build({
      settings: {
        ...SETTINGS,
        restaurantName: 'Osteria Nova',
        phone: null,
        email: null,
        address: null,
        currency: 'EUR',
        openingHours: {},
      },
      menu: [],
      siteUrl: 'https://osteria.example',
    });
    expect(ld.name).toBe('Osteria Nova');
    expect(ld.url).toBe('https://osteria.example');
    expect(ld.menu).toBe('https://osteria.example/menu');
    expect(ld.currenciesAccepted).toBe('EUR');
    expect('telephone' in ld).toBe(false);
    expect('email' in ld).toBe(false);
    expect('address' in ld).toBe(false);
    expect('openingHoursSpecification' in ld).toBe(false);
  });

  it('an unparseable hours string drops only that specification', () => {
    const ld = build({ settings: { ...SETTINGS, openingHours: { weekdays: 'call us', weekends: '10:00 AM – 12:00 AM' } } });
    const specs = ld.openingHoursSpecification as Array<Record<string, unknown>>;
    expect(specs).toHaveLength(1);
    expect(specs[0].dayOfWeek).toEqual(['Saturday', 'Sunday']);
  });
});

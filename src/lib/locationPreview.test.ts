import { describe, expect, it } from 'vitest';
import { NOTHING_LIVE, liveLocationValues, type LocationProfileSource } from './locationPreview.ts';
import type { SiteLocations } from '../services/api.ts';

const profile = (over: Partial<LocationProfileSource> = {}): LocationProfileSource => ({
  phone: '+92 300 1112223',
  email: 'hello@ember.example',
  address: '9 Profile Avenue',
  openingHours: { weekdays: '11:00 AM – 11:00 PM', weekends: '10:00 AM – 12:00 AM' },
  ...over,
});

const locations = (over: Partial<SiteLocations> = {}): SiteLocations => ({
  footer: { phone: null, email: null, address: null },
  contact: { phone: null, email: null, address: null, hours: null, mapLocation: null, mapLat: null, mapLng: null },
  reservation: { phone: null, address: null, hours: null, locationLabel: null },
  ...over,
});

describe('liveLocationValues (Admin Settings live-value previews)', () => {
  it('footer: a filled override is what is live — it wins over the profile', () => {
    const live = liveLocationValues(profile(), locations({
      footer: { phone: '+92 21 3580 0000', email: 'footer@ember.example', address: '1 Footer Road' },
    }));
    expect(live.footer).toEqual({ phone: '+92 21 3580 0000', email: 'footer@ember.example', address: '1 Footer Road' });
  });

  it('footer: empty overrides fall back to the Restaurant profile values', () => {
    const live = liveLocationValues(profile(), locations());
    expect(live.footer).toEqual({ phone: '+92 300 1112223', email: 'hello@ember.example', address: '9 Profile Avenue' });
  });

  it('footer: override AND profile empty → the honest marker, never an invented value', () => {
    const live = liveLocationValues(profile({ phone: null, email: null, address: null }), locations());
    expect(live.footer).toEqual({ phone: NOTHING_LIVE, email: NOTHING_LIVE, address: NOTHING_LIVE });
  });

  it('contact: phone/email/address mirror the same override → profile chain', () => {
    const live = liveLocationValues(profile(), locations({
      contact: { phone: '+92 21 3581 1111', email: null, address: null, hours: null, mapLocation: null, mapLat: null, mapLng: null },
    }));
    expect(live.contact.phone).toBe('+92 21 3581 1111');
    expect(live.contact.email).toBe('hello@ember.example');
    expect(live.contact.address).toBe('9 Profile Avenue');
  });

  it('contact hours: the free-text override wins verbatim', () => {
    const live = liveLocationValues(profile(), locations({
      contact: { phone: null, email: null, address: null, hours: 'Mon–Fri 9–5\nSat 10–2', mapLocation: null, mapLat: null, mapLng: null },
    }));
    expect(live.contact.hours).toBe('Mon–Fri 9–5\nSat 10–2');
  });

  it('contact hours: no override → the opening-hours lines the Hours card renders', () => {
    const live = liveLocationValues(profile(), locations());
    expect(live.contact.hours).toBe('Weekdays: 11:00 AM – 11:00 PM\nWeekends: 10:00 AM – 12:00 AM');
  });

  it('contact hours: no override and no opening hours → the honest marker', () => {
    const live = liveLocationValues(profile({ openingHours: {} }), locations());
    expect(live.contact.hours).toBe(NOTHING_LIVE);
  });

  it('reservation: phone/address fall back to the profile; hours join the derived lines with ·', () => {
    const live = liveLocationValues(profile(), locations());
    expect(live.reservation.phone).toBe('+92 300 1112223');
    expect(live.reservation.address).toBe('9 Profile Avenue');
    expect(live.reservation.hours).toBe('Weekdays: 11:00 AM – 11:00 PM · Weekends: 10:00 AM – 12:00 AM');
  });

  it('reservation hours: the override wins; nothing anywhere → the honest marker', () => {
    const withOverride = liveLocationValues(profile(), locations({
      reservation: { phone: null, address: null, hours: 'Daily 12 PM – 12 AM', locationLabel: null },
    }));
    expect(withOverride.reservation.hours).toBe('Daily 12 PM – 12 AM');
    const bare = liveLocationValues(profile({ openingHours: {} }), locations());
    expect(bare.reservation.hours).toBe(NOTHING_LIVE);
  });

  it('reservation location label: falls back to the RESERVATION address override before the profile', () => {
    const resAddr = liveLocationValues(profile(), locations({
      reservation: { phone: null, address: '44 Reservation Lane', hours: null, locationLabel: null },
    }));
    expect(resAddr.reservation.locationLabel).toBe('44 Reservation Lane');
    const profileAddr = liveLocationValues(profile(), locations());
    expect(profileAddr.reservation.locationLabel).toBe('9 Profile Avenue');
    const labelSet = liveLocationValues(profile(), locations({
      reservation: { phone: null, address: '44 Reservation Lane', hours: null, locationLabel: 'Clifton, Karachi' },
    }));
    expect(labelSet.reservation.locationLabel).toBe('Clifton, Karachi');
    const nothing = liveLocationValues(profile({ address: null }), locations());
    expect(nothing.reservation.locationLabel).toBe(NOTHING_LIVE);
  });

  it('contact map target: pin wins, then Map location text, then contact address, then profile', () => {
    const pinned = liveLocationValues(profile(), locations({
      contact: { phone: null, email: null, address: '1 Contact Road', hours: null, mapLocation: 'Text Place', mapLat: 24.8608, mapLng: 67.0011 },
    }));
    expect(pinned.contact.mapTarget).toBe('24.8608,67.0011');
    const text = liveLocationValues(profile(), locations({
      contact: { phone: null, email: null, address: '1 Contact Road', hours: null, mapLocation: 'Text Place', mapLat: null, mapLng: null },
    }));
    expect(text.contact.mapTarget).toBe('Text Place');
    const addr = liveLocationValues(profile(), locations({
      contact: { phone: null, email: null, address: '1 Contact Road', hours: null, mapLocation: null, mapLat: null, mapLng: null },
    }));
    expect(addr.contact.mapTarget).toBe('1 Contact Road');
    expect(liveLocationValues(profile(), locations()).contact.mapTarget).toBe('9 Profile Avenue');
    expect(liveLocationValues(profile({ address: null }), locations()).contact.mapTarget).toBeNull();
  });

  it('contact map text fallback: the contact address, then the profile address, then the marker', () => {
    const withContactAddr = liveLocationValues(profile(), locations({
      contact: { phone: null, email: null, address: '1 Contact Road', hours: null, mapLocation: null, mapLat: null, mapLng: null },
    }));
    expect(withContactAddr.contact.mapTextFallback).toBe('1 Contact Road');
    expect(liveLocationValues(profile(), locations()).contact.mapTextFallback).toBe('9 Profile Avenue');
    expect(liveLocationValues(profile({ address: null }), locations()).contact.mapTextFallback).toBe(NOTHING_LIVE);
  });
});

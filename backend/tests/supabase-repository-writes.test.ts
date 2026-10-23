import { beforeEach, describe, expect, it, vi } from 'vitest';

// Audit-2 Fix 10 (H-5) — the repository WRITE paths, pinned against the
// REAL Supabase repository over the shared PostgREST miniature
// (./stubSupabase). The fake-repository suite proves route behaviour;
// it cannot prove query construction — which columns an insert sends,
// which predicates a write carries, how a 23505 race resolves, or how
// the pre-migration degradation retries behave — because the fake
// re-implements all of it. These tests seed/inspect the stub's raw
// tables so the stored ROWS (snake_case columns, forced values,
// untouched fields) are the assertions, not just the returned DTOs.

vi.mock('@supabase/supabase-js', async () => {
  const m = await import('./stubSupabase');
  return { createClient: m.stubSupabase.createClient };
});

import { stubSupabase as stub, type Row } from './stubSupabase';
import { createSupabaseRepository } from '../src/repositories/supabaseRepository';
import { ApiError } from '../src/lib/errors';

const repo = createSupabaseRepository('https://stub.invalid', 'stub-key');

const ts = (sec: number) => new Date(Date.UTC(2026, 0, 1) + sec * 1000).toISOString();
const rows = (table: string): Row[] => stub.tables.get(table) ?? [];

function menuRow(id: number, patch: Row = {}): Row {
  return {
    id, name: `Dish ${id}`, description: 'seeded', price: 10, image_url: `img${id}`, category: 'Mains',
    dietary_tags: [], is_available: true, sort_order: id, ...patch,
  };
}

function settingsRow(patch: Row = {}): Row {
  return {
    id: 1, kitchen_open: true, wait_min: 20, wait_max: 30, currency: 'USD', restaurant_name: 'Ember & Co.',
    phone: null, email: null, address: null, whatsapp_number: null, reservation_slot_capacity: 40,
    opening_hours: {}, site_locations: null, ...patch,
  };
}

beforeEach(() => stub.reset());

describe('menu CRUD + availability filtering', () => {
  it('listMenuItems serves only available dishes, mapped and in sort order', async () => {
    stub.seed('menu_items', [
      menuRow(2, { sort_order: 5 }),
      menuRow(1, { sort_order: 5, dietary_tags: ['Vegan'] }),
      menuRow(3, { is_available: false, sort_order: 1 }),
    ]);
    const items = await repo.listMenuItems();
    // sort_order ties break by id; the unavailable dish never appears.
    expect(items.map((i) => i.id)).toEqual([1, 2]);
    expect(items[0]).toEqual({
      id: 1, name: 'Dish 1', description: 'seeded', price: 10, image: 'img1', category: 'Mains', tags: ['Vegan'],
    });
  });

  it('getMenuItem returns null for unavailable and for absent dishes alike', async () => {
    stub.seed('menu_items', [menuRow(1), menuRow(2, { is_available: false })]);
    expect((await repo.getMenuItem(1))?.name).toBe('Dish 1');
    await expect(repo.getMenuItem(2)).resolves.toBeNull();
    await expect(repo.getMenuItem(999)).resolves.toBeNull();
  });

  it('listAllMenuItems includes unavailable dishes and pages past the 1000-row cap', async () => {
    const all: Row[] = [];
    for (let i = 1; i <= 1100; i++) all.push(menuRow(i, { sort_order: 7, is_available: i % 3 !== 0 }));
    stub.seed('menu_items', all);
    const items = await repo.listAllMenuItems();
    expect(items).toHaveLength(1100);
    // sort_order ties on every row: the id tiebreak keeps the scan total.
    expect(items.map((i) => i.id)).toEqual(Array.from({ length: 1100 }, (_, i) => i + 1));
    expect(items.find((i) => i.id === 3)?.isAvailable).toBe(false);
    expect(items[0]).toMatchObject({ sortOrder: 7 });
  });

  it('createMenuItem stores snake_case columns and returns the full admin shape', async () => {
    stub.seed('menu_items', []);
    const created = await repo.createMenuItem({
      name: 'Smoked Short Rib', description: '12-hour smoke', price: 42.5, image: 'rib.jpg',
      category: 'Mains', tags: ['GF'], isAvailable: true, sortOrder: 9,
    });
    expect(created).toMatchObject({ name: 'Smoked Short Rib', price: 42.5, image: 'rib.jpg', isAvailable: true, sortOrder: 9, tags: ['GF'] });
    const stored = rows('menu_items');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      name: 'Smoked Short Rib', image_url: 'rib.jpg', dietary_tags: ['GF'], is_available: true, sort_order: 9,
    });
    // The id is database-generated (0001: bigint identity) — the caller
    // supplied none — and the DTO contract exposes it as a number
    // (MenuItemDTO.id), mapped from the stored row, never passed through
    // raw. The raw row's id TYPE is the storage layer's business (a
    // stub-generated string here, a bigint in Postgres) and is
    // deliberately not pinned.
    expect(created).toHaveProperty('id');
    expect(typeof created.id).toBe('number');
  });

  it('updateMenuItem writes only the provided fields and returns null when absent', async () => {
    stub.seed('menu_items', [menuRow(5, { name: 'Old Name', price: 11 })]);
    const updated = await repo.updateMenuItem(5, { price: 13.25 });
    expect(updated).toMatchObject({ name: 'Old Name', price: 13.25 });
    expect(rows('menu_items')[0]).toMatchObject({ name: 'Old Name', price: 13.25, image_url: 'img5' });
    await expect(repo.updateMenuItem(999, { price: 1 })).resolves.toBeNull();
  });

  it('deleteMenuItem reports true once, then false', async () => {
    stub.seed('menu_items', [menuRow(5)]);
    await expect(repo.deleteMenuItem(5)).resolves.toBe(true);
    expect(rows('menu_items')).toHaveLength(0);
    await expect(repo.deleteMenuItem(5)).resolves.toBe(false);
  });
});

describe('settings reads sanitize garbage in storage', () => {
  it('maps invalid values to the documented fallbacks and keeps legitimate zeroes', async () => {
    stub.seed('restaurant_settings', [settingsRow({
      currency: 'bogus', wait_min: 0, wait_max: null, reservation_slot_capacity: 0, restaurant_name: '',
      site_locations: {
        footer: { phone: '  +1 555  ', email: 42, address: '12 Oak St' },
        contact: 'junk-not-an-object',
        reservation: { hours: '17:00 – 22:00', phone: '' },
      },
    })]);
    const s = await repo.getSettings();
    expect(s.currency).toBe('USD'); // unrecognised stored code
    expect(s.waitMin).toBe(0); // 0 is a real wait time, not a fallback case
    expect(s.waitMax).toBe(30); // null falls back
    expect(s.reservationSlotCapacity).toBe(40); // stored 0 is corruption (schema min is 1)
    expect(s.restaurantName).toBe('Ember & Co.');
    expect(s.siteLocations.footer).toEqual({ phone: '  +1 555  ', email: null, address: '12 Oak St' });
    expect(s.siteLocations.contact).toEqual({ phone: null, email: null, address: null, hours: null, mapLocation: null, mapLat: null, mapLng: null });
    expect(s.siteLocations.reservation).toEqual({ phone: null, address: null, hours: '17:00 – 22:00', locationLabel: null });
  });

  it('a valid stored map pin survives the read; garbage pairs read as no pin', async () => {
    stub.seed('restaurant_settings', [settingsRow({
      site_locations: {
        footer: { phone: null, email: null, address: null },
        contact: { phone: null, email: null, address: null, hours: null, mapLocation: 'Somewhere', mapLat: 24.8608, mapLng: 67.0011 },
        reservation: { phone: null, address: null, hours: null, locationLabel: null },
      },
    })]);
    const good = await repo.getSettings();
    expect(good.siteLocations.contact.mapLat).toBe(24.8608);
    expect(good.siteLocations.contact.mapLng).toBe(67.0011);

    // A string latitude is not a coordinate — the whole pair drops.
    stub.seed('restaurant_settings', [settingsRow({
      site_locations: { contact: { mapLat: '24.8608', mapLng: 67.0011 } },
    })]);
    const stringLat = await repo.getSettings();
    expect(stringLat.siteLocations.contact.mapLat).toBeNull();
    expect(stringLat.siteLocations.contact.mapLng).toBeNull();

    // Out-of-range and lone-half pairs are equally "no pin".
    stub.seed('restaurant_settings', [settingsRow({
      site_locations: { contact: { mapLat: 124.8608, mapLng: 67.0011 } },
    })]);
    const outOfRange = await repo.getSettings();
    expect(outOfRange.siteLocations.contact.mapLat).toBeNull();
    expect(outOfRange.siteLocations.contact.mapLng).toBeNull();
    stub.seed('restaurant_settings', [settingsRow({
      site_locations: { contact: { mapLat: 24.8608 } },
    })]);
    const loneHalf = await repo.getSettings();
    expect(loneHalf.siteLocations.contact.mapLat).toBeNull();
    expect(loneHalf.siteLocations.contact.mapLng).toBeNull();
  });
});

describe('settings writes — site_locations merge + degradation', () => {
  const seededLocations = {
    footer: { phone: 'F-old', email: null, address: null },
    contact: { phone: 'C-keep', email: null, address: null, hours: null, mapLocation: null, mapLat: 24.8608, mapLng: 67.0011 },
    reservation: { phone: 'R-keep', address: null, hours: null, locationLabel: null },
  };

  it('a siteLocations patch merges per group over the stored groups', async () => {
    stub.seed('restaurant_settings', [settingsRow({ site_locations: seededLocations })]);
    const saved = await repo.updateSettings({ siteLocations: { footer: { phone: 'F-new' } } });
    expect(saved.siteLocations.footer.phone).toBe('F-new');
    expect(saved.siteLocations.contact.phone).toBe('C-keep'); // unmentioned groups survive
    expect(saved.siteLocations.reservation.phone).toBe('R-keep');
    // The stored map pin survives a patch that never mentions it.
    expect(saved.siteLocations.contact.mapLat).toBe(24.8608);
    expect(saved.siteLocations.contact.mapLng).toBe(67.0011);
    // The merged document is what actually lands in the column.
    expect((rows('restaurant_settings')[0].site_locations as Row).contact).toMatchObject({ phone: 'C-keep' });
  });

  it('a map-pin patch merges inside the contact group and can clear back to null', async () => {
    stub.seed('restaurant_settings', [settingsRow({ site_locations: seededLocations })]);
    const moved = await repo.updateSettings({ siteLocations: { contact: { mapLat: 31.5497, mapLng: 74.3436 } } });
    expect(moved.siteLocations.contact.mapLat).toBe(31.5497);
    expect(moved.siteLocations.contact.mapLng).toBe(74.3436);
    expect(moved.siteLocations.contact.phone).toBe('C-keep'); // sibling fields survive
    expect((rows('restaurant_settings')[0].site_locations as Row).contact).toMatchObject({ mapLat: 31.5497, mapLng: 74.3436 });
    const cleared = await repo.updateSettings({ siteLocations: { contact: { mapLat: null, mapLng: null } } });
    expect(cleared.siteLocations.contact.mapLat).toBeNull();
    expect(cleared.siteLocations.contact.mapLng).toBeNull();
    expect((rows('restaurant_settings')[0].site_locations as Row).contact).toMatchObject({ mapLat: null, mapLng: null });
  });

  it('a scalar-only patch never rewrites site_locations', async () => {
    stub.seed('restaurant_settings', [settingsRow({ site_locations: seededLocations })]);
    const saved = await repo.updateSettings({ restaurantName: 'New Name' });
    expect(saved.restaurantName).toBe('New Name');
    expect(saved.siteLocations).toEqual(seededLocations);
    expect(rows('restaurant_settings')[0].site_locations).toEqual(seededLocations);
  });

  it('pre-migration (0010 not run): a locations save degrades to the scalar write instead of failing', async () => {
    stub.setMissingColumns('restaurant_settings', ['site_locations']);
    stub.seed('restaurant_settings', [settingsRow()]);
    const saved = await repo.updateSettings({
      restaurantName: 'Degraded Diner',
      siteLocations: { footer: { phone: 'F-new' } },
    });
    expect(saved.restaurantName).toBe('Degraded Diner'); // the save itself succeeds
    expect(saved.siteLocations.footer.phone).toBeNull(); // locations simply not active yet
    expect(rows('restaurant_settings')[0].restaurant_name).toBe('Degraded Diner');
    expect(rows('restaurant_settings')[0].site_locations).toBeNull();
  });

  it('a missing settings row is INSERTED with the patch over the defaults (update + insert degradation)', async () => {
    stub.seed('restaurant_settings', []);
    const saved = await repo.updateSettings({ restaurantName: 'First Save', waitMin: 15 });
    expect(saved.restaurantName).toBe('First Save');
    expect(saved.waitMin).toBe(15);
    expect(saved.waitMax).toBe(30); // defaults fill the rest
    expect(rows('restaurant_settings')).toHaveLength(1);
    expect(rows('restaurant_settings')[0]).toMatchObject({ id: 1, restaurant_name: 'First Save', wait_min: 15 });
  });

  it('the insert path degrades the same way when the column is missing', async () => {
    stub.setMissingColumns('restaurant_settings', ['site_locations']);
    stub.seed('restaurant_settings', []);
    const saved = await repo.updateSettings({ restaurantName: 'First Save' });
    expect(saved.restaurantName).toBe('First Save');
    expect(rows('restaurant_settings')).toHaveLength(1);
    expect('site_locations' in rows('restaurant_settings')[0]).toBe(false);
  });
});

describe('settings writes — column-aware degradation (Step 6, mega-audit Area 4 M2)', () => {
  // A partially-migrated DB (0010 run, 0014 not — or the reverse) must
  // lose ONLY the family whose migration is missing: the old retry
  // stripped BOTH optional families on any bare 42703/PGRST204, so a
  // healthy half of the save silently evaporated.
  const fullPatch = {
    restaurantName: 'Partial Diner',
    reservationFeeEnabled: true,
    reservationFeeAmount: 500,
    siteLocations: { footer: { phone: 'F-new' } },
  };

  it('(i) fee columns missing (0014 not run): locations PERSIST, fee fields absent', async () => {
    stub.setMissingColumns('restaurant_settings', ['reservation_fee_enabled', 'reservation_fee_amount']);
    stub.seed('restaurant_settings', [settingsRow()]);
    const saved = await repo.updateSettings(fullPatch);
    expect(saved.restaurantName).toBe('Partial Diner');
    // The healthy half of the save actually landed this time.
    expect(saved.siteLocations.footer.phone).toBe('F-new');
    const stored = rows('restaurant_settings')[0];
    expect((stored.site_locations as Row).footer).toMatchObject({ phone: 'F-new' });
    // The missing family is simply not active yet — absent, never faked.
    expect('reservation_fee_enabled' in stored).toBe(false);
    expect('reservation_fee_amount' in stored).toBe(false);
    expect(saved.reservationFeeEnabled).toBe(false);
    expect(saved.reservationFeeAmount).toBe(0);
  });

  it('(ii) site_locations missing (0010 not run): the fee PERSISTS, locations absent', async () => {
    stub.setMissingColumns('restaurant_settings', ['site_locations']);
    stub.seed('restaurant_settings', [settingsRow()]);
    const saved = await repo.updateSettings(fullPatch);
    expect(saved.reservationFeeEnabled).toBe(true);
    expect(saved.reservationFeeAmount).toBe(500);
    const stored = rows('restaurant_settings')[0];
    expect(stored.reservation_fee_enabled).toBe(true);
    expect(stored.reservation_fee_amount).toBe(500);
    expect(stored.site_locations).toBeNull(); // the seeded value was never overwritten
    expect(saved.siteLocations.footer.phone).toBeNull(); // not active yet
  });

  it('(iii) BOTH families missing: the save still succeeds via iteration, base fields persist', async () => {
    stub.setMissingColumns('restaurant_settings', ['site_locations', 'reservation_fee_enabled', 'reservation_fee_amount']);
    stub.seed('restaurant_settings', [settingsRow()]);
    const saved = await repo.updateSettings(fullPatch);
    expect(saved.restaurantName).toBe('Partial Diner');
    const stored = rows('restaurant_settings')[0];
    expect(stored.restaurant_name).toBe('Partial Diner');
    expect(stored.site_locations).toBeNull(); // never written (seeded null survives)
    expect('reservation_fee_enabled' in stored).toBe(false);
    expect('reservation_fee_amount' in stored).toBe(false);
    // Iteration is observable: first attempt + one retry per family.
    expect(stub.writeAttempts.get('restaurant_settings')).toBe(3);
  });

  it('(iii-b) both families missing on the INSERT path: iteration applies there too', async () => {
    stub.setMissingColumns('restaurant_settings', ['site_locations', 'reservation_fee_enabled', 'reservation_fee_amount']);
    stub.seed('restaurant_settings', []);
    const saved = await repo.updateSettings({ restaurantName: 'First Save', reservationFeeEnabled: true, reservationFeeAmount: 250 });
    expect(saved.restaurantName).toBe('First Save');
    expect(rows('restaurant_settings')).toHaveLength(1);
    const stored = rows('restaurant_settings')[0];
    expect(stored.restaurant_name).toBe('First Save');
    expect('site_locations' in stored).toBe(false);
    expect('reservation_fee_enabled' in stored).toBe(false);
  });

  it('(iv) an error naming NO column keeps the whole-strip fallback', async () => {
    // A bare PGRST204 with a generic message: nothing to parse, so
    // every optional family present is stripped (today's behaviour).
    const OPTIONAL = ['site_locations', 'reservation_fee_enabled', 'reservation_fee_amount'];
    stub.failWrites('restaurant_settings', (_op, cols) =>
      cols.some((c) => OPTIONAL.includes(c))
        ? { code: 'PGRST204', message: 'schema cache error — reload in progress' }
        : null);
    stub.seed('restaurant_settings', [settingsRow()]);
    const saved = await repo.updateSettings(fullPatch);
    expect(saved.restaurantName).toBe('Partial Diner'); // base fields persist
    const stored = rows('restaurant_settings')[0];
    expect(stored.restaurant_name).toBe('Partial Diner');
    expect(stored.site_locations).toBeNull(); // never written (seeded null survives)
    expect('reservation_fee_enabled' in stored).toBe(false);
    expect('reservation_fee_amount' in stored).toBe(false);
  });

  it('(v) an unrelated error throws — no retry theatre, exactly one write attempt', async () => {
    stub.failWrites('restaurant_settings', () => ({
      code: '23514', message: 'new row for relation "restaurant_settings" violates check constraint "settings_wait_check"',
    }));
    stub.seed('restaurant_settings', [settingsRow()]);
    await expect(repo.updateSettings({ restaurantName: 'Boom' })).rejects.toThrow('settings update failed');
    expect(stub.writeAttempts.get('restaurant_settings')).toBe(1);
    expect(rows('restaurant_settings')[0].restaurant_name).toBe('Ember & Co.'); // untouched
  });

  it('(vi) a PERSISTENT 23514 naming reservation_fee_amount throws — no strip, no retry (audit D1)', async () => {
    // Postgres auto-names a CHECK on the fee column
    // "…_reservation_fee_amount_check", so a genuine fee check
    // violation's message names the optional column exactly like a
    // missing-column error would. The shared matcher fires on that
    // message — only the code veto in withoutMissingColumns keeps
    // this from being misread as "0014 not run".
    stub.failWrites('restaurant_settings', () => ({
      code: '23514', message: 'new row for relation "restaurant_settings" violates check constraint "restaurant_settings_reservation_fee_amount_check"',
    }));
    stub.seed('restaurant_settings', [settingsRow()]);
    await expect(repo.updateSettings(fullPatch)).rejects.toThrow('settings update failed');
    expect(stub.writeAttempts.get('restaurant_settings')).toBe(1);
    const stored = rows('restaurant_settings')[0];
    expect(stored.restaurant_name).toBe('Ember & Co.'); // untouched
    expect(stored.site_locations).toBeNull();
    expect('reservation_fee_enabled' in stored).toBe(false);
    expect('reservation_fee_amount' in stored).toBe(false);
  });

  it('(vii) a CONDITIONAL 23514 naming reservation_fee_amount throws — must NOT succeed by stripping (audit D1)', async () => {
    // The harmful shape: the error fires only while the fee column
    // is in the payload, so a strip-and-retry would "succeed" and
    // the admin's fee setting would evaporate behind a normal
    // response. The veto makes the genuine error surface instead.
    stub.failWrites('restaurant_settings', (_op, cols) =>
      cols.includes('reservation_fee_amount')
        ? { code: '23514', message: 'new row for relation "restaurant_settings" violates check constraint "restaurant_settings_reservation_fee_amount_check"' }
        : null);
    stub.seed('restaurant_settings', [settingsRow()]);
    await expect(repo.updateSettings(fullPatch)).rejects.toThrow('settings update failed');
    expect(stub.writeAttempts.get('restaurant_settings')).toBe(1);
    const stored = rows('restaurant_settings')[0];
    expect(stored.restaurant_name).toBe('Ember & Co.'); // untouched — nothing was saved
    expect(stored.site_locations).toBeNull();
    expect('reservation_fee_enabled' in stored).toBe(false);
    expect('reservation_fee_amount' in stored).toBe(false);
  });

  it('(viii) a CONDITIONAL 23514 naming site_locations throws — the veto guards both families (audit D1)', async () => {
    stub.failWrites('restaurant_settings', (_op, cols) =>
      cols.includes('site_locations')
        ? { code: '23514', message: 'new row for relation "restaurant_settings" violates check constraint "restaurant_settings_site_locations_check"' }
        : null);
    stub.seed('restaurant_settings', [settingsRow()]);
    await expect(repo.updateSettings(fullPatch)).rejects.toThrow('settings update failed');
    expect(stub.writeAttempts.get('restaurant_settings')).toBe(1);
    const stored = rows('restaurant_settings')[0];
    expect(stored.restaurant_name).toBe('Ember & Co.'); // untouched — nothing was saved
    expect(stored.site_locations).toBeNull();
    expect('reservation_fee_enabled' in stored).toBe(false);
    expect('reservation_fee_amount' in stored).toBe(false);
  });
});

describe('reservations — create paths', () => {
  const input = {
    userId: 'user-9', name: 'Walk In', email: 'walk@example.com', phone: '555-1',
    date: '2026-12-24', time: '19:30', guests: 4,
  };

  it('the public create sends the stored-column names and NO source (the DB default speaks)', async () => {
    stub.seed('reservations', []);
    const created = await repo.createReservation(input);
    expect(created).toMatchObject({ name: 'Walk In', date: '2026-12-24', time: '19:30', guests: 4, status: 'pending', source: 'website' });
    const stored = rows('reservations')[0];
    expect(stored).toMatchObject({
      user_id: 'user-9', reservation_date: '2026-12-24', reservation_time: '19:30', guests: 4,
    });
    expect('source' in stored).toBe(false);
    expect('date' in stored).toBe(false); // DTO field names never reach the table
  });

  it('the admin create forces source=admin and user_id=null server-side', async () => {
    stub.seed('reservations', []);
    const created = await repo.adminCreateReservation({ ...input, status: 'confirmed', notes: 'Window seat' });
    expect(created).toMatchObject({ source: 'admin', userId: null, status: 'confirmed', notes: 'Window seat' });
    expect(rows('reservations')[0]).toMatchObject({ source: 'admin', user_id: null, status: 'confirmed' });
  });

  it('adminListReservations applies date/status filters BEFORE paging (total is the filtered count)', async () => {
    const seed: Row[] = [];
    for (let i = 1; i <= 5; i++) {
      seed.push({
        id: `res-a-${i}`, user_id: null, name: 'A', email: null, phone: '1', reservation_date: '2026-12-01',
        reservation_time: '18:00', guests: 2, status: 'confirmed', source: 'website', notes: null, created_at: ts(i),
      });
    }
    for (let i = 1; i <= 3; i++) {
      seed.push({
        id: `res-b-${i}`, user_id: null, name: 'B', email: null, phone: '1', reservation_date: '2026-12-02',
        reservation_time: '18:00', guests: 2, status: 'pending', source: 'website', notes: null, created_at: ts(10 + i),
      });
    }
    stub.seed('reservations', seed);
    const page1 = await repo.adminListReservations({ date: '2026-12-01' }, { limit: 2, offset: 0 });
    expect(page1.total).toBe(5); // NOT the unfiltered 8
    const page3 = await repo.adminListReservations({ date: '2026-12-01' }, { limit: 2, offset: 4 });
    expect(page3.items).toHaveLength(1);
    const byStatus = await repo.adminListReservations({ status: 'pending' }, { limit: 10, offset: 0 });
    expect(byStatus.total).toBe(3);
    expect(byStatus.items.every((r) => r.date === '2026-12-02')).toBe(true);
  });
});

describe('reviews moderation writes', () => {
  it('createReview starts unapproved; moderation flips it; delete removes the row', async () => {
    stub.seed('reviews', []);
    const created = await repo.createReview({ userId: 'user-9', name: 'Nia', rating: 5, comment: 'Superb', country: null });
    expect(created).toMatchObject({ name: 'Nia', rating: 5 });
    const stored = rows('reviews')[0];
    expect(stored).toMatchObject({ user_id: 'user-9', name: 'Nia' });
    // No raw-row approval assertion here: 0001 declares is_approved
    // `not null default false`, so a real stored row CARRIES the key —
    // its absence in the stub is the miniature's missing column default,
    // not the database's contract. What production guarantees is the
    // DTO-level truth pinned by the next two assertions: the admin list
    // reads the new review back with isApproved === false, and the
    // approved list stays empty until moderation flips it.

    expect(await repo.adminListReviews()).toHaveLength(1);
    expect((await repo.adminListReviews())[0].isApproved).toBe(false);
    expect(await repo.listApprovedReviews()).toHaveLength(0);

    await expect(repo.setReviewApproved(created.id, true)).resolves.toBe(true);
    expect((await repo.listApprovedReviews()).map((r) => r.id)).toEqual([created.id]);
    await expect(repo.setReviewApproved('absent-id', true)).resolves.toBe(false);

    await expect(repo.deleteReview(created.id)).resolves.toBe(true);
    expect(rows('reviews')).toHaveLength(0);
    await expect(repo.deleteReview(created.id)).resolves.toBe(false);
  });

  it('getReview reads one review by id with its approval flag; absent and malformed ids are null', async () => {
    stub.seed('reviews', [
      { id: 'rev-a', name: 'Nia', rating: 4, comment: 'Superb', country: null, is_approved: false, created_at: ts(1) },
      { id: 'rev-b', name: 'Omar', rating: 5, comment: 'Great', country: 'Canada', is_approved: true, created_at: ts(2) },
    ]);
    // The moderation handlers' pre-write snapshot read (Step 2): the
    // DTO plus isApproved, for exactly the requested row.
    await expect(repo.getReview('rev-a')).resolves.toEqual({
      id: 'rev-a', name: 'Nia', rating: 4, comment: 'Superb', country: null, createdAt: ts(1), isApproved: false,
    });
    await expect(repo.getReview('rev-b')).resolves.toMatchObject({ isApproved: true });
    await expect(repo.getReview('absent-id')).resolves.toBeNull();
    await expect(repo.getReview('not-a-uuid')).resolves.toBeNull();
  });
});

describe('newsletter subscribe + list', () => {
  it('subscribes once; the second subscribe reports alreadySubscribed and stores one row', async () => {
    stub.seed('newsletter_subscribers', []);
    await expect(repo.addNewsletterSubscriber('a@example.com')).resolves.toEqual({ alreadySubscribed: false });
    await expect(repo.addNewsletterSubscriber('a@example.com')).resolves.toEqual({ alreadySubscribed: true });
    expect(rows('newsletter_subscribers')).toHaveLength(1);
  });

  it('a subscribe racing a concurrent insert (23505) also reports alreadySubscribed', async () => {
    stub.addUnique('newsletter_subscribers', 'email');
    stub.seed('newsletter_subscribers', []);
    // Concurrent winner commits between the repository's existence
    // check and its insert — the unique index is what answers.
    stub.beforeInsert('newsletter_subscribers', (tables) => {
      tables.set('newsletter_subscribers', [{ id: 'sub-winner', email: 'race@example.com', created_at: ts(1) }]);
      return null;
    });
    await expect(repo.addNewsletterSubscriber('race@example.com')).resolves.toEqual({ alreadySubscribed: true });
    expect(rows('newsletter_subscribers')).toHaveLength(1);
  });

  it('adminListNewsletter answers the since-filtered total (the "new this week" stat)', async () => {
    stub.seed('newsletter_subscribers', [
      { id: 'sub-1', email: 'old@example.com', created_at: ts(10) },
      { id: 'sub-2', email: 'mid@example.com', created_at: ts(20) },
      { id: 'sub-3', email: 'new@example.com', created_at: ts(30) },
    ]);
    const page = await repo.adminListNewsletter({ limit: 1, offset: 0 }, ts(20));
    expect(page.total).toBe(2); // filtered count, not the page size and not the table size
    expect(page.items.map((s) => s.email)).toEqual(['new@example.com']); // newest first
    const all = await repo.adminListNewsletter({ limit: 10, offset: 0 });
    expect(all.total).toBe(3);
  });
});

describe('staff list joins auth emails', () => {
  it('adminListStaff pages profiles oldest-first with the auth email attached', async () => {
    stub.seed('profiles', [
      { id: 'p-2', role: 'staff', full_name: 'Second', phone: null, addresses: [], favorites: [], created_at: ts(2) },
      { id: 'p-1', role: 'admin', full_name: 'First', phone: null, addresses: [], favorites: [], created_at: ts(1) },
      { id: 'p-3', role: 'customer', full_name: 'No Auth Row', phone: null, addresses: [], favorites: [], created_at: ts(3) },
    ]);
    stub.seedAuthUsers([{ id: 'p-1', email: 'first@example.com' }, { id: 'p-2', email: 'second@example.com' }]);
    const page = await repo.adminListStaff({ limit: 10, offset: 0 });
    expect(page.total).toBe(3);
    expect(page.items.map((s) => s.id)).toEqual(['p-1', 'p-2', 'p-3']);
    expect(page.items.map((s) => s.email)).toEqual(['first@example.com', 'second@example.com', null]);
  });
});

describe('profiles — DTO sanitising and writes', () => {
  it('getProfile coerces a garbage role to customer and filters favorites to numbers', async () => {
    stub.seed('profiles', [{
      id: 'u-garbage', role: 'superuser', full_name: 42, phone: '555',
      addresses: [{ line1: '1 Way' }], favorites: [1, 'x', 2.5, 3, null], created_at: ts(1),
    }]);
    const profile = await repo.getProfile('u-garbage');
    expect(profile?.role).toBe('customer');
    expect(profile?.fullName).toBeNull(); // non-string name drops to null
    expect(profile?.favorites).toEqual([1, 2.5, 3]);
    expect(profile?.addresses).toEqual([{ line1: '1 Way' }]);
  });

  it('upsertProfile creates the row and never NULLs fields a later upsert omits', async () => {
    stub.seed('profiles', []);
    const created = await repo.upsertProfile('u-new', { fullName: 'New Person' });
    expect(created).toMatchObject({ id: 'u-new', fullName: 'New Person', phone: null });
    const updated = await repo.upsertProfile('u-new', { phone: '555-9' });
    expect(updated.fullName).toBe('New Person'); // preserved across the conflict update
    expect(updated.phone).toBe('555-9');
    expect(rows('profiles')).toHaveLength(1);
    expect(rows('profiles')[0]).toMatchObject({ full_name: 'New Person', phone: '555-9' });
  });

  it('updateProfile patches addresses/favorites and returns the stored shape', async () => {
    stub.seed('profiles', [{
      id: 'u-1', role: 'customer', full_name: 'Pat', phone: null, addresses: [], favorites: [], created_at: ts(1),
    }]);
    const addresses = [{ label: 'Home', line1: '9 Pine', city: 'Portland' }];
    const updated = await repo.updateProfile('u-1', { addresses, favorites: [3, 1, 3] });
    expect(updated.addresses).toEqual(addresses);
    expect(updated.favorites).toEqual([3, 1, 3]);
    expect(rows('profiles')[0].addresses).toEqual(addresses);
  });

  it('updateProfileRole returns the updated profile, null for an absent user', async () => {
    stub.seed('profiles', [{
      id: 'u-1', role: 'customer', full_name: 'Pat', phone: null, addresses: [], favorites: [], created_at: ts(1),
    }]);
    expect((await repo.updateProfileRole('u-1', 'staff'))?.role).toBe('staff');
    await expect(repo.updateProfileRole('absent', 'staff')).resolves.toBeNull();
  });
});

describe('coupons — unique code is a 409, never a 500', () => {
  it('createCoupon uppercases the code; a duplicate (any case) raises ApiError 409', async () => {
    stub.addUnique('coupons', 'code');
    stub.seed('coupons', []);
    const created = await repo.createCoupon({ code: 'save10', type: 'percent', value: 10, isActive: true, expiresAt: null });
    expect(created.code).toBe('SAVE10');
    expect(rows('coupons')[0].code).toBe('SAVE10');
    const err = await repo.createCoupon({ code: 'SAVE10', type: 'fixed', value: 5, isActive: true, expiresAt: null })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect(rows('coupons')).toHaveLength(1);
  });

  it('renaming a coupon onto an existing code also raises 409; getCouponByCode is case-insensitive', async () => {
    stub.addUnique('coupons', 'code');
    stub.seed('coupons', [
      { id: 'cpn-a', code: 'ALPHA', type: 'percent', value: 10, is_active: true, expires_at: null, created_at: ts(1) },
      { id: 'cpn-b', code: 'BETA', type: 'percent', value: 20, is_active: true, expires_at: null, created_at: ts(2) },
    ]);
    const err = await repo.updateCoupon('cpn-b', { code: 'alpha' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((await repo.getCouponByCode('alpha'))?.id).toBe('cpn-a');
    expect((await repo.getCouponByCode('beta'))?.id).toBe('cpn-b');
    await expect(repo.getCouponByCode('gamma')).resolves.toBeNull();
  });
});

describe('order create — items, replay, race, degradation', () => {
  const orderData = (patch: Record<string, unknown> = {}) => ({
    userId: null, customerName: 'Guest', customerEmail: 'guest@example.com', customerPhone: null,
    address: null, notes: null, couponCode: null, currency: 'USD', idempotencyKey: null,
    items: [
      { menuItemId: 1, name: 'Ember Classic', unitPrice: 24, quantity: 1 },
      { menuItemId: 2, name: 'Truffle Burger', unitPrice: 38, quantity: 2 },
    ],
    subtotal: 100, deliveryFee: 0, discount: 0, total: 100, ...patch,
  }) as Parameters<typeof repo.createOrder>[0];

  it('inserts the order and its items, and returns the order with items attached', async () => {
    stub.seed('orders', []);
    stub.seed('order_items', []);
    const created = await repo.createOrder(orderData({ idempotencyKey: 'key-happy-1' }));
    expect(created).toMatchObject({ status: 'pending', paymentStatus: 'unpaid', total: 100 });
    expect(created.items).toEqual([
      { menuItemId: 1, name: 'Ember Classic', unitPrice: 24, quantity: 1 },
      { menuItemId: 2, name: 'Truffle Burger', unitPrice: 38, quantity: 2 },
    ]);
    const storedOrders = rows('orders');
    expect(storedOrders).toHaveLength(1);
    expect(storedOrders[0]).toMatchObject({ idempotency_key: 'key-happy-1', status: 'pending', payment_status: 'unpaid' });
    const storedItems = rows('order_items');
    expect(storedItems).toHaveLength(2);
    expect(storedItems.every((i) => i.order_id === created.id)).toBe(true);
  });

  it('stores money verbatim — the repository never rounds to 2dp (migration 0011 owns storage precision)', async () => {
    stub.seed('orders', []);
    stub.seed('order_items', []);
    const created = await repo.createOrder(orderData({
      currency: 'KWD', subtotal: 3.015, discount: 0.302, total: 2.713,
      items: [{ menuItemId: 1, name: 'Dish', unitPrice: 1.005, quantity: 3 }],
    }));
    expect(created.total).toBe(2.713);
    expect(rows('orders')[0].total).toBe(2.713);
    expect(rows('order_items')[0].unit_price).toBe(1.005);
  });

  it('a keyed retry returns the FIRST order untouched — even carrying different items', async () => {
    stub.seed('orders', []);
    stub.seed('order_items', []);
    const first = await repo.createOrder(orderData({ idempotencyKey: 'key-replay-1' }));
    const retry = await repo.createOrder(orderData({
      idempotencyKey: 'key-replay-1', total: 999,
      items: [{ menuItemId: 9, name: 'Other', unitPrice: 999, quantity: 1 }],
    }));
    expect(retry.id).toBe(first.id);
    expect(retry.total).toBe(100);
    expect(retry.items).toHaveLength(2);
    expect(rows('orders')).toHaveLength(1);
    expect(rows('order_items')).toHaveLength(2);
  });

  it('the 23505 race returns the concurrent winner (with its items), never a duplicate', async () => {
    stub.addUnique('orders', 'idempotency_key');
    stub.seed('orders', []);
    stub.seed('order_items', []);
    stub.beforeInsert('orders', (tables) => {
      // A twin submit commits first: its order + items land, then this
      // insert hits the unique index.
      tables.set('orders', [{
        id: 'ord-winner', user_id: null, customer_name: 'Winner', customer_email: 'guest@example.com',
        customer_phone: null, delivery_address: null, notes: null, coupon_code: null, currency: 'USD',
        subtotal: 100, delivery_fee: 0, discount: 0, total: 100, status: 'pending', payment_status: 'unpaid',
        payment_intent_id: null, idempotency_key: 'key-race-1', created_at: ts(5), updated_at: ts(5),
      }]);
      tables.set('order_items', [
        { id: 1, order_id: 'ord-winner', menu_item_id: 1, name: 'Ember Classic', unit_price: 24, quantity: 1 },
      ]);
      return null;
    });
    const created = await repo.createOrder(orderData({ idempotencyKey: 'key-race-1', customerName: 'Loser' }));
    expect(created.id).toBe('ord-winner');
    expect(created.customerName).toBe('Winner');
    expect(created.items).toHaveLength(1);
    expect(rows('orders')).toHaveLength(1);
  });

  it('the 23505 race still returns the winner when its items have not landed yet (delayed re-read)', async () => {
    stub.addUnique('orders', 'idempotency_key');
    stub.seed('orders', []);
    stub.seed('order_items', []);
    stub.beforeInsert('orders', (tables) => {
      tables.set('orders', [{
        id: 'ord-winner-slow', user_id: null, customer_name: 'Winner', customer_email: 'guest@example.com',
        customer_phone: null, delivery_address: null, notes: null, coupon_code: null, currency: 'USD',
        subtotal: 100, delivery_fee: 0, discount: 0, total: 100, status: 'pending', payment_status: 'unpaid',
        payment_intent_id: null, idempotency_key: 'key-race-2', created_at: ts(5), updated_at: ts(5),
      }]);
      return null;
    });
    const created = await repo.createOrder(orderData({ idempotencyKey: 'key-race-2' }));
    expect(created.id).toBe('ord-winner-slow');
    expect(rows('orders')).toHaveLength(1);
  });

  it('pre-migration (0006 not run): a keyed create degrades to a plain insert and key lookups answer null', async () => {
    stub.setMissingColumns('orders', ['idempotency_key']);
    stub.seed('orders', []);
    stub.seed('order_items', []);
    const created = await repo.createOrder(orderData({ idempotencyKey: 'key-pre-migration' }));
    expect(created.items).toHaveLength(2);
    expect(rows('orders')).toHaveLength(1);
    expect('idempotency_key' in rows('orders')[0]).toBe(false);
    await expect(repo.getOrderByIdempotencyKey('key-pre-migration')).resolves.toBeNull();
  });

  it('an items-insert failure deletes the orphan order (compensating cleanup)', async () => {
    stub.seed('orders', []);
    stub.seed('order_items', []);
    stub.beforeInsert('order_items', () => ({ code: '23503', message: 'insert or update on table "order_items" violates foreign key constraint' }));
    await expect(repo.createOrder(orderData())).rejects.toThrow(/order items insert failed/);
    expect(rows('orders')).toHaveLength(0); // no orphan left behind
    expect(rows('order_items')).toHaveLength(0);
  });
});

describe('order payment transitions — the cancelled guard (mega-audit M1)', () => {
  function orderRow(patch: Row = {}): Row {
    return {
      id: 'ord-m1', user_id: null, customer_name: 'Guest', customer_email: 'guest@example.com',
      customer_phone: null, delivery_address: null, notes: null, coupon_code: null, currency: 'USD',
      subtotal: 24, delivery_fee: 0, discount: 0, total: 24, status: 'pending',
      payment_status: 'pending', payment_intent_id: 'pi_m1', created_at: ts(1), updated_at: ts(1),
      ...patch,
    };
  }

  it('markOrderPaidByPaymentIntent never pays a CANCELLED order — the stored row is untouched', async () => {
    stub.seed('orders', [orderRow({ status: 'cancelled' })]);
    stub.seed('order_items', []);
    const result = await repo.markOrderPaidByPaymentIntent('pi_m1');
    // The row is still returned (the webhook handler detects the
    // blocked transition from it) — but nothing was written.
    expect(result?.status).toBe('cancelled');
    expect(result?.paymentStatus).toBe('pending');
    expect(rows('orders')[0].payment_status).toBe('pending');
    expect(rows('orders')[0].status).toBe('cancelled');
  });

  it('a live order still recovers failed → paid, and an already-paid replay stays a no-op', async () => {
    stub.seed('orders', [orderRow({ status: 'confirmed', payment_status: 'failed' })]);
    stub.seed('order_items', []);
    expect((await repo.markOrderPaidByPaymentIntent('pi_m1'))?.paymentStatus).toBe('paid');
    expect(rows('orders')[0].payment_status).toBe('paid');
    expect((await repo.markOrderPaidByPaymentIntent('pi_m1'))?.paymentStatus).toBe('paid');
    expect(rows('orders')[0].payment_status).toBe('paid');
  });
});

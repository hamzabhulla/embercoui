import { beforeEach, describe, expect, it, vi } from 'vitest';

// Audit-2 Fix 4 — scale integrity, pinned against the REAL Supabase
// repository (the rest of the suite runs on the in-memory fake, which
// has no response cap and no scan-order instability, so it cannot
// express these defects). The Supabase client is stubbed with a
// faithful miniature of PostgREST semantics:
//
//  • every response is capped at 1000 rows unless the query pages
//    with .range() (the cap that silently truncated attachItems and
//    the unpaged review/coupon lists);
//  • `count: 'exact'` reports the FILTERED row count;
//  • rows that tie on every ORDER BY key (and entire results without
//    an ORDER BY) have NO guaranteed relative order — successive
//    queries may serve ties rotated. A caller paging on a total order
//    (unique tiebreak) is immune; a caller paging on created_at alone,
//    or not ordering at all, duplicates/skips rows exactly as it
//    could against real Postgres.

type Row = Record<string, unknown>;

const stub = vi.hoisted(() => {
  const tables = new Map<string, Row[]>();
  const querySeq = new Map<string, number>();
  const CAP = 1000;

  type StubError = { code: string; message: string };
  type StubResult = { data: unknown; error: StubError | null; count: number | null };

  class StubQuery {
    private filters: ((r: Row) => boolean)[] = [];
    private eqValues: unknown[] = [];
    private orders: { col: string; asc: boolean }[] = [];
    private rangeSlice: [number, number] | null = null;
    private limitN: number | null = null;
    private singleMode = false;
    private cols: string | null = null;
    private wantCount = false;
    private op: 'select' | 'update' | 'delete' = 'select';
    private patch: Row = {};
    private returnCols: string | null = null;

    constructor(private table: string) {}

    select(cols: string, opts?: { count?: string }) {
      // After update()/delete(), .select() names the RETURNING columns.
      if (this.op === 'select') {
        this.cols = cols;
        this.wantCount = opts?.count === 'exact';
      } else {
        this.returnCols = cols;
      }
      return this;
    }
    update(patch: Row) { this.op = 'update'; this.patch = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); this.eqValues.push(v); return this; }
    neq(col: string, v: unknown) { this.filters.push((r) => r[col] !== v); return this; }
    in(col: string, vs: unknown[]) { const s = new Set(vs); this.filters.push((r) => s.has(r[col])); return this; }
    order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this; }
    range(from: number, to: number) { this.rangeSlice = [from, to]; return this; }
    limit(n: number) { this.limitN = n; return this; }
    maybeSingle() { this.singleMode = true; return this; }
    single() { this.singleMode = true; return this; }

    then<TResult1 = StubResult, TResult2 = never>(
      onfulfilled?: ((value: StubResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
    }

    private execute(): StubResult {
      const seq = (querySeq.get(this.table) ?? 0) + 1;
      querySeq.set(this.table, seq);
      // Postgres rejects a non-UUID literal compared against a uuid
      // column with 22P02 — BEFORE any row logic. The repository's
      // malformed-id translation (fix 8) keys on exactly this code;
      // without it, the calls below would throw like the old code.
      if (this.eqValues.some((v) => v === 'not-a-uuid')) {
        return { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid: "not-a-uuid"' }, count: null };
      }
      const tableRows = tables.get(this.table) ?? [];
      const matched = tableRows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === 'update') {
        for (const r of matched) Object.assign(r, this.patch);
        const out = matched.map((r) => this.projectWith(this.returnCols, r));
        if (this.singleMode) return { data: out[0] ?? null, error: null, count: null };
        return { data: this.returnCols ? out : null, error: null, count: null };
      }
      if (this.op === 'delete') {
        tables.set(this.table, tableRows.filter((r) => !matched.includes(r)));
        const out = matched.map((r) => this.projectWith(this.returnCols, r));
        if (this.singleMode) return { data: out[0] ?? null, error: null, count: null };
        return { data: this.returnCols ? out : null, error: null, count: null };
      }
      let rows = matched;
      const total = rows.length;
      rows = this.applyOrder(rows, seq);
      if (this.singleMode) {
        return { data: rows[0] ?? null, error: null, count: null };
      }
      if (this.rangeSlice) {
        const [from, to] = this.rangeSlice;
        rows = rows.slice(from, from + Math.min(to - from + 1, CAP));
      } else if (this.limitN != null) {
        rows = rows.slice(0, this.limitN);
      } else {
        rows = rows.slice(0, CAP); // PostgREST max-rows on an unbounded response
      }
      const projected = rows.map((r) => this.project(r));
      return { data: projected, error: null, count: this.wantCount ? total : null };
    }

    private applyOrder(rows: Row[], seq: number): Row[] {
      const keys = this.orders;
      const sorted = [...rows].sort((a, b) => {
        for (const { col, asc } of keys) {
          const av = a[col] as string | number;
          const bv = b[col] as string | number;
          if (av === bv) continue;
          const cmp = av < bv ? -1 : 1;
          return asc ? cmp : -cmp;
        }
        return 0;
      });
      // Rotate each tie group by the query sequence number: ties have
      // no stable order across queries unless a unique key breaks them.
      const out: Row[] = [];
      let i = 0;
      while (i < sorted.length) {
        let j = i + 1;
        while (j < sorted.length && keys.every(({ col }) => sorted[j][col] === sorted[i][col])) j++;
        const group = sorted.slice(i, j);
        if (group.length > 1) {
          const shift = seq % group.length;
          out.push(...group.slice(shift), ...group.slice(0, shift));
        } else {
          out.push(...group);
        }
        i = j;
      }
      return out;
    }

    private project(r: Row): Row {
      return this.projectWith(this.cols, r);
    }

    private projectWith(cols: string | null, r: Row): Row {
      if (!cols || cols === '*') return { ...r };
      const keep = cols.split(',').map((c) => c.trim());
      const out: Row = {};
      for (const k of keep) out[k] = r[k];
      return out;
    }
  }

  const client = {
    from: (table: string) => new StubQuery(table),
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } },
  };

  return {
    tables,
    createClient: () => client,
    reset() { tables.clear(); querySeq.clear(); },
    seed(table: string, rows: Row[]) { tables.set(table, rows); },
  };
});

vi.mock('@supabase/supabase-js', () => ({ createClient: stub.createClient }));

import { createSupabaseRepository } from '../src/repositories/supabaseRepository';
import { FakeRepository } from './fakeRepository';

const repo = createSupabaseRepository('https://stub.invalid', 'stub-key');

const pad = (n: number, w = 4) => String(n).padStart(w, '0');
const ts = (sec: number) => new Date(Date.UTC(2026, 0, 1) + sec * 1000).toISOString();

function orderRow(id: string, patch: Row = {}): Row {
  return {
    id, user_id: 'cust-a', customer_name: 'Seed', customer_email: 'seed@example.com', customer_phone: null,
    status: 'delivered', payment_status: 'paid', payment_intent_id: null, currency: 'USD',
    subtotal: 10, delivery_fee: 0, discount: 0, total: 10, coupon_code: null,
    delivery_address: null, notes: null, created_at: ts(0), updated_at: ts(0), ...patch,
  };
}

beforeEach(() => stub.reset());

describe('attachItems completeness (H-4)', () => {
  it('attaches EVERY item when one page of orders holds more than 1000 item rows', async () => {
    const orders: Row[] = [];
    const items: Row[] = [];
    let itemId = 0;
    for (let o = 1; o <= 300; o++) {
      const orderId = `ord-${pad(o)}`;
      orders.push(orderRow(orderId, { created_at: ts(o), updated_at: ts(o) }));
      for (let k = 1; k <= 5; k++) {
        itemId += 1;
        items.push({ id: itemId, order_id: orderId, menu_item_id: 1, name: `item-${o}-${k}`, unit_price: 2, quantity: 1 });
      }
    }
    stub.seed('orders', orders);
    stub.seed('order_items', items);

    const page = await repo.adminListOrders(undefined, { limit: 300, offset: 0 });
    expect(page.total).toBe(300);
    expect(page.items).toHaveLength(300);
    // 1500 item rows total: a single unpaged items query would have
    // silently dropped the last 500.
    expect(page.items.reduce((s, o) => s + o.items.length, 0)).toBe(1500);
    for (const o of page.items) expect(o.items).toHaveLength(5);
    // Per-order item order is unchanged (item id ascending).
    const seventh = page.items.find((o) => o.id === 'ord-0007');
    expect(seventh?.items.map((i) => i.name)).toEqual(['item-7-1', 'item-7-2', 'item-7-3', 'item-7-4', 'item-7-5']);
  });
});

describe('unpaged list methods return the complete set past the 1000-row cap (C-M3)', () => {
  it('listApprovedReviews returns every approved review, newest first', async () => {
    const reviews: Row[] = [];
    for (let i = 1; i <= 1200; i++) {
      reviews.push({ id: `rev-${pad(i)}`, name: `Guest ${i}`, rating: 5, comment: 'x', country: null, is_approved: true, created_at: ts(i) });
    }
    for (let i = 1; i <= 50; i++) {
      reviews.push({ id: `rev-pending-${pad(i)}`, name: 'Pending', rating: 1, comment: 'x', country: null, is_approved: false, created_at: ts(5000 + i) });
    }
    stub.seed('reviews', reviews);

    const approved = await repo.listApprovedReviews();
    expect(approved).toHaveLength(1200);
    expect(approved[0].id).toBe('rev-1200'); // newest first
    expect(approved[approved.length - 1].id).toBe('rev-0001');
  });

  it('adminListReviews is complete unpaged and its pages tile exactly when timestamps tie', async () => {
    const reviews: Row[] = [];
    for (let i = 1; i <= 1100; i++) {
      reviews.push({
        id: `rev-${pad(i)}`, name: `Guest ${i}`, rating: 4, comment: 'x', country: null,
        is_approved: i % 2 === 0, created_at: ts(42), // every row ties on created_at
      });
    }
    stub.seed('reviews', reviews);

    const all = await repo.adminListReviews();
    expect(all).toHaveLength(1100);
    expect(all.filter((r) => r.isApproved)).toHaveLength(550);

    const seen: string[] = [];
    for (const offset of [0, 400, 800]) {
      const page = await repo.adminListReviews({ limit: 400, offset });
      expect(page.total).toBe(1100);
      seen.push(...page.items.map((r) => r.id));
    }
    expect(seen).toHaveLength(1100);
    expect(new Set(seen).size).toBe(1100); // no duplicates, no skips across page boundaries
  });

  it('adminListCoupons is complete unpaged and its pages tile the set', async () => {
    const coupons: Row[] = [];
    for (let i = 1; i <= 1100; i++) {
      coupons.push({ id: `cpn-${pad(i)}`, code: `CODE${i}`, type: 'percent', value: 10, is_active: true, expires_at: null, created_at: ts(i) });
    }
    stub.seed('coupons', coupons);

    const all = await repo.adminListCoupons();
    expect(all).toHaveLength(1100);
    expect(new Set(all.map((c) => c.code)).size).toBe(1100);

    const seen: string[] = [];
    for (const offset of [0, 600]) {
      const page = await repo.adminListCoupons({ limit: 600, offset });
      expect(page.total).toBe(1100);
      seen.push(...page.items.map((c) => c.id));
    }
    expect(new Set(seen).size).toBe(1100);
  });
});

describe('deterministic ordering for paged scans (B-M3)', () => {
  it('a paged orders list tiles exactly when every order shares one timestamp', async () => {
    const orders: Row[] = [];
    for (let i = 1; i <= 25; i++) orders.push(orderRow(`ord-${pad(i)}`, { created_at: ts(7), updated_at: ts(7) }));
    stub.seed('orders', orders);
    stub.seed('order_items', []);

    const seen: string[] = [];
    for (const offset of [0, 10, 20]) {
      const page = await repo.adminListOrders(undefined, { limit: 10, offset });
      expect(page.total).toBe(25);
      seen.push(...page.items.map((o) => o.id));
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('the customers spend aggregation counts every order exactly once across pages of tied timestamps', async () => {
    stub.seed('restaurant_settings', [{
      id: 1, kitchen_open: true, wait_min: 20, wait_max: 30, currency: 'USD', restaurant_name: 'Ember & Co.',
      phone: null, email: null, address: null, whatsapp_number: null, reservation_slot_capacity: 40,
      opening_hours: {}, site_locations: null,
    }]);
    // All profiles share one created_at too: the profiles pages must
    // tile by the id tiebreak, not by scan luck.
    stub.seed('profiles', ['cust-a', 'cust-b', 'cust-c'].map((id) => ({
      id, role: 'customer', full_name: id, phone: null, addresses: [], favorites: [], created_at: ts(3),
    })));
    const orders: Row[] = [];
    let n = 0;
    const push = (userId: string, count: number, patch: Row) => {
      for (let i = 0; i < count; i++) {
        n += 1;
        orders.push(orderRow(`ord-${pad(n, 5)}`, { user_id: userId, created_at: ts(9), updated_at: ts(9), ...patch }));
      }
    };
    push('cust-a', 1200, { total: 2 }); // paid USD → spent 2400
    push('cust-b', 1300, { total: 3 }); // paid USD → spent 3900
    push('cust-c', 6, { total: 5 }); // paid USD → spent 30
    push('cust-c', 2, { total: 5, payment_status: 'unpaid' }); // counted, not spent
    push('cust-c', 2, { total: 100, currency: 'EUR' }); // paid but foreign currency: counted, never summed in
    stub.seed('orders', orders);
    stub.seed('order_items', []);

    const customers = [
      ...(await repo.adminListCustomers({ limit: 2, offset: 0 })).items,
      ...(await repo.adminListCustomers({ limit: 2, offset: 2 })).items,
    ];
    expect(customers.map((c) => c.id).sort()).toEqual(['cust-a', 'cust-b', 'cust-c']);
    const byId = new Map(customers.map((c) => [c.id, c]));
    expect(byId.get('cust-a')).toMatchObject({ orderCount: 1200, totalSpent: 2400 });
    expect(byId.get('cust-b')).toMatchObject({ orderCount: 1300, totalSpent: 3900 });
    expect(byId.get('cust-c')).toMatchObject({ orderCount: 10, totalSpent: 30 });
  });
});

describe('fake repository mirrors the paged contracts', () => {
  it('adminListReviews / adminListCoupons page with totals and return everything unpaged', async () => {
    const fake = new FakeRepository();
    const page = await fake.adminListReviews({ limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(await fake.adminListReviews()).toHaveLength(2);

    const couponPage = await fake.adminListCoupons({ limit: 2, offset: 0 });
    expect(couponPage.total).toBe(5);
    expect(couponPage.items).toHaveLength(2);
    const allCoupons = await fake.adminListCoupons();
    expect(allCoupons).toHaveLength(5);
    expect(new Set(allCoupons.map((c) => c.id)).size).toBe(5);
    // Newest first, mirroring the real repository's created_at desc.
    expect(allCoupons[0].id).toBe('cpn-5');
  });
});

// ─── Fix 8 (audit-2): conditional writes, malformed ids, webhook
// lookups, settings hygiene, batched reads — against the REAL
// repository over the stubbed client. The stub gained update/delete/
// neq support and answers 22P02 for the sentinel id 'not-a-uuid',
// exactly like Postgres comparing a non-UUID literal to a uuid column.

function reservationRow(id: string, patch: Row = {}): Row {
  return {
    id, user_id: null, name: 'Seed Guest', email: 'seed@example.com', phone: '555', date: '2026-12-01',
    time: '19:00', guests: 2, status: 'pending', source: 'website', notes: null,
    created_at: ts(0), ...patch,
  };
}

function menuRow(id: number, patch: Row = {}): Row {
  return {
    id, name: `Dish ${id}`, description: 'seeded', price: 10, image_url: `img${id}`, category: 'Mains',
    dietary_tags: [], is_available: true, sort_order: id, ...patch,
  };
}

describe('conditional status transitions (fix 8, B-M1)', () => {
  it('an order status write applies only from the expected status', async () => {
    stub.seed('orders', [orderRow('ord-cond', { status: 'pending', payment_status: 'unpaid' })]);
    stub.seed('order_items', []);
    const updated = await repo.updateOrderStatus('ord-cond', 'pending', 'confirmed');
    expect(updated?.status).toBe('confirmed');
    // A stale writer still expecting 'pending' matches zero rows…
    await expect(repo.updateOrderStatus('ord-cond', 'pending', 'cancelled')).resolves.toBeNull();
    // …and the first writer's state survives untouched.
    expect((await repo.getOrder('ord-cond'))?.status).toBe('confirmed');
  });

  it('a cancellation never applies to a paid order at the data layer', async () => {
    stub.seed('orders', [orderRow('ord-paid', { status: 'pending', payment_status: 'paid' })]);
    stub.seed('order_items', []);
    // The webhook landed between the route's read and this write.
    await expect(repo.updateOrderStatus('ord-paid', 'pending', 'cancelled')).resolves.toBeNull();
    expect((await repo.getOrder('ord-paid'))?.status).toBe('pending');
  });

  it('a reservation status write applies only from the expected status', async () => {
    stub.seed('reservations', [reservationRow('res-cond')]);
    const updated = await repo.updateReservationStatus('res-cond', 'pending', 'confirmed');
    expect(updated?.status).toBe('confirmed');
    await expect(repo.updateReservationStatus('res-cond', 'pending', 'cancelled')).resolves.toBeNull();
    expect((await repo.getReservation('res-cond'))?.status).toBe('confirmed');
  });
});

describe('webhook intent lookups survive duplicate rows (fix 8, D-L7)', () => {
  it('marks the FIRST matching order paid and leaves the duplicate untouched', async () => {
    stub.seed('orders', [
      orderRow('ord-newer', { payment_intent_id: 'pi_dup', payment_status: 'pending', created_at: ts(50) }),
      orderRow('ord-older', { payment_intent_id: 'pi_dup', payment_status: 'pending', created_at: ts(5) }),
    ]);
    stub.seed('order_items', []);
    const marked = await repo.markOrderPaidByPaymentIntent('pi_dup');
    expect(marked?.id).toBe('ord-older');
    expect(marked?.paymentStatus).toBe('paid');
    expect((await repo.getOrder('ord-newer'))?.paymentStatus).toBe('pending');
  });

  it('marks the FIRST matching order failed and leaves the duplicate untouched', async () => {
    stub.seed('orders', [
      orderRow('ord-f-newer', { payment_intent_id: 'pi_dup_f', payment_status: 'pending', created_at: ts(60) }),
      orderRow('ord-f-older', { payment_intent_id: 'pi_dup_f', payment_status: 'pending', created_at: ts(6) }),
    ]);
    stub.seed('order_items', []);
    const marked = await repo.markOrderPaymentFailedByPaymentIntent('pi_dup_f');
    expect(marked?.id).toBe('ord-f-older');
    expect(marked?.paymentStatus).toBe('failed');
    expect((await repo.getOrder('ord-f-newer'))?.paymentStatus).toBe('pending');
  });
});

describe('malformed ids resolve to not-found, never throw (fix 8, B-M2)', () => {
  it('translates 22P02 to null/false on every by-uuid-id method', async () => {
    stub.seed('orders', []);
    stub.seed('reservations', []);
    stub.seed('reviews', []);
    stub.seed('coupons', []);
    stub.seed('profiles', []);
    await expect(repo.getOrder('not-a-uuid')).resolves.toBeNull();
    await expect(repo.getReservation('not-a-uuid')).resolves.toBeNull();
    await expect(repo.getProfile('not-a-uuid')).resolves.toBeNull();
    await expect(repo.updateOrderStatus('not-a-uuid', 'pending', 'confirmed')).resolves.toBeNull();
    await expect(repo.updateReservationStatus('not-a-uuid', 'pending', 'confirmed')).resolves.toBeNull();
    await expect(repo.setOrderPaymentIntent('not-a-uuid', 'pi_x')).resolves.toBe(false);
    await expect(repo.setReviewApproved('not-a-uuid', true)).resolves.toBe(false);
    await expect(repo.deleteReview('not-a-uuid')).resolves.toBe(false);
    await expect(repo.updateCoupon('not-a-uuid', { isActive: false })).resolves.toBeNull();
    await expect(repo.deleteCoupon('not-a-uuid')).resolves.toBe(false);
    await expect(repo.updateProfileRole('not-a-uuid', 'admin')).resolves.toBeNull();
  });
});

describe('settings hygiene (fix 8)', () => {
  it('getSettings never hands out the shared defaults object', async () => {
    stub.seed('restaurant_settings', []);
    const first = await repo.getSettings();
    first.restaurantName = 'Mutated';
    first.openingHours.weekdays = 'mutated';
    first.siteLocations.footer.phone = 'mutated';
    const second = await repo.getSettings();
    expect(second).not.toBe(first);
    expect(second.restaurantName).toBe('Ember & Co.');
    expect(second.openingHours).toEqual({});
    expect(second.siteLocations.footer.phone).toBeNull();
  });

  it('sanitizes a stored opening_hours blob down to string entries', async () => {
    stub.seed('restaurant_settings', [{
      id: 1, kitchen_open: true, wait_min: 20, wait_max: 30, currency: 'USD', restaurant_name: 'Ember & Co.',
      phone: null, email: null, address: null, whatsapp_number: null, reservation_slot_capacity: 40,
      opening_hours: { weekdays: '  11:00 – 22:00 ', weekends: 42, holiday: { nested: true }, blank: '   ' },
      site_locations: null,
    }]);
    const settings = await repo.getSettings();
    expect(settings.openingHours).toEqual({ weekdays: '11:00 – 22:00' });
  });

  it('normalizes openingHours on write as well', async () => {
    stub.seed('restaurant_settings', [{
      id: 1, kitchen_open: true, wait_min: 20, wait_max: 30, currency: 'USD', restaurant_name: 'Ember & Co.',
      phone: null, email: null, address: null, whatsapp_number: null, reservation_slot_capacity: 40,
      opening_hours: {}, site_locations: null,
    }]);
    const saved = await repo.updateSettings({ openingHours: { weekdays: ' 9 – 5 ', bogus: 7 } });
    expect(saved.openingHours).toEqual({ weekdays: '9 – 5' });
  });
});

describe('idempotency lookup + batched menu reads (fix 8)', () => {
  it('getOrderByIdempotencyKey returns the stored order with items, or null', async () => {
    stub.seed('orders', [orderRow('ord-keyed', { idempotency_key: 'checkout-key-1' })]);
    stub.seed('order_items', [
      { id: 'oi-1', order_id: 'ord-keyed', menu_item_id: 1, name: 'Dish', unit_price: 10, quantity: 1 },
    ]);
    const found = await repo.getOrderByIdempotencyKey('checkout-key-1');
    expect(found?.id).toBe('ord-keyed');
    expect(found?.items).toHaveLength(1);
    await expect(repo.getOrderByIdempotencyKey('no-such-key')).resolves.toBeNull();
  });

  it('getMenuItemsByIds batches, preserves caller order, skips missing/unavailable', async () => {
    stub.seed('menu_items', [menuRow(1), menuRow(2), menuRow(3, { is_available: false })]);
    const items = await repo.getMenuItemsByIds([2, 999, 1, 3]);
    expect(items.map((i) => i.id)).toEqual([2, 1]);
  });
});

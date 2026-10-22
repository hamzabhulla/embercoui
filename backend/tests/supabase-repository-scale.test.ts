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

  class StubQuery {
    private filters: ((r: Row) => boolean)[] = [];
    private orders: { col: string; asc: boolean }[] = [];
    private rangeSlice: [number, number] | null = null;
    private limitN: number | null = null;
    private singleMode = false;
    private cols: string | null = null;
    private wantCount = false;

    constructor(private table: string) {}

    select(cols: string, opts?: { count?: string }) {
      this.cols = cols;
      this.wantCount = opts?.count === 'exact';
      return this;
    }
    eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this; }
    in(col: string, vs: unknown[]) { const s = new Set(vs); this.filters.push((r) => s.has(r[col])); return this; }
    order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this; }
    range(from: number, to: number) { this.rangeSlice = [from, to]; return this; }
    limit(n: number) { this.limitN = n; return this; }
    maybeSingle() { this.singleMode = true; return this; }
    single() { this.singleMode = true; return this; }

    then<TResult1 = { data: unknown; error: null; count: number | null }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: null; count: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
    }

    private execute(): { data: unknown; error: null; count: number | null } {
      const seq = (querySeq.get(this.table) ?? 0) + 1;
      querySeq.set(this.table, seq);
      let rows = (tables.get(this.table) ?? []).filter((r) => this.filters.every((f) => f(r)));
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
      if (!this.cols || this.cols === '*') return { ...r };
      const keep = this.cols.split(',').map((c) => c.trim());
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

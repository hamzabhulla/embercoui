import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { OrderDTO, ReservationDTO, ReviewDTO } from '../src/repositories/types';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';
import { FakeStorageService } from './fakeStorage';

// Audit Fix 9 — pagination + scale. The admin list endpoints page with
// limit/offset and report exact totals; unpaged repository calls (what
// dashboard / finance / CSV export use) return the COMPLETE set, so
// nothing silently truncates at PostgREST's 1000-row cap anymore.

const as = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
const ADMIN = 'token-admin';

function setup() {
  const repo = new FakeRepository();
  const app = createApp({
    env: testEnv(), repo, verifyToken: fakeVerifyToken,
    stripe: new FakeStripeService(), storage: new FakeStorageService(),
  });
  return { repo, app };
}

const at = (sec: number) => new Date(Date.UTC(2026, 0, 1) + sec * 1000).toISOString();

let orderSeq = 0;
function makeOrder(patch: Partial<OrderDTO> = {}): OrderDTO {
  const n = ++orderSeq;
  return {
    id: `seed-order-${n}`, userId: 'user-1', customerName: 'Seed Customer',
    customerEmail: 'seed@example.com', customerPhone: null, status: 'pending',
    paymentStatus: 'paid', paymentIntentId: null, currency: 'USD',
    subtotal: 10, deliveryFee: 0, discount: 0, total: 10, couponCode: null,
    address: null, notes: null, items: [],
    createdAt: at(n), updatedAt: at(n), ...patch,
  };
}

let resSeq = 0;
function makeReservation(patch: Partial<ReservationDTO> = {}): ReservationDTO {
  const n = ++resSeq;
  return {
    id: `seed-res-${n}`, userId: null, name: 'Seed Guest', email: 'guest@example.com',
    phone: '1234567', date: '2026-12-01', time: '19:00', guests: 2,
    source: 'website', notes: null, status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z', ...patch,
  };
}

describe('paged admin orders endpoint', () => {
  const { repo, app } = setup();
  for (let i = 1; i <= 7; i++) {
    repo.orders.push(makeOrder({ createdAt: at(i), status: i >= 6 ? 'delivered' : 'pending' }));
  }

  it('returns the first page with the exact total and echoes limit/offset', async () => {
    const res = await as(request(app).get('/api/v1/admin/orders?limit=3&offset=0'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(7);
    expect(res.body.limit).toBe(3);
    expect(res.body.offset).toBe(0);
    // Newest first.
    expect(res.body.orders.map((o: OrderDTO) => o.createdAt)).toEqual([at(7), at(6), at(5)]);
  });

  it('pages tile the full set without overlap (load-more contract)', async () => {
    const seen: string[] = [];
    for (const offset of [0, 3, 6]) {
      const res = await as(request(app).get(`/api/v1/admin/orders?limit=3&offset=${offset}`), ADMIN);
      expect(res.status).toBe(200);
      seen.push(...res.body.orders.map((o: OrderDTO) => o.id));
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('defaults to limit=100/offset=0 and totals respect the status filter', async () => {
    const all = await as(request(app).get('/api/v1/admin/orders'), ADMIN);
    expect(all.body.limit).toBe(100);
    expect(all.body.offset).toBe(0);
    expect(all.body.orders).toHaveLength(7);
    const delivered = await as(request(app).get('/api/v1/admin/orders?status=delivered&limit=1'), ADMIN);
    expect(delivered.body.total).toBe(2);
    expect(delivered.body.orders).toHaveLength(1);
  });

  it('rejects invalid paging params with 400', async () => {
    for (const q of ['limit=abc', 'limit=0', 'limit=-1', 'offset=-1', 'offset=1.5']) {
      const res = await as(request(app).get(`/api/v1/admin/orders?${q}`), ADMIN);
      expect(res.status, q).toBe(400);
    }
  });

  it('clamps an oversized limit to 500 instead of erroring', async () => {
    const res = await as(request(app).get('/api/v1/admin/orders?limit=99999'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(500);
    expect(res.body.orders).toHaveLength(7);
  });
});

describe('repository paging contract (fake mirrors the real one)', () => {
  it('paged calls return slices + total; unpaged calls return everything', async () => {
    const { repo } = setup();
    for (let i = 0; i < 5; i++) repo.orders.push(makeOrder());
    const page = await repo.adminListOrders(undefined, { limit: 2, offset: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
    const all = await repo.adminListOrders();
    expect(Array.isArray(all)).toBe(true);
    expect(all).toHaveLength(5);
  });

  it('getReservation returns the row or null', async () => {
    const { repo } = setup();
    repo.reservations.push(makeReservation({ id: 'res-known' }));
    expect((await repo.getReservation('res-known'))?.id).toBe('res-known');
    expect(await repo.getReservation('res-nope')).toBeNull();
  });

  it('listOrdersForUser caps at the 100 most recent orders', async () => {
    const { repo } = setup();
    for (let i = 1; i <= 105; i++) repo.orders.push(makeOrder({ userId: 'user-9', createdAt: at(i) }));
    const mine = await repo.listOrdersForUser('user-9');
    expect(mine).toHaveLength(100);
    expect(mine[0].createdAt).toBe(at(105));
  });
});

describe('reservations paging + deterministic order', () => {
  const { repo, app } = setup();
  // Same date, different times: time asc breaks the tie before created_at.
  const a = makeReservation({ date: '2026-12-02', time: '19:00', createdAt: '2026-01-01T00:00:00.000Z' });
  const b = makeReservation({ date: '2026-12-02', time: '18:00', createdAt: '2026-01-03T00:00:00.000Z' });
  const c = makeReservation({ date: '2026-12-03', time: '09:00', createdAt: '2026-01-02T00:00:00.000Z' });
  repo.reservations.push(a, b, c);

  it('orders date desc, then time asc, and pages carry the total', async () => {
    const first = await as(request(app).get('/api/v1/admin/reservations?limit=2&offset=0'), ADMIN);
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(3);
    expect(first.body.reservations.map((r: ReservationDTO) => r.id)).toEqual([c.id, b.id]);
    const rest = await as(request(app).get('/api/v1/admin/reservations?limit=2&offset=2'), ADMIN);
    expect(rest.body.reservations.map((r: ReservationDTO) => r.id)).toEqual([a.id]);
  });

  it('rejects invalid paging params with 400', async () => {
    expect((await as(request(app).get('/api/v1/admin/reservations?limit=nope'), ADMIN)).status).toBe(400);
    expect((await as(request(app).get('/api/v1/admin/reservations?offset=-2'), ADMIN)).status).toBe(400);
  });
});

describe('reservations date/status filters (audit-2 fix 3)', () => {
  const { repo, app } = setup();
  const DAY = '2026-12-20';
  // 120 newer bookings on OTHER dates — the newest-100 window the old
  // day board derived from would not contain a single row of DAY.
  for (let i = 0; i < 120; i++) {
    repo.reservations.push(makeReservation({ date: '2026-12-25', status: 'confirmed', createdAt: at(1000 + i) }));
  }
  // DAY itself: 30 bookings — 12 parties in the 19:00 slot (2 guests
  // each), 18 across other slots; 5 of the 30 are cancelled.
  for (let i = 0; i < 12; i++) {
    repo.reservations.push(makeReservation({ date: DAY, time: '19:00', guests: 2, status: 'confirmed', createdAt: at(2000 + i) }));
  }
  for (let i = 0; i < 13; i++) {
    repo.reservations.push(makeReservation({ date: DAY, time: '18:00', guests: 3, status: 'pending', createdAt: at(2100 + i) }));
  }
  for (let i = 0; i < 5; i++) {
    repo.reservations.push(makeReservation({ date: DAY, time: '20:00', guests: 4, status: 'cancelled', createdAt: at(2200 + i) }));
  }
  // Older dates too, so an unfiltered count differs from every filter.
  for (let i = 0; i < 10; i++) {
    repo.reservations.push(makeReservation({ date: '2026-12-10', status: 'pending', createdAt: at(500 + i) }));
  }

  it('date filter returns that date\'s complete set across pages, with the filtered total', async () => {
    const seen: ReservationDTO[] = [];
    for (const offset of [0, 10, 20]) {
      const res = await as(request(app).get(`/api/v1/admin/reservations?date=${DAY}&limit=10&offset=${offset}`), ADMIN);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(30);
      seen.push(...res.body.reservations);
    }
    expect(seen).toHaveLength(30);
    expect(new Set(seen.map((r) => r.id)).size).toBe(30);
    expect(seen.every((r) => r.date === DAY)).toBe(true);
    // The board's arithmetic over the fetched set: the 19:00 slot holds
    // all 12 parties / 24 guests even though 120 newer rows exist.
    const slot = seen.filter((r) => r.time === '19:00' && (r.status === 'pending' || r.status === 'confirmed'));
    expect(slot).toHaveLength(12);
    expect(slot.reduce((s, r) => s + r.guests, 0)).toBe(24);
  });

  it('status filter reports the exact filtered total (the stat-chip contract)', async () => {
    const pending = await as(request(app).get('/api/v1/admin/reservations?status=pending&limit=1'), ADMIN);
    expect(pending.status).toBe(200);
    expect(pending.body.total).toBe(23); // 13 on DAY + 10 on 2026-12-10
    expect(pending.body.reservations).toHaveLength(1);
    const confirmed = await as(request(app).get('/api/v1/admin/reservations?status=confirmed&limit=1'), ADMIN);
    expect(confirmed.body.total).toBe(132); // 120 on 2026-12-25 + 12 in DAY's 19:00 slot
  });

  it('date + status filters combine', async () => {
    const res = await as(request(app).get(`/api/v1/admin/reservations?date=${DAY}&status=cancelled&limit=100`), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.reservations.every((r: ReservationDTO) => r.date === DAY && r.status === 'cancelled')).toBe(true);
  });

  it('a date with no bookings is an honest empty page, not an error', async () => {
    const res = await as(request(app).get('/api/v1/admin/reservations?date=2027-01-01'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.reservations).toEqual([]);
  });

  it('rejects malformed date and unknown status with 400', async () => {
    for (const q of ['date=2026-1-1', 'date=20-12-2026', 'date=garbage', 'status=bogus']) {
      const res = await as(request(app).get(`/api/v1/admin/reservations?${q}`), ADMIN);
      expect(res.status, q).toBe(400);
    }
  });

  it('rejects nonexistent calendar dates with 400 but accepts a real leap date', async () => {
    // Shape-valid but impossible dates: PostgREST would reject these
    // literals, so the route must too — fake and real stay in agreement.
    for (const q of ['date=2026-02-30', 'date=2026-04-31', 'date=2027-02-29']) {
      const res = await as(request(app).get(`/api/v1/admin/reservations?${q}`), ADMIN);
      expect(res.status, q).toBe(400);
    }
    const leap = await as(request(app).get('/api/v1/admin/reservations?date=2028-02-29'), ADMIN);
    expect(leap.status).toBe(200);
    expect(leap.body.total).toBe(0);
    expect(leap.body.reservations).toEqual([]);
    // Years 0–99 are real dates too: Date.UTC maps them onto
    // 1900–1999, but the route pins the exact year before comparing,
    // so 0099-06-15 is an honest empty page — not a 400.
    const early = await as(request(app).get('/api/v1/admin/reservations?date=0099-06-15'), ADMIN);
    expect(early.status).toBe(200);
    expect(early.body.total).toBe(0);
    expect(early.body.reservations).toEqual([]);
  });

  it('unpaged repository call with no filter still returns everything', async () => {
    const all = await repo.adminListReservations();
    expect(all).toHaveLength(160);
    const dayPage = await repo.adminListReservations({ date: DAY }, { limit: 500, offset: 0 });
    expect(dayPage.total).toBe(30);
    expect(dayPage.items).toHaveLength(30);
  });
});

describe('reservation status PATCH reaches rows beyond the first page', () => {
  const { repo, app } = setup();
  for (let i = 0; i < 149; i++) {
    repo.reservations.push(makeReservation({ date: '2026-12-15', createdAt: at(i + 1) }));
  }
  // Earliest date → sorts last, far outside the default 100-row page.
  const target = makeReservation({ date: '2026-01-05', name: 'Old Booking' });
  repo.reservations.push(target);

  it('the default page really does not contain the target…', async () => {
    const res = await as(request(app).get('/api/v1/admin/reservations'), ADMIN);
    expect(res.body.total).toBe(150);
    expect(res.body.reservations).toHaveLength(100);
    expect(res.body.reservations.some((r: ReservationDTO) => r.id === target.id)).toBe(false);
  });

  it('…but the status PATCH still finds it by id', async () => {
    const res = await as(request(app).patch(`/api/v1/admin/reservations/${target.id}/status`).send({ status: 'confirmed' }), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.reservation.status).toBe('confirmed');
    const missing = await as(request(app).patch('/api/v1/admin/reservations/res-nope/status').send({ status: 'confirmed' }), ADMIN);
    expect(missing.status).toBe(404);
  });
});

describe('customers + newsletter paging', () => {
  const { repo, app } = setup();

  it('customers page with totals, emails and counts intact', async () => {
    const first = await as(request(app).get('/api/v1/admin/customers?limit=1&offset=0'), ADMIN);
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(2); // user-1 + user-2 in the fake seeds
    expect(first.body.customers).toHaveLength(1);
    const second = await as(request(app).get('/api/v1/admin/customers?limit=1&offset=1'), ADMIN);
    expect(second.body.customers).toHaveLength(1);
    expect(second.body.customers[0].id).not.toBe(first.body.customers[0].id);
    for (const c of [...first.body.customers, ...second.body.customers]) {
      expect(c.email).toContain('@');
      expect(typeof c.orderCount).toBe('number');
      expect(typeof c.totalSpent).toBe('number');
    }
  });

  it('newsletter pages tile the subscriber set', async () => {
    for (let i = 0; i < 5; i++) await repo.addNewsletterSubscriber(`fan${i}@example.com`);
    const seen = new Set<string>();
    for (const offset of [0, 2, 4]) {
      const res = await as(request(app).get(`/api/v1/admin/newsletter?limit=2&offset=${offset}`), ADMIN);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(5);
      for (const s of res.body.subscribers as { email: string }[]) seen.add(s.email);
    }
    expect(seen.size).toBe(5);
  });
});

describe('aggregation completeness past 1000 rows', () => {
  const { repo, app } = setup();
  for (let i = 0; i < 1005; i++) repo.orders.push(makeOrder({ total: 2 }));

  it('dashboard counts and sums ALL orders, not the first 1000', async () => {
    const res = await as(request(app).get('/api/v1/admin/dashboard'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.stats.totalOrders).toBe(1005);
    expect(res.body.stats.revenue).toBe(2010);
  });

  it('finance aggregates ALL paid orders', async () => {
    const res = await as(request(app).get('/api/v1/admin/finance'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.totalPaidOrders).toBe(1005);
    expect(res.body.totalRevenue).toBe(2010);
  });

  it('the unpaged repository list is complete; a deep page still slices', async () => {
    expect(await repo.adminListOrders()).toHaveLength(1005);
    const tail = await repo.adminListOrders(undefined, { limit: 1000, offset: 1000 });
    expect(tail.total).toBe(1005);
    expect(tail.items).toHaveLength(5);
  });
});

describe('paged admin reviews + global stats (audit-2 fix 6)', () => {
  const { repo, app } = setup();
  // On top of the fake's two seeds (rev-1 approved 5★, rev-2 pending 4★):
  // six older reviews, so the full order (created_at desc) is
  // rev-2, rev-1, a, b, c, d, e, f and pending rows sit on later pages.
  repo.reviews.push(
    { id: 'seed-rev-a', name: 'A', rating: 5, comment: 'a', country: null, createdAt: '2025-12-06T00:00:00Z', isApproved: true },
    { id: 'seed-rev-b', name: 'B', rating: 4, comment: 'b', country: null, createdAt: '2025-12-05T00:00:00Z', isApproved: true },
    { id: 'seed-rev-c', name: 'C', rating: 3, comment: 'c', country: null, createdAt: '2025-12-04T00:00:00Z', isApproved: true },
    { id: 'seed-rev-d', name: 'D', rating: 2, comment: 'd', country: null, createdAt: '2025-12-03T00:00:00Z', isApproved: false },
    { id: 'seed-rev-e', name: 'E', rating: 5, comment: 'e', country: null, createdAt: '2025-12-02T00:00:00Z', isApproved: false },
    { id: 'seed-rev-f', name: 'F', rating: 5, comment: 'f', country: null, createdAt: '2025-12-01T00:00:00Z', isApproved: true },
  );

  it('pages tile the full set without overlap (load-more contract)', async () => {
    const seen: string[] = [];
    for (const offset of [0, 3, 6]) {
      const res = await as(request(app).get(`/api/v1/admin/reviews?limit=3&offset=${offset}`), ADMIN);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(8);
      expect(res.body.limit).toBe(3);
      expect(res.body.offset).toBe(offset);
      seen.push(...res.body.reviews.map((r: ReviewDTO) => r.id));
    }
    expect(seen).toEqual(['rev-2', 'rev-1', 'seed-rev-a', 'seed-rev-b', 'seed-rev-c', 'seed-rev-d', 'seed-rev-e', 'seed-rev-f']);
  });

  it('defaults to limit=100/offset=0 and still returns the reviews array (backward compatible)', async () => {
    const res = await as(request(app).get('/api/v1/admin/reviews'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
    expect(res.body.offset).toBe(0);
    expect(res.body.reviews).toHaveLength(8);
  });

  it('stats describe the COMPLETE set, not the loaded page', async () => {
    // A limit=1 page holds a single (pending) review, yet the stats
    // must still cover all 8: 5 approved (5,5,4,3,5 → avg 4.4), 3 pending.
    const res = await as(request(app).get('/api/v1/admin/reviews?limit=1&offset=0'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.stats.approvedCount).toBe(5);
    expect(res.body.stats.pendingCount).toBe(3);
    expect(res.body.stats.averageRating).toBeCloseTo(4.4);
    expect(res.body.stats.distribution).toEqual({ '5': 3, '4': 1, '3': 1, '2': 0, '1': 0 });
  });

  it('moderation reaches a review that only appears on a later page', async () => {
    // seed-rev-d is pending and sits at index 5 — page 2 at limit=3.
    const page2 = await as(request(app).get('/api/v1/admin/reviews?limit=3&offset=3'), ADMIN);
    expect(page2.body.reviews.map((r: ReviewDTO) => r.id)).toContain('seed-rev-d');
    const patch = await as(request(app).patch('/api/v1/admin/reviews/seed-rev-d').send({ isApproved: true }), ADMIN);
    expect(patch.status).toBe(200);
    const after = await as(request(app).get('/api/v1/admin/reviews?limit=1'), ADMIN);
    expect(after.body.stats.approvedCount).toBe(6);
    expect(after.body.stats.pendingCount).toBe(2);
    expect(after.body.stats.averageRating).toBeCloseTo(4); // (22 + 2) / 6
    expect(after.body.stats.distribution['2']).toBe(1);
  });

  it('rejects invalid paging params with 400', async () => {
    for (const q of ['limit=abc', 'limit=0', 'offset=-1']) {
      const res = await as(request(app).get(`/api/v1/admin/reviews?${q}`), ADMIN);
      expect(res.status, q).toBe(400);
    }
  });
});

describe('paged admin coupons (audit-2 fix 6)', () => {
  const { app } = setup();

  it('pages tile the full set with the exact total', async () => {
    // The fake seeds 5 coupons; newest-first is reverse seed order.
    const seen: string[] = [];
    for (const offset of [0, 2, 4]) {
      const res = await as(request(app).get(`/api/v1/admin/coupons?limit=2&offset=${offset}`), ADMIN);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(5);
      seen.push(...res.body.coupons.map((c: { id: string }) => c.id));
    }
    expect(seen).toEqual(['cpn-5', 'cpn-4', 'cpn-3', 'cpn-2', 'cpn-1']);
  });

  it('a coupon that only appears on the last page can still be deleted by id', async () => {
    const del = await as(request(app).delete('/api/v1/admin/coupons/cpn-1'), ADMIN);
    expect(del.status).toBe(200);
    const after = await as(request(app).get('/api/v1/admin/coupons'), ADMIN);
    expect(after.body.total).toBe(4);
    expect(after.body.coupons.map((c: { id: string }) => c.id)).not.toContain('cpn-1');
  });

  it('rejects invalid paging params with 400', async () => {
    const res = await as(request(app).get('/api/v1/admin/coupons?limit=nope'), ADMIN);
    expect(res.status).toBe(400);
  });
});

describe('paged admin staff (audit-2 fix 6)', () => {
  const { repo, app } = setup();

  it('pages tile the full set with the exact total (id breaks the created_at tie)', async () => {
    // The fake seeds 4 profiles sharing one createdAt; id asc orders them.
    const first = await as(request(app).get('/api/v1/admin/staff?limit=3&offset=0'), ADMIN);
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(4);
    expect(first.body.staff.map((p: { id: string }) => p.id)).toEqual(['admin-1', 'staff-1', 'user-1']);
    const rest = await as(request(app).get('/api/v1/admin/staff?limit=3&offset=3'), ADMIN);
    expect(rest.body.staff.map((p: { id: string }) => p.id)).toEqual(['user-2']);
    for (const p of [...first.body.staff, ...rest.body.staff]) expect(p.email).toContain('@');
  });

  it('role changes still reach accounts beyond the first page', async () => {
    const res = await as(request(app).patch('/api/v1/admin/staff/user-2/role').send({ role: 'staff' }), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.profile.role).toBe('staff');
  });

  it('repository contract: paged returns slice + total, unpaged returns everything', async () => {
    const page = await repo.adminListStaff({ limit: 2, offset: 2 });
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(2);
    expect(await repo.adminListStaff()).toHaveLength(4);
  });

  it('rejects invalid paging params with 400', async () => {
    const res = await as(request(app).get('/api/v1/admin/staff?offset=-1'), ADMIN);
    expect(res.status).toBe(400);
  });
});

describe('newsletter "new this week" server count (audit-2 fix 6)', () => {
  const { repo, app } = setup();
  for (let i = 0; i < 5; i++) repo.newsletter.add(`week${i}@example.com`);
  // The fake stamps every subscriber 2026-01-01T00:00:00Z, so the
  // since boundary can be tested exactly: at/before it counts all 5,
  // after it counts none — the total is the FILTERED count.

  it('since at or before the join date counts every subscriber', async () => {
    for (const since of ['2025-12-31T00:00:00.000Z', '2026-01-01T00:00:00.000Z']) {
      const res = await as(request(app).get(`/api/v1/admin/newsletter?limit=1&offset=0&since=${encodeURIComponent(since)}`), ADMIN);
      expect(res.status).toBe(200);
      expect(res.body.total, since).toBe(5);
      expect(res.body.subscribers).toHaveLength(1);
    }
  });

  it('since after the join date counts none — a true zero, not the page size', async () => {
    const res = await as(request(app).get('/api/v1/admin/newsletter?limit=1&offset=0&since=2026-01-02T00:00:00.000Z'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.subscribers).toEqual([]);
  });

  it('no since keeps the unfiltered total (backward compatible)', async () => {
    const res = await as(request(app).get('/api/v1/admin/newsletter?limit=2&offset=0'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.subscribers).toHaveLength(2);
  });

  it('rejects an unparseable since with 400', async () => {
    const res = await as(request(app).get('/api/v1/admin/newsletter?since=garbage'), ADMIN);
    expect(res.status).toBe(400);
  });

  it('repository contract: the paged overload filters by since', async () => {
    const page = await repo.adminListNewsletter({ limit: 1, offset: 0 }, '2026-01-02T00:00:00.000Z');
    expect(page.total).toBe(0);
    const all = await repo.adminListNewsletter({ limit: 1, offset: 0 }, '2025-12-31T00:00:00.000Z');
    expect(all.total).toBe(5);
  });
});

describe('newsletter CSV export past 1000 subscribers', () => {
  const { repo, app } = setup();
  for (let i = 0; i < 1005; i++) repo.newsletter.add(`sub${i}@example.com`);

  it('exports every subscriber, including the 1005th', async () => {
    const res = await as(request(app).get('/api/v1/admin/newsletter.csv'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.text).toContain('sub1004@example.com');
    expect(res.text.split('\n')).toHaveLength(1006); // header + 1005 rows
  });
});

import { auditCategoryOf } from '../src/lib/audit';
import { currencyExponent } from '../src/lib/currency';
import { ApiError } from '../src/lib/errors';
import { sanitizePermissionMap } from '../src/lib/permissions';
import { DEFAULT_SETTINGS, cloneSettings, sanitizeOpeningHours, sanitizeSiteLocations } from '../src/repositories/supabaseRepository';
import type {
  AdminReservationInput, AuditEventDTO, AuditEventFilter, AuditEventInput, AuditEventPage, CouponDTO, CreateOrderData, CustomerDTO, MenuItemDTO, NewsletterSubscriberDTO,
  OrderDTO, Page, PageParams, PartialPermissionMap, ProfileDTO, PublicSettingsDTO,
  Repository, ReservationDTO, ReservationInput, ReservationListFilter, ReservationRequestDTO, ReservationRequestListFilter, ReviewDTO,
} from '../src/repositories/types';

type FullMenuItem = MenuItemDTO & { isAvailable: boolean; sortOrder: number };

// The real repository's total order for its newest-first lists:
// created_at desc with the unique id as tiebreak, so paged scans tile
// exactly even when rows share a timestamp. Every fake list that
// mirrors a real paged scan sorts with this (or its ascending twin).
function byCreatedDescIdDesc(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  return (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
function byCreatedAscIdAsc(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  return (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export class FakeRepository implements Repository {
  menu: FullMenuItem[] = [
    { id: 1, name: 'Ember Classic', description: 'Beef patty', price: 24, image: 'img1', category: 'Burgers', tags: [], isAvailable: true, sortOrder: 0 },
    { id: 2, name: 'Forest Truffle Burger', description: 'Wagyu', price: 38, image: 'img2', category: 'Burgers', tags: ['Spicy'], isAvailable: true, sortOrder: 1 },
    { id: 3, name: 'Secret Special', description: 'Hidden', price: 50, image: 'img3', category: 'Pizza', tags: [], isAvailable: false, sortOrder: 2 },
  ];
  // Null simulates the missing restaurant_settings row (seed never ran):
  // reads fall back to DEFAULT_SETTINGS, exactly like the real repository.
  settings: PublicSettingsDTO | null = {
    kitchenOpen: true, waitMin: 20, waitMax: 30, currency: 'USD', restaurantName: 'Ember & Co.',
    phone: null, email: null, address: null, whatsappNumber: null, reservationSlotCapacity: 40,
    reservationFeeEnabled: false, reservationFeeAmount: 0, openingHours: {},
    siteLocations: {
      footer: { phone: null, email: null, address: null },
      contact: { phone: null, email: null, address: null, hours: null, mapLocation: null, mapLat: null, mapLng: null },
      reservation: { phone: null, address: null, hours: null, locationLabel: null },
    },
  };
  reviews: (ReviewDTO & { isApproved: boolean; userId?: string | null })[] = [
    { id: 'rev-1', name: 'Amélie Fontaine', rating: 5, comment: 'Wonderful.', country: 'France', createdAt: '2026-01-01T00:00:00Z', isApproved: true },
    { id: 'rev-2', name: 'Pending Pete', rating: 4, comment: 'Awaiting moderation.', country: null, createdAt: '2026-01-02T00:00:00Z', isApproved: false },
  ];
  // No mfaRequired key on the seeds: that is the PRE-0013 world, which
  // is what the real repository produces against a database where
  // migration 0013 has not run (the column is absent from select('*')
  // rows — see profileDTO's key-presence check) and is therefore the
  // fake's default, exactly as the pre-Phase-B suites assume. Tests
  // for the MFA system itself set the field explicitly: null is the
  // post-0013 "column exists, no per-person decision" state, and
  // true/false are the owner's decisions (mfa.test.ts opts in).
  profiles = new Map<string, ProfileDTO>([
    ['user-1', { id: 'user-1', role: 'customer', fullName: 'Test User', phone: null, addresses: [], favorites: [], permissions: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    ['admin-1', { id: 'admin-1', role: 'admin', fullName: 'Admin', phone: null, addresses: [], favorites: [], permissions: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    ['staff-1', { id: 'staff-1', role: 'staff', fullName: 'Staff', phone: null, addresses: [], favorites: [], permissions: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    ['manager-1', { id: 'manager-1', role: 'manager', fullName: 'Manager', phone: null, addresses: [], favorites: [], permissions: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    ['user-2', { id: 'user-2', role: 'customer', fullName: 'Second User', phone: null, addresses: [], favorites: [], permissions: null, createdAt: '2026-01-01T00:00:00.000Z' }],
  ]);
  /** Owner-edited role defaults (role_permissions rows); absent = built-ins. */
  rolePermissions = new Map<'manager' | 'staff', PartialPermissionMap>();
  /** audit_events rows, in insert order. */
  auditEvents: (AuditEventInput & { id: string; createdAt: string })[] = [];
  /**
   * False simulates the PRE-0012 world for the Phase C reads: the
   * audit_events table does not exist, so listAuditEvents answers the
   * degraded empty page exactly like the real repository (writes
   * through insertAuditEvent stay accepted-and-dropped either way —
   * the fake keeps them visible here so hook tests can assert them).
   */
  auditLogAvailable = true;
  reservations: ReservationDTO[] = [];
  /** reservation_requests rows (Phase G), in insert order. */
  reservationRequests: ReservationRequestDTO[] = [];
  /**
   * False simulates the PRE-0015 world: the reservation_requests
   * table does not exist, so request reads degrade (list → null,
   * inbox → degraded page) and creation resolves null, exactly like
   * the real repository.
   */
  reservationRequestsAvailable = true;
  /**
   * reservation id → fee payment intent id (Phase F). Mirrors the
   * reservations.fee_payment_intent_id column, which deliberately
   * does NOT ride on ReservationDTO (the same internal-only treatment
   * as orderIdempotencyKeys below).
   */
  reservationFeeIntentIds = new Map<string, string>();
  newsletter = new Set<string>();
  contactMessages: unknown[] = [];
  orders: OrderDTO[] = [];
  /** order id → idempotency key. Mirrors the real repository: the key is stored with the order but never exposed on the DTO. */
  orderIdempotencyKeys = new Map<string, string>();
  coupons: CouponDTO[] = [
    { id: 'cpn-1', code: 'WELCOME10', type: 'percent', value: 10, isActive: true, expiresAt: null },
    { id: 'cpn-2', code: 'OLD50', type: 'percent', value: 50, isActive: true, expiresAt: '2020-01-01T00:00:00Z' },
    { id: 'cpn-3', code: 'FIXED5', type: 'fixed', value: 5, isActive: true, expiresAt: null },
    { id: 'cpn-4', code: 'DISABLED20', type: 'percent', value: 20, isActive: false, expiresAt: null },
    { id: 'cpn-5', code: 'ALMOSTFREE', type: 'fixed', value: 24, isActive: true, expiresAt: null },
  ];
  private seq = 100;

  async listMenuItems() { return this.menu.filter((m) => m.isAvailable).map(({ isAvailable: _a, sortOrder: _s, ...dto }) => dto); }
  async listAllMenuItems() { return [...this.menu]; }
  async getMenuItem(id: number) {
    const found = this.menu.find((m) => m.id === id && m.isAvailable);
    return found ? (({ isAvailable: _a, sortOrder: _s, ...dto }) => dto)(found) : null;
  }
  async getMenuItemsByIds(ids: number[]) {
    // Mirrors the real batch lookup as ONE pass over the menu (the
    // real repository issues a single .in() query): the caller's id
    // order (duplicates included); missing/unavailable ids drop out.
    const byId = new Map(this.menu.filter((m) => m.isAvailable).map((m) =>
      (({ isAvailable: _a, sortOrder: _s, ...dto }) => [m.id, dto] as const)(m)));
    const out: MenuItemDTO[] = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (item) out.push(item);
    }
    return out;
  }
  async getSettings() {
    // Same isolation as the real repository: a fresh deep copy, with
    // site_locations sanitized on read exactly as the real repository
    // does (missing fields read as null, garbage reads as null).
    const copy = cloneSettings(this.settings ?? DEFAULT_SETTINGS);
    copy.siteLocations = sanitizeSiteLocations(copy.siteLocations);
    return copy;
  }
  async listApprovedReviews() {
    // Same order as the real repository: created_at desc, id desc.
    return this.reviews.filter((r) => r.isApproved)
      .sort((a, b) => byCreatedDescIdDesc(a, b))
      .map(({ isApproved: _a, ...dto }) => dto);
  }

  async getProfile(userId: string) { return this.profiles.get(userId) ?? null; }
  async upsertProfile(userId: string, data: { fullName?: string | null; phone?: string | null }) {
    const existing = this.profiles.get(userId);
    const profile: ProfileDTO = existing ?? { id: userId, role: 'customer', fullName: data.fullName ?? null, phone: data.phone ?? null, addresses: [], favorites: [], permissions: null, createdAt: new Date().toISOString() };
    if (data.fullName !== undefined) profile.fullName = data.fullName;
    if (data.phone !== undefined) profile.phone = data.phone;
    this.profiles.set(userId, profile);
    return profile;
  }
  async updateProfile(userId: string, patch: Partial<Pick<ProfileDTO, 'fullName' | 'phone' | 'addresses' | 'favorites'>>) {
    const profile = this.profiles.get(userId);
    if (!profile) throw new Error('profile not found');
    Object.assign(profile, patch);
    return profile;
  }
  async createReservation(input: ReservationInput): Promise<ReservationDTO> {
    const reservation: ReservationDTO = {
      userId: input.userId, name: input.name, email: input.email, phone: input.phone,
      date: input.date, time: input.time, guests: input.guests,
      id: `res-${++this.seq}`, status: 'pending', source: 'website', notes: null,
      // Mirror the real repository: a fee booking is born 'pending',
      // a free one carries no fee at all.
      feeAmount: input.fee?.amount ?? null,
      feeCurrency: input.fee?.currency ?? null,
      feePaymentStatus: input.fee ? 'pending' : 'none',
      createdAt: new Date().toISOString(),
    };
    this.reservations.push(reservation);
    return reservation;
  }
  async setReservationFeePaymentIntent(reservationId: string, paymentIntentId: string) {
    const reservation = this.reservations.find((r) => r.id === reservationId);
    // Mirror the real conditional write: only while the fee is pending.
    if (!reservation || reservation.feePaymentStatus !== 'pending') return false;
    this.reservationFeeIntentIds.set(reservationId, paymentIntentId);
    return true;
  }
  async markReservationFeePaidByPaymentIntent(paymentIntentId: string) {
    const reservation = this.reservations.find((r) => this.reservationFeeIntentIds.get(r.id) === paymentIntentId);
    if (!reservation) return null;
    // Same guards as the real repository: 'paid' from pending/failed, terminal.
    if (reservation.feePaymentStatus === 'pending' || reservation.feePaymentStatus === 'failed') {
      reservation.feePaymentStatus = 'paid';
    }
    return reservation;
  }
  async markReservationFeeFailedByPaymentIntent(paymentIntentId: string) {
    const reservation = this.reservations.find((r) => this.reservationFeeIntentIds.get(r.id) === paymentIntentId);
    if (!reservation) return null;
    // 'failed' from pending only — a late failure never un-pays a booking.
    if (reservation.feePaymentStatus === 'pending') {
      reservation.feePaymentStatus = 'failed';
    }
    return reservation;
  }
  async failReservationFee(reservationId: string) {
    const reservation = this.reservations.find((r) => r.id === reservationId);
    if (reservation && reservation.feePaymentStatus === 'pending') {
      reservation.feePaymentStatus = 'failed';
    }
  }
  async adminCreateReservation(input: AdminReservationInput): Promise<ReservationDTO> {
    const reservation: ReservationDTO = {
      userId: null, ...input, id: `res-${++this.seq}`, source: 'admin',
      feeAmount: null, feeCurrency: null, feePaymentStatus: 'none',
      createdAt: new Date().toISOString(),
    };
    this.reservations.push(reservation);
    return reservation;
  }
  async addNewsletterSubscriber(email: string) {
    if (this.newsletter.has(email)) return { alreadySubscribed: true };
    this.newsletter.add(email);
    return { alreadySubscribed: false };
  }
  async createContactMessage(input: { name: string; email: string; message: string }) { this.contactMessages.push(input); }
  async createReview(input: { userId: string | null; name: string; rating: number; comment: string; country?: string | null }): Promise<ReviewDTO> {
    const review = { id: `rev-${++this.seq}`, ...input, country: input.country ?? null, createdAt: new Date().toISOString(), isApproved: false };
    this.reviews.push(review);
    return { id: review.id, name: review.name, rating: review.rating, comment: review.comment, country: review.country, createdAt: review.createdAt };
  }
  async listOrdersForUser(userId: string) {
    // Mirrors the real repository: most recent first (created_at desc,
    // id desc tiebreak), capped at 100.
    return this.orders
      .filter((o) => o.userId === userId)
      .sort((a, b) => byCreatedDescIdDesc(a, b))
      .slice(0, 100);
  }

  async createOrder(data: CreateOrderData): Promise<OrderDTO> {
    // Same idempotency semantics as the Supabase repository: when a key is
    // provided, first write wins — a repeated key returns the original
    // order, even if the retry carries different items.
    if (data.idempotencyKey) {
      const existing = this.orders.find((o) => this.orderIdempotencyKeys.get(o.id) === data.idempotencyKey);
      if (existing) return existing;
    }
    const order: OrderDTO = {
      id: `order-${++this.seq}`,
      userId: data.userId, customerName: data.customerName, customerEmail: data.customerEmail,
      customerPhone: data.customerPhone, status: 'pending', paymentStatus: 'unpaid', paymentIntentId: null,
      currency: data.currency,
      subtotal: data.subtotal, deliveryFee: data.deliveryFee, discount: data.discount, total: data.total,
      couponCode: data.couponCode, address: data.address, notes: data.notes,
      items: data.items.map((i) => ({ menuItemId: i.menuItemId, name: i.name, unitPrice: i.unitPrice, quantity: i.quantity })),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    this.orders.push(order);
    if (data.idempotencyKey) this.orderIdempotencyKeys.set(order.id, data.idempotencyKey);
    return order;
  }
  async getOrderByIdempotencyKey(key: string) {
    return this.orders.find((o) => this.orderIdempotencyKeys.get(o.id) === key) ?? null;
  }
  async getOrder(id: string) { return this.orders.find((o) => o.id === id) ?? null; }
  async setOrderPaymentIntent(orderId: string, paymentIntentId: string) {
    const order = this.orders.find((o) => o.id === orderId);
    // Mirror the real repository's conditional write: the intent is
    // stored only while payment_status is unpaid/pending/failed and
    // the order is not cancelled, and the result reports whether it
    // was stored — false for a paid, refunded, cancelled or unknown
    // order — so the caller re-reads and answers for the order's
    // current state.
    const storable = !!order && order.status !== 'cancelled'
      && (order.paymentStatus === 'unpaid' || order.paymentStatus === 'pending' || order.paymentStatus === 'failed');
    if (!storable) return false;
    order.paymentIntentId = paymentIntentId; order.paymentStatus = 'pending';
    return true;
  }
  async markOrderPaidByPaymentIntent(paymentIntentId: string) {
    const order = this.orders.find((o) => o.paymentIntentId === paymentIntentId);
    if (!order) return null;
    // Same guarded transitions as the Supabase repository: 'paid' may be
    // set from unpaid/pending/failed and is terminal once set.
    if (order.paymentStatus === 'unpaid' || order.paymentStatus === 'pending' || order.paymentStatus === 'failed') {
      order.paymentStatus = 'paid';
    }
    return order;
  }
  async markOrderPaymentFailedByPaymentIntent(paymentIntentId: string) {
    const order = this.orders.find((o) => o.paymentIntentId === paymentIntentId);
    if (!order) return null;
    // 'failed' may be set from unpaid/pending only — a late failed event
    // must never un-pay an order.
    if (order.paymentStatus === 'unpaid' || order.paymentStatus === 'pending') {
      order.paymentStatus = 'failed';
    }
    return order;
  }
  async getCouponByCode(code: string) { return this.coupons.find((c) => c.code === code.toUpperCase()) ?? null; }

  async adminListOrders(status?: string): Promise<OrderDTO[]>;
  async adminListOrders(status: string | undefined, page: PageParams): Promise<Page<OrderDTO>>;
  async adminListOrders(status?: string, page?: PageParams): Promise<OrderDTO[] | Page<OrderDTO>> {
    const sorted = [...this.orders].sort((a, b) => byCreatedDescIdDesc(a, b));
    const filtered = status ? sorted.filter((o) => o.status === status) : sorted;
    // No page = the complete list (the fake has no 1000-row cap to hide).
    if (!page) return filtered;
    return { items: filtered.slice(page.offset, page.offset + page.limit), total: filtered.length };
  }
  async updateOrderStatus(orderId: string, expectedStatus: OrderDTO['status'], status: OrderDTO['status']) {
    const order = this.orders.find((o) => o.id === orderId);
    // Mirror the real conditional write: the predicate (still in the
    // expected status — and, for a cancel, still unpaid) must hold at
    // write time, else no row matches and the result is null.
    if (!order || order.status !== expectedStatus) return null;
    if (status === 'cancelled' && order.paymentStatus === 'paid') return null;
    order.status = status;
    order.updatedAt = new Date().toISOString();
    return order;
  }
  async createMenuItem(data: Omit<MenuItemDTO, 'id'> & { isAvailable: boolean; sortOrder: number }) {
    const item: FullMenuItem = { ...data, id: Math.max(0, ...this.menu.map((m) => m.id)) + 1 };
    this.menu.push(item);
    return item;
  }
  async updateMenuItem(id: number, patch: Partial<MenuItemDTO> & { isAvailable?: boolean; sortOrder?: number }) {
    const item = this.menu.find((m) => m.id === id);
    if (!item) return null;
    Object.assign(item, patch);
    return item;
  }
  async deleteMenuItem(id: number) {
    const before = this.menu.length;
    this.menu = this.menu.filter((m) => m.id !== id);
    return this.menu.length < before;
  }
  async adminListReservations(): Promise<ReservationDTO[]>;
  async adminListReservations(filter: ReservationListFilter, page: PageParams): Promise<Page<ReservationDTO>>;
  async adminListReservations(filter?: ReservationListFilter, page?: PageParams): Promise<ReservationDTO[] | Page<ReservationDTO>> {
    // Filters apply before ordering/paging, exactly like the real
    // repository: `total` is the FILTERED count and pages tile the
    // filtered set (audit-2 fix 3).
    const filtered = this.reservations.filter((r) =>
      (!filter?.date || r.date === filter.date) && (!filter?.status || r.status === filter.status));
    // Same deterministic order as the real repository: date desc,
    // time asc, created_at desc, id desc — so paged slices tile
    // without overlap.
    const sorted = [...filtered].sort((a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) ||
      (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    if (!page) return sorted;
    return { items: sorted.slice(page.offset, page.offset + page.limit), total: sorted.length };
  }
  async getReservation(id: string) { return this.reservations.find((r) => r.id === id) ?? null; }
  async updateReservationStatus(id: string, expectedStatus: ReservationDTO['status'], status: ReservationDTO['status']) {
    const r = this.reservations.find((x) => x.id === id);
    if (!r || r.status !== expectedStatus) return null;
    r.status = status;
    return r;
  }
  async adminUpdateReservation(id: string, patch: { date?: string; time?: string; guests?: number }) {
    const r = this.reservations.find((x) => x.id === id);
    if (!r) return null;
    if (patch.date !== undefined) r.date = patch.date;
    if (patch.time !== undefined) r.time = patch.time;
    if (patch.guests !== undefined) r.guests = patch.guests;
    return r;
  }
  async listReservationsForUser(userId: string, email: string | null) {
    // Mirror the real repository: linked by user_id OR email match
    // (trimmed, case-insensitive), de-duplicated, upcoming first
    // (date/time asc) then the past most-recent first.
    const mine = (email ?? '').trim().toLowerCase();
    const visible = this.reservations.filter((r) =>
      r.userId === userId || (!!mine && (r.email ?? '').trim().toLowerCase() === mine));
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = visible.filter((r) => r.date >= today)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) || byCreatedDescIdDesc(a, b));
    const past = visible.filter((r) => r.date < today)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.time < b.time ? 1 : a.time > b.time ? -1 : 0) || byCreatedDescIdDesc(a, b));
    const reservations = [...upcoming, ...past];
    if (!this.reservationRequestsAvailable) return { reservations, requests: null };
    const ids = new Set(reservations.map((r) => r.id));
    const requests = this.reservationRequests
      .filter((q) => ids.has(q.reservationId))
      .sort((a, b) => byCreatedDescIdDesc(a, b));
    return { reservations, requests };
  }
  async createReservationRequest(input: {
    reservationId: string; requesterUserId: string | null; requesterEmail: string | null;
    proposedDate: string | null; proposedTime: string | null; proposedGuests: number | null; message: string;
  }): Promise<ReservationRequestDTO | null> {
    if (!this.reservationRequestsAvailable) return null;
    // Mirror the real one-pending guard (friendly check; the partial
    // unique index is its database backstop).
    if (this.reservationRequests.some((q) => q.reservationId === input.reservationId && q.status === 'pending')) {
      throw new ApiError(409, 'A change request is already pending for this reservation — our team will answer that one first');
    }
    const now = new Date().toISOString();
    const created: ReservationRequestDTO = {
      id: `req-${++this.seq}`, ...input, status: 'pending',
      adminReply: null, handledBy: null, createdAt: now, updatedAt: now,
    };
    this.reservationRequests.push(created);
    return created;
  }
  async getReservationRequest(id: string) {
    if (!this.reservationRequestsAvailable) return null;
    return this.reservationRequests.find((q) => q.id === id) ?? null;
  }
  async adminListReservationRequests(filter: ReservationRequestListFilter, page: PageParams) {
    if (!this.reservationRequestsAvailable) return { items: [], total: 0, pendingTotal: 0, degraded: true };
    const pendingTotal = this.reservationRequests.filter((q) => q.status === 'pending').length;
    const filtered = this.reservationRequests
      .filter((q) => !filter.status || q.status === filter.status)
      .sort((a, b) => byCreatedDescIdDesc(a, b));
    const items = filtered.slice(page.offset, page.offset + page.limit)
      .map((q) => ({ ...q, reservation: this.reservations.find((r) => r.id === q.reservationId) ?? null }));
    return { items, total: filtered.length, pendingTotal, degraded: false };
  }
  async updateReservationRequest(id: string, patch: { status: 'approved' | 'declined' | 'handled'; adminReply?: string | null; handledBy: string }) {
    if (!this.reservationRequestsAvailable) return null;
    const q = this.reservationRequests.find((x) => x.id === id);
    // Mirror the real conditional write: only a pending request closes.
    if (!q || q.status !== 'pending') return null;
    q.status = patch.status;
    if (patch.adminReply !== undefined) q.adminReply = patch.adminReply;
    q.handledBy = patch.handledBy;
    q.updatedAt = new Date().toISOString();
    return q;
  }
  async adminListCustomers(): Promise<CustomerDTO[]>;
  async adminListCustomers(page: PageParams): Promise<Page<CustomerDTO>>;
  async adminListCustomers(page?: PageParams): Promise<CustomerDTO[] | Page<CustomerDTO>> {
    const settingsCurrency = (this.settings ?? DEFAULT_SETTINGS).currency;
    // Same rounding as the real repository: at the settings currency's
    // own ISO exponent (3dp for KWD/BHD/…), never a hardcoded 2dp — a
    // 2dp round here would hide exactly the storage-precision class of
    // bug migration 0011 fixes (audit-2 fix 5).
    const expFactor = 10 ** currencyExponent(settingsCurrency);
    const all = [...this.profiles.values()]
      .filter((p) => p.role === 'customer')
      // Same order as the real repository's profiles page:
      // created_at desc, id desc (the aggregation itself is a per-user
      // reduce — order-independent here, paged + ordered in the real
      // repository where the scan can actually drift).
      .sort((a, b) => byCreatedDescIdDesc(a, b))
      .map((p) => {
        const userOrders = this.orders.filter((o) => o.userId === p.id);
        return {
          ...p,
          email: `${p.id}@example.com`,
          orderCount: userOrders.length,
          totalSpent: Math.round(userOrders.filter((o) => o.paymentStatus === 'paid' && o.currency === settingsCurrency).reduce((sum, o) => sum + o.total, 0) * expFactor) / expFactor,
        };
      });
    if (!page) return all;
    return { items: all.slice(page.offset, page.offset + page.limit), total: all.length };
  }
  async adminListReviews(): Promise<(ReviewDTO & { isApproved: boolean })[]>;
  async adminListReviews(page: PageParams): Promise<Page<ReviewDTO & { isApproved: boolean }>>;
  async adminListReviews(page?: PageParams): Promise<(ReviewDTO & { isApproved: boolean })[] | Page<ReviewDTO & { isApproved: boolean }>> {
    const all = [...this.reviews]
      .sort((a, b) => byCreatedDescIdDesc(a, b))
      .map((r) => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, country: r.country, createdAt: r.createdAt, isApproved: r.isApproved }));
    // No page = the complete list (the fake has no 1000-row cap to hide).
    if (!page) return all;
    return { items: all.slice(page.offset, page.offset + page.limit), total: all.length };
  }
  async setReviewApproved(id: string, approved: boolean) {
    const r = this.reviews.find((x) => x.id === id);
    if (!r) return false;
    r.isApproved = approved;
    return true;
  }
  async deleteReview(id: string) {
    const before = this.reviews.length;
    this.reviews = this.reviews.filter((r) => r.id !== id);
    return this.reviews.length < before;
  }
  async adminListNewsletter(): Promise<NewsletterSubscriberDTO[]>;
  async adminListNewsletter(page: PageParams, since?: string): Promise<Page<NewsletterSubscriberDTO>>;
  async adminListNewsletter(page?: PageParams, since?: string): Promise<NewsletterSubscriberDTO[] | Page<NewsletterSubscriberDTO>> {
    // Mirrors the real repository's newest-first order: the fake's
    // subscribers all share one synthetic createdAt, so newest-first
    // is reverse subscription order. The `since` filter (applied before
    // paging, so the total is the filtered count) mirrors the real
    // repository's .gte('created_at', since).
    const all = [...this.newsletter]
      .map((email, i) => ({ id: `nl-${i}`, email, createdAt: '2026-01-01T00:00:00Z' }))
      .reverse()
      .filter((s) => !since || s.createdAt >= since);
    if (!page) return all;
    return { items: all.slice(page.offset, page.offset + page.limit), total: all.length };
  }
  async adminListCoupons(): Promise<CouponDTO[]>;
  async adminListCoupons(page: PageParams): Promise<Page<CouponDTO>>;
  async adminListCoupons(page?: PageParams): Promise<CouponDTO[] | Page<CouponDTO>> {
    // CouponDTO carries no createdAt; the fake's array is append-only
    // in creation order (seeds first, createCoupon pushes), so the
    // real repository's created_at desc / id desc order is reverse
    // array order here.
    const all = [...this.coupons].reverse();
    if (!page) return all;
    return { items: all.slice(page.offset, page.offset + page.limit), total: all.length };
  }
  async createCoupon(data: Omit<CouponDTO, 'id'>) {
    const code = data.code.toUpperCase();
    // Mirror the real repository: the coupons.code unique index makes a
    // duplicate write a 409 conflict, never a silent second coupon.
    if (this.coupons.some((c) => c.code === code)) {
      throw new ApiError(409, 'A coupon with this code already exists');
    }
    const coupon: CouponDTO = { ...data, id: `cpn-${++this.seq}`, code };
    this.coupons.push(coupon);
    return coupon;
  }
  async updateCoupon(id: string, patch: Partial<Omit<CouponDTO, 'id'>>) {
    const c = this.coupons.find((x) => x.id === id);
    if (!c) return null;
    if (patch.code) {
      const code = patch.code.toUpperCase();
      if (this.coupons.some((x) => x.id !== id && x.code === code)) {
        throw new ApiError(409, 'A coupon with this code already exists');
      }
    }
    Object.assign(c, patch);
    if (patch.code) c.code = patch.code.toUpperCase();
    return c;
  }
  async deleteCoupon(id: string) {
    const before = this.coupons.length;
    this.coupons = this.coupons.filter((c) => c.id !== id);
    return this.coupons.length < before;
  }
  async adminListStaff(): Promise<(ProfileDTO & { email: string | null })[]>;
  async adminListStaff(page: PageParams): Promise<Page<ProfileDTO & { email: string | null }>>;
  async adminListStaff(page?: PageParams): Promise<(ProfileDTO & { email: string | null })[] | Page<ProfileDTO & { email: string | null }>> {
    // Same order as the real repository's staff list:
    // created_at asc, id asc.
    const all = [...this.profiles.values()]
      .sort((a, b) => byCreatedAscIdAsc(a, b))
      .map((p) => ({ ...p, email: `${p.id}@example.com` }));
    if (!page) return all;
    return { items: all.slice(page.offset, page.offset + page.limit), total: all.length };
  }
  async updateProfileRole(userId: string, role: ProfileDTO['role']) {
    const p = this.profiles.get(userId);
    if (!p) return null;
    p.role = role;
    return p;
  }
  async getRolePermissions(role: 'manager' | 'staff') {
    const stored = this.rolePermissions.get(role);
    return stored ? { ...stored } : null;
  }
  async setRolePermissions(role: 'manager' | 'staff', permissions: PartialPermissionMap) {
    // Sanitised on write, like the real repository.
    this.rolePermissions.set(role, { ...(sanitizePermissionMap(permissions) ?? {}) });
  }
  async setUserPermissions(userId: string, permissions: PartialPermissionMap) {
    const p = this.profiles.get(userId);
    if (!p) return null;
    const clean = sanitizePermissionMap(permissions);
    p.permissions = clean && Object.keys(clean).length > 0 ? clean : null;
    return p;
  }
  async setUserMfaRequired(userId: string, required: boolean | null) {
    const p = this.profiles.get(userId);
    if (!p) return null;
    p.mfaRequired = required;
    return p;
  }
  async insertAuditEvent(event: AuditEventInput) {
    this.auditEvents.push({ ...event, id: `audit-${++this.seq}`, createdAt: new Date().toISOString() });
  }
  async listAuditEvents(filter: AuditEventFilter, page?: PageParams): Promise<AuditEventPage> {
    if (!this.auditLogAvailable) return { items: [], total: 0, degraded: true };
    // Same semantics as the real repository: filters before paging,
    // total = the FILTERED count, newest first (created_at desc,
    // id desc tiebreak).
    const q = filter.q?.toLowerCase();
    const filtered = this.auditEvents.filter((e) =>
      (!filter.category || auditCategoryOf(e.action) === filter.category) &&
      (!filter.actorId || e.actorId === filter.actorId) &&
      (!filter.action || e.action.startsWith(filter.action)) &&
      (!filter.from || e.createdAt >= filter.from) &&
      (!filter.to || e.createdAt <= filter.to) &&
      (!q || (e.actorLabel ?? '').toLowerCase().includes(q) ||
        (e.summary ?? '').toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q)));
    const sorted = [...filtered].sort((a, b) => byCreatedDescIdDesc(a, b));
    const items: AuditEventDTO[] = sorted.map((e) => ({ ...e }));
    if (!page) return { items, total: items.length, degraded: false };
    return { items: items.slice(page.offset, page.offset + page.limit), total: items.length, degraded: false };
  }
  async updateSettings(patch: Partial<PublicSettingsDTO>) {
    // Mirror the real repository: patching while the row is missing
    // creates the singleton (defaults + patch) — the save must persist,
    // never silently evaporate; the opening-hours patch is normalized
    // the same way; and callers receive a fresh copy, never a
    // reference into the stored object. One deliberate simplification:
    // the patch spread replaces siteLocations wholesale, where the
    // real repository merges it per group over the stored value (route
    // tests exercise the schema/route contract, not that merge).
    const normalized = patch.openingHours !== undefined
      ? { ...patch, openingHours: sanitizeOpeningHours(patch.openingHours) }
      : patch;
    this.settings = cloneSettings({ ...(this.settings ?? DEFAULT_SETTINGS), ...normalized });
    // The real updateSettings returns a fresh READ (sanitized) — mirror it.
    return this.getSettings();
  }
}

// The verified user's assurance level rides along like the real
// verifier's: plain tokens are aal1 (password only); appending
// '-aal2' to any known token yields the same user at aal2 (an MFA-
// verified session), which is how the MFA gate matrix is exercised.
export const fakeVerifyToken = async (token: string) => {
  const aal2 = token.endsWith('-aal2');
  const base = aal2 ? token.slice(0, -'-aal2'.length) : token;
  const aal = (aal2 ? 'aal2' : 'aal1') as 'aal1' | 'aal2';
  if (base === 'token-user') return { id: 'user-1', email: 'user@example.com', aal };
  if (base === 'token-admin') return { id: 'admin-1', email: 'admin@example.com', aal };
  if (base === 'token-staff') return { id: 'staff-1', email: 'staff@example.com', aal };
  if (base === 'token-manager') return { id: 'manager-1', email: 'manager@example.com', aal };
  if (base === 'token-user2') return { id: 'user-2', email: 'user2@example.com', aal };
  return null;
};

// A YYYY-MM-DD date `days` from today (UTC) — for fixtures that must
// stay in the future (or the past) no matter when the suite runs.
// Fixed calendar dates rot into the past and silently arm a time bomb
// in happy-path tests (audit-2 B-M4); a weeks-scale margin like +30
// cannot flake at a midnight boundary.
export function dateFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export function testEnv(overrides: Partial<import('../src/config/env').Env> = {}): import('../src/config/env').Env {
  return {
    nodeEnv: 'test', port: 0, corsOrigins: ['http://localhost:5173'],
    supabaseUrl: 'https://example.supabase.co', supabaseServiceRoleKey: 'service-key',
    supabaseConfigured: true, stripeSecretKey: 'sk_test_fake', stripeWebhookSecret: 'whsec_fake',
    stripeConfigured: true, geminiApiKey: null, geminiConfigured: false, geminiModel: null,
    trustProxy: undefined, siteUrl: 'https://embercoui.vercel.app', ...overrides,
  };
}

import { ApiError } from '../src/lib/errors';
import { DEFAULT_SETTINGS } from '../src/repositories/supabaseRepository';
import type {
  AdminReservationInput, CouponDTO, CreateOrderData, CustomerDTO, MenuItemDTO, NewsletterSubscriberDTO,
  OrderDTO, Page, PageParams, ProfileDTO, PublicSettingsDTO,
  Repository, ReservationDTO, ReservationInput, ReviewDTO,
} from '../src/repositories/types';

type FullMenuItem = MenuItemDTO & { isAvailable: boolean; sortOrder: number };

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
    phone: null, email: null, address: null, whatsappNumber: null, reservationSlotCapacity: 40, openingHours: {},
    siteLocations: {
      footer: { phone: null, email: null, address: null },
      contact: { phone: null, email: null, address: null, hours: null, mapLocation: null },
      reservation: { phone: null, address: null, hours: null, locationLabel: null },
    },
  };
  reviews: (ReviewDTO & { isApproved: boolean; userId?: string | null })[] = [
    { id: 'rev-1', name: 'Amélie Fontaine', rating: 5, comment: 'Wonderful.', country: 'France', createdAt: '2026-01-01T00:00:00Z', isApproved: true },
    { id: 'rev-2', name: 'Pending Pete', rating: 4, comment: 'Awaiting moderation.', country: null, createdAt: '2026-01-02T00:00:00Z', isApproved: false },
  ];
  profiles = new Map<string, ProfileDTO>([
    ['user-1', { id: 'user-1', role: 'customer', fullName: 'Test User', phone: null, addresses: [], favorites: [], createdAt: '2026-01-01T00:00:00.000Z' }],
    ['admin-1', { id: 'admin-1', role: 'admin', fullName: 'Admin', phone: null, addresses: [], favorites: [], createdAt: '2026-01-01T00:00:00.000Z' }],
    ['staff-1', { id: 'staff-1', role: 'staff', fullName: 'Staff', phone: null, addresses: [], favorites: [], createdAt: '2026-01-01T00:00:00.000Z' }],
    ['user-2', { id: 'user-2', role: 'customer', fullName: 'Second User', phone: null, addresses: [], favorites: [], createdAt: '2026-01-01T00:00:00.000Z' }],
  ]);
  reservations: ReservationDTO[] = [];
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
  async getSettings() { return { ...(this.settings ?? DEFAULT_SETTINGS) }; }
  async listApprovedReviews() { return this.reviews.filter((r) => r.isApproved).map(({ isApproved: _a, ...dto }) => dto); }

  async getProfile(userId: string) { return this.profiles.get(userId) ?? null; }
  async upsertProfile(userId: string, data: { fullName?: string | null; phone?: string | null }) {
    const existing = this.profiles.get(userId);
    const profile: ProfileDTO = existing ?? { id: userId, role: 'customer', fullName: data.fullName ?? null, phone: data.phone ?? null, addresses: [], favorites: [], createdAt: new Date().toISOString() };
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
    const reservation: ReservationDTO = { ...input, id: `res-${++this.seq}`, status: 'pending', source: 'website', notes: null, createdAt: new Date().toISOString() };
    this.reservations.push(reservation);
    return reservation;
  }
  async adminCreateReservation(input: AdminReservationInput): Promise<ReservationDTO> {
    const reservation: ReservationDTO = { userId: null, ...input, id: `res-${++this.seq}`, source: 'admin', createdAt: new Date().toISOString() };
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
    // Mirrors the real repository: most recent first, capped at 100.
    return this.orders
      .filter((o) => o.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
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
    const sorted = [...this.orders].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const filtered = status ? sorted.filter((o) => o.status === status) : sorted;
    // No page = the complete list (the fake has no 1000-row cap to hide).
    if (!page) return filtered;
    return { items: filtered.slice(page.offset, page.offset + page.limit), total: filtered.length };
  }
  async updateOrderStatus(orderId: string, status: OrderDTO['status']) {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) return null;
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
  async adminListReservations(page: PageParams): Promise<Page<ReservationDTO>>;
  async adminListReservations(page?: PageParams): Promise<ReservationDTO[] | Page<ReservationDTO>> {
    // Same deterministic order as the real repository: date desc,
    // time asc, created_at desc — so paged slices tile without overlap.
    const sorted = [...this.reservations].sort((a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) ||
      (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    if (!page) return sorted;
    return { items: sorted.slice(page.offset, page.offset + page.limit), total: sorted.length };
  }
  async getReservation(id: string) { return this.reservations.find((r) => r.id === id) ?? null; }
  async updateReservationStatus(id: string, status: ReservationDTO['status']) {
    const r = this.reservations.find((x) => x.id === id);
    if (!r) return null;
    r.status = status;
    return r;
  }
  async adminListCustomers(): Promise<CustomerDTO[]>;
  async adminListCustomers(page: PageParams): Promise<Page<CustomerDTO>>;
  async adminListCustomers(page?: PageParams): Promise<CustomerDTO[] | Page<CustomerDTO>> {
    const all = [...this.profiles.values()]
      .filter((p) => p.role === 'customer')
      .map((p) => {
        const userOrders = this.orders.filter((o) => o.userId === p.id);
        return {
          ...p,
          email: `${p.id}@example.com`,
          orderCount: userOrders.length,
          totalSpent: Math.round(userOrders.filter((o) => o.paymentStatus === 'paid' && o.currency === (this.settings ?? DEFAULT_SETTINGS).currency).reduce((sum, o) => sum + o.total, 0) * 100) / 100,
        };
      });
    if (!page) return all;
    return { items: all.slice(page.offset, page.offset + page.limit), total: all.length };
  }
  async adminListReviews() { return this.reviews.map((r) => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, country: r.country, createdAt: r.createdAt, isApproved: r.isApproved })); }
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
  async adminListNewsletter(page: PageParams): Promise<Page<NewsletterSubscriberDTO>>;
  async adminListNewsletter(page?: PageParams): Promise<NewsletterSubscriberDTO[] | Page<NewsletterSubscriberDTO>> {
    const all = [...this.newsletter].map((email, i) => ({ id: `nl-${i}`, email, createdAt: '2026-01-01T00:00:00Z' }));
    if (!page) return all;
    return { items: all.slice(page.offset, page.offset + page.limit), total: all.length };
  }
  async adminListCoupons() { return [...this.coupons]; }
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
  async adminListStaff() { return [...this.profiles.values()].map((p) => ({ ...p, email: `${p.id}@example.com` })); }
  async updateProfileRole(userId: string, role: ProfileDTO['role']) {
    const p = this.profiles.get(userId);
    if (!p) return null;
    p.role = role;
    return p;
  }
  async updateSettings(patch: Partial<PublicSettingsDTO>) {
    // Mirror the real repository: patching while the row is missing
    // creates the singleton (defaults + patch) — the save must persist,
    // never silently evaporate. One deliberate simplification: the
    // patch spread replaces siteLocations wholesale, where the real
    // repository merges it per group over the stored value (route tests
    // exercise the schema/route contract, not that merge).
    this.settings = { ...(this.settings ?? DEFAULT_SETTINGS), ...patch };
    return { ...this.settings };
  }
}

export const fakeVerifyToken = async (token: string) => {
  if (token === 'token-user') return { id: 'user-1', email: 'user@example.com' };
  if (token === 'token-admin') return { id: 'admin-1', email: 'admin@example.com' };
  if (token === 'token-staff') return { id: 'staff-1', email: 'staff@example.com' };
  if (token === 'token-user2') return { id: 'user-2', email: 'user2@example.com' };
  return null;
};

export function testEnv(overrides: Partial<import('../src/config/env').Env> = {}): import('../src/config/env').Env {
  return {
    nodeEnv: 'test', port: 0, corsOrigins: ['http://localhost:5173'],
    supabaseUrl: 'https://example.supabase.co', supabaseServiceRoleKey: 'service-key',
    supabaseConfigured: true, stripeSecretKey: 'sk_test_fake', stripeWebhookSecret: 'whsec_fake',
    stripeConfigured: true, geminiApiKey: null, geminiConfigured: false, geminiModel: null,
    trustProxy: undefined, ...overrides,
  };
}

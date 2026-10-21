import type {
  CouponDTO, CreateOrderData, MenuItemDTO, OrderDTO, ProfileDTO, PublicSettingsDTO,
  Repository, ReservationDTO, ReservationInput, ReviewDTO,
} from '../src/repositories/types';

type FullMenuItem = MenuItemDTO & { isAvailable: boolean; sortOrder: number };

export class FakeRepository implements Repository {
  menu: FullMenuItem[] = [
    { id: 1, name: 'Ember Classic', description: 'Beef patty', price: 24, image: 'img1', category: 'Burgers', tags: [], isAvailable: true, sortOrder: 0 },
    { id: 2, name: 'Forest Truffle Burger', description: 'Wagyu', price: 38, image: 'img2', category: 'Burgers', tags: ['Spicy'], isAvailable: true, sortOrder: 1 },
    { id: 3, name: 'Secret Special', description: 'Hidden', price: 50, image: 'img3', category: 'Pizza', tags: [], isAvailable: false, sortOrder: 2 },
  ];
  settings: PublicSettingsDTO = {
    kitchenOpen: true, waitMin: 20, waitMax: 30, currency: 'USD', restaurantName: 'Ember & Co.',
    phone: null, email: null, address: null, whatsappNumber: null, openingHours: {},
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
  async getSettings() { return { ...this.settings }; }
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
    const reservation: ReservationDTO = { ...input, id: `res-${++this.seq}`, status: 'pending', createdAt: new Date().toISOString() };
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
  async listOrdersForUser(userId: string) { return this.orders.filter((o) => o.userId === userId); }

  async createOrder(data: CreateOrderData): Promise<OrderDTO> {
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
    return order;
  }
  async getOrder(id: string) { return this.orders.find((o) => o.id === id) ?? null; }
  async setOrderPaymentIntent(orderId: string, paymentIntentId: string) {
    const order = this.orders.find((o) => o.id === orderId);
    if (order) { order.paymentIntentId = paymentIntentId; order.paymentStatus = 'pending'; }
  }
  async markOrderPaidByPaymentIntent(paymentIntentId: string) {
    const order = this.orders.find((o) => o.paymentIntentId === paymentIntentId);
    if (!order) return null;
    order.paymentStatus = 'paid';
    return order;
  }
  async markOrderPaymentFailedByPaymentIntent(paymentIntentId: string) {
    const order = this.orders.find((o) => o.paymentIntentId === paymentIntentId);
    if (order) order.paymentStatus = 'failed';
  }
  async getCouponByCode(code: string) { return this.coupons.find((c) => c.code === code.toUpperCase()) ?? null; }

  async adminListOrders(status?: string) {
    const sorted = [...this.orders].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return status ? sorted.filter((o) => o.status === status) : sorted;
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
  async adminListReservations() { return [...this.reservations]; }
  async updateReservationStatus(id: string, status: ReservationDTO['status']) {
    const r = this.reservations.find((x) => x.id === id);
    if (!r) return null;
    r.status = status;
    return r;
  }
  async adminListCustomers() {
    return [...this.profiles.values()]
      .filter((p) => p.role === 'customer')
      .map((p) => {
        const userOrders = this.orders.filter((o) => o.userId === p.id);
        return {
          ...p,
          email: `${p.id}@example.com`,
          orderCount: userOrders.length,
          totalSpent: Math.round(userOrders.filter((o) => o.paymentStatus === 'paid' && o.currency === this.settings.currency).reduce((sum, o) => sum + o.total, 0) * 100) / 100,
        };
      });
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
  async adminListNewsletter() {
    return [...this.newsletter].map((email, i) => ({ id: `nl-${i}`, email, createdAt: '2026-01-01T00:00:00Z' }));
  }
  async adminListCoupons() { return [...this.coupons]; }
  async createCoupon(data: Omit<CouponDTO, 'id'>) {
    const coupon: CouponDTO = { ...data, id: `cpn-${++this.seq}`, code: data.code.toUpperCase() };
    this.coupons.push(coupon);
    return coupon;
  }
  async updateCoupon(id: string, patch: Partial<Omit<CouponDTO, 'id'>>) {
    const c = this.coupons.find((x) => x.id === id);
    if (!c) return null;
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
    Object.assign(this.settings, patch);
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
    stripeConfigured: true, geminiApiKey: null, geminiConfigured: false, geminiModel: null, ...overrides,
  };
}

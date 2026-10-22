export interface MenuItemDTO {
  id: number;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  tags: string[];
}

/**
 * Per-location contact overrides for the public website (migration
 * 0010). Each location on the site — footer, contact page, reservation
 * section — can carry its own contact details; a null field means "fall
 * back to the global Restaurant profile field". Stored as one
 * `site_locations` JSONB column on the settings singleton.
 */
export interface FooterContacts {
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface ContactContacts {
  phone: string | null;
  email: string | null;
  address: string | null;
  hours: string | null;
  /** Free-text place/address used for the map embed and the directions link. */
  mapLocation: string | null;
  /**
   * Exact map pin chosen in the admin map picker. Always both-or-neither:
   * a set pair outranks `mapLocation` for the Contact page map; both null
   * means "no pin — fall back to the text fields", exactly as before.
   */
  mapLat: number | null;
  mapLng: number | null;
}

export interface ReservationContacts {
  phone: string | null;
  address: string | null;
  hours: string | null;
  /** Small line under "Book Your Table" (e.g. the neighbourhood/city). */
  locationLabel: string | null;
}

export interface SiteLocations {
  footer: FooterContacts;
  contact: ContactContacts;
  reservation: ReservationContacts;
}

/** A settings PATCH may carry a partial siteLocations — groups/fields merged server-side. */
export type SiteLocationsPatch = {
  footer?: Partial<FooterContacts>;
  contact?: Partial<ContactContacts>;
  reservation?: Partial<ReservationContacts>;
};

export type SettingsPatch = Partial<Omit<PublicSettingsDTO, 'siteLocations'>> & {
  siteLocations?: SiteLocationsPatch;
};

export interface PublicSettingsDTO {
  kitchenOpen: boolean;
  waitMin: number;
  waitMax: number;
  /** ISO 4217 uppercase code — the currency the restaurant currently trades in. */
  currency: string;
  restaurantName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** Digits (with country code) for the site's floating WhatsApp button; null hides the button. */
  whatsappNumber: string | null;
  /** Guests that fit in one reservation time slot; drives the admin day board. */
  reservationSlotCapacity: number;
  openingHours: Record<string, unknown>;
  /** Per-location contact overrides (migration 0010); see SiteLocations. */
  siteLocations: SiteLocations;
}

export interface ReviewDTO {
  id: string;
  name: string;
  rating: number;
  comment: string;
  country: string | null;
  createdAt: string;
}

export interface ProfileDTO {
  id: string;
  role: 'customer' | 'admin' | 'staff';
  fullName: string | null;
  phone: string | null;
  addresses: unknown[];
  favorites: number[];
  createdAt: string;
}

export type StaffDTO = ProfileDTO & { email: string | null };

export type CustomerDTO = ProfileDTO & { email: string | null; orderCount: number; totalSpent: number };

export interface NewsletterSubscriberDTO {
  id: string;
  email: string;
  createdAt: string;
}

/**
 * Paging for the admin list methods (audit Fix 9). PostgREST silently
 * caps every response at 1000 rows, so list methods take an optional
 * page: WITH a page they return one slice plus the exact total; WITHOUT
 * one they return the COMPLETE list (fetching every page internally) —
 * the unpaged form is what aggregations (dashboard, finance, CSV export)
 * must use so their numbers never truncate at scale.
 */
export interface PageParams {
  limit: number;
  offset: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface ReservationInput {
  userId: string | null;
  name: string;
  email: string;
  phone: string;
  date: string;
  time: string;
  guests: number;
}

/** A booking created from the admin panel (walk-in / phone) — email is optional there. */
export interface AdminReservationInput {
  name: string;
  email: string | null;
  phone: string;
  date: string;
  time: string;
  guests: number;
  notes: string | null;
  status: 'pending' | 'confirmed';
}

export interface ReservationDTO extends Omit<ReservationInput, 'email'> {
  id: string;
  email: string | null;
  /** 'website' = public form, 'admin' = created from the admin panel. */
  source: 'website' | 'admin';
  notes: string | null;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  createdAt: string;
}

/**
 * Optional filters for the paged admin reservations list (audit-2 fix 3):
 * `date` pins the list to one calendar day (YYYY-MM-DD) so the day board
 * can page through that date's COMPLETE set instead of deriving board
 * numbers from the newest-100 window; `status` lets stat chips read an
 * exact filtered total from a limit=1 request.
 */
export interface ReservationListFilter {
  date?: string;
  status?: ReservationDTO['status'];
}

export interface OrderItemInput {
  menuItemId: number;
  quantity: number;
}

export interface OrderItemDTO {
  menuItemId: number | null;
  name: string;
  unitPrice: number;
  quantity: number;
}

export type OrderStatus =
  | 'pending' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'refunded' | 'failed';

export interface OrderDTO {
  id: string;
  userId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentIntentId: string | null;
  /** ISO 4217 code snapshotted from the settings when the order was placed. */
  currency: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  couponCode: string | null;
  address: Record<string, unknown> | null;
  notes: string | null;
  items: OrderItemDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderData {
  userId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  address: Record<string, unknown> | null;
  notes: string | null;
  couponCode: string | null;
  /**
   * Per-checkout-attempt idempotency key (migration 0006). When present,
   * createOrder returns the ORIGINAL order for a repeated key instead of
   * creating a duplicate — first write wins. Internal only: the key is
   * never copied onto OrderDTO.
   */
  idempotencyKey?: string | null;
  /** ISO 4217 code the order's money amounts are denominated in. */
  currency: string;
  items: { menuItemId: number; name: string; unitPrice: number; quantity: number }[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
}

export interface CouponDTO {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  isActive: boolean;
  expiresAt: string | null;
}

/**
 * Data layer contract. The production implementation talks to Supabase
 * Postgres with the service-role key; tests substitute an in-memory fake.
 * Methods throw on infrastructure errors; routes translate to HTTP.
 */
export interface Repository {
  // Public (Phase 1)
  listMenuItems(): Promise<MenuItemDTO[]>;
  listAllMenuItems(): Promise<(MenuItemDTO & { isAvailable: boolean; sortOrder: number })[]>;
  getMenuItem(id: number): Promise<MenuItemDTO | null>;
  /** Batch form of getMenuItem for id lists (account favorites): one
   * lookup for the whole list, available dishes only, returned in the
   * caller's id order (duplicates in the input are preserved). */
  getMenuItemsByIds(ids: number[]): Promise<MenuItemDTO[]>;
  getSettings(): Promise<PublicSettingsDTO>;
  listApprovedReviews(): Promise<ReviewDTO[]>;

  // Accounts (Phase 2)
  getProfile(userId: string): Promise<ProfileDTO | null>;
  upsertProfile(userId: string, data: { fullName?: string | null; phone?: string | null }): Promise<ProfileDTO>;
  updateProfile(userId: string, patch: Partial<Pick<ProfileDTO, 'fullName' | 'phone' | 'addresses' | 'favorites'>>): Promise<ProfileDTO>;
  createReservation(input: ReservationInput): Promise<ReservationDTO>;
  addNewsletterSubscriber(email: string): Promise<{ alreadySubscribed: boolean }>;
  createContactMessage(input: { name: string; email: string; phone?: string; subject?: string; message: string }): Promise<void>;
  createReview(input: { userId: string | null; name: string; rating: number; comment: string; country?: string | null }): Promise<ReviewDTO>;
  listOrdersForUser(userId: string): Promise<OrderDTO[]>;

  // Orders & payments (Phase 3)
  createOrder(data: CreateOrderData): Promise<OrderDTO>;
  getOrder(id: string): Promise<OrderDTO | null>;
  /** The stored order for a checkout idempotency key, or null when the
   * key has not created one (or the key column is unavailable). Routes
   * consult this BEFORE the kitchen-open gate so a legitimate retry is
   * answered from the stored order even after closing time. */
  getOrderByIdempotencyKey(key: string): Promise<OrderDTO | null>;
  /**
   * Store the order's live payment intent. CONDITIONAL in every
   * implementation: it applies only while payment_status is
   * unpaid/pending/failed and the order is not cancelled, so it can
   * never regress a paid order back to 'pending', move a paid (or
   * refunded) order's intent pointer, or arm a cancelled order. Resolves true when the intent was stored; false when the
   * write matched nothing (order gone, or its state moved on since
   * the caller read it) — the caller must then re-read the order and
   * answer for its current state, never hand out a client secret for
   * an intent that was never stored.
   */
  setOrderPaymentIntent(orderId: string, paymentIntentId: string): Promise<boolean>;
  /**
   * Payment-state transitions are GUARDED in every implementation:
   * 'paid' is terminal; 'paid' may be set from unpaid/pending/failed;
   * 'failed' may be set from unpaid/pending only. Return the order, or
   * null when no order references the intent.
   */
  markOrderPaidByPaymentIntent(paymentIntentId: string): Promise<OrderDTO | null>;
  markOrderPaymentFailedByPaymentIntent(paymentIntentId: string): Promise<OrderDTO | null>;
  getCouponByCode(code: string): Promise<CouponDTO | null>;

  // Admin (Phase 4)
  adminListOrders(status?: string): Promise<OrderDTO[]>;
  adminListOrders(status: string | undefined, page: PageParams): Promise<Page<OrderDTO>>;
  /**
   * CONDITIONAL status transition: the write applies only while the
   * order's status is still `expectedStatus` (the status the caller
   * read and validated the transition against). A cancellation
   * additionally refuses a paid order at the data layer, closing the
   * read→webhook race in the route's refund guard. Resolves the
   * updated order, or null when no row matched — the order is gone or
   * its state moved on, and the caller must re-read and answer for the
   * current state (the admin routes answer 409).
   */
  updateOrderStatus(orderId: string, expectedStatus: OrderStatus, status: OrderStatus): Promise<OrderDTO | null>;
  createMenuItem(data: Omit<MenuItemDTO, 'id'> & { isAvailable: boolean; sortOrder: number }): Promise<MenuItemDTO & { isAvailable: boolean; sortOrder: number }>;
  updateMenuItem(id: number, patch: Partial<MenuItemDTO> & { isAvailable?: boolean; sortOrder?: number }): Promise<(MenuItemDTO & { isAvailable: boolean; sortOrder: number }) | null>;
  deleteMenuItem(id: number): Promise<boolean>;
  adminListReservations(): Promise<ReservationDTO[]>;
  adminListReservations(filter: ReservationListFilter): Promise<ReservationDTO[]>;
  adminListReservations(filter: ReservationListFilter, page: PageParams): Promise<Page<ReservationDTO>>;
  getReservation(id: string): Promise<ReservationDTO | null>;
  adminCreateReservation(input: AdminReservationInput): Promise<ReservationDTO>;
  /** Conditional twin of updateOrderStatus: applies only while the
   * reservation's status is still `expectedStatus`; null on no match. */
  updateReservationStatus(id: string, expectedStatus: ReservationDTO['status'], status: ReservationDTO['status']): Promise<ReservationDTO | null>;
  adminListCustomers(): Promise<CustomerDTO[]>;
  adminListCustomers(page: PageParams): Promise<Page<CustomerDTO>>;
  adminListReviews(): Promise<(ReviewDTO & { isApproved: boolean })[]>;
  adminListReviews(page: PageParams): Promise<Page<ReviewDTO & { isApproved: boolean }>>;
  setReviewApproved(id: string, approved: boolean): Promise<boolean>;
  deleteReview(id: string): Promise<boolean>;
  adminListNewsletter(): Promise<NewsletterSubscriberDTO[]>;
  adminListNewsletter(page: PageParams, since?: string): Promise<Page<NewsletterSubscriberDTO>>;
  adminListCoupons(): Promise<CouponDTO[]>;
  adminListCoupons(page: PageParams): Promise<Page<CouponDTO>>;
  createCoupon(data: Omit<CouponDTO, 'id'>): Promise<CouponDTO>;
  updateCoupon(id: string, patch: Partial<Omit<CouponDTO, 'id'>>): Promise<CouponDTO | null>;
  deleteCoupon(id: string): Promise<boolean>;
  adminListStaff(): Promise<StaffDTO[]>;
  adminListStaff(page: PageParams): Promise<Page<StaffDTO>>;
  updateProfileRole(userId: string, role: ProfileDTO['role']): Promise<ProfileDTO | null>;
  updateSettings(patch: SettingsPatch): Promise<PublicSettingsDTO>;
}

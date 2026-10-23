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
  /**
   * The owner's reservation-fee controls (migration 0014): the RAW
   * toggle and amount, exactly as stored. These two fields are NOT
   * the fee a guest pays — the effective fee (lib/reservationFee.ts)
   * additionally requires a configured card provider, and every
   * charging/display surface consumes that computation, never these.
   * The public settings response strips both and exposes only the
   * effective fee.
   */
  reservationFeeEnabled: boolean;
  /** Flat per reservation, in `currency`. 0 = no fee even when enabled. */
  reservationFeeAmount: number;
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

export type UserRole = 'customer' | 'admin' | 'staff' | 'manager';

/**
 * Section permissions (Phase A; the full model lives in
 * lib/permissions.ts). Twelve admin sections, three levels each.
 */
export type SectionKey =
  | 'dashboard' | 'orders' | 'reservations' | 'menu' | 'customers' | 'reviews'
  | 'newsletter' | 'coupons' | 'finance' | 'staff' | 'settings' | 'security';

export type PermissionLevel = 'none' | 'view' | 'manage';

/** A complete effective map — every section resolved to a level. */
export type PermissionMap = Record<SectionKey, PermissionLevel>;

/** A stored map (role defaults row or per-person overrides): sparse. */
export type PartialPermissionMap = Partial<Record<SectionKey, PermissionLevel>>;

/** One audit_events row as written by lib/audit.ts. */
export interface AuditEventInput {
  actorId: string | null;
  actorLabel: string | null;
  actorRole: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  ip: string | null;
  userAgent: string | null;
}

/** One audit_events row as read back for the Security & Activity API (Phase C). */
export interface AuditEventDTO {
  id: string;
  createdAt: string;
  actorId: string | null;
  /** The actor's display label as recorded at write time (name, else email). */
  actorLabel: string | null;
  actorRole: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Filters for the Security & Activity reads. `category` is the
 * lib/audit.ts taxonomy ('auth' = the `auth.` action prefix);
 * `action` is a PREFIX match (the full action string is a prefix of
 * itself, so exact lookups work too); `q` is a case-insensitive
 * substring over the actor label, the summary and the action.
 */
export interface AuditEventFilter {
  category?: 'auth' | 'change';
  actorId?: string;
  action?: string;
  /** Inclusive ISO timestamp lower bound on created_at. */
  from?: string;
  /** Inclusive ISO timestamp upper bound on created_at. */
  to?: string;
  q?: string;
}

export interface AuditEventPage extends Page<AuditEventDTO> {
  /**
   * True when the audit_events table does not exist yet (migration
   * 0012 not run): the page is empty because logging is not active —
   * the UI says so honestly instead of implying nothing happened.
   */
  degraded: boolean;
}

export interface ProfileDTO {
  id: string;
  role: UserRole;
  fullName: string | null;
  phone: string | null;
  addresses: unknown[];
  favorites: number[];
  /** Per-person permission overrides (migration 0012); null = none set. */
  permissions: PartialPermissionMap | null;
  /**
   * The owner's per-person two-factor decision (migration 0013):
   * true/false = explicit, null = follow the role default. The field
   * is ABSENT (undefined) only in the pre-0013 world, where profiles
   * are read without the column — lib/mfa.ts treats that as "the
   * requirement system is not in force yet" and enforcement stays off.
   */
  mfaRequired?: boolean | null;
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
  /**
   * The EFFECTIVE fee for this booking (lib/reservationFee.ts), when
   * one applies: the row is created already owing it (fee state
   * 'pending') and the route then mints + conditionally stores the
   * Stripe intent. Absent/null = a free booking, stored exactly as
   * before migration 0014.
   */
  fee?: { amount: number; currency: string } | null;
}

/**
 * A booking's fee lifecycle (migration 0014). 'none' = the booking
 * carries no fee; 'pending' = an intent exists but is unpaid (the
 * booking holds NO seats); 'paid' = the webhook settled it (the
 * booking holds seats); 'failed' = payment failed (no seats).
 */
export type ReservationFeePaymentStatus = 'none' | 'pending' | 'paid' | 'failed';

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

export interface ReservationDTO extends Omit<ReservationInput, 'email' | 'fee'> {
  id: string;
  email: string | null;
  /** 'website' = public form, 'admin' = created from the admin panel. */
  source: 'website' | 'admin';
  notes: string | null;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  /** The fee snapshotted at booking (migration 0014); null = no fee. */
  feeAmount: number | null;
  /** The settings currency at booking time; null when there is no fee. */
  feeCurrency: string | null;
  feePaymentStatus: ReservationFeePaymentStatus;
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

/**
 * A customer's request to change one of their reservations
 * (migration 0015, Phase G). Every part of the proposal is optional —
 * a request may be a bare message — and the row is born 'pending'.
 * The handling admin closes it exactly once: 'approved' (only ever
 * as part of saving the reservation edit it asked for), 'declined'
 * (with a reply) or 'handled' (resolved without an edit, e.g. by
 * phone). The customer reads status + reply back in their account.
 */
export type ReservationRequestStatus = 'pending' | 'approved' | 'declined' | 'handled';

export interface ReservationRequestDTO {
  id: string;
  reservationId: string;
  /** The account that sent the request; null if that account is gone. */
  requesterUserId: string | null;
  /** The account's email at send time (the inbox's contact snapshot). */
  requesterEmail: string | null;
  proposedDate: string | null;
  proposedTime: string | null;
  proposedGuests: number | null;
  /** The customer's note; '' when they only proposed new values. */
  message: string;
  status: ReservationRequestStatus;
  /** The team's answer, shown to the customer; null = no reply given. */
  adminReply: string | null;
  /** The privileged profile that closed the request. */
  handledBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationRequestInput {
  reservationId: string;
  requesterUserId: string | null;
  requesterEmail: string | null;
  proposedDate: string | null;
  proposedTime: string | null;
  proposedGuests: number | null;
  message: string;
}

/** The account page's view of one of the customer's reservations. */
export interface AccountReservationDTO extends ReservationDTO {
  /** All of this booking's change requests, newest first. */
  requests: ReservationRequestDTO[];
}

/** A change request with the booking it refers to (admin inbox row). */
export interface ReservationRequestWithContext extends ReservationRequestDTO {
  reservation: ReservationDTO | null;
}

export interface ReservationRequestListFilter {
  status?: ReservationRequestStatus;
}

export interface ReservationRequestInboxPage {
  items: ReservationRequestWithContext[];
  /** The filtered set's exact total (the page tiles this set). */
  total: number;
  /** The exact count of requests still awaiting a decision — the badge. */
  pendingTotal: number;
  /**
   * True BEFORE migration 0015 runs: the table does not exist, the
   * inbox is empty because there is nowhere for requests to live —
   * flagged, never faked.
   */
  degraded: boolean;
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
  /**
   * Store a fee booking's Stripe intent. CONDITIONAL twin of
   * setOrderPaymentIntent: it applies only while the booking's fee is
   * still 'pending', so it can never move the pointer on a paid or
   * failed booking. Resolves true when stored; false when no row
   * matched — the caller re-reads and answers for the current state.
   */
  setReservationFeePaymentIntent(reservationId: string, paymentIntentId: string): Promise<boolean>;
  /**
   * Fee payment transitions, guarded exactly like the order pair:
   * 'paid' may be set from pending/failed and is terminal; 'failed'
   * may be set from pending only (a late failure never un-pays a
   * booking). 'paid' additionally requires the booking NOT be
   * cancelled (mega-audit M1 analogue, same guarded statement).
   * Return the reservation, or null when no reservation
   * references the intent (a foreign intent — the webhook acks and
   * leaves everything untouched).
   */
  markReservationFeePaidByPaymentIntent(paymentIntentId: string): Promise<ReservationDTO | null>;
  markReservationFeeFailedByPaymentIntent(paymentIntentId: string): Promise<ReservationDTO | null>;
  /**
   * Best-effort compensation when fee SETUP fails after the booking
   * row exists (the intent could not be minted or stored): the fee
   * flips 'pending' → 'failed' so the row is honest — it holds no
   * seats and staff see "Fee failed", never a phantom "awaiting
   * payment" for a charge that can never complete.
   */
  failReservationFee(reservationId: string): Promise<void>;
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
   * 'paid' is terminal; 'paid' may be set from unpaid/pending/failed
   * AND only while the order is not cancelled (mega-audit M1 — the
   * status condition rides the same UPDATE, never a read-then-write);
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
  /**
   * Edit a booking's date/time/guests (Phase G — the Apply flow's
   * save). Only the fields present in the patch move; null when no
   * reservation has the id (a malformed id counts as no match).
   */
  adminUpdateReservation(id: string, patch: { date?: string; time?: string; guests?: number }): Promise<ReservationDTO | null>;
  /**
   * The signed-in customer's reservations (Phase G): the ones linked
   * to their account PLUS guest bookings whose email matches the
   * account's email (case-insensitive, trimmed — the caller passes
   * the verified account email; matching happens here, server-side,
   * so no other customer's booking can ever surface). Sorted
   * upcoming first (date asc, then time asc), then past bookings
   * most-recent first. `requests` rides along for exactly those
   * reservations — and is NULL before migration 0015 runs, the
   * degradation signal the account route turns into an honest
   * "change requests not available yet" state (the reservations
   * themselves read exactly as before).
   */
  listReservationsForUser(userId: string, email: string | null): Promise<{ reservations: ReservationDTO[]; requests: ReservationRequestDTO[] | null }>;
  /**
   * Create a change request (Phase G). At most one PENDING request
   * per reservation: a second one is the caller's conflict — an
   * ApiError(409), whether the pre-check or the partial unique index
   * (migration 0015) catches it. Resolves null BEFORE 0015 runs (the
   * route answers an honest 503 — no fake success).
   */
  createReservationRequest(input: ReservationRequestInput): Promise<ReservationRequestDTO | null>;
  /** One request by id; null when absent (or pre-0015) — never a throw for a malformed id. */
  getReservationRequest(id: string): Promise<ReservationRequestDTO | null>;
  /**
   * The admin Requests inbox (Phase G): one page of the filtered
   * set, newest first, each request joined with its reservation,
   * plus the exact pending total for the badge. Pre-0015 the page
   * is empty and flagged degraded.
   */
  adminListReservationRequests(filter: ReservationRequestListFilter, page: PageParams): Promise<ReservationRequestInboxPage>;
  /**
   * Close a request. CONDITIONAL like every guarded write in this
   * interface: the update applies only while the request is still
   * 'pending', so a request is closed exactly once — null when it
   * was already handled (or does not exist, or pre-0015).
   */
  updateReservationRequest(id: string, patch: { status: Exclude<ReservationRequestStatus, 'pending'>; adminReply?: string | null; handledBy: string }): Promise<ReservationRequestDTO | null>;
  adminListCustomers(): Promise<CustomerDTO[]>;
  adminListCustomers(page: PageParams): Promise<Page<CustomerDTO>>;
  adminListReviews(): Promise<(ReviewDTO & { isApproved: boolean })[]>;
  adminListReviews(page: PageParams): Promise<Page<ReviewDTO & { isApproved: boolean }>>;
  /** One review by id (the moderation handlers' pre-write snapshot read). */
  getReview(id: string): Promise<(ReviewDTO & { isApproved: boolean }) | null>;
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
  updateProfileRole(userId: string, role: UserRole): Promise<ProfileDTO | null>;
  /**
   * Access control (migration 0012). All four degrade gracefully BEFORE
   * the migration runs: reads return null (→ built-in defaults apply),
   * writes become no-ops, audit inserts are dropped — never a throw for
   * a missing table/column.
   */
  getRolePermissions(role: 'manager' | 'staff'): Promise<PartialPermissionMap | null>;
  setRolePermissions(role: 'manager' | 'staff', permissions: PartialPermissionMap): Promise<void>;
  /** Stores the person's overrides; an empty map clears them (NULL). */
  setUserPermissions(userId: string, permissions: PartialPermissionMap): Promise<ProfileDTO | null>;
  /**
   * Stores the person's explicit two-factor requirement (migration
   * 0013); null clears it back to the role default. Degrades like the
   * other access-control writes BEFORE 0013 runs: a no-op that returns
   * the profile as it actually stands.
   */
  setUserMfaRequired(userId: string, required: boolean | null): Promise<ProfileDTO | null>;
  insertAuditEvent(event: AuditEventInput): Promise<void>;
  /**
   * Security & Activity reads (Phase C). With a page: that slice of
   * the filtered set plus its exact total. Without: the complete
   * filtered set (the CSV export). There is deliberately NO update or
   * delete for audit rows anywhere in this interface — the log is
   * append-only, for every role including the owner.
   */
  listAuditEvents(filter: AuditEventFilter, page: PageParams): Promise<AuditEventPage>;
  listAuditEvents(filter: AuditEventFilter): Promise<AuditEventPage>;
  updateSettings(patch: SettingsPatch): Promise<PublicSettingsDTO>;
}

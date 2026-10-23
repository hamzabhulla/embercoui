import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { currencyExponent, sanitizeCurrencyCode } from '../lib/currency';
import { ApiError } from '../lib/errors';
import { sanitizePermissionMap } from '../lib/permissions';
import type {
  AdminReservationInput, AuditEventDTO, AuditEventFilter, AuditEventInput, AuditEventPage, CouponDTO, CreateOrderData, CustomerDTO, MenuItemDTO, NewsletterSubscriberDTO,
  OrderDTO, Page, PageParams, PartialPermissionMap, ProfileDTO, PublicSettingsDTO, ReservationDTO, ReservationInput,
  Repository, ReservationListFilter, ReservationRequestDTO, ReviewDTO, SettingsPatch, SiteLocations, StaffDTO,
} from './types';

type Row = Record<string, unknown>;

// PostgREST caps every response at 1000 rows. "Fetch everything" callers
// (dashboard/finance aggregation, CSV export, unpaged list methods) page
// through in chunks of this size instead of trusting one response.
const ALL_PAGE_SIZE = 1000;
// Hard bound so a pathological count can never loop forever: 50k rows.
const MAX_ALL_PAGES = 50;

async function fetchAllPages<T>(fetchPage: (page: PageParams) => Promise<Page<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < MAX_ALL_PAGES; p++) {
    const { items, total } = await fetchPage({ limit: ALL_PAGE_SIZE, offset: p * ALL_PAGE_SIZE });
    out.push(...items);
    if (items.length === 0 || out.length >= total) break;
  }
  return out;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
// Malformed-id policy (audit-2 fix 8): a non-UUID value compared
// against a uuid column makes Postgres answer 22P02. That is a client
// addressing mistake — the addressed row simply does not exist — so
// every by-id read/write below translates this one error to its
// not-found result (null / false) instead of letting it surface as a
// 500. Valid-but-absent ids already take the same paths.
export function isInvalidUuidError(error: { code?: string } | null | undefined): boolean {
  return !!error && error.code === '22P02';
}
// Opening hours are stored as free-form JSONB, but every consumer
// (site display, chat grounding) only understands string entries —
// the admin editor writes `weekdays` / `weekends` strings. Normalize
// defensively, the way sanitizeSiteLocations does: a non-record value
// becomes {}, and only non-empty string entries survive (trimmed,
// length-capped), so garbage planted directly in the column can never
// leak into a DTO.
export function sanitizeOpeningHours(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) out[key.slice(0, 80)] = trimmed.slice(0, 300);
  }
  return out;
}
// getSettings must never hand out a shared settings object by
// reference: callers receive a fresh copy (nested groups included),
// so a mutation of a returned DTO can never corrupt the defaults or
// another caller's view.
export function cloneSettings(s: PublicSettingsDTO): PublicSettingsDTO {
  return {
    ...s,
    openingHours: { ...s.openingHours },
    siteLocations: {
      footer: { ...s.siteLocations.footer },
      contact: { ...s.siteLocations.contact },
      reservation: { ...s.siteLocations.reservation },
    },
  };
}

function menuDTO(r: Row): MenuItemDTO {
  return {
    id: num(r.id),
    name: str(r.name),
    description: str(r.description),
    price: num(r.price),
    image: str(r.image_url),
    category: str(r.category),
    tags: Array.isArray(r.dietary_tags) ? (r.dietary_tags as string[]) : [],
  };
}
function menuFull(r: Row) {
  return { ...menuDTO(r), isAvailable: r.is_available !== false, sortOrder: num(r.sort_order) };
}
// Like num(), but a stored 0 is a real value: only a missing/NULL or
// non-numeric value falls back. (`num(v) || fallback` would silently turn
// a legitimate 0 into the fallback.)
const numOrFallback = (v: unknown, fallback: number): number => {
  if (v == null) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isNaN(n) ? fallback : n;
};
// Per-location contacts (migration 0010) live in one free-form JSONB
// column, so reads sanitize defensively: anything that is not a plain
// object group, and any value that is not a non-empty string, becomes
// null — the frontend then falls back to the global profile fields.
function emptySiteLocations(): SiteLocations {
  return {
    footer: { phone: null, email: null, address: null },
    contact: { phone: null, email: null, address: null, hours: null, mapLocation: null, mapLat: null, mapLng: null },
    reservation: { phone: null, address: null, hours: null, locationLabel: null },
  };
}
// A stored map coordinate is only real as a pair of finite, in-range
// numbers. Anything else (a string, NaN, out of range, or a lone half of
// the pair planted directly in the JSON) is garbage and the whole pair
// reads as null — the Contact page then falls back to the text fields.
function coordPair(latRaw: unknown, lngRaw: unknown): { mapLat: number | null; mapLng: number | null } {
  const lat = typeof latRaw === 'number' && Number.isFinite(latRaw) && latRaw >= -90 && latRaw <= 90 ? latRaw : null;
  const lng = typeof lngRaw === 'number' && Number.isFinite(lngRaw) && lngRaw >= -180 && lngRaw <= 180 ? lngRaw : null;
  return lat !== null && lng !== null ? { mapLat: lat, mapLng: lng } : { mapLat: null, mapLng: null };
}
export function sanitizeSiteLocations(raw: unknown): SiteLocations {
  const out = emptySiteLocations();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const groups = raw as Record<string, unknown>;
  const pick = (group: unknown): Row =>
    group && typeof group === 'object' && !Array.isArray(group) ? (group as Row) : {};
  const footer = pick(groups.footer);
  out.footer = { phone: strOrNull(footer.phone), email: strOrNull(footer.email), address: strOrNull(footer.address) };
  const contact = pick(groups.contact);
  out.contact = {
    phone: strOrNull(contact.phone), email: strOrNull(contact.email), address: strOrNull(contact.address),
    hours: strOrNull(contact.hours), mapLocation: strOrNull(contact.mapLocation),
    ...coordPair(contact.mapLat, contact.mapLng),
  };
  const reservation = pick(groups.reservation);
  out.reservation = {
    phone: strOrNull(reservation.phone), address: strOrNull(reservation.address),
    hours: strOrNull(reservation.hours), locationLabel: strOrNull(reservation.locationLabel),
  };
  return out;
}
// Migration 0010's site_locations column: until the owner runs 0010,
// PostgREST rejects any settings write that names it — an unknown column
// in a payload surfaces PGRST204 and filtering surfaces PG 42703 (the
// same two signals createOrder watches for idempotency_key). A stale
// schema cache can also word the failure directly, so the column name
// in the message counts too.
export function isMissingSiteLocationsError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return typeof error.message === 'string' && error.message.includes('site_locations');
}
// Migration 0012's access-control objects (role_permissions table,
// profiles.permissions column, audit_events table): same degradation
// contract as site_locations — until the owner runs 0012 these do not
// exist. PostgREST reports a missing TABLE as PGRST205 (or PG 42P01
// behind a stale cache), a missing column in a payload as PGRST204 and
// in a filter/select as 42703; the object name in the message counts
// too. Callers treat any of these as "not migrated yet" and fall back
// to the built-in permission defaults — never a 500.
export function isMissingAccessControlError(
  error: { code?: string; message?: string } | null | undefined,
  objectName: 'role_permissions' | 'permissions' | 'audit_events',
): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.code === '42P01') return true;
  return typeof error.message === 'string' && error.message.includes(objectName);
}
// Migration 0013's profiles.mfa_required column: the same degradation
// contract as 0012's objects — until the owner runs 0013 the column
// does not exist. A write naming it fails with PGRST204 (payload) or
// 42703 (filter/select) and the column name in the message counts too;
// callers treat any of these as "not migrated yet" and fall back to
// the profile as it stands — never a 500, never a lockout.
export function isMissingMfaRequiredError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return typeof error.message === 'string' && error.message.includes('mfa_required');
}
// Migration 0014's columns (restaurant_settings.reservation_fee_*,
// reservations.fee_*): the same degradation contract as 0010/0012/
// 0013 — until the owner runs 0014 these do not exist. A write naming
// one fails with PGRST204 (payload) or 42703 (filter/select) and the
// column-family name in the message counts too; callers treat any of
// these as "not migrated yet" and fall back to the pre-fee behaviour
// (fee off, bookings exactly as before) — never a 500.
export function isMissingReservationFeeError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return typeof error.message === 'string' && (error.message.includes('reservation_fee') || error.message.includes('fee_'));
}
// Migration 0015's reservation_requests table: the same degradation
// contract as 0012's objects — until the owner runs 0015 the table
// does not exist. PostgREST reports a missing TABLE as PGRST205 (or
// PG 42P01 behind a stale cache), a missing column in a payload as
// PGRST204 and in a filter/select as 42703; the table name in the
// message counts too. Callers treat any of these as "not migrated
// yet": the account reservations list degrades to requests=null (the
// bookings themselves read exactly as before), creation resolves
// null (an honest 503 at the route), and the admin inbox answers an
// empty page flagged degraded — never a 500, never a fake row.
export function isMissingReservationRequestsError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.code === '42P01') return true;
  return typeof error.message === 'string' && error.message.includes('reservation_requests');
}
function settingsDTO(r: Row): PublicSettingsDTO {
  return {
    kitchenOpen: r.kitchen_open !== false,
    // 0 is a legitimate wait time ("no wait right now") — the settings
    // schema allows min 0 — so these two use the nullish-aware parse.
    // reservationSlotCapacity keeps `|| 40`: its schema minimum is 1, so a
    // stored 0 is corruption, not a value, and the fallback is the guard.
    waitMin: numOrFallback(r.wait_min, 20),
    waitMax: numOrFallback(r.wait_max, 30),
    currency: sanitizeCurrencyCode(r.currency),
    restaurantName: str(r.restaurant_name) || 'Ember & Co.',
    phone: strOrNull(r.phone),
    email: strOrNull(r.email),
    address: strOrNull(r.address),
    whatsappNumber: strOrNull(r.whatsapp_number),
    reservationSlotCapacity: num(r.reservation_slot_capacity) || 40,
    // Reservation fee controls (0014): absent columns (pre-migration)
    // read as the migration's own defaults — fee OFF, amount 0 — so
    // the effective-fee rule can never fire before 0014 runs. A
    // stored amount is clamped at 0 from below: negative is not a
    // charge in any currency.
    reservationFeeEnabled: r.reservation_fee_enabled === true,
    reservationFeeAmount: Math.max(0, numOrFallback(r.reservation_fee_amount, 0)),
    openingHours: sanitizeOpeningHours(r.opening_hours),
    siteLocations: sanitizeSiteLocations(r.site_locations),
  };
}
export const DEFAULT_SETTINGS: PublicSettingsDTO = {
  kitchenOpen: true, waitMin: 20, waitMax: 30, currency: 'USD', restaurantName: 'Ember & Co.',
  phone: null, email: null, address: null, whatsappNumber: null, reservationSlotCapacity: 40,
  reservationFeeEnabled: false, reservationFeeAmount: 0, openingHours: {},
  siteLocations: emptySiteLocations(),
};
// Inverse of settingsDTO: a full settings DTO as a restaurant_settings
// row (the singleton is always id 1 — see the check constraint in 0001).
function settingsRow(s: PublicSettingsDTO): Row {
  return {
    id: 1,
    kitchen_open: s.kitchenOpen,
    wait_min: s.waitMin,
    wait_max: s.waitMax,
    currency: s.currency,
    restaurant_name: s.restaurantName,
    phone: s.phone,
    email: s.email,
    address: s.address,
    whatsapp_number: s.whatsappNumber,
    reservation_slot_capacity: s.reservationSlotCapacity,
    reservation_fee_enabled: s.reservationFeeEnabled,
    reservation_fee_amount: s.reservationFeeAmount,
    opening_hours: s.openingHours,
    site_locations: s.siteLocations,
  };
}
function reviewDTO(r: Row): ReviewDTO {
  return { id: str(r.id), name: str(r.name), rating: num(r.rating), comment: str(r.comment), country: strOrNull(r.country), createdAt: str(r.created_at) };
}
function profileDTO(r: Row): ProfileDTO {
  const favorites = Array.isArray(r.favorites) ? (r.favorites as unknown[]).filter((f): f is number => typeof f === 'number') : [];
  // Per-person permission overrides (0012): sanitised on the way out —
  // unknown sections/levels planted directly in the column are dropped;
  // an empty/absent map normalizes to null ("no overrides").
  const permissions = sanitizePermissionMap(r.permissions);
  // Two-factor requirement (0013): profiles are read with select('*'),
  // so BEFORE 0013 runs the row simply has no mfa_required key — that
  // ABSENCE is itself the signal (enforcement off entirely; see
  // lib/mfa.ts), so it must survive as undefined rather than collapsing
  // into null, which means "column exists, follow the role default".
  // A present-but-garbage value reads as null, never as a requirement.
  const mfaRequired: boolean | null | undefined = !('mfa_required' in r)
    ? undefined
    : typeof r.mfa_required === 'boolean' ? r.mfa_required : null;
  return {
    id: str(r.id),
    role: (['customer', 'admin', 'staff', 'manager'].includes(str(r.role)) ? str(r.role) : 'customer') as ProfileDTO['role'],
    fullName: strOrNull(r.full_name),
    phone: strOrNull(r.phone),
    addresses: Array.isArray(r.addresses) ? (r.addresses as unknown[]) : [],
    favorites,
    permissions: permissions && Object.keys(permissions).length > 0 ? permissions : null,
    mfaRequired,
    createdAt: str(r.created_at),
  };
}
function reservationDTO(r: Row): ReservationDTO {
  return {
    id: str(r.id),
    userId: strOrNull(r.user_id),
    name: str(r.name), email: strOrNull(r.email), phone: str(r.phone),
    date: str(r.reservation_date), time: str(r.reservation_time),
    guests: num(r.guests),
    // Pre-migration rows have no source column — they all came from the site.
    source: r.source === 'admin' ? 'admin' : 'website',
    notes: strOrNull(r.notes),
    status: str(r.status) as ReservationDTO['status'],
    // Fee record (0014): absent columns (pre-migration rows) read as
    // no fee at all. An out-of-vocabulary stored status — only
    // reachable by hand-editing the column past its check constraint
    // — also reads as 'none', never as a state the capacity math
    // might miscount as paid.
    feeAmount: r.fee_amount == null ? null : num(r.fee_amount),
    feeCurrency: strOrNull(r.fee_currency),
    feePaymentStatus: (['pending', 'paid', 'failed'].includes(str(r.fee_payment_status))
      ? str(r.fee_payment_status)
      : 'none') as ReservationDTO['feePaymentStatus'],
    createdAt: str(r.created_at),
  };
}
function reservationRequestDTO(r: Row): ReservationRequestDTO {
  return {
    id: str(r.id),
    reservationId: str(r.reservation_id),
    requesterUserId: strOrNull(r.requester_user_id),
    requesterEmail: strOrNull(r.requester_email),
    proposedDate: strOrNull(r.proposed_date),
    proposedTime: strOrNull(r.proposed_time),
    proposedGuests: r.proposed_guests == null ? null : num(r.proposed_guests),
    message: str(r.message),
    // The status vocabulary is closed at the database; a value
    // outside it (only reachable by hand-editing past the CHECK)
    // reads as 'pending' — the one state that claims nothing has
    // been decided yet.
    status: (['approved', 'declined', 'handled'].includes(str(r.status))
      ? str(r.status)
      : 'pending') as ReservationRequestDTO['status'],
    adminReply: strOrNull(r.admin_reply),
    handledBy: strOrNull(r.handled_by),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}
function couponDTO(r: Row): CouponDTO {
  return {
    id: str(r.id), code: str(r.code),
    type: str(r.type) === 'fixed' ? 'fixed' : 'percent',
    value: num(r.value), isActive: r.is_active !== false,
    expiresAt: strOrNull(r.expires_at),
  };
}
function auditEventDTO(r: Row): AuditEventDTO {
  return {
    id: str(r.id),
    createdAt: str(r.created_at),
    actorId: strOrNull(r.actor_id),
    actorLabel: strOrNull(r.actor_label),
    actorRole: strOrNull(r.actor_role),
    action: str(r.action),
    entity: strOrNull(r.entity),
    entityId: strOrNull(r.entity_id),
    summary: strOrNull(r.summary),
    changes: (r.changes as AuditEventDTO['changes'] | null) ?? null,
    ip: strOrNull(r.ip),
    userAgent: strOrNull(r.user_agent),
  };
}
function orderDTO(r: Row, items: OrderDTO['items']): OrderDTO {
  return {
    id: str(r.id),
    userId: strOrNull(r.user_id),
    customerName: str(r.customer_name), customerEmail: str(r.customer_email),
    customerPhone: strOrNull(r.customer_phone),
    status: str(r.status) as OrderDTO['status'],
    paymentStatus: str(r.payment_status) as OrderDTO['paymentStatus'],
    paymentIntentId: strOrNull(r.payment_intent_id),
    currency: sanitizeCurrencyCode(r.currency),
    subtotal: num(r.subtotal), deliveryFee: num(r.delivery_fee),
    discount: num(r.discount), total: num(r.total),
    couponCode: strOrNull(r.coupon_code),
    address: (r.delivery_address as Record<string, unknown>) ?? null,
    notes: strOrNull(r.notes),
    items,
    createdAt: str(r.created_at), updatedAt: str(r.updated_at),
  };
}

export function createSupabaseRepository(url: string, serviceRoleKey: string): Repository {
  const db: SupabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function attachItems(orders: Row[]): Promise<OrderDTO[]> {
    if (orders.length === 0) return [];
    const ids = orders.map((o) => str(o.id));
    // The items fetch pages through fetchAllPages (chunks of
    // ALL_PAGE_SIZE rows against the exact count), NOT one bare
    // .in() query: PostgREST caps every response at 1000 rows and the
    // cap counts ITEM rows, so a single query silently truncated the
    // tail once one page of orders held >1000 items combined (~250–350
    // ordinary orders) and later orders rendered with missing items.
    // Chunking by order-id count instead could not guarantee
    // completeness — one order may hold many item rows — while paging
    // by row count is complete regardless of items-per-order. `id` is
    // the items primary key, so the page order is total and each
    // order's items keep their previous (id-ascending) order.
    const itemRows = await fetchAllPages(async (page) => {
      const { data, error, count } = await db
        .from('order_items')
        .select('order_id, menu_item_id, name, unit_price, quantity', { count: 'exact' })
        .in('order_id', ids)
        .order('id', { ascending: true })
        .range(page.offset, page.offset + page.limit - 1);
      if (error) throw new Error(`order_items query failed: ${error.message}`);
      return { items: (data ?? []) as Row[], total: count ?? 0 };
    });
    const byOrder = new Map<string, OrderDTO['items']>();
    for (const raw of itemRows) {
      const list = byOrder.get(str(raw.order_id)) ?? [];
      list.push({
        menuItemId: raw.menu_item_id == null ? null : num(raw.menu_item_id),
        name: str(raw.name), unitPrice: num(raw.unit_price), quantity: num(raw.quantity),
      });
      byOrder.set(str(raw.order_id), list);
    }
    return orders.map((o) => orderDTO(o, byOrder.get(str(o.id)) ?? []));
  }

  // One paged pass over auth.users building an id → email map. The admin
  // customers/staff lists used to call getUserById once PER profile
  // (an N+1 against the Auth API); this replaces that with a single
  // listUsers sweep. Email stays best-effort, exactly as before: any
  // failure leaves the map (partially) empty and emails render as null.
  async function fetchEmailMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      for (let page = 1; page <= MAX_ALL_PAGES; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: ALL_PAGE_SIZE });
        if (error || !data) break;
        for (const u of data.users) if (u.email) map.set(u.id, u.email);
        if (data.users.length < ALL_PAGE_SIZE) break;
      }
    } catch { /* best-effort — see above */ }
    return map;
  }

  async function adminListOrders(status?: string): Promise<OrderDTO[]>;
  async function adminListOrders(status: string | undefined, page: PageParams): Promise<Page<OrderDTO>>;
  async function adminListOrders(status?: string, page?: PageParams): Promise<OrderDTO[] | Page<OrderDTO>> {
    if (!page) return fetchAllPages((p) => adminListOrders(status, p));
    // created_at + id: a total order, so pages tile exactly even when
    // many orders share a timestamp (created_at alone leaves ties to
    // the whim of the scan, and pages can overlap or skip rows).
    let query = db.from('orders').select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error, count } = await query.range(page.offset, page.offset + page.limit - 1);
    if (error) throw new Error(`orders query failed: ${error.message}`);
    return { items: await attachItems((data ?? []) as Row[]), total: count ?? 0 };
  }

  /**
   * The fee webhook transitions, mirroring the order pair
   * (markOrderPaidByPaymentIntent / …Failed…): a first-row lookup by
   * intent id (the column is not unique — limit(1) keeps a duplicate
   * from ever wedging the webhook on PGRST116), then a GUARDED
   * update. 'paid' may be set from pending/failed (a succeeded event
   * after a failed attempt is a legitimate card retry) and is
   * terminal; 'failed' may be set from pending only, so an
   * out-of-order failure can never un-pay a booking. Returns the
   * reservation as it stands, or null when no reservation references
   * the intent. Pre-0014 the fee columns do not exist: the lookup's
   * missing-column error reads as "no such reservation" (null), so
   * a stray fee event degrades to the webhook's unknown-intent ack
   * instead of a 500 Stripe would retry forever.
   */
  async function transitionReservationFeeByIntent(
    paymentIntentId: string,
    target: 'paid' | 'failed',
  ): Promise<ReservationDTO | null> {
    const { data, error } = await db
      .from('reservations')
      .select('id')
      .eq('fee_payment_intent_id', paymentIntentId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1);
    if (error) {
      if (isMissingReservationFeeError(error)) return null;
      throw new Error(`reservation fee lookup failed: ${error.message}`);
    }
    if (!data || data.length === 0) return null;
    const reservationId = str((data[0] as Row).id);
    const fromStates = target === 'paid' ? ['pending', 'failed'] : ['pending'];
    // The order pair's M1 guard, applied to the 'paid' transition
    // only: a CANCELLED reservation's fee is never marked paid in the
    // same statement (no read-then-write window). Capacity and
    // revenue never counted a cancelled booking either way — both
    // seat-holding rules gate on the booking status first — but the
    // row would otherwise read "fee paid" for a booking that will
    // never happen while the money sits taken; the webhook handler
    // records the blocked transition for the owner instead. The
    // 'failed' transition is deliberately unguarded: marking a
    // cancelled booking's fee failed creates no paid state, holds
    // no seats and counts nothing.
    let updateQuery = db
      .from('reservations')
      .update({ fee_payment_status: target })
      .eq('id', reservationId)
      .in('fee_payment_status', fromStates);
    if (target === 'paid') updateQuery = updateQuery.neq('status', 'cancelled');
    const { error: updError } = await updateQuery;
    if (updError) throw new Error(`reservation fee update failed: ${updError.message}`);
    return repo.getReservation(reservationId);
  }

  async function adminListReservations(): Promise<ReservationDTO[]>;
  async function adminListReservations(filter: ReservationListFilter, page: PageParams): Promise<Page<ReservationDTO>>;
  async function adminListReservations(filter?: ReservationListFilter, page?: PageParams): Promise<ReservationDTO[] | Page<ReservationDTO>> {
    if (!page) return fetchAllPages((p) => adminListReservations(filter ?? {}, p));
    let query = db
      .from('reservations')
      .select('*', { count: 'exact' })
      // Deterministic order for paging: newest date first; within a date,
      // earliest seating first (the day board's view); created_at breaks
      // most remaining ties and id — unique — breaks the last ones (rows
      // created in the same instant), so the order is total and pages
      // never overlap or skip a row.
      .order('reservation_date', { ascending: false })
      .order('reservation_time', { ascending: true })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    // Filters apply BEFORE the range, so `total` is the filtered count
    // and pages tile the filtered set (audit-2 fix 3).
    if (filter?.date) query = query.eq('reservation_date', filter.date);
    if (filter?.status) query = query.eq('status', filter.status);
    const { data, error, count } = await query.range(page.offset, page.offset + page.limit - 1);
    if (error) throw new Error(`reservations query failed: ${error.message}`);
    return { items: ((data ?? []) as Row[]).map(reservationDTO), total: count ?? 0 };
  }

  async function adminListNewsletter(): Promise<NewsletterSubscriberDTO[]>;
  async function adminListNewsletter(page: PageParams, since?: string): Promise<Page<NewsletterSubscriberDTO>>;
  async function adminListNewsletter(page?: PageParams, since?: string): Promise<NewsletterSubscriberDTO[] | Page<NewsletterSubscriberDTO>> {
    if (!page) return fetchAllPages((p) => adminListNewsletter(p));
    // The optional `since` filter applies BEFORE the range, so `total`
    // is the filtered count (audit-2 fix 6) — the "new this week" stat
    // reads it via a limit=1 request instead of counting a loaded page.
    let query = db
      .from('newsletter_subscribers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (since) query = query.gte('created_at', since);
    const { data, error, count } = await query.range(page.offset, page.offset + page.limit - 1);
    if (error) throw new Error(`newsletter query failed: ${error.message}`);
    const items = ((data ?? []) as Row[]).map((r) => ({ id: str(r.id), email: str(r.email), createdAt: str(r.created_at) }));
    return { items, total: count ?? 0 };
  }

  async function adminListCustomers(): Promise<CustomerDTO[]>;
  async function adminListCustomers(page: PageParams): Promise<Page<CustomerDTO>>;
  async function adminListCustomers(page?: PageParams): Promise<CustomerDTO[] | Page<CustomerDTO>> {
    if (!page) return fetchAllPages((p) => adminListCustomers(p));
    // Lifetime spend is reported in the CURRENT settings currency only —
    // orders placed in another currency are counted, never summed in,
    // so two currencies are never silently added together.
    const settings = await repo.getSettings();
    // The aggregation runs over the COMPLETE orders table (paged
    // internally): a customer's totals must not shrink because the
    // profiles list itself is being viewed one page at a time.
    const counts = new Map<string, { count: number; spent: number }>();
    for (let p = 0; p < MAX_ALL_PAGES; p++) {
      const from = p * ALL_PAGE_SIZE;
      const { data: orderRows, error: ordersError } = await db
        .from('orders')
        .select('user_id, total, payment_status, currency')
        // A paged scan MUST name a total order: without one the pages
        // are arbitrary slices of an unstable scan and can double-count
        // or drop orders between fetches (this sweep previously had no
        // .order() at all). created_at + the unique id is total.
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + ALL_PAGE_SIZE - 1);
      if (ordersError) throw new Error(`customer order aggregation failed: ${ordersError.message}`);
      for (const o of (orderRows ?? []) as Row[]) {
        if (!o.user_id) continue;
        const entry = counts.get(str(o.user_id)) ?? { count: 0, spent: 0 };
        entry.count += 1;
        if (o.payment_status === 'paid' && sanitizeCurrencyCode(o.currency) === settings.currency) entry.spent += num(o.total);
        counts.set(str(o.user_id), entry);
      }
      if ((orderRows ?? []).length < ALL_PAGE_SIZE) break;
    }
    const emails = await fetchEmailMap();
    const { data: profiles, error, count } = await db
      .from('profiles')
      .select('*', { count: 'exact' })
      .eq('role', 'customer')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page.offset, page.offset + page.limit - 1);
    if (error) throw new Error(`profiles query failed: ${error.message}`);
    const expFactor = 10 ** currencyExponent(settings.currency);
    const items = ((profiles ?? []) as Row[]).map((p) => {
      const dto = profileDTO(p);
      const c = counts.get(dto.id) ?? { count: 0, spent: 0 };
      return { ...dto, email: emails.get(dto.id) ?? null, orderCount: c.count, totalSpent: Math.round(c.spent * expFactor) / expFactor };
    });
    return { items, total: count ?? 0 };
  }

  async function adminListReviews(): Promise<(ReviewDTO & { isApproved: boolean })[]>;
  async function adminListReviews(page: PageParams): Promise<Page<ReviewDTO & { isApproved: boolean }>>;
  async function adminListReviews(page?: PageParams): Promise<(ReviewDTO & { isApproved: boolean })[] | Page<ReviewDTO & { isApproved: boolean }>> {
    if (!page) return fetchAllPages((p) => adminListReviews(p));
    const { data, error, count } = await db
      .from('reviews')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page.offset, page.offset + page.limit - 1);
    if (error) throw new Error(`reviews query failed: ${error.message}`);
    const items = ((data ?? []) as Row[]).map((r) => ({ ...reviewDTO(r), isApproved: r.is_approved === true }));
    return { items, total: count ?? 0 };
  }

  async function adminListCoupons(): Promise<CouponDTO[]>;
  async function adminListCoupons(page: PageParams): Promise<Page<CouponDTO>>;
  async function adminListCoupons(page?: PageParams): Promise<CouponDTO[] | Page<CouponDTO>> {
    if (!page) return fetchAllPages((p) => adminListCoupons(p));
    const { data, error, count } = await db
      .from('coupons')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page.offset, page.offset + page.limit - 1);
    if (error) throw new Error(`coupons query failed: ${error.message}`);
    return { items: ((data ?? []) as Row[]).map(couponDTO), total: count ?? 0 };
  }

  async function adminListStaff(): Promise<StaffDTO[]>;
  async function adminListStaff(page: PageParams): Promise<Page<StaffDTO>>;
  async function adminListStaff(page?: PageParams): Promise<StaffDTO[] | Page<StaffDTO>> {
    if (!page) return fetchAllPages((p) => adminListStaff(p));
    // All profiles: the Staff screen is where customers get promoted.
    // created_at asc + id asc is a total order, so pages tile; emails
    // come from the single listUsers sweep (no per-profile N+1).
    const emails = await fetchEmailMap();
    const { data, error, count } = await db
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(page.offset, page.offset + page.limit - 1);
    if (error) throw new Error(`staff query failed: ${error.message}`);
    const items = ((data ?? []) as Row[]).map((r) => ({ ...profileDTO(r), email: emails.get(str(r.id)) ?? null }));
    return { items, total: count ?? 0 };
  }

  const repo: Repository = {
    async listMenuItems() {
      const { data, error } = await db.from('menu_items').select('*').eq('is_available', true).order('sort_order').order('id');
      if (error) throw new Error(`menu query failed: ${error.message}`);
      return ((data ?? []) as Row[]).map(menuDTO);
    },
    async listAllMenuItems() {
      // The admin Menu screen filters/searches this list client-side,
      // so it must be the COMPLETE set: page through in ALL_PAGE_SIZE
      // chunks (sort_order + id is a total order) instead of trusting
      // one response, which PostgREST caps at 1000 rows (audit-2 fix 6).
      const items: ReturnType<typeof menuFull>[] = [];
      for (let p = 0; p < MAX_ALL_PAGES; p++) {
        const from = p * ALL_PAGE_SIZE;
        const { data, error } = await db
          .from('menu_items').select('*').order('sort_order').order('id')
          .range(from, from + ALL_PAGE_SIZE - 1);
        if (error) throw new Error(`menu query failed: ${error.message}`);
        const rows = ((data ?? []) as Row[]).map(menuFull);
        items.push(...rows);
        if (rows.length < ALL_PAGE_SIZE) break;
      }
      return items;
    },
    async getMenuItem(id) {
      const { data, error } = await db.from('menu_items').select('*').eq('id', id).eq('is_available', true).maybeSingle();
      if (error) throw new Error(`menu query failed: ${error.message}`);
      return data ? menuDTO(data as Row) : null;
    },
    async getMenuItemsByIds(ids) {
      if (ids.length === 0) return [];
      // One batched lookup for the whole id list (the favorites read
      // used to resolve ids one by one — an unbounded sequential
      // N+1). Availability matches getMenuItem; the caller's id order
      // (and any duplicate ids) are preserved by mapping the rows
      // back onto the input list.
      const { data, error } = await db.from('menu_items').select('*').in('id', ids).eq('is_available', true);
      if (error) throw new Error(`menu query failed: ${error.message}`);
      const byId = new Map(((data ?? []) as Row[]).map((r) => [num(r.id), menuDTO(r)]));
      const out: MenuItemDTO[] = [];
      for (const id of ids) {
        const item = byId.get(id);
        if (item) out.push(item);
      }
      return out;
    },
    async getSettings() {
      const { data, error } = await db.from('restaurant_settings').select('*').eq('id', 1).maybeSingle();
      if (error) throw new Error(`settings query failed: ${error.message}`);
      // A fresh copy on every read — never the shared DEFAULT_SETTINGS
      // object (or its nested groups) by reference.
      return cloneSettings(data ? settingsDTO(data as Row) : DEFAULT_SETTINGS);
    },
    async listApprovedReviews() {
      // Complete set, paged internally like every other fetch-all
      // caller: a single unpaged select silently dropped every
      // approved review past PostgREST's 1000-row cap from the
      // homepage. created_at + id is a total order, so pages tile.
      return fetchAllPages(async (page) => {
        const { data, error, count } = await db
          .from('reviews')
          .select('*', { count: 'exact' })
          .eq('is_approved', true)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(page.offset, page.offset + page.limit - 1);
        if (error) throw new Error(`reviews query failed: ${error.message}`);
        return { items: ((data ?? []) as Row[]).map(reviewDTO), total: count ?? 0 };
      });
    },

    async getProfile(userId) {
      const { data, error } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (error) {
        if (isInvalidUuidError(error)) return null;
        throw new Error(`profile query failed: ${error.message}`);
      }
      return data ? profileDTO(data as Row) : null;
    },
    async upsertProfile(userId, data) {
      // Only write fields that were actually provided — an upsert must never
      // NULL out an existing name/phone on conflict.
      const record: Row = { id: userId };
      if (data.fullName !== undefined) record.full_name = data.fullName;
      if (data.phone !== undefined) record.phone = data.phone;
      const { data: row, error } = await db
        .from('profiles')
        .upsert(record, { onConflict: 'id' })
        .select('*')
        .single();
      if (error) throw new Error(`profile upsert failed: ${error.message}`);
      return profileDTO(row as Row);
    },
    async updateProfile(userId, patch) {
      const update: Row = {};
      if (patch.fullName !== undefined) update.full_name = patch.fullName;
      if (patch.phone !== undefined) update.phone = patch.phone;
      if (patch.addresses !== undefined) update.addresses = patch.addresses;
      if (patch.favorites !== undefined) update.favorites = patch.favorites;
      const { data, error } = await db.from('profiles').update(update).eq('id', userId).select('*').single();
      if (error) throw new Error(`profile update failed: ${error.message}`);
      return profileDTO(data as Row);
    },
    async createReservation(input: ReservationInput) {
      const { data, error } = await db
        .from('reservations')
        .insert({
          user_id: input.userId, name: input.name, email: input.email, phone: input.phone,
          reservation_date: input.date, reservation_time: input.time, guests: input.guests,
          // A fee booking is born owing its fee ('pending' — the route
          // mints the intent next and stores it conditionally). A free
          // booking names no fee columns at all: its insert is
          // byte-identical to the pre-0014 one, so bookings keep
          // working before the migration runs.
          ...(input.fee
            ? { fee_amount: input.fee.amount, fee_currency: input.fee.currency, fee_payment_status: 'pending' }
            : {}),
        })
        .select('*')
        .single();
      if (error) throw new Error(`reservation insert failed: ${error.message}`);
      return reservationDTO(data as Row);
    },
    async setReservationFeePaymentIntent(reservationId, paymentIntentId) {
      // Conditional twin of setOrderPaymentIntent: the intent may be
      // stored only while the fee is still 'pending', so a late store
      // can never move the pointer on a booking the webhook already
      // settled (or one whose setup already failed).
      const { data, error } = await db
        .from('reservations')
        .update({ fee_payment_intent_id: paymentIntentId })
        .eq('id', reservationId)
        .eq('fee_payment_status', 'pending')
        .select('id');
      if (error) {
        if (isInvalidUuidError(error)) return false;
        // Pre-0014 the fee columns do not exist — "not stored" is the
        // honest degradation (unreachable in practice: a fee can only
        // be effective once 0014's settings columns exist, and the
        // reservation columns ship in the same migration).
        if (isMissingReservationFeeError(error)) return false;
        throw new Error(`reservation fee intent update failed: ${error.message}`);
      }
      return !!data && data.length > 0;
    },
    async markReservationFeePaidByPaymentIntent(paymentIntentId) {
      return transitionReservationFeeByIntent(paymentIntentId, 'paid');
    },
    async markReservationFeeFailedByPaymentIntent(paymentIntentId) {
      return transitionReservationFeeByIntent(paymentIntentId, 'failed');
    },
    async failReservationFee(reservationId) {
      // Guarded like every payment transition: only a still-'pending'
      // fee may be failed by setup compensation — a webhook landing
      // first (paid) is never overwritten.
      const { error } = await db
        .from('reservations')
        .update({ fee_payment_status: 'failed' })
        .eq('id', reservationId)
        .eq('fee_payment_status', 'pending');
      if (error) {
        if (isInvalidUuidError(error)) return;
        // Best-effort compensation: a pre-0014 schema (or any failure
        // here) must never mask the original setup error behind a
        // second one.
        if (isMissingReservationFeeError(error)) return;
        throw new Error(`reservation fee failure update failed: ${error.message}`);
      }
    },
    async addNewsletterSubscriber(email) {
      const { data: existing } = await db.from('newsletter_subscribers').select('id').eq('email', email).maybeSingle();
      if (existing) return { alreadySubscribed: true };
      const { error } = await db.from('newsletter_subscribers').insert({ email });
      if (error) {
        if ((error as { code?: string }).code === '23505') return { alreadySubscribed: true };
        throw new Error(`newsletter insert failed: ${error.message}`);
      }
      return { alreadySubscribed: false };
    },
    async createContactMessage(input) {
      const { error } = await db.from('contact_messages').insert({
        name: input.name, email: input.email, phone: input.phone ?? null,
        subject: input.subject ?? null, message: input.message,
      });
      if (error) throw new Error(`contact insert failed: ${error.message}`);
    },
    async createReview(input) {
      const { data, error } = await db
        .from('reviews')
        .insert({ user_id: input.userId, name: input.name, rating: input.rating, comment: input.comment, country: input.country ?? null })
        .select('*')
        .single();
      if (error) throw new Error(`review insert failed: ${error.message}`);
      return reviewDTO(data as Row);
    },
    async listOrdersForUser(userId) {
      // The account page shows recent history, not an archive: cap the
      // select at the 100 most recent orders so the query stays bounded
      // no matter how long the account lives.
      const { data, error } = await db
        .from('orders').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
      if (error) throw new Error(`orders query failed: ${error.message}`);
      return attachItems((data ?? []) as Row[]);
    },

    async getOrderByIdempotencyKey(key) {
      // limit(1) rather than maybeSingle: the key is unique by index,
      // but a first-row read can never wedge on PGRST116 if duplicate
      // rows ever exist. A missing-column error means migration 0006
      // has not run — there is no stored order to replay, exactly the
      // degradation createOrder already applies.
      const { data, error } = await db
        .from('orders')
        .select('id')
        .eq('idempotency_key', key)
        .limit(1);
      if (error) {
        if (error.code === '42703' || error.code === 'PGRST204') return null;
        throw new Error(`order idempotency lookup failed: ${error.message}`);
      }
      if (!data || data.length === 0) return null;
      return repo.getOrder(str((data[0] as Row).id));
    },
    async createOrder(data: CreateOrderData) {
      const key = data.idempotencyKey ?? null;
      // Whether the idempotency_key column is usable. It only becomes false
      // when PostgREST reports the column missing — i.e. migration 0006 has
      // not run yet (or its schema cache has not reloaded). Two signals:
      // filtering on an unknown column surfaces PG error 42703, and sending
      // an unknown column in an insert payload surfaces PGRST204. In that
      // state checkout must keep working exactly as it did before 0006,
      // just without dedupe — the live site never breaks waiting on the
      // owner to run the migration.
      let keyUsable = key !== null;
      const isMissingKeyColumn = (error: { code?: string } | null): boolean =>
        !!error && (error.code === '42703' || error.code === 'PGRST204');

      const findByKey = async (): Promise<OrderDTO | null> => {
        const { data: existing, error } = await db
          .from('orders')
          .select('id')
          .eq('idempotency_key', key as string)
          .maybeSingle();
        if (error) {
          if (isMissingKeyColumn(error)) { keyUsable = false; return null; }
          throw new Error(`order idempotency lookup failed: ${error.message}`);
        }
        if (!existing) return null;
        return repo.getOrder(str((existing as Row).id));
      };

      if (keyUsable) {
        // First write wins: a retry with the same key returns the original
        // order untouched — even if the retry carries different items.
        const existing = await findByKey();
        if (existing) return existing;
      }

      const insertRow = (withKey: boolean) => ({
        user_id: data.userId, customer_name: data.customerName, customer_email: data.customerEmail,
        customer_phone: data.customerPhone, delivery_address: data.address, notes: data.notes,
        coupon_code: data.couponCode, currency: data.currency, subtotal: data.subtotal, delivery_fee: data.deliveryFee,
        discount: data.discount, total: data.total, status: 'pending', payment_status: 'unpaid',
        ...(withKey && key ? { idempotency_key: key } : {}),
      });

      let { data: row, error } = await db.from('orders').insert(insertRow(keyUsable)).select('*').single();
      if (error && keyUsable && isMissingKeyColumn(error)) {
        // Pre-migration schema (or a stale PostgREST cache): retry once
        // without the key — the plain pre-0006 insert.
        keyUsable = false;
        ({ data: row, error } = await db.from('orders').insert(insertRow(false)).select('*').single());
      }
      if (error) {
        // Unique-index backstop: two submits raced past the pre-check with
        // the same key; the loser lands here with 23505. The winner's
        // order is the correct response. (A 23505 can only come from the
        // idempotency index — orders has no other unique constraint the
        // insert can hit besides the server-generated PK.)
        if (keyUsable && (error as { code?: string }).code === '23505') {
          let winner = await findByKey();
          if (winner && winner.items.length === 0) {
            // The winner committed its order row a moment ago and may
            // still be inserting its items — re-read once, briefly later.
            await new Promise((resolve) => setTimeout(resolve, 250));
            winner = (await findByKey()) ?? winner;
          }
          if (winner) return winner;
        }
        throw new Error(`order insert failed: ${error.message}`);
      }
      const orderId = str((row as Row).id);
      const items = data.items.map((i) => ({
        order_id: orderId, menu_item_id: i.menuItemId, name: i.name, unit_price: i.unitPrice, quantity: i.quantity,
      }));
      const { error: itemsError } = await db.from('order_items').insert(items);
      if (itemsError) {
        // Compensating cleanup: never leave an orphan order with no items.
        const { error: cleanupError } = await db.from('orders').delete().eq('id', orderId);
        if (cleanupError) {
          console.error(`[orders] CRITICAL: cleanup of orphan order ${orderId} failed: ${cleanupError.message}`);
        }
        throw new Error(`order items insert failed: ${itemsError.message}`);
      }
      const created = await repo.getOrder(orderId);
      if (!created) throw new Error('order vanished after insert');
      return created;
    },
    async getOrder(id) {
      const { data, error } = await db.from('orders').select('*').eq('id', id).maybeSingle();
      if (error) {
        if (isInvalidUuidError(error)) return null;
        throw new Error(`order query failed: ${error.message}`);
      }
      if (!data) return null;
      const [withItems] = await attachItems([data as Row]);
      return withItems;
    },
    async setOrderPaymentIntent(orderId, paymentIntentId) {
      // Conditional write, in the same guarded style as the payment
      // transitions below: an intent may be stored only while the order
      // is unpaid-or-in-flight and not cancelled. 'paid' is excluded —
      // storing must never regress a paid order to 'pending', nor move
      // its pointer away from the intent the webhook reconciles
      // against. 'pending' is included: a first store has already moved
      // the order to 'pending', and replacing that intent after it died
      // at Stripe is a legitimate store. 'failed' is included so a card
      // retry can arm a fresh intent.
      const { data, error } = await db
        .from('orders')
        .update({ payment_intent_id: paymentIntentId, payment_status: 'pending' })
        .eq('id', orderId)
        .in('payment_status', ['unpaid', 'pending', 'failed'])
        .neq('status', 'cancelled')
        .select('id');
      if (error) {
        if (isInvalidUuidError(error)) return false;
        throw new Error(`order payment update failed: ${error.message}`);
      }
      // Zero matched rows: the order is gone, or its state moved on
      // (paid/cancelled) since the caller read it. Report "not stored"
      // rather than throwing or passing silently — the caller re-reads
      // and answers for the order's current state, because handing out
      // a client secret for an intent that was never stored would
      // strand the payment.
      return !!data && data.length > 0;
    },
    async markOrderPaidByPaymentIntent(paymentIntentId) {
      // payment_intent_id is NOT unique, so maybeSingle() would throw
      // PGRST116 and wedge the webhook if duplicate rows ever share an
      // intent. Take the first matching row (oldest first) with
      // limit(1) semantics instead; the guarded update below is
      // unchanged.
      const { data, error } = await db
        .from('orders')
        .select('id')
        .eq('payment_intent_id', paymentIntentId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1);
      if (error) throw new Error(`order lookup failed: ${error.message}`);
      if (!data || data.length === 0) return null;
      const orderId = str((data[0] as Row).id);
      // Guarded transition: 'paid' may be set from unpaid/pending/failed
      // (a succeeded event after a failed attempt is a legitimate card
      // retry). 'paid' itself is terminal — re-deliveries and later events
      // match zero rows here and change nothing. A CANCELLED order is
      // excluded in the same statement (mega-audit M1): an intent minted
      // before the cancellation can still be completed at Stripe, but
      // its success must never flip the cancelled order to paid — the
      // dashboard/finance filters count paid orders as revenue and no
      // refund path exists. The webhook handler detects the blocked
      // transition from the returned row and records it for the owner
      // instead (see routes/payments.ts). The status condition rides
      // THIS update — no read-then-write window.
      const { error: updError } = await db
        .from('orders')
        .update({ payment_status: 'paid' })
        .eq('id', orderId)
        .in('payment_status', ['unpaid', 'pending', 'failed'])
        .neq('status', 'cancelled');
      if (updError) throw new Error(`order payment update failed: ${updError.message}`);
      return repo.getOrder(orderId);
    },
    async markOrderPaymentFailedByPaymentIntent(paymentIntentId) {
      // Same first-row lookup as the paid path (see above): duplicates
      // must never wedge the webhook on PGRST116.
      const { data, error } = await db
        .from('orders')
        .select('id')
        .eq('payment_intent_id', paymentIntentId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1);
      if (error) throw new Error(`order lookup failed: ${error.message}`);
      if (!data || data.length === 0) return null;
      const orderId = str((data[0] as Row).id);
      // Guarded transition: 'failed' may be set from unpaid/pending ONLY.
      // Stripe does not guarantee webhook ordering — a payment_failed event
      // delivered after payment_succeeded must never un-pay an order, and a
      // refunded order must not flip to failed either.
      const { error: updError } = await db
        .from('orders')
        .update({ payment_status: 'failed' })
        .eq('id', orderId)
        .in('payment_status', ['unpaid', 'pending']);
      if (updError) throw new Error(`order payment update failed: ${updError.message}`);
      return repo.getOrder(orderId);
    },
    async getCouponByCode(code) {
      const { data, error } = await db.from('coupons').select('*').eq('code', code.toUpperCase()).maybeSingle();
      if (error) throw new Error(`coupon query failed: ${error.message}`);
      return data ? couponDTO(data as Row) : null;
    },

    adminListOrders,
    async updateOrderStatus(orderId, expectedStatus, status) {
      // Conditional write (audit-2 fix 8): the UPDATE carries the
      // status the route read as a predicate, so a state that moved
      // on since the read matches zero rows instead of being silently
      // overwritten. A cancellation additionally requires the order
      // to still be unpaid at write time — the route's paid guard is
      // judged on its read, and a webhook landing in the read→write
      // window must not let a paid order be cancelled with no refund
      // path. Zero rows → null; the route re-reads and answers 409.
      let query = db
        .from('orders')
        .update({ status })
        .eq('id', orderId)
        .eq('status', expectedStatus);
      if (status === 'cancelled') query = query.neq('payment_status', 'paid');
      const { data, error } = await query.select('id');
      if (error) {
        if (isInvalidUuidError(error)) return null;
        throw new Error(`order status update failed: ${error.message}`);
      }
      if (!data || data.length === 0) return null;
      return repo.getOrder(orderId);
    },
    async createMenuItem(data) {
      const { data: row, error } = await db
        .from('menu_items')
        .insert({
          name: data.name, description: data.description, price: data.price, image_url: data.image,
          category: data.category, dietary_tags: data.tags, is_available: data.isAvailable, sort_order: data.sortOrder,
        })
        .select('*')
        .single();
      if (error) throw new Error(`menu insert failed: ${error.message}`);
      return menuFull(row as Row);
    },
    async updateMenuItem(id, patch) {
      const update: Row = {};
      if (patch.name !== undefined) update.name = patch.name;
      if (patch.description !== undefined) update.description = patch.description;
      if (patch.price !== undefined) update.price = patch.price;
      if (patch.image !== undefined) update.image_url = patch.image;
      if (patch.category !== undefined) update.category = patch.category;
      if (patch.tags !== undefined) update.dietary_tags = patch.tags;
      if (patch.isAvailable !== undefined) update.is_available = patch.isAvailable;
      if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
      const { data, error } = await db.from('menu_items').update(update).eq('id', id).select('*').maybeSingle();
      if (error) throw new Error(`menu update failed: ${error.message}`);
      return data ? menuFull(data as Row) : null;
    },
    async deleteMenuItem(id) {
      const { data, error } = await db.from('menu_items').delete().eq('id', id).select('id');
      if (error) throw new Error(`menu delete failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    adminListReservations,
    async getReservation(id) {
      const { data, error } = await db.from('reservations').select('*').eq('id', id).maybeSingle();
      if (error) {
        if (isInvalidUuidError(error)) return null;
        throw new Error(`reservation query failed: ${error.message}`);
      }
      return data ? reservationDTO(data as Row) : null;
    },
    async updateReservationStatus(id, expectedStatus, status) {
      // Conditional twin of updateOrderStatus: zero matched rows
      // (gone, or the status moved on since the caller's read) → null.
      const { data, error } = await db
        .from('reservations')
        .update({ status })
        .eq('id', id)
        .eq('status', expectedStatus)
        .select('*')
        .maybeSingle();
      if (error) {
        if (isInvalidUuidError(error)) return null;
        throw new Error(`reservation update failed: ${error.message}`);
      }
      return data ? reservationDTO(data as Row) : null;
    },
    async adminCreateReservation(input: AdminReservationInput) {
      const { data, error } = await db
        .from('reservations')
        .insert({
          user_id: null, name: input.name, email: input.email, phone: input.phone,
          reservation_date: input.date, reservation_time: input.time, guests: input.guests,
          status: input.status, source: 'admin', notes: input.notes,
        })
        .select('*')
        .single();
      if (error) throw new Error(`admin reservation insert failed: ${error.message}`);
      return reservationDTO(data as Row);
    },
    async adminUpdateReservation(id, patch) {
      const update: Row = {};
      if (patch.date !== undefined) update.reservation_date = patch.date;
      if (patch.time !== undefined) update.reservation_time = patch.time;
      if (patch.guests !== undefined) update.guests = patch.guests;
      // An Apply save whose proposal matches the booking as it stands
      // changes no column — the reservation as it stands IS the answer
      // (and the linked request still gets its approval from the route).
      if (Object.keys(update).length === 0) return repo.getReservation(id);
      const { data, error } = await db.from('reservations').update(update).eq('id', id).select('*').maybeSingle();
      if (error) {
        if (isInvalidUuidError(error)) return null;
        throw new Error(`reservation update failed: ${error.message}`);
      }
      return data ? reservationDTO(data as Row) : null;
    },
    async listReservationsForUser(userId, email) {
      // Visibility (Phase G): the account's own bookings — linked by
      // user_id — PLUS guest bookings whose email matches the
      // account's email. Two bounded reads (the account page is a
      // recent-history view, like listOrdersForUser's cap), merged
      // and de-duplicated by id: a booking that is BOTH linked and
      // email-matching appears exactly once.
      const byAccount = await db
        .from('reservations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(100);
      if (byAccount.error) throw new Error(`account reservations query failed: ${byAccount.error.message}`);
      const merged = new Map<string, ReservationDTO>();
      for (const row of (byAccount.data ?? []) as Row[]) {
        const dto = reservationDTO(row);
        merged.set(dto.id, dto);
      }
      const accountEmail = (email ?? '').trim();
      if (accountEmail) {
        // ILIKE with the LIKE wildcards escaped to literals is a
        // case-insensitive EXACT match (the audit-log search's
        // likeLiteral treatment): an address containing % or _ must
        // match only itself, never a pattern-neighbour's booking.
        const literal = accountEmail.replace(/[%_\\]/g, (c) => `\\${c}`);
        const byEmail = await db
          .from('reservations')
          .select('*')
          .ilike('email', literal)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(100);
        if (byEmail.error) throw new Error(`account reservations query failed: ${byEmail.error.message}`);
        for (const row of (byEmail.data ?? []) as Row[]) {
          const dto = reservationDTO(row);
          if (!merged.has(dto.id)) merged.set(dto.id, dto);
        }
      }
      // Upcoming first (soonest first), then the past (most recent
      // first); created_at/id break ties so the order is total.
      const today = new Date().toISOString().slice(0, 10);
      const tiebreak = (a: ReservationDTO, b: ReservationDTO): number =>
        (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
      const all = [...merged.values()];
      const upcoming = all
        .filter((r) => r.date >= today)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) || tiebreak(a, b));
      const past = all
        .filter((r) => r.date < today)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.time < b.time ? 1 : a.time > b.time ? -1 : 0) || tiebreak(a, b));
      const reservations = [...upcoming, ...past];
      if (reservations.length === 0) return { reservations, requests: [] };
      // The booking's change requests ride along. Pre-0015 the table
      // does not exist: requests degrade to null (the route flags it)
      // while the bookings above read exactly as they always have.
      const { data, error } = await db
        .from('reservation_requests')
        .select('*')
        .in('reservation_id', reservations.map((r) => r.id))
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (error) {
        if (isMissingReservationRequestsError(error)) return { reservations, requests: null };
        throw new Error(`reservation requests query failed: ${error.message}`);
      }
      return { reservations, requests: ((data ?? []) as Row[]).map(reservationRequestDTO) };
    },
    async createReservationRequest(input) {
      // One pending request per reservation (the spam guard): the
      // friendly check first — the partial unique index in migration
      // 0015 is the race-proof backstop, and its 23505 lands on the
      // same 409 below.
      const { data: pending, error: pendingError } = await db
        .from('reservation_requests')
        .select('id')
        .eq('reservation_id', input.reservationId)
        .eq('status', 'pending')
        .limit(1);
      if (pendingError) {
        if (isMissingReservationRequestsError(pendingError)) return null;
        throw new Error(`reservation request check failed: ${pendingError.message}`);
      }
      if (pending && pending.length > 0) {
        throw new ApiError(409, 'A change request is already pending for this reservation — our team will answer that one first');
      }
      const { data, error } = await db
        .from('reservation_requests')
        .insert({
          reservation_id: input.reservationId,
          requester_user_id: input.requesterUserId,
          requester_email: input.requesterEmail,
          proposed_date: input.proposedDate,
          proposed_time: input.proposedTime,
          proposed_guests: input.proposedGuests,
          message: input.message,
        })
        .select('*')
        .single();
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new ApiError(409, 'A change request is already pending for this reservation — our team will answer that one first');
        }
        if (isMissingReservationRequestsError(error)) return null;
        throw new Error(`reservation request insert failed: ${error.message}`);
      }
      return reservationRequestDTO(data as Row);
    },
    async getReservationRequest(id) {
      const { data, error } = await db.from('reservation_requests').select('*').eq('id', id).maybeSingle();
      if (error) {
        if (isInvalidUuidError(error)) return null;
        if (isMissingReservationRequestsError(error)) return null;
        throw new Error(`reservation request query failed: ${error.message}`);
      }
      return data ? reservationRequestDTO(data as Row) : null;
    },
    async adminListReservationRequests(filter, page) {
      let query = db
        .from('reservation_requests')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (filter.status) query = query.eq('status', filter.status);
      const { data, error, count } = await query.range(page.offset, page.offset + page.limit - 1);
      if (error) {
        // Pre-0015: the inbox is an empty page flagged degraded —
        // never a 500, and the badge reads the same pendingTotal.
        if (isMissingReservationRequestsError(error)) return { items: [], total: 0, pendingTotal: 0, degraded: true };
        throw new Error(`reservation requests query failed: ${error.message}`);
      }
      // The badge's number is the EXACT pending count, independent of
      // the filter being browsed (a limit=1 count read, the stat-chip
      // pattern from the reservations board).
      const { count: pendingCount, error: pendingError } = await db
        .from('reservation_requests')
        .select('id', { count: 'exact' })
        .eq('status', 'pending')
        .limit(1);
      if (pendingError) {
        if (isMissingReservationRequestsError(pendingError)) return { items: [], total: 0, pendingTotal: 0, degraded: true };
        throw new Error(`reservation requests count failed: ${pendingError.message}`);
      }
      const requests = ((data ?? []) as Row[]).map(reservationRequestDTO);
      // Join the bookings these requests refer to in ONE read.
      const byId = new Map<string, ReservationDTO>();
      const ids = [...new Set(requests.map((r) => r.reservationId))];
      if (ids.length > 0) {
        const { data: rows, error: resError } = await db.from('reservations').select('*').in('id', ids);
        if (resError) throw new Error(`reservation requests context failed: ${resError.message}`);
        for (const row of (rows ?? []) as Row[]) {
          const dto = reservationDTO(row);
          byId.set(dto.id, dto);
        }
      }
      return {
        items: requests.map((r) => ({ ...r, reservation: byId.get(r.reservationId) ?? null })),
        total: count ?? 0,
        pendingTotal: pendingCount ?? 0,
        degraded: false,
      };
    },
    async updateReservationRequest(id, patch) {
      const update: Row = { status: patch.status, handled_by: patch.handledBy };
      if (patch.adminReply !== undefined) update.admin_reply = patch.adminReply;
      // Conditional: only a still-pending request can be closed, so
      // two handlers racing the same request produce exactly one
      // outcome — the loser reads null and answers 409.
      const { data, error } = await db
        .from('reservation_requests')
        .update(update)
        .eq('id', id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();
      if (error) {
        if (isInvalidUuidError(error)) return null;
        if (isMissingReservationRequestsError(error)) return null;
        throw new Error(`reservation request update failed: ${error.message}`);
      }
      return data ? reservationRequestDTO(data as Row) : null;
    },
    adminListCustomers,
    adminListReviews,
    async getReview(id) {
      const { data, error } = await db.from('reviews').select('*').eq('id', id).maybeSingle();
      if (error) {
        if (isInvalidUuidError(error)) return null;
        throw new Error(`review query failed: ${error.message}`);
      }
      return data ? { ...reviewDTO(data as Row), isApproved: (data as Row).is_approved === true } : null;
    },
    async setReviewApproved(id, approved) {
      const { data, error } = await db.from('reviews').update({ is_approved: approved }).eq('id', id).select('id');
      if (error) {
        if (isInvalidUuidError(error)) return false;
        throw new Error(`review update failed: ${error.message}`);
      }
      return (data ?? []).length > 0;
    },
    async deleteReview(id) {
      const { data, error } = await db.from('reviews').delete().eq('id', id).select('id');
      if (error) {
        if (isInvalidUuidError(error)) return false;
        throw new Error(`review delete failed: ${error.message}`);
      }
      return (data ?? []).length > 0;
    },
    adminListNewsletter,
    adminListCoupons,
    async createCoupon(data) {
      const { data: row, error } = await db
        .from('coupons')
        .insert({ code: data.code.toUpperCase(), type: data.type, value: data.value, is_active: data.isActive, expires_at: data.expiresAt })
        .select('*')
        .single();
      if (error) {
        // The coupons.code unique index: a duplicate is the caller's
        // conflict (409), not a server fault (500).
        if ((error as { code?: string }).code === '23505') {
          throw new ApiError(409, 'A coupon with this code already exists');
        }
        throw new Error(`coupon insert failed: ${error.message}`);
      }
      return couponDTO(row as Row);
    },
    async updateCoupon(id, patch) {
      const update: Row = {};
      if (patch.code !== undefined) update.code = patch.code.toUpperCase();
      if (patch.type !== undefined) update.type = patch.type;
      if (patch.value !== undefined) update.value = patch.value;
      if (patch.isActive !== undefined) update.is_active = patch.isActive;
      if (patch.expiresAt !== undefined) update.expires_at = patch.expiresAt;
      const { data, error } = await db.from('coupons').update(update).eq('id', id).select('*').maybeSingle();
      if (error) {
        // Renaming onto another coupon's code hits the same unique index.
        if ((error as { code?: string }).code === '23505') {
          throw new ApiError(409, 'A coupon with this code already exists');
        }
        if (isInvalidUuidError(error)) return null;
        throw new Error(`coupon update failed: ${error.message}`);
      }
      return data ? couponDTO(data as Row) : null;
    },
    async deleteCoupon(id) {
      const { data, error } = await db.from('coupons').delete().eq('id', id).select('id');
      if (error) {
        if (isInvalidUuidError(error)) return false;
        throw new Error(`coupon delete failed: ${error.message}`);
      }
      return (data ?? []).length > 0;
    },
    adminListStaff,
    async updateProfileRole(userId, role) {
      const { data, error } = await db.from('profiles').update({ role }).eq('id', userId).select('*').maybeSingle();
      if (error) {
        if (isInvalidUuidError(error)) return null;
        throw new Error(`role update failed: ${error.message}`);
      }
      return data ? profileDTO(data as Row) : null;
    },
    // -- Access control (migration 0012) --------------------------------
    // Every method degrades to the pre-0012 world: reads return null
    // (built-in defaults apply), writes no-op, audit inserts drop. The
    // moment 0012 runs, the same code paths persist for real — the same
    // activation pattern as site_locations (0010).
    async getRolePermissions(role) {
      const { data, error } = await db.from('role_permissions').select('permissions').eq('role', role).maybeSingle();
      if (error) {
        if (isMissingAccessControlError(error, 'role_permissions')) return null;
        throw new Error(`role permissions read failed: ${error.message}`);
      }
      if (!data) return null;
      return sanitizePermissionMap((data as Row).permissions);
    },
    async setRolePermissions(role, permissions) {
      const clean: PartialPermissionMap = sanitizePermissionMap(permissions) ?? {};
      const { error } = await db.from('role_permissions').upsert(
        { role, permissions: clean },
        { onConflict: 'role' },
      );
      if (error) {
        if (isMissingAccessControlError(error, 'role_permissions')) return;
        throw new Error(`role permissions write failed: ${error.message}`);
      }
    },
    async setUserPermissions(userId, permissions) {
      const clean = sanitizePermissionMap(permissions);
      // An empty map clears the overrides entirely (NULL), so "reset to
      // role default" is a real state, not an empty-jsonb residue.
      const value = clean && Object.keys(clean).length > 0 ? clean : null;
      const { data, error } = await db.from('profiles').update({ permissions: value }).eq('id', userId).select('*').maybeSingle();
      if (error) {
        if (isInvalidUuidError(error)) return null;
        if (isMissingAccessControlError(error, 'permissions')) {
          // Pre-0012: nothing can persist yet — hand back the profile
          // as it actually stands so the caller shows real state.
          return repo.getProfile(userId);
        }
        throw new Error(`user permissions write failed: ${error.message}`);
      }
      return data ? profileDTO(data as Row) : null;
    },
    async setUserMfaRequired(userId, required) {
      const { data, error } = await db.from('profiles').update({ mfa_required: required }).eq('id', userId).select('*').maybeSingle();
      if (error) {
        if (isInvalidUuidError(error)) return null;
        if (isMissingMfaRequiredError(error)) {
          // Pre-0013: nothing can persist yet — hand back the profile
          // as it actually stands so the caller shows real state (and
          // the endpoint's audit diff correctly sees no change).
          return repo.getProfile(userId);
        }
        throw new Error(`user MFA requirement write failed: ${error.message}`);
      }
      return data ? profileDTO(data as Row) : null;
    },
    async insertAuditEvent(event: AuditEventInput) {
      const { error } = await db.from('audit_events').insert({
        actor_id: event.actorId,
        actor_label: event.actorLabel,
        actor_role: event.actorRole,
        action: event.action,
        entity: event.entity,
        entity_id: event.entityId,
        summary: event.summary,
        changes: event.changes,
        ip: event.ip,
        user_agent: event.userAgent,
      });
      if (error) {
        // Pre-0012 the log table does not exist: dropping the event is
        // the correct degradation (lib/audit.ts also guards its caller).
        if (isMissingAccessControlError(error, 'audit_events')) return;
        throw new Error(`audit insert failed: ${error.message}`);
      }
    },
    // Security & Activity reads (Phase C). Filters apply BEFORE the
    // range, so `total` is the filtered count and pages tile the
    // filtered set; created_at desc + id desc is a total order. The
    // 'auth' category is the `auth.` action prefix (lib/audit.ts) —
    // expressed as LIKE / NOT LIKE because the table carries no
    // category column. Free text goes through an or() of ILIKEs with
    // the PostgREST or-syntax metacharacters stripped and its LIKE
    // wildcards escaped to literals; the value is double-quoted so
    // spaces survive, and a term with nothing searchable left in it
    // matches nothing rather than degrading to no filter.
    async listAuditEvents(filter: AuditEventFilter, page?: PageParams): Promise<AuditEventPage> {
      if (!page) {
        // The complete filtered set (CSV export): page through at the
        // PostgREST cap. A degraded first page is the whole answer.
        const first = await repo.listAuditEvents(filter, { limit: ALL_PAGE_SIZE, offset: 0 });
        if (first.degraded || first.items.length >= first.total) return first;
        const items = [...first.items];
        while (items.length < first.total) {
          const next = await repo.listAuditEvents(filter, { limit: ALL_PAGE_SIZE, offset: items.length });
          if (next.items.length === 0) break;
          items.push(...next.items);
        }
        return { items, total: first.total, degraded: false };
      }
      // Escape LIKE wildcards in user input so a filter value can
      // only ever match literally (plus the suffix wildcard WE add
      // for the action prefix match).
      const likeLiteral = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);
      let query = db
        .from('audit_events')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
      if (filter.category === 'auth') query = query.like('action', 'auth.%');
      if (filter.category === 'change') query = query.not('action', 'like', 'auth.%');
      if (filter.actorId) query = query.eq('actor_id', filter.actorId);
      if (filter.action) query = query.like('action', `${likeLiteral(filter.action)}%`);
      if (filter.from) query = query.gte('created_at', filter.from);
      if (filter.to) query = query.lte('created_at', filter.to);
      if (filter.q) {
        // Only the or()-grammar metacharacters are stripped — a
        // comma / paren / quote would break the filter string
        // itself. LIKE wildcards in what remains (% and _) and the
        // escape character are KEPT and passed through likeLiteral,
        // so they can only ever match literally (the action-prefix
        // treatment above). The previous strip-everything version
        // deleted % and \ outright, let _ act as a one-character
        // wildcard, and silently dropped the filter altogether
        // when nothing searchable survived the strip.
        const term = filter.q.replace(/[,()"]/g, ' ').trim();
        if (!term) {
          // A q with nothing searchable in it (e.g. ",,,") must not
          // degrade into "no filter" and stream back the whole
          // log — it matches nothing.
          return { items: [], total: 0, degraded: false };
        }
        const pattern = `"%${likeLiteral(term)}%"`;
        query = query.or(`actor_label.ilike.${pattern},summary.ilike.${pattern},action.ilike.${pattern}`);
      }
      const { data, error, count } = await query.range(page.offset, page.offset + page.limit - 1);
      if (error) {
        // Pre-0012: the log table does not exist — the honest answer
        // is an EMPTY page flagged degraded, never a 500 (the UI
        // turns the flag into "logging activates once the database
        // update is applied").
        if (isMissingAccessControlError(error, 'audit_events')) return { items: [], total: 0, degraded: true };
        // A non-UUID actorId filter simply matches no one (fix 8's
        // malformed-id policy), it is not a server failure.
        if (isInvalidUuidError(error)) return { items: [], total: 0, degraded: false };
        throw new Error(`audit events query failed: ${error.message}`);
      }
      return { items: ((data ?? []) as Row[]).map(auditEventDTO), total: count ?? 0, degraded: false };
    },
    async updateSettings(patch) {
      const update: Row = {};
      if (patch.kitchenOpen !== undefined) update.kitchen_open = patch.kitchenOpen;
      if (patch.waitMin !== undefined) update.wait_min = patch.waitMin;
      if (patch.waitMax !== undefined) update.wait_max = patch.waitMax;
      if (patch.currency !== undefined) update.currency = patch.currency;
      if (patch.restaurantName !== undefined) update.restaurant_name = patch.restaurantName;
      if (patch.phone !== undefined) update.phone = patch.phone;
      if (patch.email !== undefined) update.email = patch.email;
      if (patch.address !== undefined) update.address = patch.address;
      if (patch.whatsappNumber !== undefined) update.whatsapp_number = patch.whatsappNumber;
      if (patch.reservationSlotCapacity !== undefined) update.reservation_slot_capacity = patch.reservationSlotCapacity;
      if (patch.reservationFeeEnabled !== undefined) update.reservation_fee_enabled = patch.reservationFeeEnabled;
      // Clamp like the read sanitizer: a negative amount is never a charge.
      if (patch.reservationFeeAmount !== undefined) update.reservation_fee_amount = Math.max(0, patch.reservationFeeAmount);
      if (patch.openingHours !== undefined) update.opening_hours = sanitizeOpeningHours(patch.openingHours);
      // siteLocations merges per group over the CURRENT settings: a
      // PATCH carrying only the footer group must not wipe the contact /
      // reservation groups it never mentioned.
      let mergedLocations: SiteLocations | undefined;
      if (patch.siteLocations !== undefined) {
        const current = await repo.getSettings();
        mergedLocations = {
          footer: { ...current.siteLocations.footer, ...(patch.siteLocations.footer ?? {}) },
          contact: { ...current.siteLocations.contact, ...(patch.siteLocations.contact ?? {}) },
          reservation: { ...current.siteLocations.reservation, ...(patch.siteLocations.reservation ?? {}) },
        };
        update.site_locations = mergedLocations;
      }
      // Pre-migration degradation (migrations 0010 + 0014): until the
      // owner runs a migration its columns do not exist and PostgREST
      // rejects any write naming one. Settings saves must keep working
      // exactly as before in that state, so a missing-column failure
      // retries the same write WITHOUT the columns that do not exist
      // yet — those fields simply activate once their migration runs.
      //
      // The retry is COLUMN-AWARE (mega-audit Area 4 M2): the shared
      // matchers answer on the bare 42703/PGRST204 code, which cannot
      // tell WHICH family is missing — in a partially-migrated DB
      // (0010 run, 0014 not) stripping on the bare code dropped the
      // HEALTHY locations half of a save whose only problem was the
      // fee columns. Both real error shapes name the column —
      // PostgREST PGRST204: "Could not find the 'reservation_fee_amount'
      // column of 'restaurant_settings' in the schema cache"; PG
      // 42703: "column restaurant_settings.reservation_fee_amount does
      // not exist" — so the names are extracted from the message and
      // ONLY the family(ies) owning a named column present in the row
      // are stripped. An error naming no recognisable column keeps the
      // conservative fallback: strip every optional family present.
      // (The shared matchers keep their bare-code semantics for their
      // other callers — read/degradation paths — untouched; the
      // precision lives only in this retry.)
      const OPTIONAL_COLUMN_FAMILIES: { columns: string[]; isMissing: (e: { code?: string; message?: string }) => boolean }[] = [
        { columns: ['site_locations'], isMissing: isMissingSiteLocationsError },
        { columns: ['reservation_fee_enabled', 'reservation_fee_amount'], isMissing: isMissingReservationFeeError },
      ];
      const namedOptionalColumns = (message: string | undefined): Set<string> => {
        const named = new Set<string>();
        if (typeof message !== 'string') return named;
        for (const family of OPTIONAL_COLUMN_FAMILIES) {
          for (const column of family.columns) {
            if (message.includes(column)) named.add(column);
          }
        }
        return named;
      };
      // One strip step: returns the row minus the family(ies) the
      // error indicts, or null when this error justifies no (further)
      // strip — either it is not a missing-column error at all, or
      // every family it names is already absent from the row.
      const withoutMissingColumns = (row: Row, error: { code?: string; message?: string }): Row | null => {
        // Code veto (audit D1): only missing-column errors may trigger
        // degradation. If the error carries a code that is neither
        // 42703 nor PGRST204 it is a genuine error, however its message
        // reads — a named column in another error's message (e.g. an
        // auto-named CHECK constraint on the fee column) must never
        // cause a silent drop. Errors with no code keep the
        // message-based behaviour below.
        if (error.code && error.code !== '42703' && error.code !== 'PGRST204') return null;
        const named = namedOptionalColumns(error.message);
        const rest = { ...row };
        let stripped = false;
        for (const family of OPTIONAL_COLUMN_FAMILIES) {
          if (!family.columns.some((c) => c in rest)) continue;
          if (!family.isMissing(error)) continue;
          // Precision applies only when the error names a column of
          // THIS family; a named column from another family (or the
          // family matcher firing on message text alone) must not
          // strip a family the error never indicted.
          if (named.size > 0 && !family.columns.some((c) => named.has(c))) continue;
          for (const column of family.columns) delete rest[column];
          stripped = true;
        }
        return stripped ? rest : null;
      };
      // Precise stripping can need more than one round: when BOTH
      // migrations are missing, the first error names only one family
      // (PostgREST reports a single column), the retry then fails
      // naming the other. Iterate — re-attempt, re-parse, strip
      // further — until the write lands or no further strip is
      // possible. Two optional families bound the loop: the initial
      // attempt plus at most one productive strip per family.
      const MAX_WRITE_ATTEMPTS = 1 + OPTIONAL_COLUMN_FAMILIES.length;
      const writeWithDegradation = async (
        write: (row: Row) => Promise<{ error: { code?: string; message?: string } | null }>,
        row: Row,
      ): Promise<{ code?: string; message?: string } | null> => {
        let current = row;
        for (let attempt = 1; ; attempt++) {
          const { error: writeError } = await write(current);
          if (!writeError) return null;
          if (attempt >= MAX_WRITE_ATTEMPTS) return writeError;
          const retry = withoutMissingColumns(current, writeError);
          if (!retry) return writeError;
          current = retry;
        }
      };
      let data: unknown[] | null = null;
      const error = await writeWithDegradation(
        async (row) => {
          const res = await db.from('restaurant_settings').update(row).eq('id', 1).select('id');
          data = res.data;
          return { error: res.error };
        },
        update,
      );
      if (error) throw new Error(`settings update failed: ${error.message}`);
      if ((data ?? []).length === 0) {
        // The singleton row is missing (seed never ran, or the row was
        // deleted): an UPDATE alone would change nothing and the admin's
        // save would evaporate behind a normal-looking defaults response.
        // Insert the row instead — the patch applied over the defaults —
        // so what the admin saved is what persists.
        const restPatch: SettingsPatch = { ...patch };
        delete restPatch.siteLocations;
        const merged: PublicSettingsDTO = {
          ...DEFAULT_SETTINGS, ...restPatch,
          siteLocations: mergedLocations ?? DEFAULT_SETTINGS.siteLocations,
        };
        const row = settingsRow(merged);
        const insertError = await writeWithDegradation(
          async (r) => {
            const res = await db.from('restaurant_settings').insert(r);
            return { error: res.error };
          },
          row,
        );
        if (insertError) throw new Error(`settings insert failed: ${insertError.message}`);
      }
      return repo.getSettings();
    },
  };

  return repo;
}

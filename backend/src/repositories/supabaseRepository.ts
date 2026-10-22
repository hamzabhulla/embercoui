import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { currencyExponent, sanitizeCurrencyCode } from '../lib/currency';
import { ApiError } from '../lib/errors';
import type {
  AdminReservationInput, CouponDTO, CreateOrderData, CustomerDTO, MenuItemDTO, NewsletterSubscriberDTO,
  OrderDTO, Page, PageParams, ProfileDTO, PublicSettingsDTO, ReservationDTO, ReservationInput,
  Repository, ReviewDTO, SettingsPatch, SiteLocations,
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
    contact: { phone: null, email: null, address: null, hours: null, mapLocation: null },
    reservation: { phone: null, address: null, hours: null, locationLabel: null },
  };
}
function sanitizeSiteLocations(raw: unknown): SiteLocations {
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
    openingHours: (r.opening_hours as Record<string, unknown>) ?? {},
    siteLocations: sanitizeSiteLocations(r.site_locations),
  };
}
export const DEFAULT_SETTINGS: PublicSettingsDTO = {
  kitchenOpen: true, waitMin: 20, waitMax: 30, currency: 'USD', restaurantName: 'Ember & Co.',
  phone: null, email: null, address: null, whatsappNumber: null, reservationSlotCapacity: 40, openingHours: {},
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
    opening_hours: s.openingHours,
    site_locations: s.siteLocations,
  };
}
function reviewDTO(r: Row): ReviewDTO {
  return { id: str(r.id), name: str(r.name), rating: num(r.rating), comment: str(r.comment), country: strOrNull(r.country), createdAt: str(r.created_at) };
}
function profileDTO(r: Row): ProfileDTO {
  const favorites = Array.isArray(r.favorites) ? (r.favorites as unknown[]).filter((f): f is number => typeof f === 'number') : [];
  return {
    id: str(r.id),
    role: (['customer', 'admin', 'staff'].includes(str(r.role)) ? str(r.role) : 'customer') as ProfileDTO['role'],
    fullName: strOrNull(r.full_name),
    phone: strOrNull(r.phone),
    addresses: Array.isArray(r.addresses) ? (r.addresses as unknown[]) : [],
    favorites,
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
    createdAt: str(r.created_at),
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
    const { data, error } = await db
      .from('order_items')
      .select('order_id, menu_item_id, name, unit_price, quantity')
      .in('order_id', ids)
      .order('id', { ascending: true });
    if (error) throw new Error(`order_items query failed: ${error.message}`);
    const byOrder = new Map<string, OrderDTO['items']>();
    for (const raw of (data ?? []) as Row[]) {
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
    let query = db.from('orders').select('*', { count: 'exact' }).order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error, count } = await query.range(page.offset, page.offset + page.limit - 1);
    if (error) throw new Error(`orders query failed: ${error.message}`);
    return { items: await attachItems((data ?? []) as Row[]), total: count ?? 0 };
  }

  async function adminListReservations(): Promise<ReservationDTO[]>;
  async function adminListReservations(page: PageParams): Promise<Page<ReservationDTO>>;
  async function adminListReservations(page?: PageParams): Promise<ReservationDTO[] | Page<ReservationDTO>> {
    if (!page) return fetchAllPages((p) => adminListReservations(p));
    const { data, error, count } = await db
      .from('reservations')
      .select('*', { count: 'exact' })
      // Deterministic order for paging: newest date first; within a date,
      // earliest seating first (the day board's view); created_at breaks
      // the remaining ties so pages never overlap or skip a row.
      .order('reservation_date', { ascending: false })
      .order('reservation_time', { ascending: true })
      .order('created_at', { ascending: false })
      .range(page.offset, page.offset + page.limit - 1);
    if (error) throw new Error(`reservations query failed: ${error.message}`);
    return { items: ((data ?? []) as Row[]).map(reservationDTO), total: count ?? 0 };
  }

  async function adminListNewsletter(): Promise<NewsletterSubscriberDTO[]>;
  async function adminListNewsletter(page: PageParams): Promise<Page<NewsletterSubscriberDTO>>;
  async function adminListNewsletter(page?: PageParams): Promise<NewsletterSubscriberDTO[] | Page<NewsletterSubscriberDTO>> {
    if (!page) return fetchAllPages((p) => adminListNewsletter(p));
    const { data, error, count } = await db
      .from('newsletter_subscribers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page.offset, page.offset + page.limit - 1);
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

  const repo: Repository = {
    async listMenuItems() {
      const { data, error } = await db.from('menu_items').select('*').eq('is_available', true).order('sort_order').order('id');
      if (error) throw new Error(`menu query failed: ${error.message}`);
      return ((data ?? []) as Row[]).map(menuDTO);
    },
    async listAllMenuItems() {
      const { data, error } = await db.from('menu_items').select('*').order('sort_order').order('id');
      if (error) throw new Error(`menu query failed: ${error.message}`);
      return ((data ?? []) as Row[]).map(menuFull);
    },
    async getMenuItem(id) {
      const { data, error } = await db.from('menu_items').select('*').eq('id', id).eq('is_available', true).maybeSingle();
      if (error) throw new Error(`menu query failed: ${error.message}`);
      return data ? menuDTO(data as Row) : null;
    },
    async getSettings() {
      const { data, error } = await db.from('restaurant_settings').select('*').eq('id', 1).maybeSingle();
      if (error) throw new Error(`settings query failed: ${error.message}`);
      return data ? settingsDTO(data as Row) : DEFAULT_SETTINGS;
    },
    async listApprovedReviews() {
      const { data, error } = await db.from('reviews').select('*').eq('is_approved', true).order('created_at', { ascending: false });
      if (error) throw new Error(`reviews query failed: ${error.message}`);
      return ((data ?? []) as Row[]).map(reviewDTO);
    },

    async getProfile(userId) {
      const { data, error } = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (error) throw new Error(`profile query failed: ${error.message}`);
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
        })
        .select('*')
        .single();
      if (error) throw new Error(`reservation insert failed: ${error.message}`);
      return reservationDTO(data as Row);
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
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw new Error(`orders query failed: ${error.message}`);
      return attachItems((data ?? []) as Row[]);
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
      if (error) throw new Error(`order query failed: ${error.message}`);
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
      if (error) throw new Error(`order payment update failed: ${error.message}`);
      // Zero matched rows: the order is gone, or its state moved on
      // (paid/cancelled) since the caller read it. Report "not stored"
      // rather than throwing or passing silently — the caller re-reads
      // and answers for the order's current state, because handing out
      // a client secret for an intent that was never stored would
      // strand the payment.
      return !!data && data.length > 0;
    },
    async markOrderPaidByPaymentIntent(paymentIntentId) {
      const { data, error } = await db.from('orders').select('id').eq('payment_intent_id', paymentIntentId).maybeSingle();
      if (error) throw new Error(`order lookup failed: ${error.message}`);
      if (!data) return null;
      const orderId = str((data as Row).id);
      // Guarded transition: 'paid' may be set from unpaid/pending/failed
      // (a succeeded event after a failed attempt is a legitimate card
      // retry). 'paid' itself is terminal — re-deliveries and later events
      // match zero rows here and change nothing.
      const { error: updError } = await db
        .from('orders')
        .update({ payment_status: 'paid' })
        .eq('id', orderId)
        .in('payment_status', ['unpaid', 'pending', 'failed']);
      if (updError) throw new Error(`order payment update failed: ${updError.message}`);
      return repo.getOrder(orderId);
    },
    async markOrderPaymentFailedByPaymentIntent(paymentIntentId) {
      const { data, error } = await db.from('orders').select('id').eq('payment_intent_id', paymentIntentId).maybeSingle();
      if (error) throw new Error(`order lookup failed: ${error.message}`);
      if (!data) return null;
      const orderId = str((data as Row).id);
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
    async updateOrderStatus(orderId, status) {
      const { error } = await db.from('orders').update({ status }).eq('id', orderId);
      if (error) throw new Error(`order status update failed: ${error.message}`);
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
      if (error) throw new Error(`reservation query failed: ${error.message}`);
      return data ? reservationDTO(data as Row) : null;
    },
    async updateReservationStatus(id, status) {
      const { data, error } = await db.from('reservations').update({ status }).eq('id', id).select('*').maybeSingle();
      if (error) throw new Error(`reservation update failed: ${error.message}`);
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
    adminListCustomers,
    async adminListReviews() {
      const { data, error } = await db.from('reviews').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(`reviews query failed: ${error.message}`);
      return ((data ?? []) as Row[]).map((r) => ({ ...reviewDTO(r), isApproved: r.is_approved === true }));
    },
    async setReviewApproved(id, approved) {
      const { data, error } = await db.from('reviews').update({ is_approved: approved }).eq('id', id).select('id');
      if (error) throw new Error(`review update failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async deleteReview(id) {
      const { data, error } = await db.from('reviews').delete().eq('id', id).select('id');
      if (error) throw new Error(`review delete failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    adminListNewsletter,
    async adminListCoupons() {
      const { data, error } = await db.from('coupons').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(`coupons query failed: ${error.message}`);
      return ((data ?? []) as Row[]).map(couponDTO);
    },
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
        throw new Error(`coupon update failed: ${error.message}`);
      }
      return data ? couponDTO(data as Row) : null;
    },
    async deleteCoupon(id) {
      const { data, error } = await db.from('coupons').delete().eq('id', id).select('id');
      if (error) throw new Error(`coupon delete failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async adminListStaff() {
      // All profiles: the Staff screen is where customers get promoted.
      // Paged internally so the list stays complete past 1000 profiles,
      // with emails from the single listUsers sweep (no per-profile N+1).
      const emails = await fetchEmailMap();
      const profiles: ProfileDTO[] = [];
      for (let p = 0; p < MAX_ALL_PAGES; p++) {
        const from = p * ALL_PAGE_SIZE;
        const { data, error } = await db
          .from('profiles').select('*').order('created_at')
          .range(from, from + ALL_PAGE_SIZE - 1);
        if (error) throw new Error(`staff query failed: ${error.message}`);
        const rows = ((data ?? []) as Row[]).map(profileDTO);
        profiles.push(...rows);
        if (rows.length < ALL_PAGE_SIZE) break;
      }
      return profiles.map((profile) => ({ ...profile, email: emails.get(profile.id) ?? null }));
    },
    async updateProfileRole(userId, role) {
      const { data, error } = await db.from('profiles').update({ role }).eq('id', userId).select('*').maybeSingle();
      if (error) throw new Error(`role update failed: ${error.message}`);
      return data ? profileDTO(data as Row) : null;
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
      if (patch.openingHours !== undefined) update.opening_hours = patch.openingHours;
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
      // Pre-migration degradation (migration 0010): until the owner runs
      // 0010 the site_locations column does not exist and PostgREST
      // rejects any write naming it. Settings saves must keep working
      // exactly as before in that state, so a missing-column failure
      // retries the same write WITHOUT the new column — the location
      // fields simply activate once 0010 has run.
      const withoutLocations = (row: Row): Row => {
        const rest = { ...row };
        delete rest.site_locations;
        return rest;
      };
      let { data, error } = await db.from('restaurant_settings').update(update).eq('id', 1).select('id');
      if (error && 'site_locations' in update && isMissingSiteLocationsError(error)) {
        ({ data, error } = await db.from('restaurant_settings').update(withoutLocations(update)).eq('id', 1).select('id'));
      }
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
        let { error: insertError } = await db.from('restaurant_settings').insert(row);
        if (insertError && isMissingSiteLocationsError(insertError)) {
          ({ error: insertError } = await db.from('restaurant_settings').insert(withoutLocations(row)));
        }
        if (insertError) throw new Error(`settings insert failed: ${insertError.message}`);
      }
      return repo.getSettings();
    },
  };

  return repo;
}

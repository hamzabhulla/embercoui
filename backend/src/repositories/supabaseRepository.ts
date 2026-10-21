import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { currencyExponent, sanitizeCurrencyCode } from '../lib/currency';
import type {
  CouponDTO, CreateOrderData, MenuItemDTO, OrderDTO, ProfileDTO,
  PublicSettingsDTO, ReservationDTO, ReservationInput, Repository, ReviewDTO,
} from './types';

type Row = Record<string, unknown>;

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
function settingsDTO(r: Row): PublicSettingsDTO {
  return {
    kitchenOpen: r.kitchen_open !== false,
    waitMin: num(r.wait_min) || 20,
    waitMax: num(r.wait_max) || 30,
    currency: sanitizeCurrencyCode(r.currency),
    restaurantName: str(r.restaurant_name) || 'Ember & Co.',
    phone: strOrNull(r.phone),
    email: strOrNull(r.email),
    address: strOrNull(r.address),
    whatsappNumber: strOrNull(r.whatsapp_number),
    openingHours: (r.opening_hours as Record<string, unknown>) ?? {},
  };
}
export const DEFAULT_SETTINGS: PublicSettingsDTO = {
  kitchenOpen: true, waitMin: 20, waitMax: 30, currency: 'USD', restaurantName: 'Ember & Co.',
  phone: null, email: null, address: null, whatsappNumber: null, openingHours: {},
};
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
    name: str(r.name), email: str(r.email), phone: str(r.phone),
    date: str(r.reservation_date), time: str(r.reservation_time),
    guests: num(r.guests),
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
      const { data, error } = await db.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      if (error) throw new Error(`orders query failed: ${error.message}`);
      return attachItems((data ?? []) as Row[]);
    },

    async createOrder(data: CreateOrderData) {
      const { data: row, error } = await db
        .from('orders')
        .insert({
          user_id: data.userId, customer_name: data.customerName, customer_email: data.customerEmail,
          customer_phone: data.customerPhone, delivery_address: data.address, notes: data.notes,
          coupon_code: data.couponCode, currency: data.currency, subtotal: data.subtotal, delivery_fee: data.deliveryFee,
          discount: data.discount, total: data.total, status: 'pending', payment_status: 'unpaid',
        })
        .select('*')
        .single();
      if (error) throw new Error(`order insert failed: ${error.message}`);
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
      const { error } = await db.from('orders').update({ payment_intent_id: paymentIntentId, payment_status: 'pending' }).eq('id', orderId);
      if (error) throw new Error(`order payment update failed: ${error.message}`);
    },
    async markOrderPaidByPaymentIntent(paymentIntentId) {
      const { data, error } = await db.from('orders').select('id').eq('payment_intent_id', paymentIntentId).maybeSingle();
      if (error) throw new Error(`order lookup failed: ${error.message}`);
      if (!data) return null;
      const orderId = str((data as Row).id);
      const { error: updError } = await db.from('orders').update({ payment_status: 'paid' }).eq('id', orderId);
      if (updError) throw new Error(`order payment update failed: ${updError.message}`);
      return repo.getOrder(orderId);
    },
    async markOrderPaymentFailedByPaymentIntent(paymentIntentId) {
      const { error } = await db.from('orders').update({ payment_status: 'failed' }).eq('payment_intent_id', paymentIntentId);
      if (error) throw new Error(`order payment update failed: ${error.message}`);
    },
    async getCouponByCode(code) {
      const { data, error } = await db.from('coupons').select('*').eq('code', code.toUpperCase()).maybeSingle();
      if (error) throw new Error(`coupon query failed: ${error.message}`);
      return data ? couponDTO(data as Row) : null;
    },

    async adminListOrders(status) {
      let query = db.from('orders').select('*').order('created_at', { ascending: false });
      if (status) query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw new Error(`orders query failed: ${error.message}`);
      return attachItems((data ?? []) as Row[]);
    },
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
    async adminListReservations() {
      const { data, error } = await db.from('reservations').select('*').order('reservation_date', { ascending: false });
      if (error) throw new Error(`reservations query failed: ${error.message}`);
      return ((data ?? []) as Row[]).map(reservationDTO);
    },
    async updateReservationStatus(id, status) {
      const { data, error } = await db.from('reservations').update({ status }).eq('id', id).select('*').maybeSingle();
      if (error) throw new Error(`reservation update failed: ${error.message}`);
      return data ? reservationDTO(data as Row) : null;
    },
    async adminListCustomers() {
      const { data: profiles, error } = await db.from('profiles').select('*').eq('role', 'customer').order('created_at', { ascending: false });
      if (error) throw new Error(`profiles query failed: ${error.message}`);
      // Lifetime spend is reported in the CURRENT settings currency only —
      // orders placed in another currency are counted, never summed in,
      // so two currencies are never silently added together.
      const settings = await repo.getSettings();
      const { data: orders, error: ordersError } = await db.from('orders').select('user_id, total, payment_status, currency');
      if (ordersError) throw new Error(`customer order aggregation failed: ${ordersError.message}`);
      const counts = new Map<string, { count: number; spent: number }>();
      for (const o of (orders ?? []) as Row[]) {
        if (!o.user_id) continue;
        const entry = counts.get(str(o.user_id)) ?? { count: 0, spent: 0 };
        entry.count += 1;
        if (o.payment_status === 'paid' && sanitizeCurrencyCode(o.currency) === settings.currency) entry.spent += num(o.total);
        counts.set(str(o.user_id), entry);
      }
      const out = [];
      for (const p of (profiles ?? []) as Row[]) {
        const dto = profileDTO(p);
        let email: string | null = null;
        try {
          const { data: authUser } = await db.auth.admin.getUserById(dto.id);
          email = authUser?.user?.email ?? null;
        } catch { /* email is best-effort */ }
        const c = counts.get(dto.id) ?? { count: 0, spent: 0 };
        const expFactor = 10 ** currencyExponent(settings.currency);
        out.push({ ...dto, email, orderCount: c.count, totalSpent: Math.round(c.spent * expFactor) / expFactor });
      }
      return out;
    },
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
    async adminListNewsletter() {
      const { data, error } = await db.from('newsletter_subscribers').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(`newsletter query failed: ${error.message}`);
      return ((data ?? []) as Row[]).map((r) => ({ id: str(r.id), email: str(r.email), createdAt: str(r.created_at) }));
    },
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
      if (error) throw new Error(`coupon insert failed: ${error.message}`);
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
      if (error) throw new Error(`coupon update failed: ${error.message}`);
      return data ? couponDTO(data as Row) : null;
    },
    async deleteCoupon(id) {
      const { data, error } = await db.from('coupons').delete().eq('id', id).select('id');
      if (error) throw new Error(`coupon delete failed: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async adminListStaff() {
      // All profiles: the Staff screen is where customers get promoted.
      const { data, error } = await db.from('profiles').select('*').order('created_at');
      if (error) throw new Error(`staff query failed: ${error.message}`);
      const profiles = ((data ?? []) as Row[]).map(profileDTO);
      return Promise.all(
        profiles.map(async (profile) => {
          let email: string | null = null;
          try {
            const { data: userData } = await db.auth.admin.getUserById(profile.id);
            email = userData?.user?.email ?? null;
          } catch { email = null; }
          return { ...profile, email };
        }),
      );
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
      if (patch.openingHours !== undefined) update.opening_hours = patch.openingHours;
      const { error } = await db.from('restaurant_settings').update(update).eq('id', 1);
      if (error) throw new Error(`settings update failed: ${error.message}`);
      return repo.getSettings();
    },
  };

  return repo;
}

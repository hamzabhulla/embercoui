export interface MenuItemDTO {
  id: number;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  tags: string[];
}

export interface PublicSettingsDTO {
  kitchenOpen: boolean;
  waitMin: number;
  waitMax: number;
  restaurantName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  openingHours: Record<string, unknown>;
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

export interface ReservationInput {
  userId: string | null;
  name: string;
  email: string;
  phone: string;
  date: string;
  time: string;
  guests: number;
}

export interface ReservationDTO extends ReservationInput {
  id: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  createdAt: string;
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
  setOrderPaymentIntent(orderId: string, paymentIntentId: string): Promise<void>;
  markOrderPaidByPaymentIntent(paymentIntentId: string): Promise<OrderDTO | null>;
  markOrderPaymentFailedByPaymentIntent(paymentIntentId: string): Promise<void>;
  getCouponByCode(code: string): Promise<CouponDTO | null>;

  // Admin (Phase 4)
  adminListOrders(status?: string): Promise<OrderDTO[]>;
  updateOrderStatus(orderId: string, status: OrderStatus): Promise<OrderDTO | null>;
  createMenuItem(data: Omit<MenuItemDTO, 'id'> & { isAvailable: boolean; sortOrder: number }): Promise<MenuItemDTO & { isAvailable: boolean; sortOrder: number }>;
  updateMenuItem(id: number, patch: Partial<MenuItemDTO> & { isAvailable?: boolean; sortOrder?: number }): Promise<(MenuItemDTO & { isAvailable: boolean; sortOrder: number }) | null>;
  deleteMenuItem(id: number): Promise<boolean>;
  adminListReservations(): Promise<ReservationDTO[]>;
  updateReservationStatus(id: string, status: ReservationDTO['status']): Promise<ReservationDTO | null>;
  adminListCustomers(): Promise<(ProfileDTO & { email: string | null; orderCount: number; totalSpent: number })[]>;
  adminListReviews(): Promise<(ReviewDTO & { isApproved: boolean })[]>;
  setReviewApproved(id: string, approved: boolean): Promise<boolean>;
  deleteReview(id: string): Promise<boolean>;
  adminListNewsletter(): Promise<{ id: string; email: string; createdAt: string }[]>;
  adminListCoupons(): Promise<CouponDTO[]>;
  createCoupon(data: Omit<CouponDTO, 'id'>): Promise<CouponDTO>;
  updateCoupon(id: string, patch: Partial<Omit<CouponDTO, 'id'>>): Promise<CouponDTO | null>;
  deleteCoupon(id: string): Promise<boolean>;
  adminListStaff(): Promise<StaffDTO[]>;
  updateProfileRole(userId: string, role: ProfileDTO['role']): Promise<ProfileDTO | null>;
  updateSettings(patch: Partial<PublicSettingsDTO> & { kitchenOpen?: boolean }): Promise<PublicSettingsDTO>;
}

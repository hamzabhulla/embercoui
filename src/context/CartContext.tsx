/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface CartItem {
  id: number;
  name: string;
  price: number;
  image: string;
  quantity: number;
  /** The dish's real menu description, snapshotted at add time (cart line subtitle). */
  description?: string;
}

/**
 * A coupon the customer applied and the API validated — the same
 * snapshot shape POST /api/v1/coupons/validate returns and Checkout
 * uses. The discount itself is never stored: it is always recomputed
 * from this snapshot against the live subtotal, exactly like the
 * server computes it at order time.
 */
export interface AppliedCoupon {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
}

interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (id: number) => void;
  clearCart: () => void;
  updateQuantity: (id: number, quantity: number) => void;
  totalCount: number;
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  coupon: AppliedCoupon | null;
  applyCoupon: (coupon: AppliedCoupon) => void;
  removeCoupon: () => void;
}

const CartContext = createContext<CartContextType | null>(null);

const CART_STORAGE_KEY = 'ember_cart';
const COUPON_STORAGE_KEY = 'ember_cart_coupon';

function isValidCartItem(i: unknown): i is CartItem {
  if (!i || typeof i !== 'object') return false;
  const item = i as Record<string, unknown>;
  return (
    typeof item.id === 'number' && Number.isInteger(item.id) && Number.isFinite(item.id) &&
    typeof item.name === 'string' && item.name.trim().length > 0 &&
    typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0 &&
    typeof item.image === 'string' &&
    typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity >= 1
  );
}

function loadStoredCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Fully validate every entry, drop anything malformed, and de-duplicate
    // by id — duplicates are merged by summing their quantities.
    const byId = new Map<number, CartItem>();
    for (const entry of parsed) {
      if (!isValidCartItem(entry)) continue;
      const description = typeof entry.description === 'string' && entry.description.trim()
        ? entry.description
        : undefined;
      const existing = byId.get(entry.id);
      if (existing) {
        byId.set(entry.id, {
          ...existing,
          quantity: existing.quantity + entry.quantity,
          description: existing.description ?? description,
        });
      } else {
        byId.set(entry.id, {
          id: entry.id, name: entry.name, price: entry.price, image: entry.image,
          quantity: entry.quantity, ...(description ? { description } : {}),
        });
      }
    }
    return [...byId.values()];
  } catch {
    return [];
  }
}

function isValidCoupon(c: unknown): c is AppliedCoupon {
  if (!c || typeof c !== 'object') return false;
  const coupon = c as Record<string, unknown>;
  return (
    typeof coupon.code === 'string' && coupon.code.trim().length > 0 &&
    (coupon.type === 'percent' || coupon.type === 'fixed') &&
    typeof coupon.value === 'number' && Number.isFinite(coupon.value) && coupon.value > 0
  );
}

function loadStoredCoupon(): AppliedCoupon | null {
  try {
    const raw = localStorage.getItem(COUPON_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidCoupon(parsed) ? { code: parsed.code, type: parsed.type, value: parsed.value } : null;
  } catch {
    return null;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(loadStoredCart);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(loadStoredCoupon);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage full/unavailable — cart simply won't persist */
    }
  }, [items]);

  // The applied coupon persists alongside the cart (same storage
  // lifecycle): it survives a reload exactly like the items do, and
  // clearCart removes it.
  useEffect(() => {
    try {
      if (coupon) localStorage.setItem(COUPON_STORAGE_KEY, JSON.stringify(coupon));
      else localStorage.removeItem(COUPON_STORAGE_KEY);
    } catch {
      /* storage full/unavailable — coupon simply won't persist */
    }
  }, [coupon]);

  const addItem = (item: Omit<CartItem, 'quantity'>) => {
    setItems(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        // Backfill the description if this entry predates it (e.g. a
        // cart persisted before descriptions were snapshotted).
        return prev.map(i => i.id === item.id
          ? { ...i, quantity: i.quantity + 1, description: i.description ?? item.description }
          : i);
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const clearCart = () => {
    setItems([]);
    setCoupon(null);
  };

  const applyCoupon = (next: AppliedCoupon) => setCoupon(next);
  const removeCoupon = () => setCoupon(null);

  const removeItem = (id: number) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const updateQuantity = (id: number, quantity: number) => {
    setItems(prev => {
      if (quantity <= 0) return prev.filter(i => i.id !== id);
      return prev.map(i => i.id === id ? { ...i, quantity } : i);
    });
  };

  const totalCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, clearCart, updateQuantity, totalCount, isOpen, setIsOpen, coupon, applyCoupon, removeCoupon }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}

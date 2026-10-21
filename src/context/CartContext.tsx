/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface CartItem {
  id: number;
  name: string;
  price: number;
  image: string;
  quantity: number;
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
}

const CartContext = createContext<CartContextType | null>(null);

const CART_STORAGE_KEY = 'ember_cart';

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
      const existing = byId.get(entry.id);
      if (existing) {
        byId.set(entry.id, { ...existing, quantity: existing.quantity + entry.quantity });
      } else {
        byId.set(entry.id, { id: entry.id, name: entry.name, price: entry.price, image: entry.image, quantity: entry.quantity });
      }
    }
    return [...byId.values()];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(loadStoredCart);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage full/unavailable — cart simply won't persist */
    }
  }, [items]);

  const addItem = (item: Omit<CartItem, 'quantity'>) => {
    setItems(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const clearCart = () => setItems([]);

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
    <CartContext.Provider value={{ items, addItem, removeItem, clearCart, updateQuantity, totalCount, isOpen, setIsOpen }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}

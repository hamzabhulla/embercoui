import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchPublicSettings } from '../services/api';
import { formatMoney, isValidCurrencyCode } from '../lib/currency';

interface CurrencyCtx {
  /** The restaurant's active currency (from backend settings; USD until loaded). */
  currency: string;
  /** Format an amount in the active currency, or in `code` when given (e.g. an order's snapshot). */
  format: (amount: number, code?: string) => string;
  /** Re-read the currency from the backend (call after saving admin settings). */
  refresh: () => Promise<void>;
}

const Ctx = createContext<CurrencyCtx | null>(null);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrency] = useState('USD');

  const refresh = useCallback(async () => {
    const settings = await fetchPublicSettings();
    if (settings?.currency && isValidCurrencyCode(settings.currency)) {
      setCurrency(settings.currency.toUpperCase());
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<CurrencyCtx>(() => ({
    currency,
    format: (amount: number, code?: string) => formatMoney(amount, code ?? currency),
    refresh,
  }), [currency, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrency(): CurrencyCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCurrency must be used inside CurrencyProvider');
  return ctx;
}

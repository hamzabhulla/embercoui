import { useState } from 'react';
import { X } from 'lucide-react';
import { useCart, MAX_LINE_QUANTITY, type AppliedCoupon } from '../context/CartContext.tsx';
import { useCurrency } from '../context/CurrencyContext.tsx';
import { usePublicSettings } from '../hooks/usePublicSettings.ts';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../services/api.ts';
import { fromMinorUnits, toMinorUnits } from '../lib/currency.ts';

export default function CartSidebar() {
  const navigate = useNavigate();
  const { items, isOpen, setIsOpen, updateQuantity, coupon, applyCoupon, removeCoupon, priceStatus, cartNotice } = useCart();
  const { format, currency } = useCurrency();
  // Same settings-driven brand name (and same fallback) as Navbar/Footer.
  const settings = usePublicSettings();
  const brandName = settings?.restaurantName ?? 'Ember & Co.';

  const [couponInput, setCouponInput] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponMsg, setCouponMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  // Mirror the server's discount math exactly (backend orders route):
  // integer minor units; percent → round(subtotal × value / 100);
  // fixed → min(value, subtotal); the result never exceeds the
  // subtotal. It is recomputed from the live subtotal on every render,
  // so the line can never overstate what the coupon is worth right
  // now — the server remains the final authority at order time.
  const subtotalMinor = toMinorUnits(subtotal, currency);
  const discountMinor = !coupon
    ? 0
    : coupon.type === 'percent'
      ? Math.round((subtotalMinor * coupon.value) / 100)
      : Math.min(toMinorUnits(coupon.value, currency), subtotalMinor);
  const discount = fromMinorUnits(Math.min(discountMinor, subtotalMinor), currency);
  const total = Math.max(0, subtotal - discount);

  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = couponInput.trim();
    if (!code || couponBusy) return;
    setCouponBusy(true);
    setCouponMsg(null);
    // The same validation endpoint Checkout uses — the drawer holds no
    // coupon logic of its own beyond displaying the outcome.
    const res = await apiRequest<{ valid: boolean; coupon?: AppliedCoupon }>('/api/v1/coupons/validate', {
      method: 'POST', body: JSON.stringify({ code }),
    });
    setCouponBusy(false);
    if (res.ok && res.data?.valid && res.data.coupon) {
      applyCoupon(res.data.coupon);
      setCouponInput('');
      setCouponMsg({
        text: `Coupon applied — ${res.data.coupon.type === 'percent' ? `${res.data.coupon.value}% off` : `${format(res.data.coupon.value)} off`}.`,
        ok: true,
      });
    } else if (res.ok) {
      setCouponMsg({ text: 'This coupon code is not valid.', ok: false });
    } else {
      setCouponMsg({ text: res.error ?? 'We could not check that coupon — please try again.', ok: false });
    }
  };

  const handleRemoveCoupon = () => {
    removeCoupon();
    setCouponMsg(null);
  };

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-[80] transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'rgba(0,0,0,0.6)' }}
        onClick={() => setIsOpen(false)}
      />

      {/* Sidebar */}
      <aside
        className={`fixed top-0 right-0 h-full w-full md:w-[420px] z-[90] flex flex-col overflow-hidden ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ 
          background: '#0D1A0E',
          transition: 'transform 350ms ease'
        }}
      >
        {/* Header */}
        <div 
          className="flex flex-col relative"
          style={{ padding: '20px 28px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center justify-between w-full">
            <span 
              style={{ 
                fontFamily: 'Jost, sans-serif', 
                fontSize: '9px', 
                letterSpacing: '0.25em',
                color: '#C17A3A',
                textTransform: 'uppercase'
              }}
            >
              Your Order
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="transition-colors duration-200 hover:text-white"
              style={{ color: 'rgba(245,240,232,0.35)' }}
            >
              <X size={20} strokeWidth={1.5} />
            </button>
          </div>
          
          <div className="mt-2 flex items-center gap-3">
            {/* Brand monogram (logo kit) beside the drawer's brand
                heading — the heading text itself is unchanged. */}
            <img src="/ember-co-monogram.svg" alt="" className="w-[28px] h-[28px] shrink-0" />
            <h2
              style={{
                fontFamily: 'Cormorant Garamond, serif',
                fontSize: '28px',
                fontWeight: 300,
                color: '#F5F0E8'
              }}
            >
              {brandName}
            </h2>
          </div>
          
          <div 
            className="mt-4"
            style={{ width: '36px', height: '1px', backgroundColor: '#C17A3A' }}
          />
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '0 28px' }}>
          {cartNotice && (
            <p
              style={{
                fontFamily: 'Jost, sans-serif',
                fontSize: '11.5px',
                lineHeight: 1.6,
                color: '#D9A45B',
                paddingTop: '18px'
              }}
            >
              {cartNotice}
            </p>
          )}
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center space-y-4">
              <span style={{ color: '#C17A3A', fontSize: '24px' }}>✦</span>
              <h3 
                style={{ 
                  fontFamily: 'Cormorant Garamond, serif', 
                  fontSize: '22px',
                  color: '#F5F0E8'
                }}
              >
                Your cart is empty
              </h3>
              <p 
                style={{ 
                  fontFamily: 'Jost, sans-serif', 
                  fontSize: '13px',
                  color: 'rgba(245,240,232,0.35)',
                  fontWeight: 300
                }}
              >
                Add items from our menu to begin
              </p>
              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate('/menu');
                }}
                className="mt-4 transition-colors hover:bg-[rgba(193,122,58,0.1)]"
                style={{
                  border: '1px solid #C17A3A',
                  color: '#C17A3A',
                  fontFamily: 'Jost, sans-serif',
                  fontSize: '11px',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  padding: '12px 24px',
                  background: 'transparent'
                }}
              >
                View Menu
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              {items.map((item, idx) => (
                <div 
                  key={item.id} 
                  className="flex gap-4 py-6"
                  style={{ 
                    borderBottom: idx < items.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' 
                  }}
                >
                  <img
                    src={item.image}
                    alt={item.name}
                    loading="lazy"
                    width="64"
                    height="64"
                    className="object-cover"
                    style={{ width: '64px', height: '64px' }}
                  />
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <h3
                        style={{ 
                          fontFamily: 'Cormorant Garamond, serif',
                          fontSize: '16px',
                          color: '#F5F0E8',
                          lineHeight: '1.2'
                        }}
                      >
                        {item.name}
                      </h3>
                      {item.description && (
                        <p
                          className="mt-1"
                          style={{
                            fontFamily: 'Jost, sans-serif',
                            fontSize: '11px',
                            color: 'rgba(245,240,232,0.35)',
                            fontWeight: 300,
                            lineHeight: '1.4',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                          }}
                        >
                          {item.description}
                        </p>
                      )}
                    </div>
                    
                    <div className="mt-3">
                      <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="flex items-center justify-center transition-colors hover:bg-[rgba(193,122,58,0.2)] hover:text-[#C17A3A]"
                          style={{
                            width: '26px',
                            height: '26px',
                            border: '1px solid rgba(255,255,255,0.12)',
                            background: 'none',
                            color: 'rgba(245,240,232,0.6)',
                            fontSize: '14px'
                          }}
                        >
                          −
                        </button>
                        <span 
                          style={{ 
                            fontFamily: 'Jost, sans-serif',
                            fontSize: '12px',
                            color: '#F5F0E8',
                            minWidth: '16px',
                            textAlign: 'center'
                          }}
                        >
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          disabled={item.quantity >= MAX_LINE_QUANTITY}
                          title={item.quantity >= MAX_LINE_QUANTITY ? `Max ${MAX_LINE_QUANTITY} per dish` : undefined}
                          aria-label={item.quantity >= MAX_LINE_QUANTITY ? `Maximum of ${MAX_LINE_QUANTITY} per dish reached` : `Add one more ${item.name}`}
                          className="flex items-center justify-center transition-colors hover:bg-[rgba(193,122,58,0.2)] hover:text-[#C17A3A] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[rgba(245,240,232,0.6)]"
                          style={{
                            width: '26px',
                            height: '26px',
                            border: '1px solid rgba(255,255,255,0.12)',
                            background: 'none',
                            color: 'rgba(245,240,232,0.6)',
                            fontSize: '14px'
                          }}
                        >
                          +
                        </button>
                      </div>
                      <span
                        style={{ 
                          fontFamily: 'Cormorant Garamond, serif',
                          fontSize: '16px',
                          color: '#C17A3A'
                        }}
                      >
                        {format(item.price * item.quantity)}
                      </span>
                      </div>
                      {item.quantity >= MAX_LINE_QUANTITY && (
                        <p
                          style={{
                            fontFamily: 'Jost, sans-serif',
                            fontSize: '11px',
                            color: 'rgba(245,240,232,0.45)',
                            marginTop: '6px'
                          }}
                        >
                          Max {MAX_LINE_QUANTITY} per dish
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div 
            className="flex flex-col"
            style={{ 
              padding: '20px 28px',
              borderTop: '1px solid rgba(255,255,255,0.07)'
            }}
          >
            <div className="space-y-3 mb-5">
              <div className="flex justify-between items-center">
                <span style={{
                  fontFamily: 'Jost, sans-serif',
                  fontSize: '12px',
                  color: 'rgba(245,240,232,0.4)',
                  letterSpacing: '0.06em'
                }}>
                  Subtotal
                </span>
                <span style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: '18px',
                  color: '#F5F0E8'
                }}>
                  {format(subtotal)}
                </span>
              </div>
              {coupon && (
                <div className="flex justify-between items-center">
                  <span style={{
                    fontFamily: 'Jost, sans-serif',
                    fontSize: '12px',
                    color: 'rgba(245,240,232,0.4)',
                    letterSpacing: '0.06em'
                  }}>
                    Discount ({coupon.code})
                  </span>
                  <span style={{
                    fontFamily: 'Jost, sans-serif',
                    fontSize: '14px',
                    color: '#4ade80'
                  }}>
                    −{format(discount)}
                  </span>
                </div>
              )}
            </div>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', marginBottom: '16px' }} />

            <div className="flex justify-between items-center">
              <span style={{
                fontFamily: 'Jost, sans-serif',
                fontSize: '13px',
                color: '#F5F0E8',
                letterSpacing: '0.06em'
              }}>
                Total
              </span>
              <span style={{
                fontFamily: 'Cormorant Garamond, serif',
                fontSize: '22px',
                color: '#C17A3A'
              }}>
                {format(total)}
              </span>
            </div>
            <p
              className="mt-1 mb-6"
              style={{
                fontFamily: 'Jost, sans-serif',
                fontSize: '10px',
                color: 'rgba(245,240,232,0.35)'
              }}
            >
              Delivery is calculated at checkout
            </p>
            {priceStatus === 'unverified' && (
              <p
                className="-mt-4 mb-6"
                style={{
                  fontFamily: 'Jost, sans-serif',
                  fontSize: '10px',
                  lineHeight: 1.6,
                  color: 'rgba(245,240,232,0.35)'
                }}
              >
                We couldn't confirm current prices just now — checkout always charges the live menu prices.
              </p>
            )}

            {coupon ? (
              <div className="mb-6">
                <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                  <span style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: '#F5F0E8', letterSpacing: '0.08em' }}>
                    {coupon.code}
                    <span style={{ color: 'rgba(245,240,232,0.4)', letterSpacing: 'normal' }}>
                      {' '}· {coupon.type === 'percent' ? `${coupon.value}% off` : `${format(coupon.value)} off`}
                    </span>
                  </span>
                  <button
                    onClick={handleRemoveCoupon}
                    className="transition-colors hover:text-white"
                    style={{
                      color: '#C17A3A',
                      fontFamily: 'Jost, sans-serif',
                      fontSize: '12px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                  >
                    Remove
                  </button>
                </div>
                {couponMsg && (
                  <p className="mt-2" style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', color: couponMsg.ok ? '#4ade80' : '#ef4444' }}>
                    {couponMsg.text}
                  </p>
                )}
              </div>
            ) : (
              <div className="mb-6">
                <form onSubmit={handleApplyCoupon} className="relative">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    placeholder="Coupon code"
                    className="w-full bg-transparent outline-none pb-2 transition-colors focus:border-[#C17A3A] placeholder-[rgba(245,240,232,0.3)]"
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.12)',
                      color: '#F5F0E8',
                      fontFamily: 'Jost, sans-serif',
                      fontSize: '13px'
                    }}
                  />
                  <button
                    type="submit"
                    disabled={couponBusy || !couponInput.trim()}
                    className="absolute right-0 top-0 pb-2 text-xs transition-colors hover:text-white disabled:opacity-50"
                    style={{
                      color: '#C17A3A',
                      fontFamily: 'Jost, sans-serif',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}
                  >
                    {couponBusy ? 'Checking…' : 'Apply'}
                  </button>
                </form>
                {couponMsg && (
                  <p className="mt-2" style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', color: couponMsg.ok ? '#4ade80' : '#ef4444' }}>
                    {couponMsg.text}
                  </p>
                )}
              </div>
            )}

            <button
              onClick={() => { setIsOpen(false); navigate('/checkout'); }}
              className="w-full flex items-center justify-center gap-2 transition-all duration-300 hover:brightness-110 hover:shadow-[0_0_20px_rgba(193,122,58,0.4)]"
              style={{
                background: '#C17A3A',
                color: 'white',
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                fontFamily: 'Jost, sans-serif',
                fontSize: '11px',
                padding: '16px 0'
              }}
            >
              Checkout <span style={{ fontSize: '14px' }}>→</span>
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

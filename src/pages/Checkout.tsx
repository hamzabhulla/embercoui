import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Check, CreditCard, Banknote } from 'lucide-react';
import { useCart } from '../context/CartContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest } from '../services/api.ts';
import { stripePromise } from '../lib/stripe.ts';
import { useCurrency } from '../context/CurrencyContext.tsx';
import { fromMinorUnits, toMinorUnits } from '../lib/currency.ts';

interface CreatedOrder { id: string; total: number }
interface AppliedCoupon { code: string; type: 'percent' | 'fixed'; value: number }

const headingFont: React.CSSProperties = { fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, color: '#F5F0E8' };
const labelStyle: React.CSSProperties = {
  fontFamily: 'Jost, sans-serif', textTransform: 'uppercase', letterSpacing: '0.12em',
  fontSize: '10px', color: '#C17A3A', display: 'block', marginBottom: '6px',
};
const inputStyle: React.CSSProperties = {
  fontFamily: 'Jost, sans-serif', fontSize: '14px', color: '#F5F0E8', background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.12)', padding: '11px 12px', width: '100%', outline: 'none',
};
const emberButton: React.CSSProperties = {
  background: '#C17A3A', color: 'white', textTransform: 'uppercase', letterSpacing: '0.18em',
  fontFamily: 'Jost, sans-serif', fontSize: '11px', padding: '16px 0', width: '100%',
};

function CardPaymentForm({ orderId, onPaid }: { orderId: string; onPaid: (id: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true);
    setError(null);
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    setPaying(false);
    if (confirmError) {
      setError(confirmError.message ?? 'Your card was declined — please try a different payment method.');
      return;
    }
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      onPaid(orderId);
    }
  };

  return (
    <form onSubmit={pay} className="flex flex-col gap-5">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <p className="text-[#ef4444]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>{error}</p>}
      <button type="submit" disabled={!stripe || paying} style={emberButton} className="transition-all duration-300 hover:brightness-110 disabled:opacity-60">
        {paying ? 'Processing…' : 'Pay Now'}
      </button>
      <p className="text-center" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', color: 'rgba(245,240,232,0.3)' }}>
        Payments are processed securely by Stripe. Your order is confirmed once the payment completes.
      </p>
    </form>
  );
}

export default function Checkout() {
  const { format, currency } = useCurrency();
  const navigate = useNavigate();
  const { items, clearCart } = useCart();
  const { profile } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState<'card' | 'cod'>('card');
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentStep, setPaymentStep] = useState<{ orderId: string; clientSecret: string } | null>(null);
  const [cardUnavailable, setCardUnavailable] = useState<{ orderId: string } | null>(null);
  const [orderPlaced, setOrderPlaced] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => {
    if (!profile) return;
    setName((v) => v || profile.fullName || '');
    setEmail((v) => v || profile.email || '');
    setPhone((v) => v || profile.phone || '');
    const first = (profile.addresses as { line1?: string; city?: string; postalCode?: string }[])[0];
    if (first) {
      setLine1((v) => v || first.line1 || '');
      setCity((v) => v || first.city || '');
      setPostalCode((v) => v || first.postalCode || '');
    }
  }, [profile]);

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.price * i.quantity, 0), [items]);
  const discount = useMemo(() => {
    if (!coupon) return 0;
    // Mirror the server's integer minor-unit math (in the active
    // currency) so the preview never differs from the charged amount.
    const discountMinor = coupon.type === 'percent'
      ? Math.round(toMinorUnits(subtotal, currency) * (coupon.value / 100))
      : Math.min(toMinorUnits(coupon.value, currency), toMinorUnits(subtotal, currency));
    return fromMinorUnits(discountMinor, currency);
  }, [coupon, subtotal, currency]);
  const total = Math.max(0, subtotal - discount);

  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    setCouponMsg(null);
    const res = await apiRequest<{ valid: boolean; coupon?: AppliedCoupon }>('/api/v1/coupons/validate', {
      method: 'POST', body: JSON.stringify({ code }),
    });
    if (res.ok && res.data?.valid && res.data.coupon) {
      setCoupon(res.data.coupon);
      setCouponMsg(`Coupon applied — ${res.data.coupon.type === 'percent' ? `${res.data.coupon.value}% off` : `${format(res.data.coupon.value)} off`}.`);
    } else {
      setCoupon(null);
      setCouponMsg('This coupon code is not valid.');
    }
  };

  const placeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !line1.trim() || !city.trim()) {
      setError('Please complete your name, email and delivery address.');
      return;
    }
    setError(null);
    setPlacing(true);
    const res = await apiRequest<{ order: CreatedOrder }>('/api/v1/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerName: name.trim(),
        customerEmail: email.trim(),
        customerPhone: phone.trim() || null,
        address: { line1: line1.trim(), city: city.trim(), postalCode: postalCode.trim() || undefined },
        notes: notes.trim() || null,
        couponCode: coupon?.code ?? null,
        items: items.map((i) => ({ menuItemId: i.id, quantity: i.quantity })),
      }),
    });
    if (!res.ok || !res.data) {
      setPlacing(false);
      setError(res.error ?? 'We could not place your order — please try again.');
      return;
    }
    const order = res.data.order;
    setOrderPlaced(true);
    clearCart();
    if (method === 'cod') {
      navigate(`/track-order/${order.id}`);
      return;
    }
    const intent = await apiRequest<{ clientSecret: string }>('/api/v1/payments/create-intent', {
      method: 'POST', body: JSON.stringify({ orderId: order.id }),
    });
    setPlacing(false);
    if (!intent.ok || !intent.data || !stripePromise) {
      // The order exists and is unpaid — never pretend it was paid.
      setCardUnavailable({ orderId: order.id });
      return;
    }
    setPaymentStep({ orderId: order.id, clientSecret: intent.data.clientSecret });
  };

  if (items.length === 0 && !paymentStep && !cardUnavailable && !orderPlaced) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 py-24" style={{ background: '#0D1A0E' }}>
        <div className="text-center max-w-md">
          <p className="uppercase mb-3" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.25em', color: '#C17A3A' }}>✦ &nbsp; Checkout</p>
          <h1 className="mb-4" style={{ ...headingFont, fontSize: '36px' }}>Your cart is empty</h1>
          <p className="mb-8" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.55)', lineHeight: 1.7 }}>
            Add a few dishes first — then come back here to complete your order.
          </p>
          <button onClick={() => navigate('/menu')} style={{ ...emberButton, width: 'auto', padding: '16px 36px' }} className="transition-all duration-300 hover:brightness-110">
            Browse the Menu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-[110px] pb-24 px-6" style={{ background: '#0D1A0E' }}>
      <div className="max-w-5xl mx-auto">
        <p className="uppercase mb-2" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.25em', color: '#C17A3A' }}>✦ &nbsp; Checkout</p>
        <h1 className="mb-10" style={{ ...headingFont, fontSize: '40px', lineHeight: 1 }}>Complete Your Order</h1>

        {cardUnavailable ? (
          <div className="max-w-lg p-6" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <h2 className="mb-3" style={{ ...headingFont, fontSize: '24px' }}>Card payments are not available yet</h2>
            <p className="mb-6" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.6)', lineHeight: 1.7 }}>
              Your order <span style={{ color: '#F5F0E8' }}>#{cardUnavailable.orderId.slice(0, 8)}</span> has been placed but is
              not paid. You can track it now and pay cash on delivery instead.
            </p>
            <button onClick={() => navigate(`/track-order/${cardUnavailable.orderId}`)} style={emberButton} className="transition-all duration-300 hover:brightness-110">
              Track My Order
            </button>
          </div>
        ) : paymentStep && stripePromise ? (
          <div className="max-w-lg">
            <p className="mb-6" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.6)' }}>
              Order <span style={{ color: '#F5F0E8' }}>#{paymentStep.orderId.slice(0, 8)}</span> created — complete your payment below.
            </p>
            <Elements stripe={stripePromise} options={{ clientSecret: paymentStep.clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#C17A3A', colorBackground: '#1C2B1E', colorText: '#F5F0E8', fontFamily: 'Jost, sans-serif' } } }}>
              <CardPaymentForm orderId={paymentStep.orderId} onPaid={(id) => navigate(`/track-order/${id}`)} />
            </Elements>
          </div>
        ) : (
          <form onSubmit={placeOrder} className="grid md:grid-cols-[1fr_360px] gap-10 items-start">
            <div className="flex flex-col gap-8">
              <section>
                <h2 className="mb-4" style={{ ...headingFont, fontSize: '24px' }}>Your Details</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><label style={labelStyle}>Full Name</label><input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Phone (optional)</label><input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} /></div>
                </div>
              </section>
              <section>
                <h2 className="mb-4" style={{ ...headingFont, fontSize: '24px' }}>Delivery Address</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2"><label style={labelStyle}>Address Line</label><input value={line1} onChange={(e) => setLine1(e.target.value)} style={inputStyle} /></div>
                  <div><label style={labelStyle}>City</label><input value={city} onChange={(e) => setCity(e.target.value)} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Postal Code</label><input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} style={inputStyle} /></div>
                  <div className="sm:col-span-2"><label style={labelStyle}>Notes for the kitchen (optional)</label><input value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} /></div>
                </div>
              </section>
              <section>
                <h2 className="mb-4" style={{ ...headingFont, fontSize: '24px' }}>Payment Method</h2>
                <div className="flex flex-col gap-3">
                  <button type="button" onClick={() => setMethod('card')}
                    className="flex items-center gap-3 p-4 text-left transition-all"
                    style={{ border: `1px solid ${method === 'card' ? '#C17A3A' : 'rgba(255,255,255,0.12)'}`, background: 'rgba(255,255,255,0.03)' }}>
                    <CreditCard size={18} color="#C17A3A" />
                    <span>
                      <span className="block" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: '#F5F0E8' }}>Card — pay now</span>
                      <span className="block" style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', color: 'rgba(245,240,232,0.45)' }}>Secure payment via Stripe</span>
                    </span>
                    {method === 'card' && <Check size={15} color="#4ade80" className="ml-auto" />}
                  </button>
                  <button type="button" onClick={() => setMethod('cod')}
                    className="flex items-center gap-3 p-4 text-left transition-all"
                    style={{ border: `1px solid ${method === 'cod' ? '#C17A3A' : 'rgba(255,255,255,0.12)'}`, background: 'rgba(255,255,255,0.03)' }}>
                    <Banknote size={18} color="#C17A3A" />
                    <span>
                      <span className="block" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: '#F5F0E8' }}>Cash on delivery</span>
                      <span className="block" style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', color: 'rgba(245,240,232,0.45)' }}>Pay when your food arrives</span>
                    </span>
                    {method === 'cod' && <Check size={15} color="#4ade80" className="ml-auto" />}
                  </button>
                </div>
              </section>
            </div>

            <aside className="p-6" style={{ background: '#1C2B1E', border: '1px solid rgba(255,255,255,0.08)' }}>
              <h2 className="mb-5" style={{ ...headingFont, fontSize: '22px' }}>Order Summary</h2>
              <div className="flex flex-col gap-3 mb-5">
                {items.map((i) => (
                  <div key={i.id} className="flex justify-between gap-3">
                    <span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.7)' }}>{i.quantity} × {i.name}</span>
                    <span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: '#F5F0E8' }}>{format(i.price * i.quantity)}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mb-5">
                <input value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="Coupon code"
                  className="flex-1 bg-transparent outline-none pb-2 placeholder-[rgba(245,240,232,0.3)]"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', color: '#F5F0E8', fontFamily: 'Jost, sans-serif', fontSize: '13px' }} />
                <button type="button" onClick={applyCoupon} style={{ color: '#C17A3A', fontFamily: 'Jost, sans-serif', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Apply
                </button>
              </div>
              {couponMsg && <p className="mb-4" style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', color: coupon ? '#4ade80' : '#ef4444' }}>{couponMsg}</p>}
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '16px' }} />
              <div className="flex flex-col gap-2 mb-6">
                <div className="flex justify-between"><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.5)' }}>Subtotal</span><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: '#F5F0E8' }}>{format(subtotal)}</span></div>
                {discount > 0 && <div className="flex justify-between"><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.5)' }}>Discount</span><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: '#4ade80' }}>−{format(discount)}</span></div>}
                <div className="flex justify-between"><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.5)' }}>Delivery</span><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: '#4ade80' }}>Free</span></div>
                <div className="flex justify-between mt-2"><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: '#F5F0E8' }}>Total</span><span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '22px', color: '#C17A3A' }}>{format(total)}</span></div>
              </div>
              {error && <p className="text-[#ef4444] mb-4" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>{error}</p>}
              <button type="submit" disabled={placing} style={emberButton} className="transition-all duration-300 hover:brightness-110 disabled:opacity-60">
                {placing ? 'Placing your order…' : method === 'card' ? 'Place Order & Pay' : 'Place Order'}
              </button>
              <p className="text-center mt-4" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', color: 'rgba(245,240,232,0.25)' }}>
                Secure checkout · SSL encrypted
              </p>
            </aside>
          </form>
        )}
      </div>
    </div>
  );
}

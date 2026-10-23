import { useState, useEffect, useRef } from 'react';
import { apiRequest, fetchMenuItems, fetchPublicSettings, type ReservationFeePayment } from '../services/api.ts';
import { stripePromise } from '../lib/stripe.ts';
import { ReservationFeePaymentPanel } from './ReservationFeePayment.tsx';
import { useCart } from '../context/CartContext.tsx';

interface ChatMsg {
  role: 'user' | 'assistant' | 'note' | 'fee';
  content: string;
  /**
   * A 'fee' message only: the booking-fee card step attached to the
   * exchange that created the booking, carrying the payment handle
   * the chat response returned for THAT booking. Display-only — fee
   * messages never ride back to the API.
   */
  feePayment?: ReservationFeePayment;
  /** Set when the guest has paid the fee through the panel. */
  feePaid?: boolean;
}
interface CartAction { menuItemId: number; quantity: number }
/** The booking summary a chat response may carry (server-written, from the created record). */
interface ChatBooking { id: string; feePayment?: ReservationFeePayment }

export default function FloatingButtons() {
  const [isOpen, setIsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { addItem, updateQuantity, setIsOpen: setCartOpen, items: cartItems } = useCart();
  const [whatsapp, setWhatsapp] = useState<string | null>(null);

  // The WhatsApp button exists only when the restaurant set a number in
  // Admin → Settings. Digits only — wa.me wants the international format.
  useEffect(() => {
    void fetchPublicSettings().then((settings) => {
      const digits = (settings?.whatsappNumber ?? '').replace(/\D/g, '');
      setWhatsapp(digits.length >= 7 ? digits : null);
    });
  }, []);

  const applyCartActions = async (actions: CartAction[]) => {
    const menu = await fetchMenuItems();
    if (!menu) return;
    const byId = new Map(menu.map((m) => [m.id, m]));
    const running = new Map(cartItems.map((i) => [i.id, i.quantity]));
    const added: string[] = [];
    for (const a of actions) {
      const m = byId.get(a.menuItemId);
      if (!m) continue;
      addItem({ id: m.id, name: m.name, price: m.price, image: m.image, description: m.description });
      const target = (running.get(m.id) ?? 0) + a.quantity;
      updateQuantity(m.id, target);
      running.set(m.id, target);
      added.push(`${a.quantity} × ${m.name}`);
    }
    if (added.length) {
      setChatMessages((prev) => [...prev, { role: 'note', content: `Added to your cart: ${added.join(' · ')} — review it and check out whenever you're ready.` }]);
      window.setTimeout(() => setCartOpen(true), 900);
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, sending, isChatOpen]);

  const sendChat = async (text: string, history: ChatMsg[]) => {
    // Notes and fee panels are display-only — the API accepts just
    // user/assistant turns, and a payment handle never rides back.
    const payload: ChatMsg[] = [...history.filter((m) => m.role === 'user' || m.role === 'assistant'), { role: 'user' as const, content: text }].slice(-12);
    setChatMessages([...history, { role: 'user', content: text }]);
    setSending(true);
    setSendFailed(false);
    const res = await apiRequest<{ reply: string; actions?: CartAction[]; booking?: ChatBooking | null }>('/api/v1/chat', {
      method: 'POST',
      // The cart rides along as ids + quantities only — the server
      // resolves names, prices and the total against the live menu, so
      // Ember AI can answer "what's in my cart?" from the real numbers.
      body: JSON.stringify({
        messages: payload,
        cart: cartItems.map((i) => ({ menuItemId: i.id, quantity: i.quantity })),
      }),
    }, { timeoutMs: 20_000 }); // AI replies legitimately take longer than a normal API call
    setSending(false);
    if (res.ok && res.data?.reply) {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: res.data!.reply }]);
      // A booking created by THIS exchange that owes its fee: the
      // card step renders right here in the conversation, attached
      // to this exchange — the same shared panel the Reservations
      // page uses. Without a publishable key the card cannot be
      // taken here at all — say so honestly, exactly as the
      // Reservations page does, instead of stranding the guest.
      const feePayment = res.data.booking?.feePayment ?? null;
      if (feePayment) {
        if (stripePromise) {
          setChatMessages((prev) => [...prev, { role: 'fee', content: '', feePayment }]);
        } else {
          setChatMessages((prev) => [...prev, { role: 'assistant', content: 'Card payment is unavailable right now — please call us to complete your booking.' }]);
        }
      }
      if (res.data.actions?.length) void applyCartActions(res.data.actions);
    } else if (res.status === 503) {
      setUnavailable(true);
      setChatMessages((prev) => [...prev, { role: 'assistant', content: "I'm not available right now — please browse the menu above, or call us and we'll be happy to help." }]);
    } else {
      setSendFailed(true);
    }
  };

  const submitChat = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending || unavailable) return;
    setDraft('');
    void sendChat(text, chatMessages);
  };

  const retryChat = () => {
    const lastUser = [...chatMessages].reverse().find((m) => m.role === 'user');
    if (!lastUser || sending) return;
    const history = chatMessages.slice(0, chatMessages.lastIndexOf(lastUser));
    void sendChat(lastUser.content, history);
  };

  useEffect(() => {
    if (isChatOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isChatOpen]);

  // Transitions
  const springTransition = 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
  const easeInTransition = 'all 0.25s ease-in';

  return (
    <>
      {/* Mobile AI Chatbot Overlay */}
      <div 
        className={`md:hidden fixed inset-0 z-[998] transition-opacity duration-300 ${
          isChatOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
        onClick={() => setIsChatOpen(false)}
      />

      {/* AI Chatbot Window */}
      <div 
        className={`fixed bg-white shadow-2xl flex flex-col overflow-hidden transition-all duration-300 border border-black/10
          top-1/2 left-1/2 w-[calc(100vw-32px)] max-w-[420px] h-[75vh] max-h-[600px] z-[999] rounded-[16px] origin-center -translate-x-1/2 -translate-y-1/2
          md:top-auto md:left-auto md:bottom-[100px] md:right-8 md:w-[350px] md:h-[500px] md:max-h-[calc(100vh-120px)] md:z-[55] md:rounded-2xl md:origin-bottom-right md:translate-x-0 md:translate-y-0
          ${isChatOpen ? 'scale-100 opacity-100 visible' : 'scale-90 opacity-0 invisible pointer-events-none'}
        `}
      >
        {/* Header */}
        <div className="bg-[#C17A3A] h-[56px] px-[20px] text-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <span className="text-lg" style={{ fontFamily: 'Cormorant Garamond, serif' }}>✦</span>
            </div>
            <div className="flex flex-col">
              <span style={{ fontFamily: 'Jost, sans-serif', lineHeight: 1.1 }} className="font-medium text-[14px]">Ember AI</span>
              <span style={{ fontFamily: 'Jost, sans-serif', lineHeight: 1.1, marginTop: '2px' }} className="text-[10px] text-white/70 uppercase tracking-widest">AI Assistant</span>
            </div>
          </div>
          <button 
            onClick={() => setIsChatOpen(false)} 
            className="hover:opacity-75 transition-opacity text-white"
            aria-label="Close Chat"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        
        {/* Body */}
        <div ref={scrollRef} className="flex-1 bg-[#FDFAF5] overflow-y-auto px-[18px] py-[20px]">
          {chatMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 bg-[#C17A3A]/10 rounded-full flex items-center justify-center mb-4 shrink-0">
                <span className="text-3xl text-[#C17A3A]" style={{ fontFamily: 'Cormorant Garamond, serif' }}>✦</span>
              </div>
              <h3 className="text-xl font-medium mb-2 shrink-0" style={{ fontFamily: 'Cormorant Garamond, serif', color: '#1C2B1E' }}>
                Ember AI Assistant
              </h3>
              <p className="text-[13px] opacity-70 max-w-[250px] shrink-0" style={{ fontFamily: 'Jost, sans-serif' }}>
                Ask me anything about our menu, reservations, or dining experience.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {chatMessages.map((m, i) => m.role === 'fee' && m.feePayment ? (
                m.feePaid ? (
                  // The factual outcome, in the Reservations page's own
                  // register: the fee is paid (through Stripe), the
                  // reservation is received, and confirmation still
                  // follows the team's review — never more than that.
                  <div key={i} className="self-stretch px-4 py-4" style={{ background: '#1C2B1E' }}>
                    <p className="text-xl mb-2" style={{ fontFamily: 'Cormorant Garamond, serif', color: '#F5F0E8' }}>
                      <span className="text-[#C17A3A]">✦</span> Booking Fee Paid
                    </p>
                    <p className="text-[12.5px] leading-relaxed" style={{ fontFamily: 'Jost, sans-serif', color: 'rgba(245,240,232,0.65)' }}>
                      Your booking fee has been paid through Stripe, and we've received your reservation request. Our team will review it and call you to confirm — please keep your phone handy. We look forward to welcoming you.
                    </p>
                  </div>
                ) : (
                  // The fee card step on the site's dark green, like the
                  // Reservations section — the shared panel (Stripe
                  // night appearance included) renders unchanged inside.
                  <div key={i} className="self-stretch px-4 py-4" style={{ background: '#1C2B1E' }}>
                    <ReservationFeePaymentPanel
                      fee={m.feePayment}
                      variant="compact"
                      onPaid={() => setChatMessages((prev) => prev.map((msg, idx) => (idx === i ? { ...msg, feePaid: true } : msg)))}
                    />
                  </div>
                )
              ) : m.role === 'note' ? (
                <div key={i} className="self-center text-center px-3 py-1.5 rounded-full border border-[#C17A3A]/30 bg-[#C17A3A]/10 text-[11.5px] text-[#8A5A24]" style={{ fontFamily: 'Jost, sans-serif' }}>
                  ✓ {m.content}
                </div>
              ) : (
                <div
                  key={i}
                  className={`max-w-[85%] px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'self-end text-white rounded-2xl rounded-br-md' : 'self-start text-[#1C2B1E] rounded-2xl rounded-bl-md border border-black/5'}`}
                  style={{ fontFamily: 'Jost, sans-serif', background: m.role === 'user' ? '#C17A3A' : '#F5F0E8' }}
                >
                  {m.content}
                </div>
              ))}
              {sending && (
                <div className="self-start px-3.5 py-2.5 rounded-2xl rounded-bl-md border border-black/5 animate-pulse" style={{ fontFamily: 'Jost, sans-serif', background: '#F5F0E8', fontSize: '13px', color: 'rgba(28,43,30,0.55)' }}>
                  Ember AI is typing…
                </div>
              )}
              {sendFailed && !sending && (
                <div className="self-start text-[12px]" style={{ fontFamily: 'Jost, sans-serif', color: '#B4552D' }}>
                  That message didn't go through.{' '}
                  <button type="button" onClick={retryChat} className="underline font-medium">Try again</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Input */}
        <div className="bg-white border-t border-black/5 p-3 shrink-0">
          <form onSubmit={submitChat} className="flex items-center gap-2 bg-[#F5F0E8] rounded-full px-4 py-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={1000}
              disabled={unavailable}
              placeholder={unavailable ? 'Ember AI is unavailable right now' : 'Ask about the menu, timings, reservations…'}
              className="flex-1 bg-transparent border-none outline-none text-sm text-[#1C2B1E] placeholder:text-[#1C2B1E]/40 disabled:opacity-50"
              style={{ fontFamily: 'Jost, sans-serif' }}
              aria-label="Message Ember AI"
            />
            <button
              type="submit"
              disabled={sending || unavailable || !draft.trim()}
              className="w-8 h-8 rounded-full bg-[#C17A3A] text-white flex items-center justify-center shrink-0 hover:bg-[#A66932] transition-colors disabled:opacity-40"
              aria-label="Send message"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-1">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
              </svg>
            </button>
          </form>
        </div>
      </div>

      {/* Speed Dial System */}
      <div 
        className={`fixed inset-0 z-[60] ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
        onClick={() => { if (isOpen) setIsOpen(false); }}
      >
        
        {/* BUTTON 2: AI Chat */}
        <div 
          className="absolute flex items-center gap-3 right-[36px] will-change-transform"
          style={{
            bottom: '160px',
            transform: isOpen ? 'translateY(0)' : 'translateY(124px)',
            opacity: isOpen ? 1 : 0,
            visibility: isOpen ? 'visible' : 'hidden',
            pointerEvents: isOpen ? 'auto' : 'none',
            transition: isOpen ? springTransition : easeInTransition,
            transitionDelay: isOpen ? '0.1s' : '0s'
          }}
        >
          {/* Label */}
          <div 
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateX(0)' : 'translateX(10px)',
              transition: isOpen ? springTransition : easeInTransition,
              transitionDelay: isOpen ? '0.15s' : '0s'
            }}
          >
            <span 
              className="px-3 py-1.5 rounded-full whitespace-nowrap block"
              style={{ 
                background: 'rgba(13,26,14,0.9)', 
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'white',
                fontSize: '11px',
                fontFamily: 'Jost, sans-serif'
              }}
            >
              Ask Ember
            </span>
          </div>
          {/* Button */}
          <button
            onClick={() => {
              setIsChatOpen(!isChatOpen);
              setIsOpen(false);
            }}
            className="w-12 h-12 bg-[#C17A3A] text-white rounded-full shadow-lg hover:shadow-xl transition-transform hover:scale-110 flex items-center justify-center flex-shrink-0"
            aria-label="Ask Ember - AI Assistant"
          >
            <span className="text-[16px]" style={{ fontFamily: 'Cormorant Garamond, serif' }}>✦</span>
          </button>
        </div>

        {/* BUTTON 1: WhatsApp (only when the restaurant set a number) */}
        {whatsapp && (
        <div 
          className="absolute flex items-center gap-3 right-[36px] will-change-transform"
          style={{
            bottom: '100px',
            transform: isOpen ? 'translateY(0)' : 'translateY(64px)',
            opacity: isOpen ? 1 : 0,
            visibility: isOpen ? 'visible' : 'hidden',
            pointerEvents: isOpen ? 'auto' : 'none',
            transition: isOpen ? springTransition : easeInTransition,
            transitionDelay: isOpen ? '0.05s' : '0s'
          }}
        >
          {/* Label */}
          <div 
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateX(0)' : 'translateX(10px)',
              transition: isOpen ? springTransition : easeInTransition,
              transitionDelay: isOpen ? '0.1s' : '0s'
            }}
          >
            <span 
              className="px-3 py-1.5 rounded-full whitespace-nowrap block"
              style={{ 
                background: 'rgba(13,26,14,0.9)', 
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'white',
                fontSize: '11px',
                fontFamily: 'Jost, sans-serif'
              }}
            >
              WhatsApp
            </span>
          </div>
          {/* Button */}
          <button
            onClick={() => {
              window.open(`https://wa.me/${whatsapp}`, '_blank');
              setIsOpen(false);
            }}
            className="w-12 h-12 bg-[#25D366] text-white rounded-full shadow-lg hover:shadow-xl transition-transform hover:scale-110 flex items-center justify-center flex-shrink-0"
            aria-label="Chat with us on WhatsApp"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.67-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.076 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421-7.403h-.004a9.87 9.87 0 00-4.782 1.176l-.013 1.39 1.395.335c1.26-.635 2.564-.889 3.915-.889h.003c2.344 0 4.536 1.158 5.728 3.007 1.194 1.85 1.305 4.23.31 6.274-1.055 2.143-3.168 3.474-5.685 3.474-1.343 0-2.62-.378-3.755-1.088l-1.377.328.294-1.39c-.704-1.232-1.146-2.7-1.146-4.258 0-5.17 4.207-9.375 9.375-9.375.528 0 1.05.048 1.562.142 2.914.513 5.45 2.46 6.75 5.219 1.3 2.76.92 5.92-.96 8.37-2.14 2.64-5.56 4.29-9.12 4.29z" />
            </svg>
          </button>
        </div>
        )}

        {/* MAIN SPEED DIAL BUTTON */}
        <div className="absolute bottom-[32px] right-[32px] pointer-events-auto flex items-center justify-center will-change-transform">
          {/* Pulse Ring when closed */}
          {!isOpen && (
            <div 
              className="absolute inset-0 rounded-full bg-[#C17A3A] opacity-60 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]"
            />
          )}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="relative w-[56px] h-[56px] bg-[#C17A3A] rounded-full flex items-center justify-center text-white z-10"
            style={{ 
              boxShadow: '0 4px 24px rgba(193,122,58,0.5)',
            }}
            aria-label="Speed Dial"
          >
            <div 
              className="relative w-full h-full flex items-center justify-center transition-transform duration-300"
              style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
            >
              <span 
                className={`absolute text-[20px] transition-all duration-300 ${isOpen ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`} 
                style={{ fontFamily: 'Cormorant Garamond, serif' }}
              >
                ✦
              </span>
              <span 
                className={`absolute text-[32px] font-light transition-all duration-300 ${isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}
                style={{ transform: 'translateY(-1px)' }}
              >
                ×
              </span>
            </div>
          </button>
        </div>
      </div>
    </>
  );
}

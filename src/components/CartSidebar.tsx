import { X } from 'lucide-react';
import { useCart } from '../context/CartContext.tsx';
import { useNavigate } from 'react-router-dom';

export default function CartSidebar() {
  const navigate = useNavigate();
  const { items, isOpen, setIsOpen, updateQuantity } = useCart();

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

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
          
          <h2
            className="mt-2"
            style={{ 
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: '28px',
              fontWeight: 300,
              color: '#F5F0E8'
            }}
          >
            Ember & Co.
          </h2>
          
          <div 
            className="mt-4"
            style={{ width: '36px', height: '1px', backgroundColor: '#C17A3A' }}
          />
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '0 28px' }}>
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
                      <p
                        className="mt-1"
                        style={{ 
                          fontFamily: 'Jost, sans-serif',
                          fontSize: '11px',
                          color: 'rgba(245,240,232,0.35)',
                          fontWeight: 300,
                          lineHeight: '1.4'
                        }}
                      >
                        Our signature preparation
                      </p>
                    </div>
                    
                    <div className="flex items-center justify-between mt-3">
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
                        ${(item.price * item.quantity).toFixed(2)}
                      </span>
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
            <div className="space-y-3 mb-6">
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
                  ${total.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span style={{ 
                  fontFamily: 'Jost, sans-serif',
                  fontSize: '12px',
                  color: 'rgba(245,240,232,0.4)',
                  letterSpacing: '0.06em'
                }}>
                  Delivery
                </span>
                <span style={{ 
                  fontFamily: 'Jost, sans-serif',
                  fontSize: '14px',
                  color: '#4CAF50'
                }}>
                  Free
                </span>
              </div>
            </div>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', marginBottom: '20px' }} />

            <div className="relative mb-6">
              <input 
                type="text"
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
                className="absolute right-0 top-0 pb-2 text-xs transition-colors hover:text-white"
                style={{
                  color: '#C17A3A',
                  fontFamily: 'Jost, sans-serif',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}
              >
                Apply
              </button>
            </div>

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
            
            <p 
              className="text-center mt-4"
              style={{
                fontFamily: 'Jost, sans-serif',
                fontSize: '10px',
                color: 'rgba(245,240,232,0.2)'
              }}
            >
              Secure checkout · SSL encrypted
            </p>
          </div>
        )}
      </aside>
    </>
  );
}

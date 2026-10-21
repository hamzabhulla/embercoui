import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { sendPasswordReset } from '../../services/auth.ts';
import InputField from './InputField.tsx';

interface Props {
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export default function ForgotPasswordModal({ onClose, onNavigate }: Props) {
  const [mounted, setMounted] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successMounted, setSuccessMounted] = useState(false);
  const [formVisible, setFormVisible] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (isSuccess) {
      const t = setTimeout(() => setSuccessMounted(true), 50);
      return () => clearTimeout(t);
    }
  }, [isSuccess]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Invalid email format';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setFormError(null);
    setIsSubmitting(true);
    const { error } = await sendPasswordReset(email);
    if (error) {
      setIsSubmitting(false);
      setFormError(error);
      return;
    }
    setFormVisible(false);
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
    }, 400); // Wait for form to fade out
  };

  return (
    <div 
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-300 ${mounted ? 'opacity-100' : 'opacity-0'}`} 
      style={{ background: 'rgba(5, 12, 6, 0.92)', backdropFilter: 'blur(12px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className={`w-full min-h-[100vh] md:min-h-0 md:max-h-[90vh] md:w-[700px] flex md:flex-row flex-col justify-center md:justify-start bg-[#0D1A0E] md:border md:border-[rgba(255,255,255,0.08)] transition-all duration-300 transform ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'} relative`}
        style={{
          boxShadow: '0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)'
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-6 right-6 text-white hover:text-[#C17A3A] transition-colors z-10"
        >
          <X size={20} />
        </button>

        {/* LEFT SIDE IMAGE (Desktop Only) */}
        <div className="hidden md:block w-[220px] relative shrink-0">
          <div className="absolute inset-0 bg-[rgba(10,18,10,0.4)] z-10" />
          <img 
            src="https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=80" 
            alt="Ambiance" 
            loading="lazy"
            width="600"
            height="800"
            className="w-full h-full object-cover"
          />
          <div className="absolute bottom-[32px] left-[28px] z-20 pr-4">
            <p 
              className="text-[#C17A3A] uppercase mb-3"
              style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.2em' }}
            >
              ✦ Ember & Co.
            </p>
            <p 
              className="text-white italic"
              style={{ 
                fontFamily: 'Cormorant Garamond, serif', 
                fontSize: '22px', 
                fontWeight: 300,
                lineHeight: '1.2'
              }}
            >
              Where Every Meal Tells a Story
            </p>
          </div>
        </div>

        {/* RIGHT SIDE FORM */}
        <div className="flex-1 flex flex-col justify-center px-[28px] pt-[48px] pb-[80px] md:px-[40px] md:py-[48px] overflow-y-auto hide-scrollbar relative overflow-x-hidden">
          {isSuccess ? (
            <div className={`flex flex-col items-center justify-center text-center h-full py-12 transition-all duration-700 w-full ${successMounted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
              <div className={`transition-all duration-700 delay-100 transform ${successMounted ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}>
                <span style={{ color: '#C17A3A', fontSize: '32px', marginBottom: '24px', display: 'inline-block' }} className="animate-pulse">✦</span>
              </div>
              <h2 
                className={`mb-4 transition-all duration-700 delay-200 transform ${successMounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
                style={{ 
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: '28px',
                  color: '#F5F0E8'
                }}
              >
                Check your email
              </h2>
              <p 
                className={`mb-8 transition-all duration-700 delay-300 transform ${successMounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
                style={{ 
                  fontFamily: 'Jost, sans-serif',
                  fontSize: '13px',
                  color: 'rgba(245,240,232,0.35)',
                  lineHeight: '1.6'
                }}
              >
                We sent a password reset link to<br/>
                <span className="text-[#F5F0E8]">{email}</span>
              </p>
              <button
                onClick={() => onNavigate('/login')}
                className={`transition-all duration-700 delay-500 transform hover:bg-[rgba(193,122,58,0.1)] hover:shadow-[0_0_15px_rgba(193,122,58,0.2)] ${successMounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
                style={{
                  border: '1px solid #C17A3A',
                  color: '#C17A3A',
                  fontFamily: 'Jost, sans-serif',
                  fontSize: '11px',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  padding: '14px 32px',
                  background: 'transparent'
                }}
              >
                Return to Login
              </button>
            </div>
          ) : (
            <div className={`transition-all duration-400 w-full flex flex-col justify-center ${formVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
              <div className="text-center mb-8">
                <p 
                  className="mb-2 uppercase text-[#C17A3A] md:hidden"
                  style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.25em' }}
                >
                  ✦ Ember & Co.
                </p>
                <h2 
                  className="text-[28px] font-light text-[#F5F0E8]"
                  style={{ fontFamily: 'Cormorant Garamond, serif' }}
                >
                  Reset Password
                </h2>
                <div className="mx-auto mt-4" style={{ width: '36px', height: '1px', background: '#C17A3A' }} />
                
                <p 
                  className="mt-6 text-[13px] text-[rgba(245,240,232,0.5)]"
                  style={{ fontFamily: 'Jost, sans-serif', lineHeight: '1.5' }}
                >
                  Enter your email address and we'll send you a link to reset your password.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                <InputField
                  label="Email Address"
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrors((prev) => {
                      if (!prev.email) return prev;
                      const next = { ...prev };
                      delete next.email;
                      return next;
                    });
                  }}
                  error={errors.email}
                />
                
                {formError && (
                <p className="text-[#ef4444] mt-4" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>
                  {formError}
                </p>
            )}
            <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full mt-6 flex items-center justify-center gap-2 transition-all duration-300 hover:brightness-110 hover:shadow-[0_0_20px_rgba(193,122,58,0.4)] min-h-[52px] group relative overflow-hidden"
                  style={{
                    background: '#C17A3A',
                    color: 'white',
                    textTransform: 'uppercase',
                    letterSpacing: '0.18em',
                    fontFamily: 'Jost, sans-serif',
                    fontSize: '11px'
                  }}
                >
                  <div className={`absolute inset-0 bg-white/20 transition-transform duration-700 ease-in-out ${isSubmitting ? 'translate-x-0' : '-translate-x-full'}`} />
                  
                  {isSubmitting ? (
                    <span className="flex items-center gap-2 animate-pulse relative z-10">
                      SENDING LINK...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 relative z-10">
                      SEND LINK <span className="text-[14px] transition-transform duration-300 group-hover:translate-x-1">→</span>
                    </span>
                  )}
                </button>
              </form>

              <div className="mt-8 text-center pb-8 md:pb-0">
                <p 
                  className="text-[rgba(245,240,232,0.3)]"
                  style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}
                >
                  Remembered your password?{' '}
                  <button 
                    onClick={(e) => { e.preventDefault(); onNavigate('/login'); }}
                    className="text-[#C17A3A] hover:underline transition-all"
                  >
                    Sign in
                  </button>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

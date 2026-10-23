import React, { useState, useEffect } from 'react';
import { sendPasswordReset } from '../../services/auth.ts';
import InputField from './InputField.tsx';
import AuthShell from './AuthShell.tsx';

interface Props {
  onClose: () => void;
  onNavigate: (path: string) => void;
}

const SUBMIT_GRADIENT = 'linear-gradient(135deg, #C98A44 0%, #C17A3A 45%, #A66932 100%)';

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
    <AuthShell mounted={mounted} onClose={onClose}>
      {isSuccess ? (
        <div className={`flex flex-col items-center justify-center text-center py-10 transition-all duration-700 w-full ${successMounted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
          <div className={`transition-all duration-700 delay-100 transform ${successMounted ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}>
            <div
              className="rounded-full flex items-center justify-center mb-6"
              style={{
                width: 68,
                height: 68,
                border: '1px solid rgba(193,122,58,0.6)',
                boxShadow: '0 0 0 6px rgba(193,122,58,0.08), inset 0 0 16px rgba(193,122,58,0.15)',
              }}
            >
              <img src="/ember-co-monogram.svg" alt="" style={{ width: '30px', height: '30px' }} className="animate-pulse" />
            </div>
          </div>
          <h2
            className={`mb-4 transition-all duration-700 delay-200 transform ${successMounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
            style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '30px', color: '#F5F0E8' }}
          >
            Check your email
          </h2>
          <p
            className={`mb-8 transition-all duration-700 delay-300 transform ${successMounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
            style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.4)', lineHeight: '1.6' }}
          >
            We sent a password reset link to<br />
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
              background: 'transparent',
            }}
          >
            Return to Login
          </button>
        </div>
      ) : (
        <div className={`transition-all duration-400 w-full flex flex-col justify-center ${formVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
          <div className="text-center mb-9">
            <h2
              className="text-[32px] font-light text-[#F5F0E8]"
              style={{ fontFamily: 'Cormorant Garamond, serif' }}
            >
              Reset Password
            </h2>
            <div className="mx-auto mt-4" style={{ width: '36px', height: '1px', background: '#C17A3A' }} />
            <p
              className="mt-4"
              style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.5)', lineHeight: '1.6' }}
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
                background: SUBMIT_GRADIENT,
                color: 'white',
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                fontFamily: 'Jost, sans-serif',
                fontSize: '11px',
              }}
            >
              <div className={`absolute inset-0 bg-white/20 transition-transform duration-700 ease-in-out ${isSubmitting ? 'translate-x-0' : '-translate-x-full'}`} />

              {isSubmitting ? (
                <span className="flex items-center gap-2 animate-pulse relative z-10">SENDING LINK...</span>
              ) : (
                <span className="flex items-center gap-2 relative z-10">
                  SEND LINK <span className="text-[14px] transition-transform duration-300 group-hover:translate-x-1">→</span>
                </span>
              )}
            </button>
          </form>

          <div
            className="mt-9 pt-6 text-center"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <p className="text-[rgba(245,240,232,0.3)]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>
              Remembered your password?{' '}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('/login');
                }}
                className="text-[#C17A3A] hover:underline transition-all"
              >
                Sign in
              </button>
            </p>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff } from 'lucide-react';
import { signInWithEmail } from '../../services/auth.ts';
import InputField from './InputField.tsx';
import GoogleButton from './GoogleButton.tsx';

interface Props {
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export default function LoginModal({ onClose, onNavigate }: Props) {
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
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

  const clearError = (field: string) =>
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Invalid email format';

    if (!password) newErrors.password = 'Password is required';
    else if (password.length < 8) newErrors.password = 'Password must be at least 8 characters';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setFormError(null);
    setIsSubmitting(true);
    const { error } = await signInWithEmail(email, password);
    setIsSubmitting(false);
    if (error) {
      setFormError(error);
      return;
    }
    setIsSuccess(true);
    // Wait for success animation then navigate
    setTimeout(() => {
      onNavigate('/');
    }, 1200);
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
          boxShadow: '0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
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
                lineHeight: '1.2',
              }}
            >
              Where Every Meal Tells a Story
            </p>
          </div>
        </div>

        {/* RIGHT SIDE FORM */}
        <div className="flex-1 flex flex-col justify-center px-[28px] pt-[48px] pb-[80px] md:px-[40px] md:py-[48px] overflow-y-auto hide-scrollbar">
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
              Welcome Back
            </h2>
            <div className="mx-auto mt-4" style={{ width: '36px', height: '1px', background: '#C17A3A' }} />
          </div>

          <GoogleButton onError={setFormError} />

          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-[1px] bg-[rgba(255,255,255,0.08)]" />
            <span
              className="text-[rgba(245,240,232,0.25)] uppercase"
              style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.1em' }}
            >
              Or continue with email
            </span>
            <div className="flex-1 h-[1px] bg-[rgba(255,255,255,0.08)]" />
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
                clearError('email');
              }}
              error={errors.email}
            />

            <div>
              <InputField
                label="Password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  clearError('password');
                }}
                error={errors.password}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="text-[rgba(245,240,232,0.4)] hover:text-[#C17A3A] transition-colors p-1"
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                }
              />
              <div className="flex justify-end mt-1">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/forgot-password');
                  }}
                  className="text-[12px] text-[rgba(245,240,232,0.35)] hover:text-[#C17A3A] transition-colors"
                  style={{ fontFamily: 'Jost, sans-serif' }}
                >
                  Forgot password?
                </button>
              </div>
            </div>

            {formError && (
              <p className="text-[#ef4444] mt-4" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>
                {formError}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting || isSuccess}
              className="w-full mt-6 flex items-center justify-center gap-2 transition-all duration-300 hover:brightness-110 hover:shadow-[0_0_20px_rgba(193,122,58,0.4)] min-h-[52px] group relative overflow-hidden"
              style={{
                background: '#C17A3A',
                color: 'white',
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                fontFamily: 'Jost, sans-serif',
                fontSize: '11px',
              }}
            >
              <div className={`absolute inset-0 bg-white/20 transition-transform duration-700 ease-in-out ${isSubmitting ? 'translate-x-0' : '-translate-x-full'}`} />

              {isSubmitting ? (
                <span className="flex items-center gap-2 animate-pulse relative z-10">AUTHENTICATING...</span>
              ) : isSuccess ? (
                <span className="flex items-center gap-2 relative z-10">
                  SUCCESS <span className="text-[14px]">✦</span>
                </span>
              ) : (
                <span className="flex items-center gap-2 relative z-10">
                  LOGIN <span className="text-[14px] transition-transform duration-300 group-hover:translate-x-1">→</span>
                </span>
              )}
            </button>
          </form>

          <div className="mt-8 text-center pb-8 md:pb-0">
            <p className="text-[rgba(245,240,232,0.3)]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>
              Don't have an account?{' '}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('/signup');
                }}
                className="text-[#C17A3A] hover:underline transition-all"
              >
                Sign up
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

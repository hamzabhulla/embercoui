import React, { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { signInWithEmail } from '../../services/auth.ts';
import InputField from './InputField.tsx';
import GoogleButton from './GoogleButton.tsx';
import AuthShell from './AuthShell.tsx';

interface Props {
  onClose: () => void;
  onNavigate: (path: string) => void;
  /** App path the visitor came from — sign-in returns there, not home. */
  returnTo?: string;
}

const SUBMIT_GRADIENT = 'linear-gradient(135deg, #C98A44 0%, #C17A3A 45%, #A66932 100%)';

export default function LoginModal({ onClose, onNavigate, returnTo }: Props) {
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
    // Wait for the success animation, then close the auth UI — which
    // returns the visitor to the page they came from (App's onClose),
    // instead of always dumping them on the home page.
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  return (
    <AuthShell mounted={mounted} onClose={onClose}>
      <div className="text-center mb-9">
        <h2
          className="text-[32px] font-light text-[#F5F0E8]"
          style={{ fontFamily: 'Cormorant Garamond, serif' }}
        >
          Welcome Back
        </h2>
        <div className="mx-auto mt-4" style={{ width: '36px', height: '1px', background: '#C17A3A' }} />
        <p
          className="mt-4"
          style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.5)', lineHeight: '1.6' }}
        >
          Your table is waiting — sign in to order, track and reserve.
        </p>
      </div>

      <GoogleButton onError={setFormError} returnTo={returnTo} />

      <div className="flex items-center gap-4 my-7">
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

      <div
        className="mt-9 pt-6 text-center"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
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
    </AuthShell>
  );
}

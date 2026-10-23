import React, { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { signUpWithEmail, resendConfirmation } from '../../services/auth.ts';
import InputField from './InputField.tsx';
import GoogleButton from './GoogleButton.tsx';
import AuthShell from './AuthShell.tsx';

interface Props {
  onClose: () => void;
  onNavigate: (path: string) => void;
  /** App path the visitor came from — sign-up returns there, not home. */
  returnTo?: string;
}

const SUBMIT_GRADIENT = 'linear-gradient(135deg, #C98A44 0%, #C17A3A 45%, #A66932 100%)';

function SuccessMedallion({ mounted }: { mounted: boolean }) {
  return (
    <div
      className={`transition-all duration-700 delay-100 transform ${mounted ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}
    >
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
  );
}

export default function SignupModal({ onClose, onNavigate, returnTo }: Props) {
  const [mounted, setMounted] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successMounted, setSuccessMounted] = useState(false);
  const [formVisible, setFormVisible] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

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

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const setFieldError = (field: string, message: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name) newErrors.name = 'Full name is required';

    if (!email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Invalid email format';

    if (!phone) newErrors.phone = 'Phone number is required';
    else if (!/^\+?[0-9\s\-()]{7,20}$/.test(phone)) newErrors.phone = 'Invalid phone format';

    if (!password) newErrors.password = 'Password is required';
    else if (password.length < 8) newErrors.password = 'Password must be at least 8 characters';

    if (password !== confirmPassword) newErrors.confirmPassword = 'Passwords must match';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setFormError(null);
    setIsSubmitting(true);
    const { error, needsEmailConfirmation } = await signUpWithEmail({ name, email, phone, password });
    if (error) {
      setIsSubmitting(false);
      setFormError(error);
      return;
    }
    setNeedsConfirm(Boolean(needsEmailConfirmation));
    setFormVisible(false);
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
    }, 400); // Wait for form to fade out
  };

  const handleResend = async () => {
    setResendError(null);
    setResendState('sending');
    const { error } = await resendConfirmation(email);
    if (error) {
      setResendState('idle');
      setResendError(error);
      return;
    }
    setResendState('sent');
    setResendCooldown(30);
  };

  const eyeToggle = (show: boolean, toggle: () => void) => (
    <button
      type="button"
      onClick={toggle}
      aria-label={show ? 'Hide password' : 'Show password'}
      className="text-[rgba(245,240,232,0.4)] hover:text-[#C17A3A] transition-colors p-1"
    >
      {show ? <EyeOff size={17} /> : <Eye size={17} />}
    </button>
  );

  const outlineBtnStyle: React.CSSProperties = {
    border: '1px solid #C17A3A',
    color: '#C17A3A',
    fontFamily: 'Jost, sans-serif',
    fontSize: '11px',
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    padding: '14px 32px',
    background: 'transparent',
  };

  return (
    <AuthShell mounted={mounted} onClose={onClose}>
      {isSuccess ? (
        <div className={`flex flex-col items-center justify-center text-center py-10 transition-all duration-700 w-full ${successMounted ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
          <SuccessMedallion mounted={successMounted} />
          {needsConfirm ? (
            <>
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
                We sent a verification link to<br />
                <span className="text-[#F5F0E8]">{email}</span>
              </p>
              <button
                onClick={handleResend}
                disabled={resendState === 'sending' || resendCooldown > 0}
                className={`transition-all duration-700 delay-500 transform hover:bg-[rgba(193,122,58,0.1)] hover:shadow-[0_0_15px_rgba(193,122,58,0.2)] disabled:opacity-50 disabled:cursor-not-allowed ${successMounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
                style={outlineBtnStyle}
              >
                {resendState === 'sending'
                  ? 'Sending…'
                  : resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : 'Resend email'}
              </button>
              {resendState === 'sent' && resendCooldown > 0 && (
                <p className="mt-4" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.5)' }}>
                  Sent again — check your inbox.
                </p>
              )}
              {resendError && (
                <p className="mt-4 text-[#ef4444]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>
                  {resendError}
                </p>
              )}
            </>
          ) : (
            <>
              <h2
                className={`mb-4 transition-all duration-700 delay-200 transform ${successMounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
                style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '30px', color: '#F5F0E8' }}
              >
                Welcome to Ember & Co.
              </h2>
              <p
                className={`mb-8 transition-all duration-700 delay-300 transform ${successMounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
                style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.4)', lineHeight: '1.6' }}
              >
                Your account is ready, {name.split(' ')[0]} — you're signed in.
              </p>
              <button
                onClick={() => onClose()}
                className={`transition-all duration-700 delay-500 transform hover:bg-[rgba(193,122,58,0.1)] hover:shadow-[0_0_15px_rgba(193,122,58,0.2)] ${successMounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
                style={outlineBtnStyle}
              >
                Start exploring
              </button>
            </>
          )}
        </div>
      ) : (
        <div className={`transition-all duration-400 w-full flex flex-col justify-center ${formVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
          <div className="text-center mb-9">
            <h2
              className="text-[32px] font-light text-[#F5F0E8]"
              style={{ fontFamily: 'Cormorant Garamond, serif' }}
            >
              Create Account
            </h2>
            <div className="mx-auto mt-4" style={{ width: '36px', height: '1px', background: '#C17A3A' }} />
            <p
              className="mt-4"
              style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.5)', lineHeight: '1.6' }}
            >
              Join us at the table — faster checkout, live order tracking and reservations.
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
              label="Full Name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setFieldError('name', null);
              }}
              error={errors.name}
            />
            <InputField
              label="Email Address"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldError('email', null);
              }}
              error={errors.email}
            />
            <InputField
              label="Phone Number"
              type="tel"
              name="phone"
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setFieldError('phone', null);
              }}
              error={errors.phone}
            />
            <div>
              <InputField
                label="Password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  const v = e.target.value;
                  setPassword(v);
                  setFieldError('password', null);
                  if (confirmPassword) {
                    setFieldError('confirmPassword', v !== confirmPassword ? 'Passwords must match' : null);
                  }
                }}
                error={errors.password}
                trailing={eyeToggle(showPassword, () => setShowPassword((v) => !v))}
              />
              <p
                className="-mt-3 mb-1"
                style={{
                  fontFamily: 'Jost, sans-serif',
                  fontSize: '11px',
                  color: password.length >= 8 ? '#A3B18A' : 'rgba(245,240,232,0.3)',
                }}
              >
                {password.length >= 8 ? '✓ At least 8 characters' : 'At least 8 characters'}
              </p>
            </div>
            <InputField
              label="Confirm Password"
              type={showConfirm ? 'text' : 'password'}
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                const v = e.target.value;
                setConfirmPassword(v);
                if (v && password && v !== password) setFieldError('confirmPassword', 'Passwords must match');
                else setFieldError('confirmPassword', null);
              }}
              error={errors.confirmPassword}
              trailing={eyeToggle(showConfirm, () => setShowConfirm((v) => !v))}
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
                <span className="flex items-center gap-2 animate-pulse relative z-10">CREATING ACCOUNT...</span>
              ) : (
                <span className="flex items-center gap-2 relative z-10">
                  SIGN UP <span className="text-[14px] transition-transform duration-300 group-hover:translate-x-1">→</span>
                </span>
              )}
            </button>
          </form>

          <div
            className="mt-9 pt-6 text-center"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <p className="text-[rgba(245,240,232,0.3)]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>
              Already have an account?{' '}
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

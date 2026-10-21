import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { signUpWithEmail } from '../../services/auth.ts';

interface Props {
  onClose: () => void;
  onNavigate: (path: string) => void;
}

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

const InputField = ({ label, type = 'text', value, onChange, error, ...props }: InputFieldProps) => {
  const [focused, setFocused] = useState(false);
  const active = focused || String(value ?? '').length > 0;
  
  return (
    <div className="relative mb-5">
      <label 
        className={`absolute left-0 transition-all duration-250 ease-in-out pointer-events-none ${
          active 
            ? '-top-4 text-[10px] text-[#C17A3A]' 
            : 'top-3 text-[12px] md:text-sm text-[rgba(245,240,232,0.4)]'
        }`}
        style={{ 
          fontFamily: 'Jost, sans-serif', 
          textTransform: 'uppercase', 
          letterSpacing: '0.1em' 
        }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`w-full bg-transparent outline-none transition-colors duration-250 ease-in-out text-[#F5F0E8] text-[16px] md:text-[14px] min-h-[48px] md:min-h-0 ${
          error ? 'border-[#ef4444]' : focused ? 'border-[#C17A3A]' : 'border-[rgba(255,255,255,0.15)]'
        }`}
        style={{
          borderBottomWidth: '1px',
          borderBottomStyle: 'solid',
          paddingBottom: '8px',
          paddingTop: active ? '8px' : '12px'
        }}
        {...props}
      />
      {error && (
        <span 
          className="absolute -bottom-5 left-0 text-[#ef4444]" 
          style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px' }}
        >
          {error}
        </span>
      )}
    </div>
  );
};

export default function SignupModal({ onClose, onNavigate }: Props) {
  const [mounted, setMounted] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successMounted, setSuccessMounted] = useState(false);
  const [formVisible, setFormVisible] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (isSuccess) {
      const t = setTimeout(() => setSuccessMounted(true), 50);
      return () => clearTimeout(t);
    }
  }, [isSuccess]);

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
    const { error } = await signUpWithEmail({ name, email, phone, password });
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
                We sent a verification link to<br/>
                <span className="text-[#F5F0E8]">{email}</span>
              </p>
              <button
                onClick={() => {}}
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
                Resend email
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
                  Create Account
                </h2>
                <div className="mx-auto mt-4" style={{ width: '36px', height: '1px', background: '#C17A3A' }} />
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                <InputField 
                  label="Full Name" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  error={errors.name}
                />
                <InputField 
                  label="Email Address" 
                  type="email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  error={errors.email}
                />
                <InputField 
                  label="Phone Number" 
                  type="tel" 
                  value={phone} 
                  onChange={(e) => setPhone(e.target.value)} 
                  error={errors.phone}
                />
                <InputField 
                  label="Password" 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  error={errors.password}
                />
                <InputField 
                  label="Confirm Password" 
                  type="password" 
                  value={confirmPassword} 
                  onChange={(e) => setConfirmPassword(e.target.value)} 
                  error={errors.confirmPassword}
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
                      CREATING ACCOUNT...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 relative z-10">
                      SIGN UP <span className="text-[14px] transition-transform duration-300 group-hover:translate-x-1">→</span>
                    </span>
                  )}
                </button>
              </form>

              <div className="flex items-center gap-4 my-8">
                <div className="flex-1 h-[1px] bg-[rgba(255,255,255,0.08)]" />
                <span 
                  className="text-[rgba(245,240,232,0.25)] uppercase"
                  style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.1em' }}
                >
                  OR
                </span>
                <div className="flex-1 h-[1px] bg-[rgba(255,255,255,0.08)]" />
              </div>

              <button
                className="w-full flex items-center justify-center gap-3 transition-colors duration-300 hover:bg-[rgba(255,255,255,0.08)] min-h-[52px]"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#F5F0E8',
                  fontFamily: 'Jost, sans-serif',
                  fontSize: '13px'
                }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <div className="mt-8 text-center pb-8 md:pb-0">
                <p 
                  className="text-[rgba(245,240,232,0.3)]"
                  style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}
                >
                  Already have an account?{' '}
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

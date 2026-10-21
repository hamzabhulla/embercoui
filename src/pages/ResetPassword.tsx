import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { supabase } from '../lib/supabase.ts';
import { updatePassword } from '../services/auth.ts';

const labelStyle: React.CSSProperties = {
  fontFamily: 'Jost, sans-serif', textTransform: 'uppercase', letterSpacing: '0.1em',
  fontSize: '10px', color: '#C17A3A', display: 'block', marginBottom: '6px',
};
const inputStyle: React.CSSProperties = {
  fontFamily: 'Jost, sans-serif', fontSize: '14px', color: '#F5F0E8',
  background: 'transparent', borderBottom: '1px solid rgba(255,255,255,0.15)',
  paddingBottom: '8px', width: '100%', outline: 'none',
};

export default function ResetPassword() {
  const navigate = useNavigate();
  const [state, setState] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (!supabase) { setState('invalid'); return; }
    let settled = false;
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN')) {
        settled = true;
        setState('ready');
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!settled && data.session) { settled = true; setState('ready'); }
    });
    const t = setTimeout(() => { if (!settled) setState('invalid'); }, 2500);
    return () => { listener.subscription.unsubscribe(); clearTimeout(t); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setError('Passwords must match'); return; }
    setError(null);
    setSubmitting(true);
    const { error: updateError } = await updatePassword(password);
    setSubmitting(false);
    if (updateError) { setError(updateError); return; }
    setState('done');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-24" style={{ background: '#0D1A0E' }}>
      <div
        className="w-full max-w-[480px] border border-[rgba(255,255,255,0.08)] p-8 md:p-10"
        style={{ background: '#0D1A0E', boxShadow: '0 40px 80px rgba(0,0,0,0.6)' }}
      >
        <div className="text-center mb-8">
          <p className="uppercase mb-3" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.25em', color: '#C17A3A' }}>
            ✦ &nbsp; Ember &amp; Co.
          </p>
          <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, fontSize: '32px', color: '#F5F0E8' }}>
            Set a New Password
          </h1>
          <div className="mx-auto mt-4" style={{ width: '36px', height: '1px', background: '#C17A3A' }} />
        </div>

        {state === 'checking' && (
          <p className="text-center" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.5)' }}>
            Verifying your reset link…
          </p>
        )}

        {state === 'invalid' && (
          <div className="text-center">
            <p className="mb-6" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.6)', lineHeight: 1.7 }}>
              This reset link is invalid or has expired. Please request a new one.
            </p>
            <button
              onClick={() => navigate('/forgot-password')}
              className="w-full flex items-center justify-center transition-all duration-300 hover:brightness-110 min-h-[52px]"
              style={{ background: '#C17A3A', color: 'white', textTransform: 'uppercase', letterSpacing: '0.18em', fontFamily: 'Jost, sans-serif', fontSize: '11px' }}
            >
              Request a New Link
            </button>
          </div>
        )}

        {state === 'ready' && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div>
              <label style={labelStyle}>New Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete="new-password" />
            </div>
            <div>
              <label style={labelStyle}>Confirm Password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputStyle} autoComplete="new-password" />
            </div>
            {error && (
              <p className="text-[#ef4444]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>{error}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center transition-all duration-300 hover:brightness-110 min-h-[52px] disabled:opacity-60"
              style={{ background: '#C17A3A', color: 'white', textTransform: 'uppercase', letterSpacing: '0.18em', fontFamily: 'Jost, sans-serif', fontSize: '11px' }}
            >
              {submitting ? 'Saving…' : 'Update Password'}
            </button>
          </form>
        )}

        {state === 'done' && (
          <div className="text-center">
            <div className="mx-auto mb-5 w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(74,222,128,0.15)' }}>
              <Check size={22} color="#4ade80" />
            </div>
            <p className="mb-6" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.6)', lineHeight: 1.7 }}>
              Your password has been updated. You can now sign in with your new password.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="w-full flex items-center justify-center transition-all duration-300 hover:brightness-110 min-h-[52px]"
              style={{ background: '#C17A3A', color: 'white', textTransform: 'uppercase', letterSpacing: '0.18em', fontFamily: 'Jost, sans-serif', fontSize: '11px' }}
            >
              Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

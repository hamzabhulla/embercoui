import { useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest } from '../services/api.ts';

/**
 * Heart toggle shown on menu cards. Renders nothing for guests, so the
 * public site looks exactly as before for signed-out visitors.
 *
 * Styling + motion follow the approved motion mockup: a frosted circle;
 * on a successful SAVE the heart beats and gold sparks burst from it.
 * The burst is decorative only — the saved state always comes from the
 * API/profile, never from the animation.
 */
export default function FavoriteButton({ itemId }: { itemId: number }) {
  const { user, profile, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  if (!user) return null;
  const active = profile?.favorites.includes(itemId) ?? false;

  const celebrate = () => {
    const btn = btnRef.current;
    if (!btn || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    btn.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: 0.3 }, { transform: 'scale(0.88)', offset: 0.55 }, { transform: 'scale(1)' }],
      { duration: 650, easing: 'cubic-bezier(.2,2.4,.4,1)' },
    );
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let i = 0; i < 10; i++) {
      const star = i % 3 === 0;
      const s = document.createElement('span');
      s.textContent = star ? '✦' : '';
      Object.assign(s.style, {
        position: 'fixed', left: `${cx}px`, top: `${cy}px`, width: star ? 'auto' : '5px', height: star ? 'auto' : '5px',
        borderRadius: '50%', background: star ? 'transparent' : '#E9C48C', color: '#C17A3A',
        fontSize: '11px', pointerEvents: 'none', zIndex: 210,
      });
      document.body.appendChild(s);
      const ang = (i / 10) * Math.PI * 2;
      const dist = 34 + Math.random() * 26;
      s.animate(
        [
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          { transform: `translate(${Math.cos(ang) * dist - 2}px, ${Math.sin(ang) * dist - 2}px) scale(0.3)`, opacity: 0 },
        ],
        { duration: 620 + Math.random() * 200, easing: 'cubic-bezier(.2,.8,.3,1)' },
      ).onfinish = () => s.remove();
    }
  };

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const wasActive = active;
    const res = await apiRequest('/api/v1/account/favorites', { method: 'POST', body: JSON.stringify({ menuItemId: itemId }) });
    if (!res.ok) {
      setFailed(true);
      setTimeout(() => setFailed(false), 2500);
    } else if (!wasActive) {
      celebrate();
    }
    await refreshProfile();
    setBusy(false);
  };

  return (
    <button
      ref={btnRef}
      onClick={toggle}
      disabled={busy}
      aria-label={active ? 'Remove from favorites' : 'Save to favorites'}
      className="absolute top-3 right-3 z-20 w-[38px] h-[38px] rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 disabled:opacity-50"
      style={{
        background: active ? 'rgba(193,122,58,0.22)' : 'rgba(6,10,6,0.45)',
        border: '1px solid rgba(255,255,255,0.25)',
        borderColor: active ? '#C17A3A' : 'rgba(255,255,255,0.25)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <Heart
        size={18}
        color={active ? '#E9C48C' : '#FFFFFF'}
        fill={active ? '#C17A3A' : 'transparent'}
        strokeWidth={1.8}
      />
      {failed && (
        <span className="absolute -bottom-5 right-0 whitespace-nowrap" style={{ fontFamily: 'Jost, sans-serif', fontSize: '9px', color: '#ef4444' }}>
          Could not save
        </span>
      )}
    </button>
  );
}

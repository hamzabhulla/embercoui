import { useState } from 'react';
import { Heart } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiRequest } from '../services/api.ts';

/**
 * Heart toggle shown on menu cards. Renders nothing for guests, so the
 * public site looks exactly as before for signed-out visitors.
 */
export default function FavoriteButton({ itemId }: { itemId: number }) {
  const { user, profile, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!user) return null;
  const active = profile?.favorites.includes(itemId) ?? false;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const res = await apiRequest('/api/v1/account/favorites', { method: 'POST', body: JSON.stringify({ menuItemId: itemId }) });
    if (!res.ok) {
      setFailed(true);
      setTimeout(() => setFailed(false), 2500);
    }
    await refreshProfile();
    setBusy(false);
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={active ? 'Remove from favorites' : 'Save to favorites'}
      className="absolute top-2 right-2 z-20 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 disabled:opacity-50"
      style={{ background: 'rgba(13,26,14,0.65)', backdropFilter: 'blur(4px)' }}
    >
      <Heart size={15} color={active ? '#ef4444' : '#F5F0E8'} fill={active ? '#ef4444' : 'transparent'} />
      {failed && (
        <span className="absolute -bottom-5 right-0 whitespace-nowrap" style={{ fontFamily: 'Jost, sans-serif', fontSize: '9px', color: '#ef4444' }}>
          Could not save
        </span>
      )}
    </button>
  );
}

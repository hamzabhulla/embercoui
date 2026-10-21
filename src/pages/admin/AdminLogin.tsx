import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function AdminLogin() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (user && (profile?.role === 'admin' || profile?.role === 'staff')) navigate('/admin', { replace: true });
    else if (!user) navigate('/login', { replace: true });
    else navigate('/admin', { replace: true }); // signed-in customer: the guard shows the no-access screen
  }, [user, profile, loading, navigate]);
  return (
    <div className="min-h-screen bg-[#0D1A0E] flex items-center justify-center">
      <p className="font-bodytext text-[#F5F0E8]/60 tracking-[0.2em] uppercase text-xs">Checking access…</p>
    </div>
  );
}

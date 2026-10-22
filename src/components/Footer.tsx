import { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoToReservations } from '../lib/nav.ts';
import { usePublicSettings } from '../hooks/usePublicSettings';

export default function Footer() {
  const navigate = useNavigate();
  const goToReservations = useGoToReservations();
  const settings = usePublicSettings();
  // Footer contact details: the footer's own overrides win, the global
  // Restaurant profile fields are the fallback, and a value that resolves
  // to null is simply not rendered — there is no hardcoded stand-in.
  const brandName = settings?.restaurantName ?? 'Ember & Co.';
  const footerContacts = settings?.siteLocations?.footer;
  const address = footerContacts?.address ?? settings?.address ?? null;
  const phone = footerContacts?.phone ?? settings?.phone ?? null;
  const email = footerContacts?.email ?? settings?.email ?? null;
  const telHref = phone ? `tel:${phone.replace(/[^0-9+]/g, '')}` : null;
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [colVisible, setColVisible] = useState<boolean[]>(new Array(3).fill(false));

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    [0, 1, 2].forEach((i) => {
      const el = colRefs.current[i];
      if (!el) return;
      const obs = new IntersectionObserver(([entry]) => {
        setColVisible(prev => {
          const next = [...prev];
          next[i] = entry.isIntersecting;
          return next;
        });
      }, { threshold: 0.1 });
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach(o => o.disconnect());
  }, []);

  return (
    <footer style={{ background: '#0C130D' }}>
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
          {/* Brand */}
          <div
            ref={el => { colRefs.current[0] = el; }}
            className={`reveal ${colVisible[0] ? 'visible' : ''}`}
            style={{ transitionDelay: '0s' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="text-ember text-xl">✦</span>
              <span
                className="text-white text-lg font-semibold"
                style={{ fontFamily: 'Cormorant Garamond, serif' }}
              >
                {brandName}
              </span>
            </div>
            <p
              className="text-xs leading-relaxed"
              style={{ color: 'rgba(255,255,255,0.45)', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}
            >
              A forest-to-table kitchen crafting seasonal, intentional cuisine. Open since 2009.
            </p>
          </div>

          {/* Visit Us */}
          <div
            ref={el => { colRefs.current[1] = el; }}
            className={`reveal ${colVisible[1] ? 'visible' : ''}`}
            style={{ transitionDelay: '0.1s' }}
          >
            <h4
              className="text-white text-sm font-medium mb-4 tracking-widest uppercase"
              style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.1em', fontSize: '0.7rem' }}
            >
              Visit Us
            </h4>
            <div
              className="text-xs space-y-2 leading-relaxed"
              style={{ color: 'rgba(255,255,255,0.65)', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}
            >
              {address && <p style={{ whiteSpace: 'pre-line' }}>{address}</p>}
              {phone && telHref && (
                <p className="pt-2">
                  <a href={telHref} className="hover:text-ember transition-colors">
                    {phone}
                  </a>
                </p>
              )}
              {email && (
                <p>
                  <a href={`mailto:${email}`} className="hover:text-ember transition-colors">
                    {email}
                  </a>
                </p>
              )}
            </div>
          </div>

          {/* Quick Links */}
          <div
            ref={el => { colRefs.current[2] = el; }}
            className={`reveal ${colVisible[2] ? 'visible' : ''}`}
            style={{ transitionDelay: '0.2s' }}
          >
            <h4
              className="text-white text-sm font-medium mb-4 tracking-widest uppercase"
              style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.1em', fontSize: '0.7rem' }}
            >
              Quick Links
            </h4>
            <nav
              className="flex flex-col gap-2 text-xs"
              style={{ color: 'rgba(255,255,255,0.65)', fontFamily: 'Jost, sans-serif', fontWeight: 300 }}
            >
              <a href="/menu" onClick={(e) => { e.preventDefault(); navigate('/menu'); }} className="hover:text-ember transition-colors">Menu</a>
              <a href="/#reservations" onClick={goToReservations} className="hover:text-ember transition-colors">Reserve</a>
              <a href="/our-story" onClick={(e) => { e.preventDefault(); navigate('/our-story'); }} className="hover:text-ember transition-colors">Our Story</a>
            </nav>
          </div>
        </div>

        <div
          className="border-t border-white/10 pt-8"
          style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'Jost, sans-serif', fontSize: '0.75rem' }}
        >
          <p className="text-center">
            © 2009–2026 {brandName}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

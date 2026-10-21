import { useEffect, useState } from 'react';
import { fetchPublicSettings } from '../services/api.ts';

export default function LiveStatus() {
  // Defaults match the restaurant's long-standing display; the API
  // (admin-controlled settings) overrides them when reachable.
  const [kitchenOpen, setKitchenOpen] = useState(true);
  const [waitMin, setWaitMin] = useState(20);
  const [waitMax, setWaitMax] = useState(30);

  useEffect(() => {
    let cancelled = false;
    fetchPublicSettings().then((settings) => {
      if (cancelled || !settings) return;
      setKitchenOpen(settings.kitchenOpen);
      setWaitMin(settings.waitMin);
      setWaitMax(settings.waitMax);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <section
      id="livestatus"
      className="md:py-3 md:px-6 px-[16px] py-[10px] border-b border-[rgba(193,122,58,0.2)] md:border-none"
      style={{ background: '#1C2B1E' }}
    >
      <div className="max-w-7xl mx-auto">
        
        {/* DESKTOP STATUS BAR */}
        <div className="hidden md:flex flex-row items-center justify-center gap-10 text-center">
          {/* Kitchen open */}
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              {kitchenOpen && (
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ background: '#4ade80' }}
                />
              )}
              <span
                className="relative inline-flex rounded-full h-2.5 w-2.5"
                style={{ background: kitchenOpen ? '#22c55e' : '#ef4444' }}
              />
            </span>
            <span
              className="text-white/90 text-xs tracking-widest uppercase"
              style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.15em', fontSize: '0.7rem' }}
            >
              {kitchenOpen ? 'Kitchen Open' : 'Kitchen Closed'}
            </span>
          </div>

          <span className="text-white/20 text-xs">|</span>

          {/* Wait time */}
          <div className="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#C17A3A]">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span
              className="text-white/70 text-xs tracking-wide"
              style={{ fontFamily: 'Jost, sans-serif', fontSize: '0.72rem' }}
            >
              Estimated wait: <span className="text-white font-medium">{waitMin}–{waitMax} min</span>
            </span>
          </div>

          <span className="text-white/20 text-xs">|</span>

          {/* Tables */}
          <div className="flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#C17A3A]">
              <path d="M3 7h18M3 12h18M3 17h18" />
            </svg>
            <span
              className="text-white/70 text-xs tracking-wide"
              style={{ fontFamily: 'Jost, sans-serif', fontSize: '0.72rem' }}
            >
              Tables available: <span className="text-white font-medium">4 remaining tonight</span>
            </span>
          </div>
        </div>

        {/* MOBILE STATUS BAR */}
        <div className="flex md:hidden items-center justify-center gap-[6px] whitespace-nowrap overflow-hidden w-full">
          {/* Green dot + OPEN */}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-[6px] w-[6px]">
              {kitchenOpen && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: '#4ade80' }} />}
              <span className="relative inline-flex rounded-full h-[6px] w-[6px]" style={{ background: kitchenOpen ? '#22c55e' : '#ef4444' }} />
            </span>
            <span className="text-[#F5F0E8] uppercase" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.1em' }}>{kitchenOpen ? 'OPEN' : 'CLOSED'}</span>
          </div>
          
          {/* Separator */}
          <span style={{ color: 'rgba(245,240,232,0.2)', fontSize: '10px' }}>&middot;</span>
          
          {/* Wait time */}
          <span className="text-[#F5F0E8]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px' }}>~{waitMin} min</span>
          
          {/* Separator */}
          <span style={{ color: 'rgba(245,240,232,0.2)', fontSize: '10px' }}>&middot;</span>
          
          {/* Tables */}
          <span className="text-[#C17A3A]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px' }}>4 tables left</span>
        </div>

      </div>
    </section>
  );
}

import React from 'react';
import { X } from 'lucide-react';

interface Props {
  mounted: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

const HERO_IMG =
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=80';

function Medallion({ size = 46 }: { size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        border: '1px solid rgba(193,122,58,0.65)',
        boxShadow: '0 0 0 4px rgba(193,122,58,0.10), inset 0 0 12px rgba(193,122,58,0.15)',
      }}
    >
      {/* Brand monogram (logo kit) inside the medallion ring. */}
      <img
        src="/ember-co-monogram.svg"
        alt=""
        style={{ width: size * 0.55, height: size * 0.55 }}
      />
    </div>
  );
}

/**
 * Shared premium frame for the auth screens (login / signup / forgot
 * password): ember-glow overlay, gold-trimmed card, cinematic side panel
 * on desktop and an image banner on mobile. Form content renders inside.
 */
export default function AuthShell({ mounted, onClose, children }: Props) {
  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-300 ${mounted ? 'opacity-100' : 'opacity-0'}`}
      style={{
        background:
          'radial-gradient(ellipse 60% 50% at 50% 42%, rgba(193,122,58,0.13), transparent 65%), rgba(4,10,5,0.94)',
        backdropFilter: 'blur(14px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full min-h-[100vh] md:min-h-0 md:max-h-[92vh] md:w-[780px] flex md:flex-row flex-col justify-center md:justify-start bg-[#0D1A0E] transition-all duration-300 transform ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'} relative`}
        style={{
          border: '1px solid rgba(193,122,58,0.28)',
          boxShadow:
            '0 50px 100px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,0,0,0.4), 0 0 90px -30px rgba(193,122,58,0.35)',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-5 right-5 w-9 h-9 rounded-full flex items-center justify-center text-[rgba(245,240,232,0.7)] hover:text-[#C17A3A] hover:bg-[rgba(255,255,255,0.05)] transition-colors z-20"
        >
          <X size={18} />
        </button>

        {/* LEFT VISUAL PANEL (Desktop) */}
        <div className="hidden md:block w-[248px] relative shrink-0 overflow-hidden">
          <img
            src={HERO_IMG}
            alt="Ambiance"
            loading="lazy"
            width="600"
            height="800"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(13,26,14,0.30) 0%, rgba(13,26,14,0.45) 45%, rgba(13,26,14,0.94) 100%)',
            }}
          />
          <div className="absolute inset-3 border border-[rgba(193,122,58,0.35)] pointer-events-none" />
          <div className="absolute bottom-[34px] left-[30px] right-[24px] z-10">
            <Medallion />
            <p
              className="text-[#F5F0E8] uppercase mt-5 mb-3"
              style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', letterSpacing: '0.32em' }}
            >
              Ember &amp; Co.
            </p>
            <p
              className="text-white italic"
              style={{
                fontFamily: 'Cormorant Garamond, serif',
                fontSize: '23px',
                fontWeight: 300,
                lineHeight: '1.25',
              }}
            >
              Where Every Meal Tells a Story
            </p>
            <div className="mt-4 mb-3" style={{ width: '36px', height: '1px', background: '#C17A3A' }} />
            <p
              className="uppercase"
              style={{
                fontFamily: 'Jost, sans-serif',
                fontSize: '8.5px',
                letterSpacing: '0.28em',
                color: 'rgba(245,240,232,0.55)',
              }}
            >
              Fine Dining, Delivered
            </p>
          </div>
        </div>

        {/* RIGHT SIDE */}
        <div className="flex-1 flex flex-col px-[28px] pt-[36px] pb-[52px] md:px-[46px] md:py-[50px] overflow-y-auto hide-scrollbar relative overflow-x-hidden">
          {/* Mobile image banner */}
          <div className="md:hidden relative -mx-[28px] -mt-[36px] mb-8 h-[118px] overflow-hidden shrink-0">
            <img src={HERO_IMG} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(13,26,14,0.45), rgba(13,26,14,0.88))',
              }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Medallion size={38} />
              <p
                className="text-[#F5F0E8] uppercase"
                style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.32em' }}
              >
                Ember &amp; Co.
              </p>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-center w-full">{children}</div>
        </div>
      </div>
    </div>
  );
}

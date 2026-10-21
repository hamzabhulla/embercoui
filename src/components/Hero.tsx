import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function Hero() {
  const heroRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (!heroRef.current) return;
      const y = window.scrollY;
      heroRef.current.style.transform = `translateY(${y * 0.4}px)`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <section
      id="hero"
      className="relative h-[100svh] md:h-screen min-h-[600px] overflow-hidden flex items-center justify-center"
    >
      <style>{`
        @keyframes scrollLine {
          0% { transform: translateY(-100%); opacity: 0; }
          30% { opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translateY(200%); opacity: 0; }
        }
      `}</style>
      {/* Background layer (parallax) */}
      <div
        ref={heroRef}
        className="absolute inset-0 scale-100 will-change-transform"
        style={{ top: '0', height: '100%' }}
      >
        {isMobile ? (
          <img
            src="https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=85&auto=format&fit=crop"
            alt="Fine dining"
            loading="eager"
            width="1200"
            height="1800"
            className="w-full h-full object-cover"
          />
        ) : (
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="w-full h-full object-cover"
            poster="https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1400&q=85&auto=format&fit=crop"
          >
            <source
              src="https://vamwyouzculrmxlxqkwe.supabase.co/storage/v1/object/public/hero-portfolio-video/hero-video.mp4"
              type="video/mp4"
            />
            <img
              src="https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1400&q=85&auto=format&fit=crop"
              alt="Fine dining"
              loading="eager"
              width="1400"
              height="900"
              className="w-full h-full object-cover"
            />
          </video>
        )}
      </div>

      {/* Top gradient for navbar readability */}
      <div
        className="absolute top-0 left-0 right-0 h-full pointer-events-none z-[1]"
        style={{
          background: 'linear-gradient(to bottom, rgba(10,18,10,0.7) 0%, transparent 40%)',
        }}
      />

      {/* Dark overlay (Desktop) */}
      <div
        ref={overlayRef}
        className="absolute inset-0 hidden md:block"
        style={{
          background: 'linear-gradient(to bottom, rgba(12,19,13,0.25) 0%, rgba(12,19,13,0.35) 60%, rgba(12,19,13,0.55) 100%)',
        }}
      />
      {/* Dark overlay (Mobile) */}
      <div
        className="absolute inset-0 md:hidden z-[1]"
        style={{
          background: 'linear-gradient(to bottom, rgba(5,12,6,0.3) 0%, rgba(5,12,6,0.2) 40%, rgba(5,12,6,0.85) 100%)',
        }}
      />

      {/* DESKTOP CONTENT */}
      <div className="hidden md:block relative z-10 text-center px-6 max-w-4xl mx-auto">
        {/* Headline */}
        <h1
          className="text-white mb-6 leading-none"
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 'clamp(3rem, 9vw, 7rem)',
            fontWeight: 300,
            letterSpacing: '-0.01em',
            textShadow: '0 4px 40px rgba(0,0,0,0.6)',
          }}
        >
          Crafted for
          <br />
          <em style={{ fontStyle: 'italic', fontWeight: 400 }}>the Senses</em>
        </h1>

        {/* Sub */}
        <p
          className="text-white/90 max-w-md mx-auto mb-10 leading-relaxed"
          style={{ fontFamily: 'Jost, sans-serif', fontWeight: 300, fontSize: '1rem' }}
        >
          A seasonal kitchen rooted in forest-to-table philosophy,<br />
          where every dish tells the story of the land.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="#menu"
            className="group relative overflow-hidden border border-white text-white px-8 py-3.5 text-xs tracking-widest uppercase hover:bg-white/10 transition-all duration-300 w-full sm:w-auto text-center"
            style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.2em', fontSize: '0.72rem' }}
          >
            <span className="relative z-10">View Our Menu</span>
          </a>
          <a
            href="#reservations"
            className="group relative overflow-hidden bg-[#C17A3A] hover:bg-[#A66932] text-white px-8 py-3.5 text-xs tracking-widest uppercase transition-all duration-300 w-full sm:w-auto text-center hover:shadow-xl hover:shadow-[#C17A3A]/30"
            style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.2em', fontSize: '0.72rem' }}
          >
            Reserve a Table
          </a>
        </div>
      </div>

      {/* MOBILE CONTENT (SaaS Style) */}
      <div className="md:hidden absolute bottom-[80px] left-0 right-0 px-[24px] text-left z-10">
        <p 
          className="text-[#C17A3A] uppercase mb-[12px]"
          style={{ fontFamily: 'Jost, sans-serif', fontSize: '9px', letterSpacing: '0.2em' }}
        >
          ✦ FINE DINING · EST. 2009
        </p>
        
        <h1
          className="mb-[16px] leading-none"
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: '52px',
            color: '#F5F0E8',
            fontWeight: 300,
          }}
        >
          Crafted for<br />
          the Senses
        </h1>

        <div className="flex gap-[12px]">
          <a
            href="#menu"
            className="flex-1 flex items-center justify-center border border-white text-white uppercase transition-colors hover:bg-white/10"
            style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.15em', fontSize: '11px', height: '52px' }}
          >
            View Menu
          </a>
          <a
            href="#reservations"
            className="flex-1 flex items-center justify-center bg-[#C17A3A] text-white uppercase transition-colors hover:bg-[#A66932]"
            style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.15em', fontSize: '11px', height: '52px' }}
          >
            Reserve
          </a>
        </div>
      </div>

      {/* DESKTOP Scroll indicator */}
      <div className="hidden md:flex absolute bottom-8 left-1/2 -translate-x-1/2 flex-col items-center gap-2 text-white/40 animate-bounce z-10">
        <ChevronDown size={20} />
      </div>

      {/* MOBILE Scroll indicator */}
      <div className="md:hidden absolute bottom-[20px] left-1/2 -translate-x-1/2 flex flex-col items-center z-10">
        <div className="w-[1px] h-[36px] bg-[rgba(245,240,232,0.15)] relative overflow-hidden">
          <div 
            className="absolute top-0 left-0 w-full h-[50%] bg-[rgba(245,240,232,0.4)]"
            style={{ animation: 'scrollLine 2s cubic-bezier(0.65, 0, 0.35, 1) infinite' }}
          />
        </div>
      </div>
    </section>
  );
}

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Leaf, ChefHat, Sprout } from 'lucide-react';

/* ─── Scroll reveal hook ──────────────────────────────────────────────────── */
function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let obs: IntersectionObserver;
    let raf2: number;
    // Double-rAF ensures the browser paints opacity:0 before observation starts
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        obs = new IntersectionObserver(
          ([entry]) => {
            if (entry.isIntersecting) {
              el.classList.add('sr-visible');
              obs.disconnect();
            }
          },
          { threshold: 0.15 }
        );
        obs.observe(el);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      obs?.disconnect();
    };
  }, []);

  return ref;
}

/* ─── Team members data ───────────────────────────────────────────────────── */
const team = [
  {
    name: 'Marco Fontaine',
    role: 'Head Chef',
    bio: 'Trained in Lyon and Tokyo, Marco brings a decade of Michelin-starred precision to every plate. His philosophy: ingredients should speak louder than technique.',
    photo: 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?w=400&q=80',
  },
  {
    name: 'Sofia Alvarez',
    role: 'Sommelier',
    bio: 'A WSET Diploma holder with a talent for pairing biodynamic wines to seasonal menus. Sofia curates a cellar that surprises without intimidating.',
    photo: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=400&q=80',
  },
  {
    name: 'James Okafor',
    role: 'Restaurant Director',
    bio: 'With fifteen years in hospitality across three continents, James orchestrates the dining room with quiet authority and genuine warmth.',
    photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80',
  },
];

/* ─── Values data ─────────────────────────────────────────────────────────── */
const values = [
  {
    icon: <Leaf size={28} strokeWidth={1.5} color="#C17A3A" />,
    title: 'Sustainability',
    desc: "Every decision from sourcing to waste is made with the forests in mind. We partner only with farmers who share our commitment to the land.",
  },
  {
    icon: <ChefHat size={28} strokeWidth={1.5} color="#C17A3A" />,
    title: 'Craftsmanship',
    desc: "We reject shortcuts. Each dish is a study in patience: slow ferments, hand-rolled pastas, sauces that simmer for hours to reach their full expression.",
  },
  {
    icon: <Sprout size={28} strokeWidth={1.5} color="#C17A3A" />,
    title: 'Seasonality',
    desc: "Our menu changes with the harvest. What grows together, goes together. What the season does not offer, we simply do not serve.",
  },
];

/* ─── Page component ──────────────────────────────────────────────────────── */
export default function OurStory() {
  const navigate = useNavigate();
  const heroRef = useScrollReveal<HTMLDivElement>();
  const s1TextRef = useScrollReveal<HTMLDivElement>();
  const s1ImgRef = useScrollReveal<HTMLDivElement>();
  const s2TextRef = useScrollReveal<HTMLDivElement>();
  const s2ImgRef = useScrollReveal<HTMLDivElement>();
  const teamRef = useScrollReveal<HTMLDivElement>();
  const valuesRef = useScrollReveal<HTMLDivElement>();
  const ctaRef = useScrollReveal<HTMLDivElement>();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const navigateTo = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(path);
  };

  return (
    <>
      {/* ── Global scroll-reveal styles ── */}
      <style>{`
        .sr-hidden {
          opacity: 0;
          transform: translateY(36px);
          transition: opacity 0.8s cubic-bezier(0.22,1,0.36,1),
                      transform 0.8s cubic-bezier(0.22,1,0.36,1);
        }
        .sr-hidden-left {
          opacity: 0;
          transform: translateX(-40px);
          transition: opacity 0.9s cubic-bezier(0.22,1,0.36,1),
                      transform 0.9s cubic-bezier(0.22,1,0.36,1);
        }
        .sr-hidden-right {
          opacity: 0;
          transform: translateX(40px);
          transition: opacity 0.9s cubic-bezier(0.22,1,0.36,1),
                      transform 0.9s cubic-bezier(0.22,1,0.36,1);
        }
        .sr-visible {
          opacity: 1 !important;
          transform: none !important;
        }
      `}</style>

      <div className="min-h-screen" style={{ background: '#F5F0E8' }}>

        {/* ════════════════════════════════════════════════════
            HERO
        ════════════════════════════════════════════════════ */}
        <section
          className="relative w-full flex items-center justify-center overflow-hidden"
          style={{ height: '60vh', minHeight: 420 }}
        >
          {/* Background image */}
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{
              backgroundImage:
                'url(https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1600&q=80)',
            }}
          />
          {/* Dark overlay */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(10,18,10,0.7)' }}
          />

          {/* Hero text */}
          <div
            ref={heroRef}
            className="sr-hidden relative z-10 text-center px-6 flex flex-col items-center gap-5"
          >
            <span
              className="text-xs tracking-[0.3em] uppercase"
              style={{ color: '#C17A3A', fontFamily: 'Jost, sans-serif' }}
            >
              ✦ Our Story
            </span>
            <h1
              style={{
                fontFamily: 'Cormorant Garamond, serif',
                fontWeight: 300,
                fontSize: 'clamp(36px, 6vw, 56px)',
                color: '#fff',
                lineHeight: 1.1,
                letterSpacing: '-0.01em',
              }}
            >
              Where Every Meal<br />Tells a Story
            </h1>
            {/* Thin orange divider */}
            <div style={{ width: 64, height: 1, background: '#C17A3A' }} />
          </div>
        </section>

        {/* ════════════════════════════════════════════════════
            STORY SECTION 1 — The Beginning  (cream bg)
        ════════════════════════════════════════════════════ */}
        <section style={{ background: '#F5F0E8' }}>
          <div className="max-w-7xl mx-auto px-6 py-12 md:py-24 grid md:grid-cols-2 gap-12 lg:gap-20 items-center">

            {/* Image */}
            <div
              ref={s1ImgRef}
              className="sr-hidden-left overflow-hidden"
              style={{ aspectRatio: '4/3' }}
            >
              <img
                src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&q=80"
                alt="Interior of Ember & Co. restaurant"
                loading="lazy"
                width="800"
                height="600"
                className="w-full h-full object-cover"
                style={{ transition: 'transform 0.6s ease', }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.04)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              />
            </div>

            {/* Text */}
            <div
              ref={s1TextRef}
              className="sr-hidden-right flex flex-col gap-6"
            >
              <span
                className="text-xs tracking-[0.3em] uppercase"
                style={{ color: '#C17A3A', fontFamily: 'Jost, sans-serif' }}
              >
                The Beginning
              </span>
              <h2
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontWeight: 400,
                  fontSize: 'clamp(32px, 4vw, 40px)',
                  color: '#1C2B1E',
                  lineHeight: 1.1,
                }}
              >
                Est. 2009
              </h2>
              <div style={{ width: 40, height: 1, background: '#C17A3A' }} />
              <p
                style={{
                  fontFamily: 'Jost, sans-serif',
                  fontWeight: 300,
                  color: '#1C2B1E',
                  lineHeight: 1.85,
                  fontSize: '0.97rem',
                  opacity: 0.82,
                }}
              >
                Ember &amp; Co. was born from a simple belief: that the Pacific Northwest's forests, farms, and coastlines hold everything a kitchen will ever need. In the autumn of 2009, chef Marco Fontaine and sommelier Sofia Alvarez converted a decommissioned cannery on the edge of Portland's Pearl District into something the city had never quite seen — a forest-to-table dining room where the menu changed not quarterly, but weekly.
              </p>
              <p
                style={{
                  fontFamily: 'Jost, sans-serif',
                  fontWeight: 300,
                  color: '#1C2B1E',
                  lineHeight: 1.85,
                  fontSize: '0.97rem',
                  opacity: 0.82,
                }}
              >
                What began as 32 seats and a single wood-fired hearth has since grown into one of the region's most celebrated dining destinations — yet the founding conviction has never wavered: every meal should feel like a letter written by the land itself.
              </p>
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════
            STORY SECTION 2 — Our Philosophy  (dark green bg)
        ════════════════════════════════════════════════════ */}
        <section style={{ background: '#1C2B1E' }}>
          <div className="max-w-7xl mx-auto px-6 py-24 grid md:grid-cols-2 gap-12 lg:gap-20 items-center">

            {/* Text (left on dark section) */}
            <div
              ref={s2TextRef}
              className="sr-hidden-left flex flex-col gap-6 order-2 md:order-1"
            >
              <span
                className="text-xs tracking-[0.3em] uppercase"
                style={{ color: '#C17A3A', fontFamily: 'Jost, sans-serif' }}
              >
                Our Philosophy
              </span>
              <h2
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontWeight: 400,
                  fontSize: 'clamp(32px, 4vw, 40px)',
                  color: '#F5F0E8',
                  lineHeight: 1.1,
                }}
              >
                From Forest to Table
              </h2>
              <div style={{ width: 40, height: 1, background: '#C17A3A' }} />
              <p
                style={{
                  fontFamily: 'Jost, sans-serif',
                  fontWeight: 300,
                  color: '#F5F0E8',
                  lineHeight: 1.85,
                  fontSize: '0.97rem',
                  opacity: 0.78,
                }}
              >
                We source exclusively from a network of thirty-two farms, fishers, and foragers within a 200-mile radius of our kitchen. No exceptions. Every ingredient is selected at its seasonal peak — which means our cooks must be as fluent in the language of the harvest as they are in classical technique.
              </p>
              <p
                style={{
                  fontFamily: 'Jost, sans-serif',
                  fontWeight: 300,
                  color: '#F5F0E8',
                  lineHeight: 1.85,
                  fontSize: '0.97rem',
                  opacity: 0.78,
                }}
              >
                Sustainable sourcing isn't a marketing strategy for us — it's a constraint we embrace willingly. When the last heirloom tomato of the season is gone, it's gone. That honesty is what makes the food taste the way it does.
              </p>
            </div>

            {/* Image */}
            <div
              ref={s2ImgRef}
              className="sr-hidden-right overflow-hidden order-1 md:order-2"
              style={{ aspectRatio: '4/3' }}
            >
              <img
                src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80"
                alt="Close-up of a beautifully plated dish"
                loading="lazy"
                width="800"
                height="600"
                className="w-full h-full object-cover"
                style={{ transition: 'transform 0.6s ease' }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.04)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              />
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════
            STORY SECTION 3 — Meet The Team  (cream bg)
        ════════════════════════════════════════════════════ */}
        <section style={{ background: '#F5F0E8' }}>
          <div className="max-w-7xl mx-auto px-6 py-24">

            {/* Section heading */}
            <div
              ref={teamRef}
              className="sr-hidden text-center mb-16 flex flex-col items-center gap-4"
            >
              <span
                className="text-xs tracking-[0.3em] uppercase"
                style={{ color: '#C17A3A', fontFamily: 'Jost, sans-serif' }}
              >
                Our Team
              </span>
              <h2
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontWeight: 400,
                  fontSize: 'clamp(30px, 4vw, 44px)',
                  color: '#1C2B1E',
                  lineHeight: 1.15,
                }}
              >
                The People Behind<br />The Plate
              </h2>
              <div style={{ width: 40, height: 1, background: '#C17A3A' }} />
            </div>

            {/* Team cards */}
            <div className="grid md:grid-cols-3 gap-8">
              {team.map((member, i) => (
                <TeamCard key={member.name} member={member} delay={i * 120} />
              ))}
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════
            VALUES SECTION  (dark green bg)
        ════════════════════════════════════════════════════ */}
        <section style={{ background: '#0D1A0E' }}>
          <div className="max-w-7xl mx-auto px-6 py-24">

            <div
              ref={valuesRef}
              className="sr-hidden text-center mb-16 flex flex-col items-center gap-4"
            >
              <span
                className="text-xs tracking-[0.3em] uppercase"
                style={{ color: '#C17A3A', fontFamily: 'Jost, sans-serif' }}
              >
                What Guides Us
              </span>
              <h2
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontWeight: 400,
                  fontSize: 'clamp(30px, 4vw, 44px)',
                  color: '#F5F0E8',
                  lineHeight: 1.15,
                }}
              >
                Our Core Values
              </h2>
              <div style={{ width: 40, height: 1, background: '#C17A3A' }} />
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {values.map((val, i) => (
                <ValueCard key={val.title} value={val} delay={i * 120} />
              ))}
            </div>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════
            CTA SECTION
        ════════════════════════════════════════════════════ */}
        <section
          className="relative overflow-hidden mb-[100px]"
          style={{ background: '#F5F0E8' }}
        >
          {/* Subtle texture bar */}
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{ background: 'rgba(28,43,30,0.1)' }}
          />
          <div
            ref={ctaRef}
            className="sr-hidden max-w-3xl mx-auto px-6 py-28 text-center flex flex-col items-center gap-8"
          >
            <span
              className="text-xs tracking-[0.3em] uppercase"
              style={{ color: '#C17A3A', fontFamily: 'Jost, sans-serif' }}
            >
              ✦ Join Us
            </span>
            <h2
              style={{
                fontFamily: 'Cormorant Garamond, serif',
                fontWeight: 400,
                fontSize: 'clamp(32px, 5vw, 50px)',
                color: '#1C2B1E',
                lineHeight: 1.1,
              }}
            >
              Ready to Experience It?
            </h2>
            <p
              style={{
                fontFamily: 'Jost, sans-serif',
                fontWeight: 300,
                color: '#1C2B1E',
                opacity: 0.7,
                fontSize: '1rem',
                lineHeight: 1.8,
                maxWidth: 480,
              }}
            >
              A table at Ember &amp; Co. is more than a reservation — it's an evening shaped by the season, the land, and the hands that bring them together.
            </p>
            <a
              href="/#reservations"
              onClick={navigateTo('/')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                background: '#C17A3A',
                color: '#fff',
                fontFamily: 'Jost, sans-serif',
                fontSize: '0.7rem',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                padding: '16px 40px',
                border: 'none',
                cursor: 'pointer',
                transition: 'background 0.25s ease, transform 0.2s ease, box-shadow 0.25s ease',
                textDecoration: 'none',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.background = '#A66932';
                (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-2px)';
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = '0 8px 28px rgba(193,122,58,0.35)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.background = '#C17A3A';
                (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = 'none';
              }}
            >
              ✦ Reserve a Table
            </a>
          </div>
        </section>

      </div>
    </>
  );
}

/* ─── Team card sub-component ─────────────────────────────────────────────── */
function TeamCard({ member, delay }: { member: typeof team[0]; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let obs: IntersectionObserver;
    let raf2: number;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        obs = new IntersectionObserver(
          ([entry]) => {
            if (entry.isIntersecting) {
              setTimeout(() => el.classList.add('sr-visible'), delay);
              obs.disconnect();
            }
          },
          { threshold: 0.15 }
        );
        obs.observe(el);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      obs?.disconnect();
    };
  }, [delay]);

  return (
    <div
      ref={ref}
      className="sr-hidden group flex flex-col"
      style={{ background: '#fff' }}
    >
      <div className="overflow-hidden" style={{ aspectRatio: '3/4', maxHeight: 340 }}>
        <img
          src={member.photo}
          alt={member.name}
          loading="lazy"
          width="400"
          height="533"
          className="w-full h-full object-cover object-top"
          style={{ transition: 'transform 0.6s ease' }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        />
      </div>
      <div className="p-6 flex flex-col gap-2">
        <div
          style={{ width: 24, height: 1, background: '#C17A3A', marginBottom: 4 }}
        />
        <h3
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontWeight: 500,
            fontSize: '1.35rem',
            color: '#1C2B1E',
          }}
        >
          {member.name}
        </h3>
        <span
          style={{
            fontFamily: 'Jost, sans-serif',
            fontSize: '0.7rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: '#C17A3A',
          }}
        >
          {member.role}
        </span>
        <p
          style={{
            fontFamily: 'Jost, sans-serif',
            fontWeight: 300,
            fontSize: '0.88rem',
            color: '#1C2B1E',
            opacity: 0.75,
            lineHeight: 1.75,
            marginTop: 6,
          }}
        >
          {member.bio}
        </p>
      </div>
    </div>
  );
}

/* ─── Value card sub-component ────────────────────────────────────────────── */
type ValueItem = { icon: React.ReactNode; title: string; desc: string };
function ValueCard({ value, delay }: { value: ValueItem; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let obs: IntersectionObserver;
    let raf2: number;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        obs = new IntersectionObserver(
          ([entry]) => {
            if (entry.isIntersecting) {
              setTimeout(() => el.classList.add('sr-visible'), delay);
              obs.disconnect();
            }
          },
          { threshold: 0.15 }
        );
        obs.observe(el);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      obs?.disconnect();
    };
  }, [delay]);

  return (
    <div
      ref={ref}
      className="sr-hidden flex flex-col gap-5 p-8"
      style={{
        border: '1px solid rgba(245,240,232,0.08)',
        transition: 'border-color 0.3s ease, transform 0.3s ease',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(193,122,58,0.35)';
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(245,240,232,0.08)';
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
      }}
    >
      <div style={{ lineHeight: 0 }}>{value.icon}</div>
      <h3
        style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontWeight: 500,
          fontSize: '1.5rem',
          color: '#F5F0E8',
        }}
      >
        {value.title}
      </h3>
      <div style={{ width: 24, height: 1, background: '#C17A3A' }} />
      <p
        style={{
          fontFamily: 'Jost, sans-serif',
          fontWeight: 300,
          fontSize: '0.88rem',
          color: '#F5F0E8',
          opacity: 0.65,
          lineHeight: 1.8,
        }}
      >
        {value.desc}
      </p>
    </div>
  );
}

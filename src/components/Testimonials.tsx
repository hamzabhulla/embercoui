import { useRef, useEffect, useState } from 'react';
import { useInView } from '../hooks/useInView.ts';
import { fetchApprovedReviews } from '../services/api.ts';

interface DisplayReview {
  id: number;
  stars: number;
  quote: string;
  name: string;
  country: string;
  initials: string;
}

function Stars({ count }: { count: number }) {
  return (
    <div className="flex gap-1 mb-4">
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="#C17A3A">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </div>
  );
}

export default function Testimonials() {
  // Only real, admin-approved guest reviews are ever shown. Until the API
  // returns at least one, the section renders nothing — no invented voices.
  const [reviews, setReviews] = useState<DisplayReview[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchApprovedReviews().then((remote) => {
      if (cancelled || !remote) return;
      setReviews(remote.slice(0, 3).map((r) => ({
        id: r.id as unknown as number,
        stars: r.rating,
        quote: r.comment,
        name: r.name,
        country: r.country ?? '',
        initials: r.name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase(),
      })));
    });
    return () => { cancelled = true; };
  }, []);

  const { ref: headingRef, isInView: headingInView } = useInView();
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [cardVisible, setCardVisible] = useState<boolean[]>(new Array(reviews.length).fill(false));
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const scrollPosition = container.scrollLeft;
      const firstChild = container.children[0] as HTMLElement;
      if (firstChild) {
        const cardWidth = firstChild.clientWidth;
        const gap = 16;
        const index = Math.round(scrollPosition / (cardWidth + gap));
        setActiveIndex(Math.min(reviews.length - 1, Math.max(0, index)));
      }
    }
  };

  useEffect(() => {
    setCardVisible(new Array(reviews.length).fill(false));
    const observers: IntersectionObserver[] = [];
    reviews.forEach((_, i) => {
      const el = cardRefs.current[i];
      if (!el) return;
      const obs = new IntersectionObserver(([entry]) => {
        setCardVisible(prev => {
          const next = [...prev];
          next[i] = entry.isIntersecting;
          return next;
        });
      }, { threshold: 0.1 });
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach(o => o.disconnect());
  }, [reviews]);

  // No approved reviews (or the API is unreachable): show no section at all
  // rather than placeholder praise.
  if (reviews.length === 0) return null;

  return (
    <section id="testimonials" className="py-[48px] md:py-16" style={{ background: '#1C2B1E' }}>
      <div className="max-w-7xl mx-auto px-[20px] md:px-6">
        <div ref={headingRef as React.RefObject<HTMLDivElement>} className={`text-center mb-10 reveal ${headingInView ? 'visible' : ''}`}>
          <p
            className="text-ember text-xs tracking-widest uppercase mb-3"
            style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.25em', fontSize: '0.7rem' }}
          >
            ✦ &nbsp; Guest Voices
          </p>
          <h2
            className="text-white font-light leading-none text-[32px] md:text-[36px]"
            style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, color: '#F5F0E8' }}
          >
            What Our Guests Say
          </h2>
          <div className="w-12 h-px bg-ember mx-auto mt-4" />
        </div>

        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex md:grid md:grid-cols-3 flex-row overflow-x-auto md:overflow-visible snap-x snap-mandatory md:snap-none no-scrollbar gap-[16px] md:gap-6 -mx-[20px] px-[20px] pb-[16px] md:mx-0 md:px-0 md:pb-0"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {reviews.map((review, i) => (
            <div
              key={review.id}
              ref={el => { cardRefs.current[i] = el; }}
              className={`shrink-0 snap-start w-[80vw] max-w-[300px] md:w-auto md:max-w-none border border-white/10 p-[24px_20px] md:p-6 hover:border-ember/40 transition-colors duration-300 reveal ${cardVisible[i] ? 'visible' : ''}`}
              style={{ background: 'rgba(255,255,255,0.03)', transitionDelay: `${i * 0.15}s` }}
            >
              <Stars count={review.stars} />
              <svg
                width="28"
                height="22"
                viewBox="0 0 28 22"
                fill="none"
                className="mb-4 opacity-30"
              >
                <path
                  d="M0 22V13.75C0 10.25 0.933333 7.29167 2.8 4.875C4.66667 2.45833 7.46667 0.833333 11.2 0L12.6 2.625C10.2667 3.20833 8.4 4.29167 7 5.875C5.6 7.45833 4.9 9.25 4.9 11.25H9.8V22H0ZM15.4 22V13.75C15.4 10.25 16.3333 7.29167 18.2 4.875C20.0667 2.45833 22.8667 0.833333 26.6 0L28 2.625C25.6667 3.20833 23.8 4.29167 22.4 5.875C21 7.45833 20.3 9.25 20.3 11.25H25.2V22H15.4Z"
                  fill="#FFFFFF"
                />
              </svg>
              <p
                className="leading-relaxed mb-4"
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  color: 'rgba(255,255,255,0.75)',
                  fontSize: '15px',
                  fontWeight: 300,
                  fontStyle: 'italic',
                }}
              >
                {review.quote}
              </p>
              <div className="flex items-center gap-3 pt-4 border-t border-white/10">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                  style={{ background: '#C17A3A', color: '#fff', fontFamily: 'Jost, sans-serif' }}
                >
                  {review.initials}
                </div>
                <div>
                  <p
                    className="text-sm font-medium"
                    style={{ color: '#FFFFFF', fontFamily: 'Jost, sans-serif' }}
                  >
                    {review.name}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: 'rgba(255,255,255,0.45)', fontFamily: 'Jost, sans-serif' }}
                  >
                    {review.country}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Mobile Scroll Indicator Dots */}
        <div className="flex md:hidden justify-center items-center gap-2 mt-2">
          {reviews.map((_, idx) => (
            <div
              key={idx}
              className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                activeIndex === idx ? 'bg-[#C17A3A]' : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

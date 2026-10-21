import { useRef, useEffect, useState } from 'react';
import { useInView } from '../hooks/useInView.ts';

const photos = [
  {
    id: 1,
    src: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&q=80&auto=format&fit=crop',
    alt: 'Restaurant interior',
  },
  {
    id: 2,
    src: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80&auto=format&fit=crop',
    alt: 'Plated dish',
  },
  {
    id: 3,
    src: 'https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=800&q=80&auto=format&fit=crop',
    alt: 'Table setting',
  },
  {
    id: 4,
    src: 'https://images.unsplash.com/photo-1481931098730-318b6f776db0?w=800&q=80&auto=format&fit=crop',
    alt: 'Cocktails',
  },
  {
    id: 5,
    src: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=800&q=80&auto=format&fit=crop',
    alt: 'Grilled meat',
  },
  {
    id: 6,
    src: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80&auto=format&fit=crop',
    alt: 'Elegant plating',
  },
];

export default function Gallery() {
  const { ref: headingRef, isInView: headingInView } = useInView();
  const photoRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [photoVisible, setPhotoVisible] = useState<boolean[]>(new Array(photos.length).fill(false));

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    photos.forEach((_, i) => {
      const el = photoRefs.current[i];
      if (!el) return;
      const obs = new IntersectionObserver(([entry]) => {
        setPhotoVisible(prev => {
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
    <section id="gallery" className="py-24" style={{ background: '#FFFFFF' }}>
      <div className="max-w-7xl mx-auto px-6">
        <div
          ref={headingRef as React.RefObject<HTMLDivElement>}
          className={`text-center mb-14 reveal ${headingInView ? 'visible' : ''}`}
        >
          <p
            className="text-ember text-xs tracking-widest uppercase mb-3"
            style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.25em', fontSize: '0.7rem' }}
          >
            ✦ &nbsp; Visual Stories
          </p>
          <h2
            className="text-forest text-[36px] md:text-6xl font-light leading-none"
            style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 300 }}
          >
            A Taste of Ember
          </h2>
          <div className="w-12 h-px bg-ember mx-auto mt-5" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          {photos.map((photo, i) => (
            <div
              key={photo.id}
              ref={el => { photoRefs.current[i] = el; }}
              className={`relative overflow-hidden aspect-square cursor-pointer reveal ${photoVisible[i] ? 'visible' : ''}`}
              style={{ transitionDelay: `${[0, 0.1, 0.15, 0.2, 0.25, 0.3][i] || i * 0.1}s` }}
            >
              <img
                src={photo.src}
                alt={photo.alt}
                loading="lazy"
                width="800"
                height="800"
                className="w-full h-full object-cover transition-transform duration-500 hover:scale-110"
              />
              <div className="absolute inset-0 bg-forest/0 hover:bg-forest/20 transition-colors duration-300" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

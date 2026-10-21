import { useState, useEffect, useMemo, memo, useCallback } from 'react';
import { Check, Search } from 'lucide-react';
import { categories, MenuItem } from '../data/menu.ts';
import { useMenuItems } from '../services/useMenuItems.ts';
import { useCart } from '../context/CartContext.tsx';
import { useCurrency } from '../context/CurrencyContext.tsx';
import { useNavigate } from 'react-router-dom';
import FavoriteButton from '../components/FavoriteButton.tsx';

const filters = ['All', 'Vegan', 'Spicy', 'Gluten Free'];

// ─── Dietary tag helper (pure, defined outside component) ────────────────────
function getDietaryTags(item: MenuItem): string[] {
  // Prefer the API's real tags; heuristics only cover the built-in items.
  if (item.tags && item.tags.length > 0) return item.tags;
  const tags: string[] = [];
  const desc = item.description.toLowerCase();
  if (desc.includes('plant-based') || desc.includes('vegan') || item.id === 3 || item.id === 11) tags.push('Vegan');
  if (desc.includes('pepper') || item.id === 8) tags.push('Spicy');
  if (item.id === 12 || item.id === 15) tags.push('Gluten Free');
  return tags;
}

/* ─── Fly-to-cart animation (approved motion mockup) ───────────────────────
   Clones the dish image and flies it to the navbar cart button along a
   curved path with a gold sparkle trail; the cart button and its badge
   pulse on landing. Purely decorative — cart state is updated separately
   and immediately, and the clone is always cleaned up. */
function flyToCart(img: HTMLImageElement | null) {
  if (!img || typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = Array.from(document.querySelectorAll<HTMLElement>('[data-cart-target]'))
    .find((el) => el.getBoundingClientRect().width > 0);
  if (!target) return;
  const r1 = img.getBoundingClientRect();
  if (r1.width === 0) return;
  const r2 = target.getBoundingClientRect();
  const flyer = img.cloneNode() as HTMLImageElement;
  flyer.removeAttribute('id');
  Object.assign(flyer.style, {
    position: 'fixed', left: `${r1.left}px`, top: `${r1.top}px`,
    width: `${r1.width}px`, height: `${r1.height}px`, margin: '0',
    borderRadius: '0px', objectFit: 'cover', pointerEvents: 'none', zIndex: 200,
    boxShadow: '0 18px 44px rgba(0,0,0,0.55)', border: '1px solid rgba(233,196,140,0.6)',
  });
  document.body.appendChild(flyer);
  const dx = (r2.left + r2.width / 2) - (r1.left + r1.width / 2);
  const dy = (r2.top + r2.height / 2) - (r1.top + r1.height / 2);
  let sparks = 0;
  const trail = window.setInterval(() => {
    sparks += 1;
    if (sparks > 7 || !flyer.isConnected) { window.clearInterval(trail); return; }
    const p = flyer.getBoundingClientRect();
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      position: 'fixed', left: `${p.left + p.width / 2}px`, top: `${p.top + p.height / 2}px`,
      width: '7px', height: '7px', borderRadius: '50%', background: '#E9C48C',
      pointerEvents: 'none', zIndex: 199, opacity: '0.85',
    });
    document.body.appendChild(dot);
    dot.animate(
      [{ transform: 'scale(1)', opacity: 0.9 }, { transform: `translate(${(Math.random() * 36 - 18).toFixed(0)}px, ${(14 + Math.random() * 16).toFixed(0)}px) scale(0.2)`, opacity: 0 }],
      { duration: 480, easing: 'ease-out' },
    ).onfinish = () => dot.remove();
  }, 95);
  const anim = flyer.animate(
    [
      { transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '0px' },
      { transform: `translate(${dx * 0.45}px, ${dy - 120}px) scale(0.55)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.06)`, opacity: 0.55, borderRadius: '0px' },
    ],
    { duration: 780, easing: 'cubic-bezier(.3,.7,.3,1)' },
  );
  anim.onfinish = () => {
    flyer.remove();
    window.clearInterval(trail);
    target.animate(
      [{ transform: 'scale(1) rotate(0deg)' }, { transform: 'scale(1.18) rotate(-7deg)', offset: 0.25 }, { transform: 'scale(0.94) rotate(5deg)', offset: 0.55 }, { transform: 'scale(1) rotate(0deg)' }],
      { duration: 600, easing: 'cubic-bezier(.2,2,.4,1)' },
    );
    const badge = target.querySelector('[data-cart-badge]');
    badge?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.55)', offset: 0.35 }, { transform: 'scale(1)' }],
      { duration: 550, easing: 'cubic-bezier(.2,2.2,.4,1)' },
    );
  };
}

/* ─── Scroll reveal hook ─────────────────────────────────────────────────── */
import { useRef } from 'react';
function useReveal<T extends HTMLElement>(delay = 0) {
  const ref = useRef<T>(null);
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
              setTimeout(() => el.classList.add('c-visible'), delay);
              obs.disconnect();
            }
          },
          { threshold: 0.1 }
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
  return ref;
}

// ─── Skeleton card ────────────────────────────────────────────────────────────
const SkeletonCard = memo(() => (
  <div className="overflow-hidden flex flex-col animate-pulse" style={{ background: 'linear-gradient(180deg, rgba(245,240,232,0.045), rgba(245,240,232,0.015))', border: '1px solid rgba(245,240,232,0.09)', borderRadius: '0px' }}>
    <div className="h-[172px] flex-shrink-0" style={{ background: '#0D1A0E' }} />
    <div className="p-0 pb-[14px] md:p-5 flex flex-col gap-3 flex-1">
      <div className="flex flex-col md:flex-row justify-between gap-1 md:gap-3 pt-2 md:pt-0">
        <div className="h-4 md:h-5 rounded w-2/3" style={{ background: 'rgba(245,240,232,0.1)' }} />
        <div className="h-4 md:h-5 rounded w-12" style={{ background: 'rgba(245,240,232,0.1)' }} />
      </div>
      <div className="hidden md:block space-y-2 flex-1">
        <div className="h-3 rounded w-full" style={{ background: 'rgba(245,240,232,0.05)' }} />
        <div className="h-3 rounded w-5/6" style={{ background: 'rgba(245,240,232,0.05)' }} />
        <div className="h-3 rounded w-3/4" style={{ background: 'rgba(245,240,232,0.05)' }} />
      </div>
      <div className="h-[34px] md:h-11 rounded-none mt-auto" style={{ background: 'rgba(245,240,232,0.1)' }} />
    </div>
  </div>
));

// ─── Memoised menu card ───────────────────────────────────────────────────────
const MenuCard = memo(({ item, isAdded, onAdd, index }: {
  item: MenuItem;
  isAdded: boolean;
  onAdd: (item: MenuItem, img: HTMLImageElement | null) => void;
  index: number;
}) => {
  const { format } = useCurrency();
  const ref = useReveal<HTMLDivElement>((index % 3) * 100);
  const imgRef = useRef<HTMLImageElement>(null);

  return (
    <div
      ref={ref}
      className="c-hidden group overflow-hidden flex flex-col transition-all duration-500 hover:-translate-y-[3px] hover:border-[rgba(193,122,58,0.4)]"
      style={{
        background: 'linear-gradient(180deg, rgba(245,240,232,0.045), rgba(245,240,232,0.015))',
        border: '1px solid rgba(245,240,232,0.09)',
        borderRadius: '0px',
      }}
    >
      <div className="relative h-[172px] overflow-hidden flex-shrink-0">
        <FavoriteButton itemId={item.id} />
        <img
          ref={imgRef}
          src={item.image}
          alt={item.name}
          loading="lazy"
          decoding="async"
          width="400"
          height="300"
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
        />
      </div>
      <div className="px-[18px] pb-[18px] pt-4 flex flex-col flex-1">
        <h3
          className="text-[#F5F0E8] text-[21px] leading-[1.15]"
          style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500 }}
        >
          {item.name}
        </h3>
        <div
          className="text-[#C17A3A] text-[10px] uppercase mt-[2px]"
          style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.24em' }}
        >
          {item.category}
        </div>
        <p
          className="text-[#F5F0E8]/60 text-[13px] leading-relaxed mt-[10px] font-light line-clamp-2"
          style={{ fontFamily: 'Jost, sans-serif' }}
        >
          {item.description}
        </p>
        <div className="flex items-center justify-between mt-auto pt-[14px]">
          <span
            className="text-[#E9C48C] text-[21px]"
            style={{ fontFamily: 'Cormorant Garamond, serif' }}
          >
            {format(item.price)}
          </span>
          <button
            onClick={() => onAdd(item, imgRef.current)}
            className={`flex items-center gap-2 rounded-none uppercase transition-all duration-300 ${
              isAdded
                ? 'border border-[#58B368] bg-[#58B368] text-white'
                : 'border border-[rgba(193,122,58,0.6)] bg-[rgba(193,122,58,0.10)] text-[#EBCB9C] hover:bg-[#C17A3A] hover:text-white hover:shadow-[0_10px_26px_rgba(193,122,58,0.35)]'
            }`}
            style={{ fontFamily: 'Jost, sans-serif', fontSize: '10.5px', letterSpacing: '0.2em', padding: '11px 18px' }}
          >
            {isAdded ? <><Check size={13} /> Added</> : 'Add to Cart'}
          </button>
        </div>
      </div>
    </div>
  );
});

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function MenuPage() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [added, setAdded] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const { addItem } = useCart();
  const menuItems = useMenuItems();

  useEffect(() => {
    window.scrollTo(0, 0);
    // Simulate a brief loading state so skeletons are visible on page mount
    const t = setTimeout(() => setIsLoading(false), 500);
    return () => clearTimeout(t);
  }, []);

  const handleAdd = useCallback((item: MenuItem, img?: HTMLImageElement | null) => {
    addItem({ id: item.id, name: item.name, price: item.price, image: item.image });
    flyToCart(img ?? null);
    setAdded(item.id);
    setTimeout(() => setAdded(null), 1500);
  }, [addItem]);

  const handleNavigateHome = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    navigate('/');
  }, [navigate]);

  // ── Memoised filter ─────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    return menuItems.filter(item => {
      if (activeCategory !== 'All' && item.category !== activeCategory) return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!item.name.toLowerCase().includes(q) && !item.description.toLowerCase().includes(q)) {
          return false;
        }
      }

      if (activeFilter !== 'All') {
        const tags = getDietaryTags(item);
        if (!tags.includes(activeFilter)) return false;
      }

      return true;
    });
  }, [activeCategory, searchQuery, activeFilter, menuItems]);

  return (
    <>
      <style>{`
        .c-hidden {
          opacity: 0;
          transform: translateY(32px);
          transition: opacity 0.8s cubic-bezier(0.22,1,0.36,1),
                      transform 0.8s cubic-bezier(0.22,1,0.36,1);
        }
        .c-visible { opacity: 1 !important; transform: none !important; }
      `}</style>
      <div className="min-h-screen bg-[#0D1A0E] pt-[80px]">
        
        {/* BACK TO HOME */}
        <div className="w-full bg-[#0D1A0E]">
          <div className="max-w-7xl mx-auto">
            <a
              href="/"
              onClick={handleNavigateHome}
              className="inline-block text-[#C17A3A] hover:text-[#A66932] transition-colors text-[12px] px-[24px] py-[12px]"
              style={{ fontFamily: 'Jost, sans-serif' }}
            >
              ← Back to Home
            </a>
          </div>
        </div>

        {/* HERO HEADER */}
        <header className="relative w-full h-[45vh] min-h-[300px] flex items-center justify-center overflow-hidden">
          {/* Background Image & Overlay */}
          <div className="absolute inset-0 z-0">
            <img 
              src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1600&q=80" 
              alt="Our Menu" 
              loading="lazy"
              width="1600"
              height="900"
              className="w-full h-full object-cover object-center"
            />
            <div className="absolute inset-0 bg-[rgba(10,18,10,0.75)]" />
          </div>

          {/* Centered Content */}
          <div className="relative z-10 flex flex-col items-center text-center px-6">
            <span
              className="text-[#C17A3A] text-[10px] tracking-[0.25em] uppercase mb-[16px]"
              style={{ fontFamily: 'Jost, sans-serif' }}
            >
              ✦ Our Menu
            </span>
            <h1
              className="text-[#F5F0E8] leading-[1.1] mb-0"
              style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, fontSize: 'clamp(40px, 6vw, 72px)' }}
            >
              Seasonal Creations
            </h1>
            <div className="w-[48px] h-[1px] bg-[#C17A3A] my-[20px]" />
            <p
              className="text-[14px] tracking-[0.05em]"
              style={{ fontFamily: 'Jost, sans-serif', color: 'rgba(245,240,232,0.6)', fontWeight: 300 }}
            >
              Crafted from nature's finest ingredients
            </p>
          </div>

          {/* Smooth Fade to Bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-b from-transparent to-[#0D1A0E] z-10" />
        </header>

      {/* CONTENT AREA */}
      <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row gap-12">

        {/* SIDEBAR (Desktop) */}
        <aside className="hidden md:block w-[240px] flex-shrink-0">
          <div className="sticky top-[120px] bg-[#1C2B1E] p-8 border border-white/[0.03]">
            <h3 className="text-[#C17A3A] text-[10px] tracking-[0.2em] uppercase mb-8 font-medium" style={{ fontFamily: 'Jost, sans-serif' }}>
              Categories
            </h3>
            <ul className="flex flex-col gap-1">
              {categories.map(cat => (
                <li key={cat}>
                  <button
                    onClick={() => setActiveCategory(cat)}
                    className={`text-left w-full py-3 pl-4 transition-all duration-[300ms] ${
                      activeCategory === cat
                        ? 'text-[#C17A3A] border-l-[3px] border-[#C17A3A] bg-white/[0.02]'
                        : 'text-[#F5F0E8]/50 border-l-[3px] border-transparent hover:text-[#F5F0E8] hover:bg-white/[0.01]'
                    }`}
                    style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', letterSpacing: '0.1em', textTransform: 'uppercase' }}
                  >
                    {cat}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* MOBILE PILLS */}
        <div className="md:hidden flex gap-3 overflow-x-auto no-scrollbar pb-4">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`flex-shrink-0 px-6 py-2.5 rounded-none text-[10px] tracking-[0.2em] uppercase transition-all duration-300 border ${
                activeCategory === cat
                  ? 'bg-[#C17A3A] text-white border-[#C17A3A]'
                  : 'bg-transparent text-[#F5F0E8]/60 border-white/10 hover:border-[#C17A3A]/50 hover:text-[#C17A3A]'
              }`}
              style={{ fontFamily: 'Jost, sans-serif' }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* MAIN MENU GRID */}
        <div className="flex-1 flex flex-col">

          {/* Breadcrumb & Filters Bar */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 mb-12">
            
            {/* Breadcrumb */}
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-widest text-[#F5F0E8]/40" style={{ fontFamily: 'Jost, sans-serif' }}>
              <a href="/" onClick={handleNavigateHome} className="hover:text-[#C17A3A] transition-colors">Home</a>
              <span className="text-[#C17A3A]/40">/</span>
              <span className="text-[#F5F0E8]/60">Menu</span>
              <span className="text-[#C17A3A]/40">/</span>
              <span className="text-[#C17A3A] font-medium">{activeCategory}</span>
            </div>

            {/* Search and Dietary Filters */}
            <div className="flex flex-col sm:flex-row items-center gap-5 w-full xl:w-auto">
              
              {/* Search */}
              <div className="relative w-full sm:w-[260px]">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#F5F0E8]/30" size={14} />
                <input
                  type="text"
                  placeholder="Search dishes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-[#1C2B1E] border border-white/5 focus:border-[#C17A3A]/50 outline-none text-[13px] text-[#F5F0E8] placeholder-[#F5F0E8]/30 transition-colors rounded-none"
                  style={{ fontFamily: 'Jost, sans-serif' }}
                />
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar pb-1 sm:pb-0">
                {filters.map(filter => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`flex-shrink-0 px-[16px] py-[8px] rounded-full text-[10px] uppercase tracking-[0.15em] border transition-all duration-300 ${
                      activeFilter === filter
                        ? 'bg-[#C17A3A] text-white border-[#C17A3A]'
                        : 'bg-[#1C2B1E] text-[#F5F0E8]/50 border-white/5 hover:border-[#C17A3A]/30 hover:text-[#F5F0E8]'
                    }`}
                    style={{ fontFamily: 'Jost, sans-serif' }}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Grid */}
          {isLoading ? (
            /* Skeleton loading state — 3 placeholder cards */
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-20 text-center text-[#1C2B1E]/50" style={{ fontFamily: 'Jost, sans-serif' }}>
              No dishes found matching your criteria.
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
              {filteredItems.map((item, index) => (
                <MenuCard
                  key={item.id}
                  item={item}
                  isAdded={added === item.id}
                  onAdd={handleAdd}
                  index={index}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

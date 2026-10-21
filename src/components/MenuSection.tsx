import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Check } from 'lucide-react';
import { categories } from '../data/menu.ts';
import { useMenuItems } from '../services/useMenuItems.ts';
import { useCart } from '../context/CartContext.tsx';
import { useCurrency } from '../context/CurrencyContext.tsx';
import { useInView } from '../hooks/useInView.ts';
import FavoriteButton from './FavoriteButton.tsx';

export default function MenuSection() {
  const menuItems = useMenuItems();
  const [activeTab, setActiveTab] = useState('All');
  const [addedIds, setAddedIds] = useState<number[]>([]);
  const { addItem } = useCart();
  const { format } = useCurrency();
  const navigate = useNavigate();

  const filtered = activeTab === 'All' ? menuItems : menuItems.filter(i => i.category === activeTab);
  // Homepage shows only the top 6 signature dishes — the full list lives on /menu.
  const displayed = filtered.slice(0, 6);

  const handleAdd = (item: typeof menuItems[0]) => {
    addItem({ id: item.id, name: item.name, price: item.price, image: item.image });
    setAddedIds(prev => [...prev, item.id]);
    setTimeout(() => {
      setAddedIds(prev => prev.filter(id => id !== item.id));
    }, 1500);
  };

  const { ref: headingRef, isInView: headingInView } = useInView();
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [cardVisible, setCardVisible] = useState<boolean[]>([]);

  useEffect(() => {
    setCardVisible(new Array(displayed.length).fill(false));
    const observers: IntersectionObserver[] = [];
    let raf2: number;

    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        displayed.forEach((_, i) => {
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
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      observers.forEach(o => o.disconnect());
    };
  }, [activeTab, displayed.length]);

  return (
    <section id="menu" className="py-24 bg-cream-200" style={{ background: '#F5F0E8' }}>
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        {/* Section header */}
        <div
          ref={headingRef as React.RefObject<HTMLDivElement>}
          className={`text-center mb-14 reveal ${headingInView ? 'visible' : ''}`}
        >
          <p
            className="text-ember text-xs tracking-widest uppercase mb-3"
            style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.25em', fontSize: '0.7rem' }}
          >
            ✦ &nbsp; Seasonal Selection
          </p>
          <h2
            className="text-forest text-5xl md:text-6xl font-light leading-none"
            style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 300 }}
          >
            Our Menu
          </h2>
          <div className="w-12 h-px bg-ember mx-auto mt-5" />
        </div>

        {/* Desktop pill tabs */}
        <div className="hidden md:flex items-center justify-center flex-wrap gap-2.5 mb-12">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={`px-5 py-2 text-xs tracking-widest uppercase transition-all duration-[250ms] border rounded-full ${
                activeTab === cat
                  ? 'bg-[#1C2B1E] text-[#F5F0E8] border-[#1C2B1E]'
                  : 'bg-transparent text-[#1C2B1E]/50 border-[rgba(28,43,30,0.2)] hover:border-[#C17A3A] hover:text-[#C17A3A]'
              }`}
              style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.15em', fontSize: '0.72rem' }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Mobile scrollable pill tabs */}
        <div className="flex md:hidden gap-2.5 overflow-x-auto no-scrollbar pb-4 mb-10 -mx-4 px-4">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={`flex-shrink-0 px-5 py-2 rounded-full text-xs tracking-widest uppercase transition-all duration-[250ms] ${
                activeTab === cat
                  ? 'bg-[#1C2B1E] text-white border border-transparent'
                  : 'bg-white text-[#1C2B1E] border border-[rgba(28,43,30,0.2)] hover:border-[#C17A3A] hover:text-[#C17A3A]'
              }`}
              style={{ fontFamily: 'Jost, sans-serif', fontSize: '0.75rem' }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px] md:gap-6">
          {displayed.map((item, i) => (
            <div
              key={item.id}
              ref={el => { cardRefs.current[i] = el; }}
              className={`group bg-white overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.08)] md:shadow-sm hover:shadow-md transition-shadow duration-300 reveal flex flex-col rounded-none md:rounded-none border-none ${cardVisible[i] ? 'visible' : ''}`}
              style={{ transitionDelay: `${(i % 3) * 0.08}s` }}
            >
              <div className="relative h-[180px] md:h-52 overflow-hidden flex-shrink-0 w-full">
                <FavoriteButton itemId={item.id} />
                <img
                  src={item.image}
                  alt={item.name}
                  loading="lazy"
                  width="400"
                  height="300"
                  className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="pt-[12px] px-[12px] pb-[14px] md:p-5 flex flex-col flex-1">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-0 md:gap-3 mb-0 md:mb-2">
                  <h3
                    className="text-[#1C2B1E] md:text-forest text-[17px] md:text-xl leading-tight mb-[2px] md:mb-0 font-medium"
                    style={{ fontFamily: 'Cormorant Garamond, serif' }}
                  >
                    {item.name}
                  </h3>
                  <span
                    className="text-[#C17A3A] md:text-ember text-[15px] md:text-base flex-shrink-0 mb-[10px] md:mb-0 md:font-semibold"
                  >
                    <span className="md:hidden" style={{ fontFamily: 'Cormorant Garamond, serif' }}>{format(item.price)}</span>
                    <span className="hidden md:inline" style={{ fontFamily: 'Jost, sans-serif' }}>{format(item.price)}</span>
                  </span>
                </div>
                <p
                  className="hidden md:block text-forest/60 text-sm leading-relaxed mb-5 flex-1"
                  style={{ fontFamily: 'Jost, sans-serif', fontWeight: 300 }}
                >
                  {item.description}
                </p>
                <div className="mt-auto">
                  <button
                    onClick={() => handleAdd(item)}
                    className={`w-full flex items-center justify-center gap-[8px] p-[10px] md:px-[20px] md:py-[12px] text-[10px] md:text-[11px] tracking-[0.12em] rounded-none uppercase border-none md:border transition-all duration-300 ease-out ${
                      addedIds.includes(item.id)
                        ? 'bg-[#2E7D32] md:border-[#2E7D32] text-white'
                        : 'bg-[#1C2B1E] text-white md:border-white/10 hover:bg-[#C17A3A] md:hover:border-[#C17A3A] hover:-translate-y-[1px] md:hover:shadow-[0_4px_20px_rgba(193,122,58,0.3)]'
                    }`}
                    style={{ fontFamily: 'Jost, sans-serif' }}
                  >
                    {addedIds.includes(item.id) ? (
                      <><Check size={14} className="hidden md:block" /> Added</>
                    ) : (
                      <><Plus size={14} className="hidden md:block" /> Add to Cart</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length > displayed.length && (
          <div className="text-center mt-12">
            <button
              onClick={() => navigate('/menu')}
              className="border border-[#1C2B1E] text-[#1C2B1E] px-[42px] py-[15px] text-[11px] uppercase transition-all duration-300 hover:bg-[#1C2B1E] hover:text-[#F5F0E8]"
              style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.22em' }}
            >
              View Full Menu →
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

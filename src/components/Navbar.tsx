import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.tsx';
import { ShoppingBag, User, X, Menu } from 'lucide-react';
import { useCart } from '../context/CartContext.tsx';
import { useGoToReservations } from '../lib/nav.ts';
import { applyPageMeta } from '../lib/pageMeta.ts';
import { usePublicSettings } from '../hooks/usePublicSettings';

const links = ['Menu', 'Our Story', 'Reservations', 'Contact'];

export default function Navbar({ forceDark = false }: { forceDark?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [isLight, setIsLight] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { totalCount, setIsOpen } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const goToReservations = useGoToReservations();
  const settings = usePublicSettings();
  // The brand is the admin's Restaurant name once settings load; the
  // static text is only the pre-load placeholder.
  const brandName = settings?.restaurantName ?? 'Ember & Co.';
  // Document title + meta description follow the route (GEO): the four
  // public pages each get their own title/description; every other
  // route keeps the brand title this effect has always set, with
  // index.html's description. Runs on navigation, and again when the
  // settings — and with them the real brand name — arrive.
  useEffect(() => {
    applyPageMeta(location.pathname, brandName);
  }, [location.pathname, brandName]);

  const handleLoginClick = () => {
    // Record where the visitor is now so a successful sign-in returns
    // here instead of always landing on the home page.
    if (user) navigate('/account');
    else navigate('/login', { state: { from: location.pathname } });
  };

  useEffect(() => {
    const onScroll = () => {
      const scrollY = window.scrollY;
      setScrolled(scrollY > 40);

      // Detect current section theme
      const navbarHeight = 80;
      const elements = document.elementsFromPoint(window.innerWidth / 2, navbarHeight / 2);
      const section = elements.find(el =>
        el.tagName === 'SECTION' ||
        el.tagName === 'HEADER' ||
        el.tagName === 'FOOTER' ||
        el.id === 'hero'
      );

      if (section) {
        const lightSections = ['menu', 'gallery', 'newsletter'];
        setIsLight(lightSections.includes(section.id));
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  const isLightMode = !forceDark && scrolled && isLight;
  const effectiveScrolled = forceDark || scrolled;
  const iconColor = isLightMode ? 'text-[#1C2B1E]' : 'text-white';
  const navLinkColor = isLightMode ? 'text-[#1C2B1E]/80 hover:text-[#1C2B1E]' : 'text-white/80 hover:text-white';
  const buttonClass = isLightMode
    ? 'border-[#1C2B1E] text-[#1C2B1E] hover:bg-[#1C2B1E]/5'
    : 'border-white text-white hover:bg-white/10';

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, link: string) => {
    if (link === 'Menu') {
      e.preventDefault();
      navigate('/menu');
    } else if (link === 'Our Story') {
      e.preventDefault();
      navigate('/our-story');
    } else if (link === 'Contact') {
      e.preventDefault();
      navigate('/contact');
    } else if (link === 'Reservations') {
      // The section lives on the home page — a plain '/#reservations'
      // anchor would reload the site and drop the scroll (audit M-11).
      goToReservations(e);
    }
  };

  const getHref = (link: string) => {
    if (link === 'Menu') return '/menu';
    if (link === 'Our Story') return '/our-story';
    if (link === 'Contact') return '/contact';
    return `/#${link.toLowerCase().replace(' ', '-')}`;
  };

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          effectiveScrolled
            ? isLightMode
              ? 'bg-[rgba(245,240,232,0.8)] backdrop-blur-[20px] border-b border-[#1C2B1E]/[0.08] py-2'
              : 'bg-[rgba(21,46,23,0.6)] backdrop-blur-[20px] border-b border-white/[0.08] py-2'
            : 'bg-transparent py-3'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          {/* Logo */}
          <a 
            href="/" 
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
            className="flex items-center gap-2 group shrink-0"
          >
            {/* Brand signature (logo kit): the ivory wordmark on the
                dark header; the dark-pine variant whenever the header
                sits on a light section, matching the text colours it
                replaces. Height is fixed so the bar never shifts. */}
            <img
              src={isLightMode ? '/ember-co-logo-light.svg' : '/ember-co-logo.svg'}
              alt={brandName}
              className="h-[30px] w-auto"
            />
          </a>

          {/* Desktop nav links */}
          <nav className="hidden lg:flex items-center gap-8">
            {links.map(link => (
              <a
                key={link}
                href={getHref(link)}
                onClick={(e) => handleNavClick(e, link)}
                className={`${navLinkColor} text-sm font-body tracking-widest uppercase transition-colors duration-200 relative after:absolute after:bottom-0 after:left-0 after:h-px after:w-0 hover:after:w-full after:bg-ember after:transition-all after:duration-300`}
                style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.12em', fontSize: '0.75rem' }}
              >
                {link}
              </a>
            ))}
          </nav>

          {/* Desktop right */}
          <div className="hidden lg:flex items-center gap-4">
            <button
              onClick={handleLoginClick}
              className={`${iconColor} opacity-80 hover:opacity-100 transition-opacity`}
            >
              <User size={18} />
            </button>
            <button
              data-cart-target
              onClick={() => setIsOpen(true)}
              className={`relative ${iconColor} opacity-80 hover:opacity-100 transition-opacity`}
            >
              <ShoppingBag size={18} />
              {totalCount > 0 && (
                <span data-cart-badge className="absolute -top-1.5 -right-1.5 bg-ember text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-0">
                  {totalCount}
                </span>
              )}
            </button>
            <a
              href="/#reservations"
              onClick={goToReservations}
              className={`border ${buttonClass} text-xs font-medium tracking-widest uppercase px-5 py-2.5 transition-all duration-200`}
              style={{ letterSpacing: '0.12em', fontSize: '0.7rem', fontFamily: 'Jost, sans-serif' }}
            >
              Reserve
            </a>
          </div>

          {/* Mobile right */}
          <div className="flex lg:hidden items-center gap-3">
            <button
              onClick={handleLoginClick}
              className={`${iconColor} opacity-90 hover:opacity-100 transition-opacity`}
            >
              <User size={20} />
            </button>
            <button
              data-cart-target
              onClick={() => setIsOpen(true)}
              className={`relative ${iconColor} opacity-90 hover:opacity-100 transition-opacity`}
            >
              <ShoppingBag size={20} />
              {totalCount > 0 && (
                <span data-cart-badge className="absolute -top-1.5 -right-1.5 bg-ember text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-0">
                  {totalCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setSidebarOpen(true)}
              className={`${iconColor} opacity-90 hover:opacity-100 transition-opacity`}
            >
              <Menu size={22} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile sidebar overlay */}
      <div
        className={`fixed inset-0 z-[9998] transition-opacity duration-300 ${
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Mobile sidebar */}
      <aside
        className={`fixed top-0 right-0 h-[100vh] z-[9999] flex flex-col transform transition-transform ease-in-out !opacity-100 ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ 
          background: '#0A1209',
          width: '75vw',
          maxWidth: '300px',
          transitionDuration: '350ms'
        }}
      >
        <div 
          className="flex items-center justify-between p-6"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
              setSidebarOpen(false);
            }}
            className="shrink-0"
          >
            <img src="/ember-co-logo.svg" alt={brandName} className="h-[24px] w-auto" />
          </a>
          <button
            onClick={() => setSidebarOpen(false)}
            className="transition-colors hover:text-white"
            style={{ color: 'rgba(245,240,232,0.5)' }}
          >
            <X size={20} />
          </button>
        </div>
        
        <nav className="p-6 flex flex-col gap-1 flex-1 overflow-y-auto">
          {links.map(link => (
            <a
              key={link}
              href={getHref(link)}
              onClick={(e) => {
                handleNavClick(e, link);
                setSidebarOpen(false);
              }}
              className="hover:text-white hover:translate-x-1 py-3 text-sm tracking-widest uppercase transition-all duration-200"
              style={{ 
                fontFamily: 'Jost, sans-serif', 
                letterSpacing: '0.1em', 
                fontWeight: 500,
                fontSize: '0.8rem',
                color: 'rgba(245,240,232,0.9)',
                borderBottom: '1px solid rgba(255,255,255,0.08)'
              }}
            >
              {link}
            </a>
          ))}
        </nav>
        
        <div className="mt-auto w-full flex flex-col">
          <div style={{ width: '100%', height: '1px', background: 'rgba(193,122,58,0.2)', marginBottom: '24px' }} />
          <a
            href="/#reservations"
            onClick={(e) => { goToReservations(e); setSidebarOpen(false); }}
            className="flex items-center justify-center transition-all duration-300 hover:bg-[#A66932] hover:-translate-y-[1px] hover:shadow-[0_8px_24px_rgba(193,122,58,0.4)]"
            style={{ 
              background: '#C17A3A',
              color: '#FFFFFF',
              fontFamily: 'Jost, sans-serif',
              fontSize: '11px',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              padding: '16px 24px',
              width: 'calc(100% - 48px)',
              margin: '0 24px 32px',
              border: 'none',
              borderRadius: '0',
              gap: '10px'
            }}
          >
            Reserve a Table <span>→</span>
          </a>
        </div>
      </aside>
    </>
  );
}

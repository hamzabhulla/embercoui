import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { scrollToReservations } from './lib/nav.ts';
import { sanitizeReturnPath } from './services/auth.ts';
import { CartProvider } from './context/CartContext.tsx';
import { CurrencyProvider } from './context/CurrencyContext.tsx';
import Navbar from './components/Navbar.tsx';
import Hero from './components/Hero.tsx';
import LiveStatus from './components/LiveStatus.tsx';
import MenuSection from './components/MenuSection.tsx';
import Gallery from './components/Gallery.tsx';
import Testimonials from './components/Testimonials.tsx';
import Reservation from './components/Reservation.tsx';
import Newsletter from './components/Newsletter.tsx';
import Footer from './components/Footer.tsx';
import FloatingButtons from './components/FloatingButtons.tsx';
import CartSidebar from './components/CartSidebar.tsx';
import LoginModal from './components/auth/LoginModal.tsx';
import SignupModal from './components/auth/SignupModal.tsx';
import ForgotPasswordModal from './components/auth/ForgotPasswordModal.tsx';
import MenuPage from './pages/MenuPage.tsx';
import OurStory from './pages/OurStory.tsx';
import Contact from './pages/Contact.tsx';
import ResetPassword from './pages/ResetPassword.tsx';
import AdminLayout, { AdminGuard } from './components/admin/AdminLayout';

// Route-level code splitting (audit fix 16): the heavy customer pages
// (checkout pulls in Stripe, account and order tracking are large) and
// the whole admin console load as separate chunks on first visit, so a
// customer browsing the menu no longer downloads the admin panel.
// Home, Menu, Our Story and Contact stay eager — they are the landing
// surface. One shared Suspense fallback (RouteFallback below) covers
// every lazy route.
const Account = lazy(() => import('./pages/Account.tsx'));
const Checkout = lazy(() => import('./pages/Checkout.tsx'));
const TrackOrder = lazy(() => import('./pages/TrackOrder.tsx'));
const NotFound = lazy(() => import('./pages/NotFound.tsx'));
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminOrders = lazy(() => import('./pages/admin/AdminOrders'));
const AdminMenu = lazy(() => import('./pages/admin/AdminMenu'));
const AdminReservations = lazy(() => import('./pages/admin/AdminReservations'));
const AdminCustomers = lazy(() => import('./pages/admin/AdminCustomers'));
const AdminReviews = lazy(() => import('./pages/admin/AdminReviews'));
const AdminNewsletter = lazy(() => import('./pages/admin/AdminNewsletter'));
const AdminMarketing = lazy(() => import('./pages/admin/AdminMarketing'));
const AdminFinance = lazy(() => import('./pages/admin/AdminFinance'));
const AdminStaff = lazy(() => import('./pages/admin/AdminStaff'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#0D1A0E' }}>
      <p style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#E9C48C' }}>
        Ember &amp; Co. — Loading
      </p>
    </div>
  );
}

function HomePage() {
  return (
    <>
      <Hero />
      <LiveStatus />
      <MenuSection />
      <Gallery />
      <Testimonials />
      <Reservation />
      <Newsletter />
    </>
  );
}

const AUTH_PATHS = ['/login', '/signup', '/forgot-password'];
// Which pages may never be a post-auth landing (the auth screens and
// /reset-password) is defined by sanitizeReturnPath in services/auth.ts,
// shared with the Google OAuth return path so the two stay in lockstep.

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  // Canonical path for display decisions: '/MENU/' and '/menu' are the same page.
  const canonicalPath = (location.pathname.replace(/\/+$/, '') || '/').toLowerCase();
  // The auth screens are routes, not overlays — "closing" one means
  // going back to the page the visitor came from (recorded in the
  // navigation state when they entered), never an auth route itself,
  // and home only when there is nowhere meaningful to return to
  // (a direct visit to /login, a fresh tab, …).
  const returnTo = sanitizeReturnPath((location.state as { from?: string } | null)?.from);
  const closeAuth = () => navigate(returnTo);
  // Switching between auth screens (login ↔ signup ↔ forgot) carries
  // the original return target along; leaving to a real page is plain.
  const authNavigate = (path: string) => {
    if (AUTH_PATHS.includes(path)) navigate(path, { state: { from: returnTo } });
    else navigate(path);
  };
  // The admin console is a standalone app: the customer site's chrome
  // (navbar, footer, chat buttons, cart) must never render over it.
  const isAdmin = canonicalPath.startsWith('/admin');

  // Landing on (or navigating to) '/#reservations' — via a Reserve
  // link on another page or a fresh page load — scrolls to the
  // reservation section once the home page has rendered. Bare
  // '#reservations' anchors elsewhere are dead (audit M-11); the
  // useGoToReservations helper in lib/nav.ts routes through here.
  useEffect(() => {
    if (canonicalPath === '/' && location.hash === '#reservations') {
      scrollToReservations();
    }
  }, [canonicalPath, location.hash, location.key]);

  return (
    <CurrencyProvider>
    <CartProvider>
      <div className="min-h-screen" style={{ background: '#F5F0E8' }}>
        {!isAdmin && <Navbar forceDark={canonicalPath === '/menu' || canonicalPath === '/our-story' || canonicalPath === '/contact' || canonicalPath === '/account' || canonicalPath === '/reset-password' || canonicalPath === '/checkout' || canonicalPath.startsWith('/track-order')} />}

        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/our-story" element={<OurStory />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/account" element={<Account />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/track-order/:id" element={<TrackOrder />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
          <Route index element={<AdminDashboard />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="menu" element={<AdminMenu />} />
          <Route path="reservations" element={<AdminReservations />} />
          <Route path="customers" element={<AdminCustomers />} />
          <Route path="reviews" element={<AdminReviews />} />
          <Route path="newsletter" element={<AdminNewsletter />} />
          <Route path="marketing" element={<AdminMarketing />} />
          <Route path="finance" element={<AdminFinance />} />
          <Route path="staff" element={<AdminStaff />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
          {/* The auth screens are modals rendered by the second <Routes>
              below — here they render null so the page behind a login
              modal stays empty chrome, exactly as before. Any other
              unknown path gets the real 404 page (audit fix 16); it used
              to render the same blank chrome. */}
          <Route path="/login" element={null} />
          <Route path="/signup" element={null} />
          <Route path="/forgot-password" element={null} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>

        {!isAdmin && <Footer />}
        {!isAdmin && <FloatingButtons />}
        {!isAdmin && <CartSidebar />}

        <Routes>
          <Route path="/login" element={<LoginModal onClose={closeAuth} onNavigate={authNavigate} returnTo={returnTo} />} />
          <Route path="/signup" element={<SignupModal onClose={closeAuth} onNavigate={authNavigate} returnTo={returnTo} />} />
          <Route path="/forgot-password" element={<ForgotPasswordModal onClose={closeAuth} onNavigate={authNavigate} />} />
          <Route path="*" element={null} />
        </Routes>
      </div>
    </CartProvider>
    </CurrencyProvider>
  );
}

export default App;

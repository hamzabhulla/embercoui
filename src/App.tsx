import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { CartProvider } from './context/CartContext.tsx';
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
import Account from './pages/Account.tsx';
import ResetPassword from './pages/ResetPassword.tsx';
import Checkout from './pages/Checkout.tsx';
import TrackOrder from './pages/TrackOrder.tsx';
import AdminLayout, { AdminGuard } from './components/admin/AdminLayout';
import AdminLogin from './pages/admin/AdminLogin';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminOrders from './pages/admin/AdminOrders';
import AdminMenu from './pages/admin/AdminMenu';
import AdminReservations from './pages/admin/AdminReservations';
import AdminCustomers from './pages/admin/AdminCustomers';
import AdminReviews from './pages/admin/AdminReviews';
import AdminNewsletter from './pages/admin/AdminNewsletter';
import AdminMarketing from './pages/admin/AdminMarketing';
import AdminFinance from './pages/admin/AdminFinance';
import AdminStaff from './pages/admin/AdminStaff';
import AdminSettings from './pages/admin/AdminSettings';

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

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  // Canonical path for display decisions: '/MENU/' and '/menu' are the same page.
  const canonicalPath = (location.pathname.replace(/\/+$/, '') || '/').toLowerCase();
  const goHome = () => navigate('/');

  return (
    <CartProvider>
      <div className="min-h-screen" style={{ background: '#F5F0E8' }}>
        <Navbar forceDark={canonicalPath === '/menu' || canonicalPath === '/our-story' || canonicalPath === '/contact' || canonicalPath === '/account' || canonicalPath === '/reset-password' || canonicalPath === '/checkout' || canonicalPath.startsWith('/track-order') || canonicalPath.startsWith('/admin')} />

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
          {/* Unknown paths render just the site chrome, exactly as the old hand-rolled router did. */}
          <Route path="*" element={null} />
        </Routes>

        <Footer />
        <FloatingButtons />
        <CartSidebar />

        <Routes>
          <Route path="/login" element={<LoginModal onClose={goHome} onNavigate={navigate} />} />
          <Route path="/signup" element={<SignupModal onClose={goHome} onNavigate={navigate} />} />
          <Route path="/forgot-password" element={<ForgotPasswordModal onClose={goHome} onNavigate={navigate} />} />
          <Route path="*" element={null} />
        </Routes>
      </div>
    </CartProvider>
  );
}

export default App;

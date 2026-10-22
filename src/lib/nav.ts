import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Navigation to the reservation section.
 *
 * The reservation form is a section (id="reservations") on the HOME page
 * only, so a bare href="#reservations" link is dead on every other page —
 * it either does nothing or reloads the site at '/#reservations' with the
 * hash dropped (audit M-11). These helpers make every "Reserve" link
 * reach the section from anywhere:
 *
 *  - On the home page: smooth-scroll straight to the section.
 *  - Anywhere else: navigate to '/#reservations'; App's hash effect
 *    scrolls once the home page has rendered (scrollToReservations
 *    polls briefly for the element to mount).
 *  - A fresh page load at '/#reservations' is covered by the same
 *    App effect.
 */
export function scrollToReservations(): void {
  let attempts = 0;
  const tryScroll = () => {
    const el = document.getElementById('reservations');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    attempts += 1;
    if (attempts < 50) window.setTimeout(tryScroll, 100);
  };
  tryScroll();
}

/**
 * Click handler for "Reserve" links/buttons. Usable directly as an
 * anchor's onClick — it prevents the default (dead) hash jump and takes
 * the React Router path instead.
 */
export function useGoToReservations() {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      const canonical = (location.pathname.replace(/\/+$/, '') || '/').toLowerCase();
      if (canonical === '/') {
        scrollToReservations();
      } else {
        navigate('/#reservations');
      }
    },
    [location.pathname, navigate],
  );
}

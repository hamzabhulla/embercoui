import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { consumeAdminLoginReturn, peekAdminLoginReturn } from '../../lib/adminLoginReturn';
import { peekUnlockIntent } from '../../lib/screenLock';

/**
 * The OAuth return courier — the piece that brings a completed
 * Google round-trip back to the page it started from, no matter
 * where the provider actually landed the browser.
 *
 * Both admin Google flows (the screen-lock step-up in LockedView
 * and the sign-in on /admin/login) ask Supabase to redirect back to
 * an admin path, but that redirect is only a request: the
 * provider's own URL configuration decides the real landing, and
 * in practice it is the customer home page. Nothing else in the
 * app can fix that landing after the fact — the lock provider
 * mounts only inside the admin console, and the sign-in page only
 * at its own route, so a browser that comes down on '/' is simply
 * never visited by either. This courier mounts at the app root,
 * where every landing passes, and does exactly one thing: when a
 * session has resolved and a return record planted before the
 * round-trip is still fresh, navigate to the path it names.
 *
 * It is a courier, never a gatekeeper:
 *  - It validates freshness and (for the unlock intent) the account
 *    binding before acting, and discards records that can no longer
 *    serve — junk never lingers for a later landing.
 *  - It does NOT consume the unlock intent. Consumption is the
 *    lock provider's proof (account + freshness + the session's
 *    own sign-in stamp), and eating the record here — on a page
 *    where the lock provider is not even mounted — would destroy
 *    the proof before it could be checked. The intent is left in
 *    place; the provider consumes it on the admin mount the
 *    navigation causes, in the same breath.
 *  - The admin sign-in record it leaves for the sign-in page to
 *    consume (that consumption is how the page recognises — and
 *    reports — the login it started). If the session is already
 *    inside the console, the record has nothing left to do and is
 *    dropped here instead.
 *  - It never navigates a signed-out or still-loading visitor, and
 *    never to a path the records did not name: the unlock intent's
 *    path was validated when planted and again when read, and the
 *    sign-in record resolves to the sign-in page or the console
 *    root only.
 */
export default function UnlockReturnCourier() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !user) return;

    // The unlock intent outranks the sign-in record: it names the
    // exact admin page its owner was locked on.
    const intent = peekUnlockIntent(user.id);
    if (intent) {
      if (location.pathname !== intent.returnPath) {
        navigate(intent.returnPath, { replace: true });
      }
      return;
    }

    const record = peekAdminLoginReturn();
    if (!record) return;
    if (location.pathname === record.returnPath) {
      // Already where the record points: the sign-in page itself
      // consumes the record on this landing.
      return;
    }
    if (location.pathname.startsWith('/admin')) {
      // Already inside the console (the round-trip's redirect was
      // honoured after all, or the admin browsed in directly): the
      // record has nothing left to do — drop it so it can never
      // bounce a later landing back to the sign-in page.
      consumeAdminLoginReturn();
      return;
    }
    navigate(record.returnPath, { replace: true });
  }, [loading, user, location.pathname, navigate]);

  return null;
}

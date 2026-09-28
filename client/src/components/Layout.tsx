import { KeyRound } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { TITLE_EVENT } from '../hooks/useDocumentTitle';
import { addStepKey } from '../lib/catalog';
import { useAuth } from '../state/AuthProvider';
import { Footer } from './Footer';
import { Header } from './Header';
import { MiniPlayer } from './MiniPlayer';
import { PageSkeleton } from './Skeletons';

/**
 * After client-side navigation to a new screen, move focus to <main> so keyboard users start at the new content
 * instead of on the old link (or on <body> when that link unmounted), and announce the new page title to screen
 * readers. A screen is the pathname — except "/add", whose steps (find → show list → form, manual) share the path
 * and differ by their params (lib/catalog `addStepKey`). ?q=/filter tweaks and #hashes aren't new screens.
 * A page that already moved focus into <main> itself keeps it.
 */
function useRouteChangeFocus(screenKey: string): string {
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef(screenKey);
  const lastTitle = useRef(typeof document === 'undefined' ? '' : document.title);
  useEffect(() => {
    if (previous.current === screenKey) return;
    previous.current = screenKey;
    const main = document.getElementById('main');
    const active = document.activeElement;
    if (main && !(active && active !== main && main.contains(active))) main.focus({ preventScroll: true });

    let announced = false;
    const announce = () => {
      if (announced && document.title === lastTitle.current) return;
      announced = true;
      lastTitle.current = document.title;
      setAnnouncement(document.title);
    };
    // The page may already have set its title (it renders first); lazy pages set it once loaded, and pages that
    // load their data refine it a moment later ("Add a song" → "Add a song from Les Misérables") — say the new one.
    if (document.title !== lastTitle.current) announce();
    window.addEventListener(TITLE_EVENT, announce);
    const fallback = window.setTimeout(announce, 1500);
    const stop = window.setTimeout(() => window.removeEventListener(TITLE_EVENT, announce), 5000);
    return () => {
      window.removeEventListener(TITLE_EVENT, announce);
      window.clearTimeout(fallback);
      window.clearTimeout(stop);
    };
  }, [screenKey]);
  return announcement;
}

/** App shell: skip link, sticky header, banner, <main id="main" class="page">, footer, mini player. */
export function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const announcement = useRouteChangeFocus(addStepKey(location));
  const needsPassword = Boolean(user?.mustChangePassword) && location.pathname !== '/me';
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      {needsPassword && (
        <div className="site-banner" role="status" data-testid="must-change-password-banner">
          <div className="container">
            <KeyRound size={18} aria-hidden="true" />
            <span>Your password was reset by an admin — please choose a new one.</span>
            <Link to="/me" className="btn btn-sm btn-primary">
              Set a new password
            </Link>
          </div>
        </div>
      )}
      <main id="main" className="page" tabIndex={-1}>
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <MiniPlayer />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="route-announcer">
        {announcement}
      </p>
      <ScrollRestoration />
    </>
  );
}

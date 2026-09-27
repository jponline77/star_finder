import { KeyRound } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { TITLE_EVENT } from '../hooks/useDocumentTitle';
import { useAuth } from '../state/AuthProvider';
import { Footer } from './Footer';
import { Header } from './Header';
import { MiniPlayer } from './MiniPlayer';
import { PageSkeleton } from './Skeletons';

/**
 * After client-side navigation to a new page (path change — not ?query or #hash tweaks), move
 * focus to <main> so keyboard users start at the new content instead of on the old link (or on
 * <body> when that link unmounted), and announce the new page title to screen readers.
 * A page that already moved focus into <main> itself keeps it.
 */
function useRouteChangeFocus(pathname: string): string {
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef(pathname);
  const lastTitle = useRef(typeof document === 'undefined' ? '' : document.title);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    const main = document.getElementById('main');
    const active = document.activeElement;
    if (main && !(active && active !== main && main.contains(active))) main.focus({ preventScroll: true });

    let done = false;
    const announce = () => {
      if (done) return;
      done = true;
      lastTitle.current = document.title;
      setAnnouncement(document.title);
    };
    // The page may already have set its title (it renders first); lazy pages set it once loaded.
    if (document.title !== lastTitle.current) {
      announce();
      return;
    }
    window.addEventListener(TITLE_EVENT, announce);
    const fallback = window.setTimeout(announce, 1500);
    return () => {
      window.removeEventListener(TITLE_EVENT, announce);
      window.clearTimeout(fallback);
    };
  }, [pathname]);
  return announcement;
}

/** App shell: skip link, sticky header, banner, <main id="main" class="page">, footer, mini player. */
export function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const announcement = useRouteChangeFocus(location.pathname);
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

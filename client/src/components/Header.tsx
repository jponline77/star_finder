import { BarChart3, Compass, Dices, GraduationCap, Heart, LibraryBig, Menu, Music, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentType, type FocusEvent } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { useSetlist } from '../lib/setlist';
import { AccountMenu } from './AccountMenu';
import { Marquee } from './Marquee';
import { ThemeToggle } from './ThemeToggle';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>;
  testId: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/songs', label: 'Browse', icon: Music, testId: 'nav-browse' },
  { to: '/shows', label: 'Shows', icon: LibraryBig, testId: 'nav-shows' },
  { to: '/match', label: 'Matchmaker', icon: Sparkles, testId: 'nav-match' },
  { to: '/spin', label: 'Spin', icon: Dices, testId: 'nav-spin' },
  { to: '/setlist', label: 'My Setlist', icon: Heart, testId: 'nav-setlist' },
  { to: '/star-prep', label: 'STAR Prep', icon: GraduationCap, testId: 'nav-star-prep' },
  { to: '/stats', label: 'Stats', icon: BarChart3, testId: 'nav-stats' },
];

function NavLinks({ onNavigate, testIdPrefix = '' }: { onNavigate?: () => void; testIdPrefix?: string }) {
  const { count } = useSetlist();
  return (
    <ul>
      {NAV_ITEMS.map(({ to, label, icon: Icon, testId }) => (
        <li key={to}>
          <NavLink to={to} className="nav-link" onClick={onNavigate} data-testid={`${testIdPrefix}${testId}`}>
            <span className="nav-icon">
              <Icon size={16} aria-hidden="true" />
            </span>
            {label}
            {to === '/setlist' && count > 0 && (
              <span className="count-badge" data-testid={`${testIdPrefix}setlist-count`}>
                {count}
                <span className="visually-hidden"> songs</span>
              </span>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/** Sticky site header: marquee logo, nav (hamburger < 1100px), Add a song, theme, account. */
export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);

  // close the mobile menu on navigation / Escape (Escape hands focus back to the menu button,
  // since the focused link unmounts with the menu)
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // …and when keyboard focus moves somewhere outside both the menu and its button
  const onMenuBlur = (e: FocusEvent<HTMLElement>) => {
    const to = e.relatedTarget;
    if (!menuOpen || !(to instanceof Node)) return;
    if (mobileNavRef.current?.contains(to) || toggleRef.current?.contains(to)) return;
    setMenuOpen(false);
  };

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link to="/" className="logo" aria-label="STAR Song Finder — home" data-testid="logo">
          <Marquee size="sm" as="span">
            <span className="logo-star emoji" aria-hidden="true">
              🌟
            </span>
            <span className="logo-star-word">STAR</span>
            <span>Song Finder</span>
          </Marquee>
        </Link>

        <nav className="main-nav" aria-label="Main">
          <NavLinks />
        </nav>

        <div className="header-actions">
          <Link to="/add" className="btn btn-primary btn-sm header-add" data-testid="nav-add-song">
            <Plus size={17} aria-hidden="true" />
            <span className="btn-label-long">Add a song</span>
            <span className="btn-label-short">Add</span>
          </Link>
          <ThemeToggle className="header-theme" />
          <AccountMenu />
          <button
            ref={toggleRef}
            type="button"
            className="btn-icon is-filled hamburger"
            onBlur={onMenuBlur}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((o) => !o)}
            data-testid="menu-toggle"
          >
            {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="mobile-nav" ref={mobileNavRef} className="mobile-nav" aria-label="Main (mobile)" onBlur={onMenuBlur}>
          <div className="container mobile-nav-inner">
            <Link to="/add" className="btn btn-primary btn-lg btn-block" onClick={() => setMenuOpen(false)}>
              <Plus size={20} aria-hidden="true" /> Add a song
            </Link>
            <NavLinks onNavigate={() => setMenuOpen(false)} testIdPrefix="mobile-" />
            <div className="mobile-nav-actions">
              <Link to="/" className="btn btn-ghost" onClick={() => setMenuOpen(false)}>
                <Compass size={18} aria-hidden="true" /> Home
              </Link>
              <ThemeToggle withLabel testId="theme-toggle-mobile" />
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}

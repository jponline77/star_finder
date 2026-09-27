import { ChevronDown, Crown, LogIn, LogOut, UserRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useClickOutside } from '../hooks/useClickOutside';
import { loginHref } from '../lib/links';
import { useAuth } from '../state/AuthProvider';
import { useToast } from '../state/ToastProvider';
import { UserAvatar } from './CharacterAvatar';

/** Navigation state that asks the account menu to log out once the navigation has happened. */
const LOGOUT_STATE = 'starLogout';

function wantsLogout(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[LOGOUT_STATE] === true;
}

/**
 * Header account area (SPEC §7.13): "Log in" when logged out; otherwise an avatar chip with a
 * disclosure of links: My stuff (/me), Admin (/admin, admins only, crown), Log out.
 * Escape closes it and returns focus to the chip; tabbing out of it closes it too.
 * data-testids: login-link, account-menu-button, account-menu, logout-button, admin-link.
 */
export function AccountMenu() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const close = useCallback(() => setOpen(false), []);
  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);
  useClickOutside(ref, close, open, closeAndRefocus);

  // Log out only once we've actually left for the home page. Navigating first lets a form with
  // unsaved changes ask "Leave without saving?" (cancel = stay logged in), and stops a login-only
  // page from bouncing to /login?next=… the moment the user disappears.
  const handledLogout = useRef<string | null>(null);
  useEffect(() => {
    if (!wantsLogout(location.state) || handledLogout.current === location.key) return;
    handledLogout.current = location.key;
    // drop the flag from history so Back/Forward can't log out again
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null });
    logout().then(
      () => toast.info('You’ve left the stage — see you next time!', { emoji: '👋' }),
      (e: unknown) => toast.error(e),
    );
  }, [location, navigate, logout, toast]);

  if (loading) return <span className="skeleton" style={{ width: 44, height: 44, borderRadius: '50%' }} aria-hidden="true" />;

  if (!user) {
    const onAuthPage = location.pathname === '/login' || location.pathname === '/signup';
    return (
      <Link to={onAuthPage ? '/login' : loginHref(`${location.pathname}${location.search}`)} className="btn btn-ghost btn-sm" data-testid="login-link">
        <LogIn size={16} aria-hidden="true" />
        Log in
      </Link>
    );
  }

  const isAdmin = user.role === 'admin';
  const onLogout = () => {
    setOpen(false);
    navigate('/', { state: { [LOGOUT_STATE]: true }, replace: location.pathname === '/' });
  };
  // Close when keyboard focus moves somewhere outside the chip + menu.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  };

  return (
    <div className="account" ref={ref} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className="account-chip"
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((o) => !o)}
        data-testid="account-menu-button"
      >
        <UserAvatar name={user.displayName} size="sm" />
        <span className="account-name">
          <bdi>{user.displayName}</bdi>
        </span>
        {isAdmin && <Crown size={14} aria-label="Admin" className="gold" />}
        <ChevronDown size={16} aria-hidden="true" className="account-caret" />
        <span className="visually-hidden">Account menu</span>
      </button>
      {open && (
        <div className="menu" id="account-menu" data-testid="account-menu">
          <div className="menu-user">
            <div className="menu-user-name">
              <bdi>{user.displayName}</bdi>
            </div>
            <div className="menu-user-email">{user.email}</div>
          </div>
          <Link to="/me" className="menu-item" onClick={close}>
            <UserRound size={18} aria-hidden="true" /> My stuff
          </Link>
          {isAdmin && (
            <Link to="/admin" className="menu-item" onClick={close} data-testid="admin-link">
              <Crown size={18} aria-hidden="true" /> Admin
              <span className="crown-badge">
                <span aria-hidden="true">👑</span> Admin
              </span>
            </Link>
          )}
          <div className="menu-divider" role="separator" />
          <button type="button" className="menu-item" onClick={onLogout} data-testid="logout-button">
            <LogOut size={18} aria-hidden="true" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

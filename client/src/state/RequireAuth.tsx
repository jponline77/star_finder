/**
 * Route guard: renders children only for logged-in users, otherwise redirects to
 * /login?next=<current path>. (Admin checks live inside AdminPage.)
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useCallback } from 'react';
import { useAuth } from './AuthProvider';
import { loginHref } from '../lib/links';
import { PageSkeleton } from '../components/Skeletons';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageSkeleton />;
  if (!user) return <Navigate to={loginHref(`${location.pathname}${location.search}`)} replace />;
  return <>{children}</>;
}

/**
 * `const goToLogin = useLoginRedirect(); goToLogin();` → navigates to /login?next=<current path>.
 * Use for "Log in to …" buttons, or after catching a 401 yourself.
 */
export function useLoginRedirect(): (next?: string) => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (next?: string) => navigate(loginHref(next ?? `${location.pathname}${location.search}`)),
    [navigate, location.pathname, location.search],
  );
}

/** Current path + search, e.g. for building `loginHref(useCurrentPath())`. */
export function useCurrentPath(): string {
  const location = useLocation();
  return `${location.pathname}${location.search}`;
}

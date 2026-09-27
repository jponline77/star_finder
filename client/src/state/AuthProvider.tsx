/**
 * Auth state: `useAuth()` → { user, loading, isAdmin, login, signup, logout, refresh, updateProfile }.
 * Loaded from GET /api/auth/me at startup. Must be rendered inside the router (it installs the
 * "session ended (401) → /login?next=<current path>" handler, which needs navigation).
 *
 * A 403 `MUST_CHANGE_PASSWORD` from any request (still on a temporary password) sends them to /me.
 *
 * Forms register `useKeepDraftOnSessionEnd(save)` so what the user typed is saved (lib/drafts)
 * just before that redirect and can be restored when they come back logged in.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import * as api from '../api';
import type { ProfileUpdateInput, SignupInput, User } from '../types';
import { clearAllDrafts } from '../lib/drafts';
import { loginHref } from '../lib/links';
import { forgetSlateDetails } from '../lib/slate';
import { useToast } from './ToastProvider';

export interface AuthContextValue {
  /** The logged-in user, or null. */
  user: User | null;
  /** True until the initial /api/auth/me call settles. */
  loading: boolean;
  isAdmin: boolean;
  /** Throws ApiError (401 wrong credentials, 403 disabled, 429 rate limited). */
  login: (email: string, password: string) => Promise<User>;
  /** Throws ApiError (409 duplicate email, 400 with details per field). */
  signup: (input: SignupInput) => Promise<User>;
  logout: () => Promise<void>;
  /** Re-fetch /api/auth/me. */
  refresh: () => Promise<User | null>;
  /** PUT /api/auth/me — display name and/or password (needs currentPassword). */
  updateProfile: (input: ProfileUpdateInput) => Promise<User>;
  /** Low-level: prefer `useKeepDraftOnSessionEnd`. Returns an unregister function. */
  registerDraftSaver: (save: DraftSaver) => () => void;
}

/**
 * Called synchronously when the session turns out to have ended, just before the redirect to
 * /login. Save whatever should survive (e.g. `saveDraft(key, userId, …)`); return true if you did.
 */
export type DraftSaver = (userId: number) => boolean;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, initialUser }: { children: ReactNode; initialUser?: User | null }) {
  const [user, setUserState] = useState<User | null>(initialUser ?? null);
  const [loading, setLoading] = useState(initialUser === undefined);
  // Mirrors `user` synchronously, so the 401 handler sees the latest value (and repeat 401s
  // from parallel requests don't each redirect).
  const userRef = useRef<User | null>(initialUser ?? null);
  const setUser = useCallback((next: User | null) => {
    userRef.current = next;
    setUserState(next);
  }, []);
  const draftSavers = useRef(new Set<DraftSaver>());
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await api.getMe();
      setUser(me);
      return me;
    } catch {
      // Server down: treat as logged out but keep browsing working.
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    if (initialUser !== undefined) return;
    void refresh();
  }, [refresh, initialUser]);

  // Session ended (401 on a write, or on a login-only read) → save drafts, clear the user,
  // friendly toast, go to /login?next=<here>.
  useEffect(() => {
    return api.setUnauthorizedHandler((_error, { method }) => {
      const was = userRef.current;
      // A login-only read failing while we already know they're logged out: RequireAuth handles it.
      if (!was && (method === 'GET' || method === 'HEAD')) return;
      let kept = false;
      if (was) {
        for (const save of draftSavers.current) {
          try {
            kept = save(was.id) || kept;
          } catch {
            /* one broken saver mustn't stop the others */
          }
        }
      }
      setUser(null);
      const loc = locationRef.current;
      if (loc.pathname === '/login' || loc.pathname === '/signup') return;
      const message = !was
        ? 'Please log in to do that.'
        : kept
          ? 'Your session ended — log in again and we’ll bring back what you typed.'
          : 'Your session ended — please log in again.';
      toast.info(message, { id: 'auth-required', emoji: '🎟️' });
      navigate(loginHref(`${loc.pathname}${loc.search}${loc.hash}`));
    });
  }, [navigate, toast, setUser]);

  // Still on an admin-issued temporary password (e.g. reset while this tab was open, or the
  // password was changed back in another tab and this one is stale): every write answers 403
  // MUST_CHANGE_PASSWORD → mark the user, explain, and go to /me where the form is.
  useEffect(() => {
    return api.setPasswordChangeHandler(() => {
      const was = userRef.current;
      if (was && !was.mustChangePassword) setUser({ ...was, mustChangePassword: true });
      toast.info('Please choose a new password first — then you can carry on.', { id: 'must-change-password', emoji: '🔑' });
      if (locationRef.current.pathname !== '/me') navigate('/me');
    });
  }, [navigate, toast, setUser]);

  const registerDraftSaver = useCallback((save: DraftSaver) => {
    draftSavers.current.add(save);
    return () => {
      draftSavers.current.delete(save);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: me } = await api.login({ email: email.trim(), password });
    setUser(me);
    return me;
  }, [setUser]);

  const signup = useCallback(async (input: SignupInput) => {
    const { user: me } = await api.signup({
      email: input.email.trim(),
      password: input.password,
      displayName: input.displayName.trim(),
    });
    setUser(me);
    return me;
  }, [setUser]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      // Shared school computers: don't leave this student's drafts or slate details behind.
      clearAllDrafts();
      forgetSlateDetails();
    }
  }, [setUser]);

  const updateProfile = useCallback(async (input: ProfileUpdateInput) => {
    const { user: me } = await api.updateMe(input);
    setUser(me);
    return me;
  }, [setUser]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, isAdmin: user?.role === 'admin', login, signup, logout, refresh, updateProfile, registerDraftSaver }),
    [user, loading, login, signup, logout, refresh, updateProfile, registerDraftSaver],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Keep a form's work when the session ends mid-edit: `save(userId)` runs just before the redirect
 * to /login (store a draft with lib/drafts and return true). Always calls the latest `save`.
 */
export function useKeepDraftOnSessionEnd(save: DraftSaver): void {
  const { registerDraftSaver } = useAuth();
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => registerDraftSaver((userId) => saveRef.current(userId)), [registerDraftSaver]);
}

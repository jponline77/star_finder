/**
 * The visitor's festival (SPEC §7b):
 *
 *   const { festivals, regionalChoices, nationals, selected, source, setFestival, ready, saving, refreshFestivals } = useFestival();
 *
 * Selection priority on load: `?festival=<slug>` (applied once, saved, then removed from the URL
 * with `replace`) → the logged-in user's `festivalSlug` → localStorage `star.festival` →
 * `meta.defaultFestivalSlug` → none. Unknown / hidden / national slugs are skipped quietly.
 *
 * `setFestival(slug | null)` updates this device (localStorage) straight away and, when logged
 * in, the account (PUT /api/auth/me — optimistic; rolled back with a toast if the save fails).
 * Saves are queued, so the last choice is the one the account ends up with.
 * Logging in adopts the account's festival, or saves this browser's choice to an account that has
 * none. A choice made while it couldn't be saved (temporary password, or the session had ended) is
 * saved to that account as soon as it can be, instead of being replaced by the account's.
 * Logging out keeps the choice on this device.
 *
 * Must sit inside the router, AuthProvider and SongsProvider (it reads meta + user).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import * as api from '../api';
import { isApiError, MUST_CHANGE_PASSWORD } from '../api';
import {
  festivalParam,
  festivalShortName,
  findChoosable,
  nationalFestivals,
  readStoredFestival,
  regionalChoices as toRegionalChoices,
  resolveFestivalSelection,
  withoutFestivalParam,
  writeStoredFestival,
  type FestivalSource,
} from '../lib/festivals';
import type { Festival, User } from '../types';
import { useAuth } from './AuthProvider';
import { useSongs } from './SongsProvider';
import { useToast } from './ToastProvider';

export interface FestivalContextValue {
  /** Every active festival (regional, online and national) in the server's order. */
  festivals: Festival[];
  /** What a student can pick: active regionals (date order, TBD last), then online. */
  regionalChoices: Festival[];
  /** Active national festivals, in date order. */
  nationals: Festival[];
  /** The chosen festival, or null. */
  selected: Festival | null;
  /** Where the choice came from ('url' | 'account' | 'local' | 'default' | 'none'). */
  source: FestivalSource;
  /**
   * Choose a festival (or clear with null). Resolves true when kept; false when the slug isn't an
   * active regional/online festival, or the account save failed (the choice is rolled back).
   */
  setFestival: (slug: string | null) => Promise<boolean>;
  /** The festival list is known (meta loaded). Until then `festivals` is empty. */
  ready: boolean;
  /** Neither /api/meta nor GET /api/festivals could be loaded (show an error + `retryLoad`). */
  loadError: boolean;
  /** Try GET /api/festivals again after `loadError`. */
  retryLoad: () => Promise<void>;
  /** An account save is in flight. */
  saving: boolean;
  /** Re-fetch GET /api/festivals (after an admin adds/edits/hides one). */
  refreshFestivals: () => Promise<void>;
}

const FestivalContext = createContext<FestivalContextValue | null>(null);

const EMPTY: Festival[] = [];

interface Choice {
  slug: string | null;
  source: FestivalSource;
}

/** A user's festival on the account (as last reported), or waiting to be saved to it. */
interface AccountSlug {
  userId: number;
  slug: string | null;
}

/** Changes whenever the account-side facts the selection depends on change. */
function userKey(user: User | null): string {
  return user ? `${user.id}|${user.mustChangePassword ? 1 : 0}|${user.festivalSlug ?? ''}` : '';
}

const canSave = (user: User | null): user is User => Boolean(user && !user.mustChangePassword);

export function FestivalProvider({ children }: { children: ReactNode }) {
  const { meta, error: metaError } = useSongs();
  const { user, loading: authLoading, updateProfile } = useAuth();
  // The logged-in user's id right now (for answers that arrive after a logout / another login).
  const userIdRef = useRef<number | null>(user?.id ?? null);
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user]);
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  // Festivals come with /api/meta; `fetched` holds a fresher GET /api/festivals (admin edits, or
  // meta failed to load). A new meta (reload) wins again.
  const [fetched, setFetched] = useState<Festival[] | null>(null);
  useEffect(() => {
    if (meta) setFetched(null);
  }, [meta]);
  const metaFestivals = meta?.festivals;
  const festivals = fetched ?? (Array.isArray(metaFestivals) ? metaFestivals : EMPTY);
  const ready = fetched !== null || meta !== null;
  const choices = useMemo(() => toRegionalChoices(festivals), [festivals]);
  const nationals = useMemo(() => nationalFestivals(festivals), [festivals]);

  const refreshFestivals = useCallback(async () => {
    const res = await api.getFestivals();
    setFetched(Array.isArray(res.festivals) ? res.festivals : []);
  }, []);

  // /api/meta failed (it's fetched with the song list): still try to fill the pickers.
  const triedFallback = useRef(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  useEffect(() => {
    if (meta || !metaError || triedFallback.current) return;
    triedFallback.current = true;
    refreshFestivals().catch(() => setFallbackFailed(true));
  }, [meta, metaError, refreshFestivals]);
  const retryLoad = useCallback(async () => {
    setFallbackFailed(false);
    try {
      await refreshFestivals();
    } catch {
      setFallbackFailed(true);
    }
  }, [refreshFestivals]);
  const loadError = !ready && fallbackFailed;

  const [choice, setChoice] = useState<Choice>({ slug: null, source: 'none' });
  const choiceRef = useRef(choice);
  const commit = useCallback((next: Choice) => {
    choiceRef.current = next;
    setChoice(next);
  }, []);

  // Account saves run one after another (so the last choice is the one that sticks).
  const [pending, setPending] = useState(0);
  const pendingRef = useRef(0);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  // The account's festival as the server last reported it, and the last one queued for it: while a
  // save is on its way, `user.festivalSlug` is still the old value (so going back to it — A→B→A —
  // must still be saved).
  const confirmedRef = useRef<AccountSlug | null>(null);
  const queuedRef = useRef<AccountSlug | null>(null);
  // A choice made while it couldn't be saved (temporary password, session ended) — saved to that
  // account once it can be, rather than replaced by the account's festival.
  const heldRef = useRef<AccountSlug | null>(null);

  /** The festival `u`'s account will have once the queued saves are done. */
  const accountWillHave = useCallback((u: User): string | null => {
    if (pendingRef.current > 0 && queuedRef.current?.userId === u.id) return queuedRef.current.slug;
    if (confirmedRef.current?.userId === u.id) return confirmedRef.current.slug;
    return u.festivalSlug ?? null;
  }, []);

  /** Resolves true when saved for the user who is still logged in (false: they left meanwhile). */
  const saveToAccount = useCallback(
    (userId: number, slug: string | null): Promise<boolean> => {
      pendingRef.current += 1;
      setPending((n) => n + 1);
      queuedRef.current = { userId, slug };
      const run = saveChain.current.catch(() => undefined).then(() => updateProfile({ festivalSlug: slug }));
      saveChain.current = run;
      return run
        .then((me) => {
          confirmedRef.current = { userId: me.id, slug: me.festivalSlug ?? null };
          return userIdRef.current === userId && me.id === userId;
        })
        .finally(() => {
          pendingRef.current -= 1;
          setPending((n) => n - 1);
        });
    },
    [updateProfile],
  );

  /** Quietly copy this device's choice to the account (retried at the next login if it fails). */
  const pushToAccount = useCallback(
    (userId: number, slug: string | null) => {
      saveToAccount(userId, slug).then(
        (kept) => {
          if (kept && slug && choiceRef.current.slug === slug && choiceRef.current.source === 'local') commit({ slug, source: 'account' });
        },
        () => undefined,
      );
    },
    [saveToAccount, commit],
  );

  const changeSeq = useRef(0);
  const choose = useCallback(
    async (slug: string | null, source?: FestivalSource): Promise<boolean> => {
      const festival = slug === null ? null : findChoosable(choices, slug);
      if (slug !== null && !festival) return false;
      const next = festival?.slug ?? null;
      const previous = choiceRef.current;
      const previousStored = readStoredFestival();
      const seq = ++changeSeq.current;
      commit({ slug: next, source: next === null ? 'none' : (source ?? (canSave(user) ? 'account' : 'local')) });
      writeStoredFestival(next);
      if (!user) return true;
      if (user.mustChangePassword) {
        // Temporary password: kept on this device, saved to the account once a new password is chosen.
        heldRef.current = { userId: user.id, slug: next };
        return true;
      }
      heldRef.current = null;
      if (accountWillHave(user) === next) return true;
      try {
        await saveToAccount(user.id, next);
        return true;
      } catch (e) {
        // Session ended / temporary password: AuthProvider takes over (login page or /me) and the
        // choice stays on this device — it's saved to this account when they're back.
        if (isApiError(e) && (e.status === 401 || (e.status === 403 && e.code === MUST_CHANGE_PASSWORD))) {
          if (seq === changeSeq.current) heldRef.current = { userId: user.id, slug: next };
          return true;
        }
        if (seq === changeSeq.current) {
          commit(previous);
          writeStoredFestival(previousStored);
        }
        const message = isApiError(e) ? (e.field('festivalSlug') ?? e.message) : 'Please try again.';
        toast.error(message, { title: 'Couldn’t save your festival', id: 'festival-save' });
        return false;
      }
    },
    [choices, user, commit, saveToAccount, accountWillHave, toast],
  );
  const setFestival = useCallback((slug: string | null) => choose(slug), [choose]);

  // ---- first resolution + ?festival= links (waits for the festival list and the session) ----
  const initialized = useRef(false);
  const seenUser = useRef('');
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || authLoading) return;
    const raw = festivalParam(location.search);
    const freshLink = raw !== null && handledLink.current !== location.key;
    const linked = freshLink ? findChoosable(choices, raw) : undefined;
    if (!initialized.current) {
      initialized.current = true;
      seenUser.current = userKey(user);
      const r = resolveFestivalSelection({
        festivals: choices,
        url: linked?.slug,
        account: user?.festivalSlug,
        local: readStoredFestival(),
        fallback: meta?.defaultFestivalSlug,
      });
      if (r.source === 'url') {
        void choose(r.slug, 'url');
      } else {
        commit(r);
        if (r.source === 'account') writeStoredFestival(r.slug);
        if (r.source === 'local' && r.slug && canSave(user) && !findChoosable(choices, user.festivalSlug)) pushToAccount(user.id, r.slug);
      }
    } else if (linked) {
      void choose(linked.slug, 'url');
    }
    if (!freshLink) return;
    handledLink.current = location.key;
    if (linked) toast.success(`Your festival is set to ${festivalShortName(linked)}.`, { emoji: '📍', id: 'festival-link', duration: 3500 });
    else toast.info('That festival link didn’t match a current festival — pick yours from the list.', { emoji: '📍', id: 'festival-link' });
    navigate({ pathname: location.pathname, search: withoutFestivalParam(location.search), hash: location.hash }, { replace: true, state: location.state });
  }, [ready, authLoading, location, choices, user, meta, choose, commit, pushToAccount, toast, navigate]);

  // ---- the list changed (e.g. an admin showed a hidden festival again) while nothing is chosen:
  // pick up the account's / this device's festival if it can be chosen now. (A site default is
  // left for the next load, so an explicit "no festival" isn't overridden mid-visit.)
  const lastChoices = useRef(choices);
  useEffect(() => {
    if (lastChoices.current === choices) return;
    lastChoices.current = choices;
    if (!initialized.current || authLoading || pendingRef.current > 0 || choiceRef.current.slug !== null) return;
    const r = resolveFestivalSelection({ festivals: choices, account: user?.festivalSlug, local: readStoredFestival() });
    if (!r.slug) return;
    commit(r);
    if (r.source === 'account') writeStoredFestival(r.slug);
  }, [choices, authLoading, user, commit]);

  // ---- login / signup / logout / account changes ----
  useEffect(() => {
    if (!initialized.current || authLoading) return;
    const key = userKey(user);
    const before = seenUser.current;
    if (key === before) return;
    seenUser.current = key;
    if (!user) {
      // Logged out: this device keeps the choice (it's in localStorage).
      if (choiceRef.current.source === 'account') commit({ ...choiceRef.current, source: 'local' });
      return;
    }
    const sameUser = before.split('|')[0] === String(user.id);
    if (sameUser && pendingRef.current > 0) return; // our own save echoing back
    confirmedRef.current = { userId: user.id, slug: user.festivalSlug ?? null };
    // A choice made here while it couldn't be saved (temporary password / session ended) wins —
    // unless someone else logged in, or the choice has changed since.
    const held = heldRef.current;
    if (held && (held.userId !== user.id || choiceRef.current.slug !== held.slug)) heldRef.current = null;
    else if (held) {
      if (!canSave(user)) return; // still on a temporary password: keep waiting
      heldRef.current = null;
      if ((user.festivalSlug ?? null) !== held.slug) pushToAccount(user.id, held.slug);
      else if (held.slug) commit({ slug: held.slug, source: 'account' });
      return;
    }
    const account = findChoosable(choices, user.festivalSlug);
    if (account) {
      if (choiceRef.current.slug !== account.slug || choiceRef.current.source !== 'account') commit({ slug: account.slug, source: 'account' });
      writeStoredFestival(account.slug);
      return;
    }
    // The account has no festival: save this browser's choice to it (never a site-wide default).
    const current = choiceRef.current;
    if (current.slug && current.source !== 'default' && canSave(user)) pushToAccount(user.id, current.slug);
  }, [user, authLoading, choices, commit, pushToAccount]);

  const selected = useMemo(() => (choice.slug ? (findChoosable(choices, choice.slug) ?? null) : null), [choice.slug, choices]);

  const value = useMemo<FestivalContextValue>(
    () => ({
      festivals,
      regionalChoices: choices,
      nationals,
      selected,
      source: selected ? choice.source : 'none',
      setFestival,
      ready,
      loadError,
      retryLoad,
      saving: pending > 0,
      refreshFestivals,
    }),
    [festivals, choices, nationals, selected, choice.source, setFestival, ready, loadError, retryLoad, pending, refreshFestivals],
  );

  return <FestivalContext.Provider value={value}>{children}</FestivalContext.Provider>;
}

export function useFestival(): FestivalContextValue {
  const ctx = useContext(FestivalContext);
  if (!ctx) throw new Error('useFestival must be used inside <FestivalProvider>');
  return ctx;
}

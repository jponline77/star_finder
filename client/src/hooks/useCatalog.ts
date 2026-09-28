/**
 * Catalog data hooks (SPEC §7c) with a small in-memory cache, so moving back and forth between the
 * "/add" steps (search → show → song → back) is instant and doesn't re-ask the server.
 *
 *   const search = useCatalogSearch(text);          // debounced, abortable, ≥ 2 characters
 *   const { data, loading, error, reload } = useCatalogShow(id);
 *   const { data } = useCatalogSuggestions(catalogSongId);
 *
 * Only successful answers are cached. `clearCatalogCaches()` resets everything (tests).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, CATALOG_MIN_QUERY, getCatalogShow, getCatalogStatus, getCatalogSuggestions, searchCatalog } from '../api';
import type { CatalogHit, CatalogShowDetail, CatalogStatus, CatalogSuggestions, ItunesCandidate } from '../types';

// ---------------------------------------------------------------------------
// tiny TTL cache
// ---------------------------------------------------------------------------

export class TtlCache<T> {
  private readonly map = new Map<string, { value: T; at: number }>();
  private readonly ttlMs: number;
  private readonly max: number;
  constructor(ttlMs: number, max = 200) {
    this.ttlMs = ttlMs;
    this.max = max;
  }
  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: T): void {
    this.map.delete(key);
    this.map.set(key, { value, at: Date.now() });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  delete(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const searchCache = new TtlCache<CatalogHit[]>(5 * 60_000, 120);
const showCache = new TtlCache<CatalogShowDetail>(10 * 60_000, 60);
// Suggestions include "already on the site" + site-derived ranges/genres, which change as people add songs.
const suggestionCache = new TtlCache<CatalogSuggestions>(60_000, 60);

/** Shared with RecordingPicker (keyed by catalog song id). */
export const recordingCache = new TtlCache<ItunesCandidate[]>(10 * 60_000, 60);

const statusCache = new TtlCache<CatalogStatus>(5 * 60_000, 1);

export function clearCatalogCaches(): void {
  statusCache.clear();
  searchCache.clear();
  showCache.clear();
  suggestionCache.clear();
  recordingCache.clear();
}

/** Cache the show list a caller already has (e.g. after loading cast-album tracks). */
export function primeCatalogShow(show: CatalogShowDetail): void {
  showCache.set(String(show.id), show);
}

function toApiError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : 'Something went wrong');
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

export type CatalogSearchStatus = 'idle' | 'loading' | 'done' | 'error';

export interface CatalogSearchState {
  /** The normalised query the current `results` answer (may lag behind the input while loading). */
  query: string;
  results: CatalogHit[];
  status: CatalogSearchStatus;
  error: ApiError | null;
  /** True when `results` belong to the text in the box right now. */
  current: boolean;
  retry: () => void;
}

/** Collapse whitespace; '' when shorter than the server's minimum. */
export function normalizeCatalogQuery(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 120);
}

export function useCatalogSearch(text: string, options: { delay?: number; limit?: number } = {}): CatalogSearchState {
  const { delay = 200, limit = 20 } = options;
  const q = normalizeCatalogQuery(text);
  const tooShort = [...q].length < CATALOG_MIN_QUERY;
  const key = `${limit}|${q.toLowerCase()}`;
  const [state, setState] = useState<Omit<CatalogSearchState, 'retry' | 'current'>>(() => {
    const hit = tooShort ? undefined : searchCache.get(key);
    return hit ? { query: q, results: hit, status: 'done', error: null } : { query: '', results: [], status: tooShort ? 'idle' : 'loading', error: null };
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (tooShort) {
      setState({ query: q, results: [], status: 'idle', error: null });
      return;
    }
    const hit = searchCache.get(key);
    if (hit) {
      setState({ query: q, results: hit, status: 'done', error: null });
      return;
    }
    // keep the previous results on screen (dimmed) while the new ones load — no flicker while typing
    setState((s) => ({ ...s, status: 'loading', error: null }));
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      searchCatalog(q, { limit }, ctrl.signal)
        .then((res) => {
          const results = Array.isArray(res?.results) ? res.results : [];
          searchCache.set(key, results);
          if (!ctrl.signal.aborted) setState({ query: q, results, status: 'done', error: null });
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted || isAbort(e)) return;
          setState({ query: q, results: [], status: 'error', error: toApiError(e) });
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, key, tooShort, limit, delay, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, current: state.query === q && state.status === 'done', retry };
}

// ---------------------------------------------------------------------------
// show detail + suggestions
// ---------------------------------------------------------------------------

export interface CachedData<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  setData: (data: T) => void;
}

function useCached<T>(cache: TtlCache<T>, key: string | null, fetcher: (signal: AbortSignal) => Promise<T>): CachedData<T> {
  const [state, setState] = useState<{ key: string | null; data: T | null; loading: boolean; error: ApiError | null }>(() => {
    const hit = key ? cache.get(key) : undefined;
    return { key, data: hit ?? null, loading: key !== null && hit === undefined, error: null };
  });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (key === null) {
      setState({ key, data: null, loading: false, error: null });
      return;
    }
    const hit = cache.get(key);
    if (hit !== undefined) {
      setState({ key, data: hit, loading: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState({ key, data: null, loading: true, error: null });
    fetcherRef
      .current(ctrl.signal)
      .then((d) => {
        cache.set(key, d);
        if (!ctrl.signal.aborted) setState({ key, data: d, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted || isAbort(e)) return;
        setState({ key, data: null, loading: false, error: toApiError(e) });
      });
    return () => ctrl.abort();
  }, [cache, key, nonce]);

  const reload = useCallback(() => {
    if (key) cache.delete(key);
    setNonce((n) => n + 1);
  }, [cache, key]);
  const setData = useCallback(
    (d: T) => {
      if (key) cache.set(key, d);
      setState({ key, data: d, loading: false, error: null });
    },
    [cache, key],
  );
  // While the key changes, don't show the previous key's data.
  const stale = state.key !== key;
  return { data: stale ? null : state.data, loading: stale ? key !== null : state.loading, error: stale ? null : state.error, reload, setData };
}

/** GET /api/catalog/shows/:id (cached). Pass null to skip. */
export function useCatalogShow(id: number | null): CachedData<CatalogShowDetail> {
  return useCached(showCache, id === null ? null : String(id), (signal) => getCatalogShow(id as number, {}, signal));
}

/** GET /api/catalog/songs/:id/suggestions (cached briefly). Pass null to skip. */
export function useCatalogSuggestions(id: number | null): CachedData<CatalogSuggestions> {
  return useCached(suggestionCache, id === null ? null : String(id), (signal) => getCatalogSuggestions(id as number, signal));
}

/** GET /api/catalog (cached): `data.available === false` → no catalog is loaded on this server. */
export function useCatalogStatus(): CachedData<CatalogStatus> {
  return useCached(statusCache, 'status', (signal) => getCatalogStatus(signal));
}

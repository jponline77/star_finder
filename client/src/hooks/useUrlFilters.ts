/**
 * Browse-style filter state that is instant locally AND synced to the URL query string.
 *
 *   const { filters, setFilters } = useUrlFilters();
 *   setFilters({ ...filters, kind: 'solo' });                   // push a history entry
 *   setFilters({ ...filters, maxSeconds: 240 }, { replace: true }); // slider drags
 *   setFilters({ ...filters, q: text }, { debounce: true });   // typing: URL updated after 250 ms
 *
 * Back/forward (or any external URL change) resets the local state from the URL. Unrelated params
 * (e.g. `view=table`) are preserved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { filtersFromSearchParams, filtersToSearchParams, type FilterState } from '../lib/filters';

export interface SetFiltersOptions {
  /** replace the current history entry instead of pushing */
  replace?: boolean;
  /** delay the URL write (typing); always uses replace */
  debounce?: boolean;
}

const keyOf = (f: FilterState) => filtersToSearchParams(f).toString();

/** The browser's current query string (always up to date, unlike a render-time snapshot). */
export function currentSearch(): URLSearchParams {
  return new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
}

export function useUrlFilters(debounceMs = 250): {
  filters: FilterState;
  setFilters: (next: FilterState, options?: SetFiltersOptions) => void;
} {
  const [params, setParams] = useSearchParams();
  const urlFilters = useMemo(() => filtersFromSearchParams(params), [params]);
  const urlKey = useMemo(() => keyOf(urlFilters), [urlFilters]);
  const [filters, setLocal] = useState<FilterState>(urlFilters);
  const pending = useRef<string[]>([]);
  const urlKeyRef = useRef(urlKey);
  const timer = useRef<number | null>(null);

  const cancelTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const urlFiltersRef = useRef(urlFilters);
  urlFiltersRef.current = urlFilters;

  // Only react when the FILTER part of the URL changes (not e.g. `view`).
  useEffect(() => {
    urlKeyRef.current = urlKey;
    const i = pending.current.indexOf(urlKey);
    if (i >= 0) {
      // our own write landed
      pending.current.splice(0, i + 1);
      return;
    }
    // external change (back/forward, link) → adopt the URL
    pending.current = [];
    cancelTimer();
    setLocal(urlFiltersRef.current);
  }, [urlKey]);

  useEffect(() => cancelTimer, []);

  const write = useCallback(
    (next: FilterState, replace: boolean) => {
      const key = keyOf(next);
      if (key === urlKeyRef.current && pending.current.length === 0) return;
      pending.current.push(key);
      // Base on the live URL (setSearchParams' functional form sees a possibly stale snapshot).
      setParams(filtersToSearchParams(next, currentSearch()), { replace, preventScrollReset: true });
    },
    [setParams],
  );

  const setFilters = useCallback(
    (next: FilterState, options: SetFiltersOptions = {}) => {
      setLocal(next);
      cancelTimer();
      if (options.debounce) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          write(next, true);
        }, debounceMs);
      } else {
        write(next, options.replace ?? false);
      }
    },
    [write, debounceMs],
  );

  return { filters, setFilters };
}

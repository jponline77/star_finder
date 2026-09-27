/**
 * Generic "fetch on mount" hook for page data.
 *
 *   const { data, loading, error, reload, setData } = useApiData((signal) => getStats(signal), []);
 *
 * - Aborts the previous request when deps change / on unmount.
 * - `reload()` refetches (keeps showing old data while refreshing).
 */
import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { ApiError } from '../api';

export interface ApiData<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  setData: (updater: T | ((prev: T | null) => T | null)) => void;
}

export function useApiData<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: DependencyList, options: { enabled?: boolean } = {}): ApiData<T> {
  const enabled = options.enabled !== false;
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetcherRef
      .current(ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) setDataState(d);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : 'Something went wrong'));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((updater: T | ((prev: T | null) => T | null)) => {
    setDataState((prev) => (typeof updater === 'function' ? (updater as (p: T | null) => T | null)(prev) : updater));
  }, []);

  return { data, loading, error, reload, setData };
}

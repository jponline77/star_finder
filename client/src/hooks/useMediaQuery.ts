import { useCallback, useSyncExternalStore } from 'react';

/** Live `matchMedia(query).matches`. SSR/test-safe (false when matchMedia is missing). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener?.('change', cb);
      return () => mql.removeEventListener?.('change', cb);
    },
    [query],
  );
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, get, () => false);
}

/** Breakpoint used for the desktop layout (sidebar filters, full nav). */
export const DESKTOP_QUERY = '(min-width: 900px)';
export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);

/** prefers-reduced-motion: reduce */
export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/** Non-hook check for imperative code (e.g. confetti). */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

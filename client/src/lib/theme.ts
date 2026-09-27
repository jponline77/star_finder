/**
 * Colour theme: 'dark' ("stage", default) or 'light' ("matinee"). Stored in localStorage
 * `star.theme`; defaults to prefers-color-scheme. index.html applies it before first paint.
 */
import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
export const THEME_STORAGE_KEY = 'star.theme';

const listeners = new Set<() => void>();

export function getStoredTheme(): Theme | null {
  try {
    const t = window.localStorage.getItem(THEME_STORAGE_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

export function getSystemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** The theme currently applied to <html data-theme>. */
export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme, persist = true): void {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#fff8ec' : '#140d24');
  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }
  for (const l of [...listeners]) l();
}

/** Apply stored or system theme (called once at startup; index.html already does this too). */
export function initTheme(): void {
  applyTheme(getStoredTheme() ?? getSystemTheme(), false);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** `const { theme, toggle, setTheme } = useTheme()` */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'dark' as Theme);
  const setTheme = useCallback((t: Theme) => applyTheme(t), []);
  const toggle = useCallback(() => applyTheme(getTheme() === 'dark' ? 'light' : 'dark'), []);
  return { theme, setTheme, toggle };
}

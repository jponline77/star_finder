/**
 * After a redeploy, a tab that is still open references the old build's lazy-loaded page chunks,
 * which no longer exist on the server — opening a page it hasn't loaded yet would fail with
 * "Failed to fetch dynamically imported module". Vite fires `vite:preloadError` on window
 * first; we reload once to pick up the new build. A timestamp in sessionStorage stops a reload
 * loop when the chunk is really broken: a second failure within `windowMs` is left alone, so the
 * route's error screen shows instead.
 */
export const CHUNK_RELOAD_KEY = 'star:chunk-reload-at';

export interface ChunkReloadOptions {
  /** Ignore a second failure this soon after the last reload (ms). */
  windowMs?: number;
  now?: () => number;
  reload?: () => void;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** Returns true when it reloaded (and swallowed the error), false when it let the error through. */
export function handleChunkLoadError(event: Pick<Event, 'preventDefault'>, options: ChunkReloadOptions = {}): boolean {
  const { windowMs = 10_000, now = Date.now, reload = () => window.location.reload() } = options;
  let storage = options.storage;
  if (storage === undefined) {
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null; // blocked storage: without a guard, don't risk a loop — let the error show
    }
  }
  if (!storage) return false;
  let last = 0;
  try {
    last = Number(storage.getItem(CHUNK_RELOAD_KEY)) || 0;
    if (now() - last < windowMs) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now()));
  } catch {
    return false;
  }
  event.preventDefault();
  reload();
  return true;
}

/** Install the `vite:preloadError` listener. Returns an uninstall function. */
export function installChunkReload(target: Window = window): () => void {
  const listener = (event: Event) => {
    handleChunkLoadError(event);
  };
  target.addEventListener('vite:preloadError', listener);
  return () => target.removeEventListener('vite:preloadError', listener);
}

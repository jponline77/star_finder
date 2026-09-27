/**
 * Short-lived form drafts, kept in sessionStorage (this tab only — gone when it closes) so what a
 * student typed survives the trip to /login and back when their session ends mid-edit.
 *
 *   saveDraft('song-form:add', user.id, { values });            // just before the 401 redirect
 *   const draft = readDraft<MyDraft>('song-form:add', user.id);  // on remount (pure — safe in a
 *   useEffect(() => clearDraft('song-form:add'), []);           //  state initializer), then clear
 *
 * A draft is only handed back to the same account that saved it, and expires after a few hours.
 * `clearAllDrafts()` runs on logout so nothing lingers on a shared computer.
 */

const PREFIX = 'star.draft.v1:';
export const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface StoredDraft<T> {
  userId: number;
  savedAt: number;
  data: T;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/** Save `data` for `key`. Returns false when storage is unavailable or full. */
export function saveDraft<T>(key: string, userId: number, data: T, now = Date.now()): boolean {
  const s = storage();
  if (!s) return false;
  try {
    const stored: StoredDraft<T> = { userId, savedAt: now, data };
    s.setItem(PREFIX + key, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

/** The draft for `key` — null if none, expired, or saved by another account. Doesn't remove it. */
export function readDraft<T>(key: string, userId: number, now = Date.now()): T | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + key);
    if (raw === null) return null;
    const stored = JSON.parse(raw) as Partial<StoredDraft<T>> | null;
    if (!stored || typeof stored !== 'object' || stored.userId !== userId) return null;
    if (typeof stored.savedAt !== 'number' || now - stored.savedAt > DRAFT_MAX_AGE_MS || now < stored.savedAt - 60_000) return null;
    return (stored.data ?? null) as T | null;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Remove every saved draft (logout). */
export function clearAllDrafts(): void {
  const s = storage();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    /* ignore */
  }
}

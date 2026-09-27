/**
 * "My Setlist" favourites — song ids kept in localStorage (key `star.setlist.v1`).
 * Works when storage is unavailable/throws (falls back to memory) and syncs across tabs.
 *
 *   const { ids, has, toggle, count } = useSetlist();
 */
import { useSyncExternalStore } from 'react';

export const SETLIST_STORAGE_KEY = 'star.setlist.v1';
/** Hard cap so a malicious share link can't bloat storage. */
export const SETLIST_MAX = 200;

type Listener = () => void;

const EMPTY: readonly number[] = Object.freeze([]);
let memoryFallback: readonly number[] = EMPTY;
let cache: readonly number[] | null = null;
const listeners = new Set<Listener>();

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Parse ids from anything (JSON array, "1,2,3", garbage) → unique positive ints, order kept. */
export function sanitizeIds(input: unknown): number[] {
  let values: unknown[] = [];
  if (Array.isArray(input)) values = input;
  else if (typeof input === 'string') values = input.split(/[\s,]+/);
  else if (typeof input === 'number') values = [input];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of values) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
    if (Number.isSafeInteger(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
      if (out.length >= SETLIST_MAX) break;
    }
  }
  return out;
}

function readStorage(): readonly number[] {
  const s = storage();
  if (!s) return memoryFallback;
  try {
    const raw = s.getItem(SETLIST_STORAGE_KEY);
    if (!raw) return EMPTY;
    return Object.freeze(sanitizeIds(JSON.parse(raw)));
  } catch {
    return memoryFallback;
  }
}

function emit(): void {
  for (const l of [...listeners]) l();
}

/** Current ids (stable reference until the list changes — safe for useSyncExternalStore). */
export function getSetlist(): readonly number[] {
  if (cache === null) cache = readStorage();
  return cache;
}

/** Replace the whole list. */
export function setSetlist(ids: readonly number[]): void {
  const next = Object.freeze(sanitizeIds([...ids]));
  const prev = getSetlist();
  if (prev.length === next.length && prev.every((v, i) => v === next[i])) return;
  cache = next;
  memoryFallback = next;
  const s = storage();
  if (s) {
    try {
      s.setItem(SETLIST_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode — memory fallback keeps working for this tab */
    }
  }
  emit();
}

export function isInSetlist(id: number): boolean {
  return getSetlist().includes(id);
}

export function addToSetlist(id: number): void {
  if (!isInSetlist(id)) setSetlist([...getSetlist(), id]);
}

export function removeFromSetlist(id: number): void {
  setSetlist(getSetlist().filter((x) => x !== id));
}

/** Returns true if the song is now in the setlist. */
export function toggleSetlist(id: number): boolean {
  if (isInSetlist(id)) {
    removeFromSetlist(id);
    return false;
  }
  addToSetlist(id);
  return true;
}

/** Move an item from one index to another (no-op when out of range). */
export function moveInSetlist(from: number, to: number): void {
  const list = [...getSetlist()];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item as number);
  setSetlist(list);
}

export function clearSetlist(): void {
  setSetlist([]);
}

/**
 * Import ids (e.g. from a share link). 'merge' appends new ids after existing ones; 'replace'
 * swaps the list. Returns how many ids were newly added.
 */
export function importSetlist(ids: readonly number[] | string, mode: 'merge' | 'replace' = 'merge'): number {
  const incoming = sanitizeIds(typeof ids === 'string' ? ids : [...ids]);
  const current = getSetlist();
  if (mode === 'replace') {
    const added = incoming.filter((id) => !current.includes(id)).length;
    setSetlist(incoming);
    return added;
  }
  const fresh = incoming.filter((id) => !current.includes(id));
  if (fresh.length) setSetlist([...current, ...fresh]);
  return fresh.length;
}

/** Parse the `?ids=1,2,3` share param. */
export function parseSetlistParam(value: string | null | undefined): number[] {
  return value ? sanitizeIds(value) : [];
}

/** Shareable URL: `${origin}/setlist?ids=1,2,3` */
export function setlistShareUrl(ids: readonly number[], origin: string = typeof window !== 'undefined' ? window.location.origin : ''): string {
  const clean = sanitizeIds([...ids]);
  return `${origin}/setlist${clean.length ? `?ids=${clean.join(',')}` : ''}`;
}

export function subscribeSetlist(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SETLIST_STORAGE_KEY) {
      cache = null;
      listener();
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** Test helper: forget the in-memory cache so the next read hits storage. */
export function __resetSetlistCacheForTests(): void {
  cache = null;
  memoryFallback = EMPTY;
}

export interface SetlistApi {
  ids: readonly number[];
  count: number;
  has: (id: number) => boolean;
  add: (id: number) => void;
  remove: (id: number) => void;
  /** returns true when the song is now in the list */
  toggle: (id: number) => boolean;
  move: (from: number, to: number) => void;
  clear: () => void;
  replace: (ids: readonly number[]) => void;
  import: (ids: readonly number[] | string, mode?: 'merge' | 'replace') => number;
}

const api = {
  add: addToSetlist,
  remove: removeFromSetlist,
  toggle: toggleSetlist,
  move: moveInSetlist,
  clear: clearSetlist,
  replace: setSetlist,
  import: importSetlist,
};

/** React hook — re-renders whenever the setlist changes (in this tab or another). */
export function useSetlist(): SetlistApi {
  const ids = useSyncExternalStore(subscribeSetlist, getSetlist, () => EMPTY);
  return {
    ids,
    count: ids.length,
    has: (id: number) => ids.includes(id),
    ...api,
  };
}

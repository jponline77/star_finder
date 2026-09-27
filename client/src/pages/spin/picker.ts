/**
 * Spin the Spotlight (SPEC §7.7) — pure, deterministic-testable helpers. Inject `random` in tests.
 *
 *   const pool = spinPool(songs, { kind: 'solo', ranges: ['Tenor'], hideMature: true });
 *   const target = pickRandom(pool, Math.random, lastId);
 *   const reel = buildReel(pool, target, 30, Math.random);   // reel[reel.length - 1] === target
 */
import type { Kind, Song, VocalRange } from '../../types';
import { defaultFilters, songMatchesFilters } from '../../lib/filters';

export type RandomFn = () => number;

export interface SpinFilters {
  kind: 'all' | Kind;
  ranges: VocalRange[];
  hideMature: boolean;
}

export const DEFAULT_SPIN_FILTERS: Readonly<SpinFilters> = Object.freeze({ kind: 'all', ranges: [], hideMature: false }) as Readonly<SpinFilters>;

/** Songs eligible for the spin (a duet matches a range if ANY part has it — same as Browse). */
export function spinPool(songs: readonly Song[], filters: SpinFilters): Song[] {
  const state = defaultFilters({ kind: filters.kind, ranges: [...filters.ranges], hideMature: filters.hideMature });
  return songs.filter((s) => songMatchesFilters(s, state));
}

/** Clamp a random() value into an index 0..n-1 (robust to random() returning exactly 1). */
export function randomIndex(n: number, random: RandomFn = Math.random): number {
  if (n <= 0) return -1;
  const r = random();
  const safe = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999999) : 0;
  return Math.floor(safe * n);
}

/**
 * Pick a random item. When `avoidId` is given and there's more than one item, never returns
 * that item (so "Spin again" always lands somewhere new).
 */
export function pickRandom<T extends { id: number }>(pool: readonly T[], random: RandomFn = Math.random, avoidId?: number | null): T | null {
  if (!pool.length) return null;
  const candidates = pool.length > 1 && avoidId != null ? pool.filter((s) => s.id !== avoidId) : pool;
  return candidates[randomIndex(candidates.length, random)] ?? null;
}

/**
 * The strip of items the reel scrolls through: `length - 1` random fillers (no item twice in a
 * row when the pool allows) followed by the target as the LAST item.
 */
export function buildReel<T extends { id: number }>(pool: readonly T[], target: T, length = 30, random: RandomFn = Math.random): T[] {
  const n = Math.max(1, Math.floor(length));
  const reel: T[] = [];
  for (let i = 0; i < n - 1; i++) {
    const prev = reel[reel.length - 1];
    // the filler right before the target shouldn't be the target either
    const avoid = new Set<number>();
    if (prev) avoid.add(prev.id);
    if (i === n - 2) avoid.add(target.id);
    const options = pool.length > avoid.size ? pool.filter((s) => !avoid.has(s.id)) : pool;
    const item = options[randomIndex(options.length, random)];
    if (item) reel.push(item);
  }
  reel.push(target);
  return reel;
}

/** Deceleration curve for the reel: fast start, long gentle landing (easeOutQuint). */
export function reelEase(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 5);
}

/** Reel position (in items, fractional) at time `elapsed` of a spin lasting `duration` that ends on index `last`. */
export function reelPosition(elapsed: number, duration: number, last: number): number {
  if (duration <= 0) return last;
  return reelEase(elapsed / duration) * last;
}

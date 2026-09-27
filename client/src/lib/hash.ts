/**
 * Deterministic "random": stable hashes → gradient colours / initials for artwork fallbacks,
 * avatars, and the Spotlight Song of the Day.
 */

/** 32-bit FNV-1a hash of a string (stable across sessions/browsers). */
export function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Gradient {
  from: string;
  to: string;
  angle: number;
  /** ready-to-use CSS background value */
  css: string;
  /** base hue 0..359 */
  hue: number;
}

/**
 * A rich two-stop gradient for a seed (e.g. a show name). Lightness is kept low enough that white
 * initials on top stay readable (≥ 4.5:1 at the darker stop).
 */
export function gradientFor(seed: string): Gradient {
  const h = stableHash(seed || '?');
  const hue = h % 360;
  const hue2 = (hue + 35 + ((h >>> 9) % 50)) % 360;
  const angle = 115 + ((h >>> 17) % 90);
  const from = `hsl(${hue} 70% 34%)`;
  const to = `hsl(${hue2} 78% 22%)`;
  return { from, to, angle, hue, css: `linear-gradient(${angle}deg, ${from}, ${to})` };
}

const SMALL_WORDS = new Set(['the', 'a', 'an', 'of', 'and', '&', 'to', 'in', 'on', 'at', 'for']);

/**
 * Initials for a name: "Les Misérables" → "LM", "The Phantom of the Opera" → "PO",
 * "Wicked" → "W", "Mrs. Lovett" → "ML". Max `max` letters, uppercase.
 */
export function initials(name: string | null | undefined, max = 2): string {
  if (!name) return '?';
  const words = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[\s\-–—/]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (!words.length) return '?';
  const significant = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  const use = significant.length ? significant : words;
  return use
    .slice(0, max)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** Local calendar date key "YYYY-MM-DD". */
export function dateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Deterministic index 0..n-1 for a key (same key → same index). */
export function pickIndex(key: string, n: number): number {
  if (n <= 0) return -1;
  return stableHash(key) % n;
}

/**
 * The item of the day (e.g. Spotlight Song of the Day): stable for a calendar day, changes daily.
 * Items are ordered by `id` first so the pick doesn't depend on list order.
 */
export function pickDaily<T extends { id: number }>(items: readonly T[], date: Date = new Date(), salt = 'spotlight'): T | null {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a.id - b.id);
  return sorted[pickIndex(`${salt}:${dateKey(date)}`, sorted.length)] ?? null;
}

/** Seeded PRNG (mulberry32) for deterministic shuffles in tests / animations. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

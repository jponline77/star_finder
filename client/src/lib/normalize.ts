/**
 * Accent- and case-insensitive text helpers (SPEC §4): "les miserables" matches "Les Misérables",
 * "dantes" matches "Dantès". Pure functions — no DOM.
 */

/** Characters that NFD does not decompose but that people type without the accent. */
const SPECIAL_FOLDS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ł: 'l',
  ı: 'i',
  // typographic punctuation → plain
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  ' ': ' ',
};

const COMBINING_MARKS = /\p{M}/gu;

/** Fold a single code point (already a whole character) to its searchable form. */
function foldChar(ch: string): string {
  const lower = ch.toLowerCase();
  const special = SPECIAL_FOLDS[lower];
  if (special !== undefined) return special;
  return lower.normalize('NFD').replace(COMBINING_MARKS, '');
}

/**
 * Lowercase + strip accents + normalise curly quotes/dashes. Does NOT collapse whitespace
 * (so indices stay meaningful for highlighting — see foldWithMap).
 */
export function fold(text: string | null | undefined): string {
  if (!text) return '';
  let out = '';
  for (const ch of text) out += foldChar(ch);
  return out;
}

/**
 * Fold `text` and return a map from each folded UTF-16 index back to the index in the original
 * string where that character came from. `map` has length folded.length + 1 (the last entry is
 * text.length) so an exclusive end index can be mapped too.
 */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let index = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let i = 0; i < f.length; i++) map.push(index);
    folded += f;
    index += ch.length;
  }
  map.push(text.length);
  return { folded, map };
}

/** Fold + collapse whitespace + trim: the canonical form for comparisons/equality. */
export function normalizeText(text: string | null | undefined): string {
  return fold(text).replace(/\s+/g, ' ').trim();
}

/** Split a search query into folded, non-empty tokens. */
export function tokenize(query: string | null | undefined): string[] {
  return normalizeText(query)
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Accent/case-insensitive equality (after trimming/collapsing whitespace). */
export function equalsLoose(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeText(a) === normalizeText(b);
}

/** Accent/case-insensitive substring test. An empty needle always matches. */
export function includesLoose(haystack: string | null | undefined, needle: string | null | undefined): boolean {
  const n = normalizeText(needle);
  if (!n) return true;
  return normalizeText(haystack).includes(n);
}

/**
 * URL slug (must agree with the server + seed files, SPEC §4): NFD-fold accents, lowercase,
 * delete apostrophes (' and ’), replace every run of chars outside [a-z0-9] with '-', trim '-'.
 *   "Les Misérables" → "les-miserables", "Something's Afoot" → "somethings-afoot"
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Best guess at a show's URL slug from its name, for when the API's `slug` isn't at hand: the
 * server's rules for a new show (`uniqueSlug`) — an empty slug becomes "show", and an all-digit one
 * ("13", "1776") gets "-show" so /shows/13 isn't read as show id 13. It can't know about "-2"
 * collision suffixes, so always prefer the slug the API sent.
 */
export function showSlug(name: string): string {
  const base = slugify(name) || 'show';
  return /^\d+$/.test(base) ? `${base}-show` : base;
}

/** Locale-aware, accent-insensitive comparator for sorting names/titles. */
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true, ignorePunctuation: false });
export function compareText(a: string | null | undefined, b: string | null | undefined): number {
  return collator.compare(a ?? '', b ?? '');
}

/**
 * Sort key that ignores a leading article ("The Phantom…" sorts under P). Use with compareText
 * when you want library-style ordering; the default Browse sort keeps titles as written.
 */
export function stripLeadingArticle(text: string): string {
  return text.replace(/^(the|a|an)\s+/i, '');
}

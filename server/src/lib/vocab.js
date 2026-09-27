// Controlled vocabularies (SPEC §4). Mirrored in client/src/lib/vocab.ts.
import { fold } from './text.js';

/** Ordered high → low. */
export const VOCAL_RANGES = Object.freeze(['Soprano', 'Mezzo-soprano', 'Alto', 'Tenor', 'Baritone', 'Bass']);

/** Suggested genres (the API accepts any ≤ 40 char string). */
export const GENRES = Object.freeze(['Comedy', 'Drama', 'Romantic']);

export const KINDS = Object.freeze(['solo', 'duet']);
export const COMMENT_TAGS = Object.freeze(['general', 'tip', 'question', 'performed']);

/** STAR rules: 6:00 hard limit, warn from 5:30. */
export const TIME_LIMIT_SECONDS = 360;
export const WARN_SECONDS = 330;

export const FESTIVAL = Object.freeze({
  name: 'Vancouver Regional STAR Fest',
  date: '2026-12-11',
  venue: 'SFU School for the Contemporary Arts (SFU SCA)',
  url: 'https://taeacanada.ca/regional-star-fest/',
});

// Aliases are compared after folding and collapsing spaces/hyphens/dots.
const RANGE_ALIASES = new Map([
  ['soprano', 'Soprano'], ['sop', 'Soprano'], ['s', 'Soprano'],
  ['mezzo', 'Mezzo-soprano'], ['mezzo soprano', 'Mezzo-soprano'], ['mezzosoprano', 'Mezzo-soprano'],
  ['mezzo sop', 'Mezzo-soprano'], ['mz', 'Mezzo-soprano'], ['mez', 'Mezzo-soprano'], ['ms', 'Mezzo-soprano'],
  ['alto', 'Alto'], ['a', 'Alto'], ['contralto', 'Alto'],
  ['tenor', 'Tenor'], ['t', 'Tenor'], ['ten', 'Tenor'],
  ['baritone', 'Baritone'], ['bari', 'Baritone'], ['bar', 'Baritone'],
  ['bass', 'Bass'], ['b', 'Bass'],
]);

/**
 * Normalize a vocal range case-insensitively ("mezzo" → "Mezzo-soprano", "sop" → "Soprano").
 * @param {unknown} value
 * @returns {string|null|undefined} canonical range, null for empty input, undefined if unknown.
 */
export function normalizeVocalRange(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (raw === '') return null;
  const key = fold(raw).replace(/[.\s_-]+/g, ' ').trim();
  if (RANGE_ALIASES.has(key)) return RANGE_ALIASES.get(key);
  return undefined;
}

/** Index in VOCAL_RANGES (unknown → 99) for sorting. */
export function vocalRangeOrder(range) {
  const i = VOCAL_RANGES.indexOf(range);
  return i === -1 ? 99 : i;
}

/** Built-in sub-genre seed normalizations (applied by import even without corrections.json). */
export const SUB_GENRE_FIXES = Object.freeze({
  'Tongue & Cheek': 'Tongue-in-Cheek',
  'Intimidating/angry': 'Intimidating / Angry',
});

/**
 * Apply the built-in sub-genre fixes (case-insensitive, whitespace-tolerant).
 * @param {string|null} value
 * @returns {string|null}
 */
export function fixSubGenre(value) {
  if (value === null || value === undefined) return null;
  const key = fold(value).replace(/\s+/g, ' ').trim();
  for (const [from, to] of Object.entries(SUB_GENRE_FIXES)) {
    if (fold(from) === key) return to;
  }
  if (key === 'tongue in cheek' || key === 'tongue-in-cheek') return 'Tongue-in-Cheek';
  if (key === 'intimidating / angry' || key === 'intimidating/ angry' || key === 'intimidating /angry') return 'Intimidating / Angry';
  return value;
}

/**
 * Match `value` case/accent-insensitively against `existing`, returning the existing spelling if found.
 * @param {string|null} value
 * @param {Iterable<string>} existing
 */
export function matchExisting(value, existing) {
  if (value === null || value === undefined) return null;
  const key = fold(value);
  for (const e of existing) if (e !== null && fold(e) === key) return e;
  return value;
}

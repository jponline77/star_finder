/**
 * Controlled vocabularies + visual language (SPEC §4, §7). Mirrors server/src/lib/vocab.js.
 */
import type { CommentTag, Kind, VocalRange } from '../types';
import { normalizeText } from './normalize';

// ---------------------------------------------------------------------------
// Vocal ranges
// ---------------------------------------------------------------------------

/** Ordered high → low. */
export const VOCAL_RANGES: readonly VocalRange[] = ['Soprano', 'Mezzo-soprano', 'Alto', 'Tenor', 'Baritone', 'Bass'];

/** Emoji-free short labels for pill badges. */
export const RANGE_SHORT: Record<VocalRange, string> = {
  Soprano: 'S',
  'Mezzo-soprano': 'Mz',
  Alto: 'A',
  Tenor: 'T',
  Baritone: 'Bar',
  Bass: 'B',
};

/** CSS-safe slug per range (used in class names `range-<slug>` and CSS vars `--range-<slug>`). */
export const RANGE_SLUG: Record<VocalRange, string> = {
  Soprano: 'soprano',
  'Mezzo-soprano': 'mezzo',
  Alto: 'alto',
  Tenor: 'tenor',
  Baritone: 'baritone',
  Bass: 'bass',
};

/**
 * Hex colours (same as tokens.css `--range-*`) for canvas/SVG use. Each passes WCAG AA (≥ 4.5:1)
 * with RANGE_TEXT_COLOR on top.
 */
export const RANGE_COLORS: Record<VocalRange, string> = {
  Soprano: '#ff7ab8',
  'Mezzo-soprano': '#c792ff',
  Alto: '#82a8ff',
  Tenor: '#3ed6c2',
  Baritone: '#ffb454',
  Bass: '#ff8a65',
};

/** Text colour to use on top of any RANGE_COLORS background. */
export const RANGE_TEXT_COLOR = '#1a1026';

/** Friendly one-liners for the "not sure?" helper (Matchmaker) and tooltips. */
export const RANGE_INFO: Record<VocalRange, { blurb: string; example: string }> = {
  Soprano: {
    blurb: 'The highest voice type — light, bright and floaty up top.',
    example: 'Think Glinda or Christine Daaé.',
  },
  'Mezzo-soprano': {
    blurb: 'A middle-high voice with a warm, strong belt.',
    example: 'Think Elphaba or Eponine.',
  },
  Alto: {
    blurb: 'The lowest "treble" voice — rich and grounded.',
    example: 'Think Mama Morton or Mrs. Lovett.',
  },
  Tenor: {
    blurb: 'The highest common "bass-clef" voice — bright and ringing.',
    example: 'Think Marius or Evan Hansen.',
  },
  Baritone: {
    blurb: 'The middle, most common lower voice — warm and flexible.',
    example: 'Think Javert or Gaston.',
  },
  Bass: {
    blurb: 'The lowest voice — deep and booming.',
    example: 'Think Joe in Show Boat ("Ol\' Man River").',
  },
};

const RANGE_ALIASES: Record<string, VocalRange> = {
  soprano: 'Soprano',
  sop: 'Soprano',
  s: 'Soprano',
  'mezzo-soprano': 'Mezzo-soprano',
  'mezzo soprano': 'Mezzo-soprano',
  mezzosoprano: 'Mezzo-soprano',
  mezzo: 'Mezzo-soprano',
  mz: 'Mezzo-soprano',
  alto: 'Alto',
  contralto: 'Alto',
  a: 'Alto',
  tenor: 'Tenor',
  ten: 'Tenor',
  t: 'Tenor',
  baritone: 'Baritone',
  bari: 'Baritone',
  bar: 'Baritone',
  bass: 'Bass',
  b: 'Bass',
};

/** Case/accent-insensitive normalisation: "mezzo" → "Mezzo-soprano". Unknown → null. */
export function normalizeVocalRange(value: string | null | undefined): VocalRange | null {
  const key = normalizeText(value).replace(/\s*-\s*/g, '-');
  if (!key) return null;
  return RANGE_ALIASES[key] ?? RANGE_ALIASES[key.replace(/-/g, ' ')] ?? null;
}

export function isVocalRange(value: unknown): value is VocalRange {
  return typeof value === 'string' && (VOCAL_RANGES as readonly string[]).includes(value);
}

/** Index in VOCAL_RANGES (0 = Soprano … 5 = Bass), or -1. */
export function rangeIndex(value: string | null | undefined): number {
  const r = normalizeVocalRange(value);
  return r ? VOCAL_RANGES.indexOf(r) : -1;
}

/** Short label ("Mz") for any string; falls back to the raw value or '?'. */
export function rangeShort(value: string | null | undefined): string {
  const r = normalizeVocalRange(value);
  return r ? RANGE_SHORT[r] : value?.trim() || '?';
}

/** CSS slug ("mezzo") or 'unknown'. */
export function rangeSlug(value: string | null | undefined): string {
  const r = normalizeVocalRange(value);
  return r ? RANGE_SLUG[r] : 'unknown';
}

/** CSS colour for a range: `var(--range-mezzo)` (falls back to the muted token). */
export function rangeColorVar(value: string | null | undefined): string {
  const r = normalizeVocalRange(value);
  return r ? `var(--range-${RANGE_SLUG[r]})` : 'var(--range-unknown)';
}

/** Sort comparator by vocal-range order (unknowns last). */
export function compareRanges(a: string | null | undefined, b: string | null | undefined): number {
  const ia = rangeIndex(a);
  const ib = rangeIndex(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
}

// ---------------------------------------------------------------------------
// Genres & sub-genres
// ---------------------------------------------------------------------------

/** Suggested genres (the API accepts any string ≤ 40 chars). */
export const GENRES = ['Comedy', 'Drama', 'Romantic'] as const;

export const GENRE_EMOJI: Record<string, string> = {
  Comedy: '😂',
  Drama: '🎭',
  Romantic: '💘',
};
export const GENRE_FALLBACK_EMOJI = '🎵';

export const SUB_GENRE_EMOJI: Record<string, string> = {
  Satire: '🃏',
  Slapstick: '🍌',
  'Tongue-in-Cheek': '😏',
  Irony: '🙃',
  Longing: '🌙',
  Confident: '💪',
  Frustration: '😤',
  'Intimidating / Angry': '🔥',
  Hopeful: '🌅',
  Reflective: '🪞',
  Scared: '😱',
  Power: '⚡',
  Conflict: '⚔️',
  'In Love': '😍',
  Cheated: '💔',
  Missing: '🥀',
};
export const SUB_GENRE_FALLBACK_EMOJI = '✨';

function lookupLoose(map: Record<string, string>, value: string | null | undefined): string | undefined {
  const key = normalizeText(value);
  if (!key) return undefined;
  for (const [k, v] of Object.entries(map)) {
    if (normalizeText(k) === key) return v;
  }
  // tolerate "Tongue in cheek" / "Intimidating/Angry" style variants
  const squash = (s: string) => normalizeText(s).replace(/[^a-z0-9]/g, '');
  const sq = squash(key);
  for (const [k, v] of Object.entries(map)) {
    if (squash(k) === sq) return v;
  }
  return undefined;
}

export function genreEmoji(genre: string | null | undefined): string {
  return lookupLoose(GENRE_EMOJI, genre) ?? GENRE_FALLBACK_EMOJI;
}

export function subGenreEmoji(subGenre: string | null | undefined): string {
  return lookupLoose(SUB_GENRE_EMOJI, subGenre) ?? SUB_GENRE_FALLBACK_EMOJI;
}

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

export const KIND_LABEL: Record<Kind, string> = { solo: 'Solo', duet: 'Duet' };
export const KIND_PLURAL: Record<Kind, string> = { solo: 'Solos', duet: 'Duets' };
export const KIND_EMOJI: Record<Kind, string> = { solo: '🎤', duet: '👯' };

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const COMMENT_TAGS: readonly CommentTag[] = ['general', 'tip', 'question', 'performed'];
export const COMMENT_TAG_LABEL: Record<CommentTag, string> = {
  general: 'General',
  tip: 'Tip',
  question: 'Question',
  performed: 'I performed this!',
};
export const COMMENT_TAG_EMOJI: Record<CommentTag, string> = {
  general: '💬',
  tip: '💡',
  question: '❓',
  performed: '🎤',
};
export const COMMENT_MAX_LENGTH = 1000;

export function isCommentTag(value: unknown): value is CommentTag {
  return typeof value === 'string' && (COMMENT_TAGS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// STAR rules
// ---------------------------------------------------------------------------

/** Musical Theatre Solo/Duet time limit (6:00). */
export const TIME_LIMIT_SECONDS = 360;
/** "Close to the limit" threshold (5:30). */
export const WARN_SECONDS = 330;

export const TAEA_URL = 'https://taeacanada.ca/regional-star-fest/';

/** Fallback festival info when /api/meta is unavailable. */
export const DEFAULT_FESTIVAL = {
  name: 'Vancouver Regional STAR Fest',
  date: '2026-12-11',
  venue: 'SFU School for the Contemporary Arts (SFU SCA)',
  url: TAEA_URL,
} as const;

export const RUBRIC_CATEGORIES = [
  'Expression',
  'Characterization',
  'Staging/Choreography',
  'Singing Technique',
  'Transitions',
  'Execution',
] as const;

export const RUBRIC_LEVELS = [
  { score: 4, label: 'Advanced' },
  { score: 3, label: 'Proficient' },
  { score: 2, label: 'Developing' },
  { score: 1, label: 'Emerging' },
] as const;

// Small text helpers shared by the API, import and enrichment scripts.

/**
 * Accent- and case-insensitive folding used for search and matching.
 * NFD-decompose, strip combining marks, lowercase. Curly apostrophes become straight ones
 * so "Don’t" and "Don't" compare equal. Registered in SQLite as the deterministic `fold()`.
 * @param {unknown} value
 * @returns {string|null}
 */
export function fold(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase();
}

// Characters that never belong in user text: C0/C1 controls (tab/newline/CR kept in multiline
// text; a space in single-line text), line/paragraph separators, and invisible format characters —
// zero-width space, BOM and every bidi control: LRM/RLM/ALM, embeddings/overrides (U+202A–U+202E)
// and isolates (U+2066–U+2069). A display name like "\u202Emoc.live" would otherwise render as
// "evil.com" and flip the text after it. Invisible characters are removed outright (the text then
// reads as it looked). ZWJ/ZWNJ (U+200D/U+200C) are kept: emoji sequences and scripts like Persian
// need them.
const INVISIBLE = /[\u200B\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g;
const CONTROL_CHARS_SINGLE_LINE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const JOINERS = /[\u200C\u200D]/;

/** Keep ZWJ/ZWNJ only between two visible characters, and never more than one in a row. */
function tidyJoiners(s) {
  if (!JOINERS.test(s)) return s;
  return s
    .replace(/[\u200C\u200D]{2,}/g, (m) => m[0])
    .replace(/(^|\s)[\u200C\u200D]+/g, '$1')
    .replace(/[\u200C\u200D]+(?=\s|$)/g, '');
}

/** `s` without ZWJ/ZWNJ — for checks (URL/email filters) that invisible joiners must not dodge. */
export function withoutJoiners(s) {
  return String(s).replace(/[\u200C\u200D]/g, '');
}

/**
 * Trim + NFC-normalize + strip control/bidi characters. Empty string → null.
 * @param {unknown} value
 * @param {{ multiline?: boolean }} [opts]
 * @returns {string|null}
 */
export function cleanText(value, { multiline = false } = {}) {
  if (value === null || value === undefined) return null;
  let s = String(value).normalize('NFC').replace(INVISIBLE, '');
  s = multiline
    ? s.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '')
    : s.replace(CONTROL_CHARS_SINGLE_LINE, ' ').replace(/\s+/g, ' ');
  s = tidyJoiners(s).trim();
  return s === '' ? null : s;
}

/** Escape LIKE wildcards for use with `ESCAPE '\\'`. */
export function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * Parse a song length. Accepts "m:ss" (e.g. "2:33" → 153), a whole number of seconds (number),
 * or a numeric string of seconds. Returns null for empty input, NaN for invalid input.
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseLength(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isInteger(value) ? value : Number.NaN;
  const s = String(value).trim();
  if (s === '') return null;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,4})$/.exec(s);
  if (m) return Number(m[1]);
  return Number.NaN;
}

/** 153 → "2:33"; null → "" */
export function formatLength(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

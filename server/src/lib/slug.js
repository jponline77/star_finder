/**
 * slugify per SPEC §4 (server, client and seed files must agree):
 * NFD-fold accents, lowercase, delete apostrophes (' and ’), replace every run of chars outside
 * [a-z0-9] with '-', trim leading/trailing '-'.
 *   "Les Misérables" → "les-miserables", "Something's Afoot" → "somethings-afoot".
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slug that is unique according to `isTaken(slug)`: appends -2, -3… on collision.
 * Falls back to "show" when the name has no slug-able characters. An all-digit slug (a show called
 * "13" or "1776") would be read as a show id by /api/shows/:idOrSlug, so it becomes "13-show".
 * @param {string} name
 * @param {(slug: string) => boolean} isTaken
 */
export function uniqueSlug(name, isTaken) {
  let base = slugify(name) || 'show';
  if (/^\d+$/.test(base)) base = `${base}-show`;
  if (!isTaken(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!isTaken(candidate)) return candidate;
  }
}

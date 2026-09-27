// iTunes Search API helpers + a match scorer. Shared by the /api/lookup/itunes endpoint and the
// bulk enrichment script (scripts/enrich.js). Wrong audio is worse than no audio: the scorer is
// deliberately strict about the show and about karaoke/instrumental/cover versions.
//
// Score guide (0–100):
//   ≥ 85  strong match — exact/near-exact title AND the show's words in the album/artist
//   70–84 probable match (e.g. title is a close variant, or no cast-recording words)
//   < 60  do not auto-accept (wrong show, wrong reprise-ness, karaoke/cover/instrumental…)
//   ≤ 40  hard cap when none of the show's significant words appear in album or artist

const SEARCH_URL = 'https://itunes.apple.com/search';
const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const USER_AGENT = 'STARSongFinder/1.0 (school musical theatre song finder)';

/**
 * @typedef {object} ItunesCandidate
 * @property {number} trackId
 * @property {string} trackName
 * @property {string} collectionName
 * @property {number|null} collectionId
 * @property {string} artistName
 * @property {string|null} previewUrl       30-second preview (https, *.itunes.apple.com / *.mzstatic.com)
 * @property {string|null} artworkUrl       600×600 artwork on *.mzstatic.com
 * @property {string|null} appleMusicUrl    trackViewUrl
 * @property {number|null} durationSeconds
 * @property {number|null} trackNumber
 * @property {number|null} discNumber
 * @property {string|null} releaseDate
 * @property {string|null} country
 * @property {number} [score]               0–100, set by searchItunes when {title, show} are given
 */

/**
 * Normalize text for matching: accent-fold, lowercase, "&" → "and", apostrophes removed
 * ("Don't" → "dont"), every other non-alphanumeric run → one space, trimmed.
 * @param {string|null|undefined} str
 * @returns {string}
 */
export function normalizeForMatch(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['‘’ʼ`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'at', 'with']);

/**
 * Significant words of a show name: normalized, minus articles/stopwords ("The Book of Mormon" →
 * ["book", "mormon"], "Smash!" → ["smash"]). Falls back to all words if everything is a stopword.
 * @param {string} show
 * @returns {string[]}
 */
export function showSignificantWords(show) {
  const words = normalizeForMatch(show).split(' ').filter(Boolean);
  const sig = words.filter((w) => !STOPWORDS.has(w));
  return sig.length ? sig : words;
}

// Words that show an album is a cast/film recording of a musical.
const CAST_WORDS = [
  'original', 'broadway', 'london', 'west end', 'cast', 'recording', 'musical', 'soundtrack', 'revival',
  'company', 'concert', 'motion picture', 'world premiere', 'studio cast',
];

// Versions we never want (backing tracks are for performing, not for previews; covers aren't the show).
const BAD_PATTERNS = [
  /\bkaraoke\b/, /\binstrumental\b/, /\bbacking tracks?\b/, /\btribute\b/, /\bmade famous\b/, /\bcovers?\b/,
  /\blullab(y|ies)\b/, /\bpiano\b/, /\boriginally performed\b/, /\bin the style of\b/, /\bworkout\b/,
  /\baccompaniment\b/, /\bsing ?a ?long\b/, /\bminus one\b/, /\bperformance tracks?\b/, /\bmusic box\b/,
  /\b8 ?bit\b/, /\bmeditation\b/, /\bsleep\b/, /\bcommentary\b/, /\binterview\b/, /\btalking\b/,
];
const SOFT_BAD_PATTERNS = [/\bremix\b/, /\bdance mix\b/, /\bclub mix\b/, /\bdemo\b/];

const isReprise = (normalized) => /\breprise\b/.test(normalized);

/** Remove (...) / [...] groups and " - From ..." style suffixes, returning the core title. */
function coreTitle(raw) {
  let s = String(raw ?? '');
  s = s.replace(/\s[-–—]\s(from|live|feat|featuring)\b.*$/i, '');
  s = s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  return normalizeForMatch(s);
}

function wordsOf(s) {
  return s.split(' ').filter(Boolean);
}

function dice(a, b) {
  const A = new Set(wordsOf(a));
  const B = new Set(wordsOf(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/** true if `needle` occurs in `hay` on word boundaries (both normalized). */
function containsWords(hay, needle) {
  if (!needle) return false;
  return (' ' + hay + ' ').includes(' ' + needle + ' ');
}

/** Title similarity 0–60. */
function titleScore(trackName, title) {
  const tFull = normalizeForMatch(trackName);
  const qFull = normalizeForMatch(title);
  if (!tFull || !qFull) return 0;

  // A reprise only matches a reprise (checked on the full names, incl. parentheticals).
  if (isReprise(tFull) !== isReprise(qFull)) return 5;

  if (tFull === qFull) return 60;
  const tCore = coreTitle(trackName);
  const qCore = coreTitle(title);
  if (tCore && tCore === qCore) return 56;
  if (tCore === qFull || tFull === qCore) return 54;

  // Medleys / slashes: "I Know Those Eyes/This Man Is Dead".
  const qSegs = String(title).split(/\s*\/\s*/).map(coreTitle).filter(Boolean);
  const tSegs = String(trackName).split(/\s*\/\s*/).map(coreTitle).filter(Boolean);
  if (qSegs.length > 1 && qSegs.every((seg) => containsWords(tFull, seg))) return 54;
  if (tSegs.length > 1 && tSegs.some((seg) => seg === qCore)) return 46;
  if (qSegs.length > 1 && qSegs.some((seg) => seg === tCore)) return 44;

  // One contains the other on word boundaries ("Prologue: What Have I Done" ⊃ "What Have I Done").
  const tw = wordsOf(tCore).length;
  const qw = wordsOf(qCore).length;
  if (tCore && qCore && (containsWords(tCore, qCore) || containsWords(qCore, tCore))) {
    const ratio = Math.min(tw, qw) / Math.max(tw, qw);
    return Math.round(28 + 20 * ratio);
  }
  return Math.round(40 * dice(tCore || tFull, qCore || qFull));
}

/**
 * Score how likely an iTunes track is the requested song from the requested show (0–100).
 *
 * - Title (0–60): exact normalized match 60; core match ignoring (…)/[…]/" - From …" 56;
 *   medley/slash handling; word-boundary containment 28–48; otherwise word-overlap × 40.
 *   A reprise only matches a reprise (mismatch → 5).
 * - Show (0–25): share of the show's significant words (leading "The"/"A"/"!" dropped) found in
 *   collectionName (+ artistName, at 80 % weight).
 * - Cast recording (0–15): +5 per cast word in collection/artist (Original, Broadway, London, Cast,
 *   Recording, Musical, Soundtrack, Revival, Company, Concert…), max 15.
 * - Penalties: −70 for Karaoke/Instrumental/Backing Track/Tribute/Made Famous/Cover/Lullaby/Piano/
 *   Originally Performed/In the Style of/Workout/Commentary (and similar) in track/collection/artist, unless that
 *   word is part of the requested title/show; −20 for remix/demo.
 * - Caps: no show word found → max 40; less than half the show words → max 65.
 * - Optional `lengthSeconds`: +3 when the track duration is within 20 s.
 *
 * @param {Pick<ItunesCandidate, 'trackName'|'collectionName'|'artistName'> & { durationSeconds?: number|null }} candidate
 * @param {{ title: string, show: string, lengthSeconds?: number|null }} target
 * @returns {number} integer 0–100
 */
export function scoreCandidate(candidate, { title, show, lengthSeconds = null }) {
  const trackName = candidate?.trackName ?? '';
  const collection = normalizeForMatch(candidate?.collectionName);
  const artist = normalizeForMatch(candidate?.artistName);
  const track = normalizeForMatch(trackName);

  let score = titleScore(trackName, title);

  // Show words.
  const sig = showSignificantWords(show);
  let ratio = 0;
  if (sig.length) {
    const collWords = new Set(wordsOf(collection));
    const artistWords = new Set(wordsOf(artist));
    let found = 0;
    for (const w of sig) {
      if (collWords.has(w)) found += 1;
      else if (artistWords.has(w)) found += 0.8;
    }
    // Whole show name as a phrase also counts (handles "spamalot" inside "monty pythons spamalot").
    const phrase = normalizeForMatch(show).replace(/^(the|a|an) /, '');
    const squashed = phrase.replace(/ /g, '');
    if (phrase && (containsWords(collection, phrase) || (squashed.length >= 6 && collection.replace(/ /g, '').includes(squashed)))) {
      found = sig.length;
    }
    ratio = found / sig.length;
  }
  score += 25 * ratio;

  // Cast-recording words.
  const hay = `${collection} ${artist}`;
  let castHits = 0;
  for (const w of CAST_WORDS) if (containsWords(hay, w)) castHits++;
  score += Math.min(15, castHits * 5);

  // Penalties.
  const requested = `${normalizeForMatch(title)} ${normalizeForMatch(show)}`;
  const all = `${track} | ${collection} | ${artist}`;
  for (const re of BAD_PATTERNS) {
    if (re.test(all) && !re.test(requested)) score -= 70;
  }
  for (const re of SOFT_BAD_PATTERNS) {
    if (re.test(all) && !re.test(requested)) score -= 20;
  }

  if (lengthSeconds && candidate?.durationSeconds && Math.abs(candidate.durationSeconds - lengthSeconds) <= 20) score += 3;

  if (ratio === 0) score = Math.min(score, 40);
  else if (ratio < 0.5) score = Math.min(score, 65);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Map a raw iTunes result to an ItunesCandidate. */
export function mapItunesResult(r) {
  const art = r.artworkUrl100 || r.artworkUrl60 || null;
  return {
    trackId: r.trackId,
    trackName: r.trackName ?? '',
    collectionName: r.collectionName ?? r.collectionCensoredName ?? '',
    collectionId: r.collectionId ?? null,
    artistName: r.artistName ?? '',
    previewUrl: r.previewUrl ?? null,
    artworkUrl: art ? art.replace(/\/\d+x\d+(bb)?(-\d+)?\.(jpg|png|webp)$/i, '/600x600bb.jpg') : null,
    appleMusicUrl: r.trackViewUrl ?? null,
    durationSeconds: Number.isFinite(r.trackTimeMillis) ? Math.round(r.trackTimeMillis / 1000) : null,
    trackNumber: r.trackNumber ?? null,
    discNumber: r.discNumber ?? null,
    releaseDate: r.releaseDate ?? null,
    country: r.country ?? null,
  };
}

async function getJson(url, fetchImpl, timeoutMs) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`iTunes request failed (HTTP ${res.status})`);
  // iTunes sometimes answers with text/javascript; parse the text ourselves.
  return JSON.parse(await res.text());
}

/** Search term: title + show (with a leading "The " dropped), parentheticals removed from the title. */
export function buildSearchTerm(title, show) {
  const t = String(title ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const s = String(show ?? '').replace(/^the\s+/i, '').replace(/!/g, '').trim();
  return `${t} ${s}`.trim();
}

/**
 * One iTunes Search API call (entity=song, limit 25). Candidates are scored against {title, show}
 * and sorted best first (ties keep iTunes order).
 * @param {{ title: string, show: string, country?: string, limit?: number, term?: string, lengthSeconds?: number|null }} query
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<ItunesCandidate[]>}
 */
export async function searchItunes({ title, show, country = 'CA', limit = 25, term, lengthSeconds = null }, fetchImpl = globalThis.fetch) {
  const params = new URLSearchParams({
    term: term ?? buildSearchTerm(title, show),
    country,
    media: 'music',
    entity: 'song',
    limit: String(limit),
  });
  const data = await getJson(`${SEARCH_URL}?${params}`, fetchImpl, 10_000);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .filter((r) => r && r.wrapperType === 'track' && r.kind === 'song' && r.trackId)
    .map(mapItunesResult)
    .map((c, i) => ({ ...c, score: scoreCandidate(c, { title, show, lengthSeconds }), _i: i }))
    .sort((a, b) => b.score - a.score || a._i - b._i)
    .map(({ _i, ...c }) => c);
}

/**
 * All tracks of an album (e.g. a cast recording) via the Lookup API.
 * @param {number|string} collectionId
 * @param {typeof fetch} [fetchImpl]
 * @param {{ country?: string }} [opts]
 * @returns {Promise<ItunesCandidate[]>} tracks in album order (disc, track)
 */
export async function lookupCollectionTracks(collectionId, fetchImpl = globalThis.fetch, { country = 'CA' } = {}) {
  const params = new URLSearchParams({ id: String(collectionId), entity: 'song', limit: '200', country });
  const data = await getJson(`${LOOKUP_URL}?${params}`, fetchImpl, 10_000);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results
    .filter((r) => r && r.wrapperType === 'track' && r.trackId)
    .map(mapItunesResult)
    .sort((a, b) => (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
}

/**
 * Search CA first, then US if CA has no candidate scoring ≥ 60; merge (dedupe by trackId), keep
 * only candidates with a usable https preview, sort by score, return the top `top`.
 * @param {{ title: string, show: string, lengthSeconds?: number|null }} query
 * @param {typeof fetch} [fetchImpl]
 * @param {{ top?: number }} [opts]
 * @returns {Promise<ItunesCandidate[]>}
 */
export async function findItunesCandidates({ title, show, lengthSeconds = null }, fetchImpl = globalThis.fetch, { top = 8 } = {}) {
  let all = [];
  let lastError = null;
  for (const country of ['CA', 'US']) {
    try {
      const found = await searchItunes({ title, show, country, lengthSeconds }, fetchImpl);
      all = all.concat(found);
      if (found.some((c) => c.score >= 60 && c.previewUrl)) break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!all.length && lastError) throw lastError;
  const seen = new Set();
  return all
    .filter((c) => {
      if (seen.has(c.trackId)) return false;
      seen.add(c.trackId);
      return isUsablePreviewUrl(c.previewUrl);
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}

/** https on *.itunes.apple.com or *.mzstatic.com */
export function isUsablePreviewUrl(u) {
  try {
    const url = new URL(u);
    const h = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (h === 'itunes.apple.com' || h.endsWith('.itunes.apple.com') || h.endsWith('.mzstatic.com'));
  } catch {
    return false;
  }
}

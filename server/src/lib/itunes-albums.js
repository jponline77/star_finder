// Cast-album finder shared by the bulk enrichment script (scripts/enrich.js) and the catalog API
// (routes/catalog.js): search iTunes for a show's recordings, keep only albums that really are a
// recording of that show (cast / studio / concept / concert, optionally film), rank them, and match
// album track names against song titles. Wrong audio is worse than no audio, so the tests are strict.
import { normalizeForMatch as norm } from './itunes.js';

const USER_AGENT = 'STARSongFinder/1.0 (school musical theatre song finder)';

const words = (s) => s.split(' ').filter(Boolean);
const containsWords = (hay, needle) => Boolean(needle) && (' ' + hay + ' ').includes(' ' + needle + ' ');
const squash = (s) => s.replace(/ /g, '');
const dropArticle = (s) => s.replace(/^(the|a|an) /, '');

function dice(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// ---------------------------------------------------------------------------------------------
// Album classification
// ---------------------------------------------------------------------------------------------
const BAD_ALBUM = [
  /\bkaraoke\b/, /\binstrumentals?\b/, /\bbacking tracks?\b/, /\btribute\b/, /\bmade famous\b/, /\bcovers?\b/,
  /\blullab(y|ies)\b/, /\bpiano\b/, /\boriginally performed\b/, /\bin the style of\b/, /\bworkout\b/, /\bguitar\b/,
  /\baccompaniment\b/, /\bsing ?a ?long\b/, /\bminus one\b/, /\bperformance tracks?\b/, /\bmusic box\b/, /\bstrings?\b/,
  /\b8 ?bit\b/, /\bmeditation\b/, /\bsleep\b/, /\bcommentary\b/, /\binterview\b/, /\btalking\b/, /\bjazz\b/,
  /\bholiday\b/, /\bchristmas\b/, /\bviolin\b/, /\borchestral suite\b/, /\bsongbook\b/, /\bthe songs of\b/,
  /\bplays\b/, /\bsings\b/, /\bbluegrass\b/, /\bmedley\b/, /\bparody\b/, /\bradio edit\b/, /\bremix(es)?\b/,
  /\bchoir\b/, /\bchoral\b/, /\bfor kids\b/, /\blounge\b/, /\baudiobook\b/, /\bunabridged\b/, /\bhits of\b/,
  /\bgreatest\b/, /\bbest of\b/, /\bselections from\b/,
];
const FOREIGN_CAST = [
  /\b(besetzung|deutsche|german|deutsch|wiener|wien|vienna|hamburg|stuttgart|berlin|st gallen|francaise|french|version francaise|dutch|nederlandse|japanese|japan|tokyo|takarazuka|shiki|toho|korean|korea|seoul|svenska|swedish|espanol|spanish|en espanol|elenco|argentina|buenos aires|mexico|madrid|italiano|italian|hungarian|czech|polish|polska|danish|norwegian|finnish|suomi|brasil|brazil|portugues|hebrew|chinese|mandarin|russian|estonian|icelandic)\b/,
  // German-language houses and cities that release cast albums ("Come from Away (2025 Theater
  // Regensburg Original Cast)" is sung in German).
  /\b(originalbesetzung|musiktheater|stadttheater|staatstheater|landestheater|volksoper|ronacher|raimund ?theater|regensburg|bonn|magdeburg|linz|bremen|dresden|leipzig|munchen|munich|koln|dusseldorf|tecklenburg|thun|amstetten|salzburg|graz|zurich|basel|kassel|mainz|oberhausen|fussen|essen|bochum|hannover)\b/,
];
const SINGLE_RE = /\b(single|ep)\s*$/;

/**
 * Is this album one we never offer, whatever it's called (karaoke, covers, tribute, a foreign-language
 * cast …)? The same lists classifyAlbum uses, for albums that don't name the show (song-search hits).
 * @param {{ collectionName?: string, artistName?: string }} album
 */
export function isUnwantedAlbum(album) {
  const hay = `${norm(album.collectionName)} | ${norm(album.artistName)}`;
  return BAD_ALBUM.some((re) => re.test(hay)) || FOREIGN_CAST.some((re) => re.test(hay));
}

/**
 * Tier (0–100) for an album name that is a recording of a show, or null if it isn't one.
 * @param {string} n normalized collection name
 */
export function albumTier(n) {
  if (/\b(in concert|concert|anniversary|dream cast|staged concert)\b/.test(n)) return { tier: 72, label: 'concert recording' };
  if (/\b(studio cast|concept (album|recording|cast)|concept|world premiere|premiere recording)\b/.test(n)) return { tier: 82, label: 'studio/concept recording' };
  if (/\boriginal (\d{4} )?(broadway|london|west end|off broadway|new york|australian|cast|uk)\b.*\b(cast|company|recording)\b|\boriginal cast\b/.test(n)
    && !/\b(revival|new broadway|new london|new york revival|\d{4} broadway|encore)\b/.test(n)) {
    return { tier: /\blive\b/.test(n) ? 90 : 100, label: 'original cast recording' };
  }
  if (/\b(revival|new broadway|new london|\d{4} broadway|\d{4} london|encore|west end cast|broadway cast|london cast|cast recording|cast album|cast)\b/.test(n)) {
    return { tier: 88, label: 'cast recording' };
  }
  if (/\b(motion picture|soundtrack|original score|film|movie)\b/.test(n)) return { tier: 62, label: 'film soundtrack', film: true };
  if (/\b(musical|recording|highlights)\b/.test(n)) return { tier: 60, label: 'recording' };
  return null;
}

export const LEAD_TRAILERS = / (the )?(musical|highlights|live|in concert|the broadway musical|a new musical|the new musical|original cast)$/;

/** The album-name "lead": the part before "(", "[", ":" or " - ", normalized, without a leading article. */
export function albumLead(collectionName) {
  const cut = String(collectionName ?? '').split(/\s*[([:]\s*|\s+[-–—]\s+/)[0];
  return dropArticle(norm(cut)).replace(LEAD_TRAILERS, '');
}

/** Does the album's lead name the show? ("Monty Python's Spamalot" ⊃ "spamalot" via a possessive is OK.) */
function leadMatches(lead, accepted) {
  for (const x of accepted) {
    if (!x) continue;
    if (same(lead, x)) return true;
    // "<someone>'s <show>" / "<someone>'s the <show>" (possessive prefix, e.g. "disneys the hunchback…")
    const m = lead.match(new RegExp(`^(.+) (the )?${x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    if (m && /s$/.test(m[1].replace(/ the$/, '').split(' ').pop())) return true;
  }
  return false;
}

/**
 * Is `album` a usable recording of `show`? Returns { tier, label, rank } or null.
 * @param {{ collectionName: string, artistName: string }} album
 * @param {{ leads: string[], cfg: object }} showInfo
 */
export function classifyAlbum(album, showInfo) {
  const n = norm(album.collectionName);
  const a = norm(album.artistName);
  const hay = `${n} | ${a}`;
  const { cfg } = showInfo;
  if (!leadMatches(albumLead(album.collectionName), showInfo.leads)) return null;
  if (BAD_ALBUM.some((re) => re.test(hay))) return null;
  if (FOREIGN_CAST.some((re) => re.test(hay))) return null;
  if (cfg.exclude && cfg.exclude.test(hay)) return null;
  const t = albumTier(n) ?? (cfg.leads?.length ? { tier: 55, label: 'recording' } : null);
  if (!t) return null;
  if (t.film && !cfg.film) return null;
  let rank = t.tier;
  for (const [re, bonus] of cfg.prefer ?? []) if (re.test(n)) rank += bonus;
  if (/\bhighlights\b/.test(n)) rank -= 8;
  if (SINGLE_RE.test(n)) rank -= 20;
  return { tier: t.tier, label: t.label, rank };
}

// ---------------------------------------------------------------------------------------------
// Title matching
// ---------------------------------------------------------------------------------------------
const REPRISE_RE = /\breprise\b/;
// Parentheticals that distinguish one version/section of a song from another.
const DISTINGUISHER_RE = /^(act|part|pt|no|version|reprise|finale)\b|\b(act|part|pt)\s*(\d+|one|two|three|i{1,3}|iv)\b|\breprise\b|\bversion\b|^(\d+|i{1,3}|iv)$/;
// Words in a track name that suggest it isn't a straight performance of the song.
const SUSPECT_RE = /\b(demo|instrumental|karaoke|underscore|playoff|play off|remix|acoustic|radio edit|pop version|dialogue|alternate|alt take|extended|ringtone|commentary|interview|backing|accompaniment|track by track|exit music|bows|curtain call|utterance|spoken|single version|end credits?|end title|credits version|intro|outro|introduction|segue|underscoring|play ?out)\b/;

export function parentheticals(raw) {
  return [...String(raw ?? '').matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map((m) => norm(m[1] ?? m[2])).filter(Boolean);
}

/** Title without (...)/[...] groups and " - From ..." / " - Live" suffixes. */
export function coreOf(raw) {
  let s = String(raw ?? '');
  s = s.replace(/\s[-–—]\s(from|live|feat|featuring|original|bonus)\b.*$/i, '');
  s = s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  return norm(s);
}

/** Sections of a name: parenthetical contents + parts split on / : ; – — and " - ". */
function segmentsOf(raw) {
  const s = String(raw ?? '');
  const out = parentheticals(s);
  const outside = s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  for (const p of outside.split(/\s*[/:;–—]\s*|\s+-\s+/)) out.push(norm(p));
  return out.filter(Boolean);
}

function distinguishers(raw) {
  return parentheticals(raw).filter((p) => DISTINGUISHER_RE.test(p) && !/^reprise$/.test(p)).sort().join('|');
}

const same = (x, y) => Boolean(x) && Boolean(y) && (x === y || squash(x) === squash(y) || dropArticle(x) === dropArticle(y));

/**
 * How well does an album track name match a song title? Returns { level, how } (level 70–100) or null.
 *   100 exact · 96 punctuation/article variant · 94 same ignoring parentheticals · 90 title is a section
 *   of the track (e.g. "Fantine's Death: Come to Me") or all medley parts present · 88 known alias /
 *   title's own subtitle · 78 track is one part of a medley title · 72 fuzzy (≥ 80 % word overlap).
 *   A reprise only matches a reprise; demo/instrumental/playoff-style tracks lose 25.
 * @param {string} trackName
 * @param {string} title
 * @param {string[]} [aliases]
 */
export function matchTitle(trackName, title, aliases = []) {
  const tN = norm(trackName);
  const qN = norm(title);
  if (!tN || !qN) return null;
  if (REPRISE_RE.test(tN) !== REPRISE_RE.test(qN)) return null;
  const tC = coreOf(trackName);
  const qC = coreOf(title);
  const tSegs = segmentsOf(trackName);
  const qSegs = segmentsOf(title);
  const qParens = parentheticals(title);
  const sameDistinguishers = distinguishers(trackName) === distinguishers(title);

  let level = 0;
  let how = '';
  if (tN === qN) [level, how] = [100, 'exact title'];
  else if (same(tN, qN)) [level, how] = [96, 'same title (punctuation/article)'];
  else if (sameDistinguishers && same(tC, qC)) [level, how] = [94, 'same title ignoring parenthetical'];
  else if (sameDistinguishers && qC && tSegs.some((seg) => same(seg, qC))) [level, how] = [90, 'title is a section of the track name'];
  else if (qSegs.length > 1 && !qParens.length && qSegs.every((seg) => containsWords(tN, seg))) [level, how] = [90, 'every part of the medley title is in the track'];
  else if (aliases.some((al) => same(norm(al), tN) || same(norm(al), tC) || tSegs.some((seg) => same(seg, norm(al))))) [level, how] = [88, 'known alternate title'];
  else if (qParens.some((p) => !DISTINGUISHER_RE.test(p) && words(p).length >= 2 && (same(p, tC) || same(p, tN)))) [level, how] = [88, "track uses the title's subtitle"];
  else if (qSegs.length > 1 && !qParens.length && qSegs.some((seg) => words(seg).length >= 2 && same(seg, tC))) [level, how] = [78, 'track is one part of the medley title'];
  else if (sameDistinguishers && tC && qC && Math.min(words(tC).length, words(qC).length) >= 2 && dice(tC, qC) >= 0.8) [level, how] = [72, 'close title (word overlap)'];
  if (!level) return null;
  if (SUSPECT_RE.test(tN) && !SUSPECT_RE.test(qN)) {
    level -= 25;
    how += ' (alternate version)';
  }
  return level >= 70 ? { level, how } : null;
}

// ---------------------------------------------------------------------------------------------
// iTunes album search
// ---------------------------------------------------------------------------------------------
const requestInit = () => ({ headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });

export async function searchAlbums(term, country, fetchImpl) {
  const params = new URLSearchParams({ term, country, media: 'music', entity: 'album', attribute: 'albumTerm', limit: '50' });
  const res = await fetchImpl(`https://itunes.apple.com/search?${params}`, requestInit());
  if (!res.ok) throw new Error(`iTunes album search failed (HTTP ${res.status})`);
  const data = JSON.parse(await res.text());
  return (Array.isArray(data?.results) ? data.results : [])
    .filter((r) => r && r.wrapperType === 'collection' && r.collectionId)
    .map((r) => ({
      collectionId: r.collectionId,
      collectionName: r.collectionName ?? '',
      artistName: r.artistName ?? '',
      collectionExplicitness: r.collectionExplicitness ?? null,
      trackCount: r.trackCount ?? null,
      releaseDate: r.releaseDate ?? null,
      country,
    }));
}

/** Albums (collections) that the tracks of a song search come from. */
export async function discoverAlbumsViaSongs(term, country, fetchImpl) {
  const params = new URLSearchParams({ term, country, media: 'music', entity: 'song', limit: '50' });
  const res = await fetchImpl(`https://itunes.apple.com/search?${params}`, requestInit());
  if (!res.ok) throw new Error(`iTunes song search failed (HTTP ${res.status})`);
  const data = JSON.parse(await res.text());
  const out = new Map();
  for (const r of Array.isArray(data?.results) ? data.results : []) {
    if (!r || r.wrapperType !== 'track' || !r.collectionId || out.has(r.collectionId)) continue;
    out.set(r.collectionId, {
      collectionId: r.collectionId,
      collectionName: r.collectionName ?? '',
      artistName: r.collectionArtistName ?? r.artistName ?? '',
      collectionExplicitness: r.collectionExplicitness ?? null,
      trackCount: r.trackCount ?? null,
      releaseDate: r.releaseDate ?? null,
      country,
    });
  }
  return [...out.values()];
}

/**
 * What to search for and which album names count as "named after the show".
 * @param {string} showName
 * @param {{ search?: string, leads?: string[], film?: boolean, prefer?: [RegExp, number][], exclude?: RegExp,
 *   extraTerms?: string[], note?: (album: object) => string|null }} [cfg] per-show tweaks (see scripts/enrich.js)
 * @returns {{ name: string, base: string, leads: string[], cfg: object }}
 */
export function showInfo(showName, cfg = {}) {
  // "¡Americano!" → "Americano": Apple's search doesn't match on the punctuation
  const base = cfg.search ?? showName.replace(/^(the|a|an)\s+/i, '').replace(/[!¡¿]/g, '').trim();
  const phrase = dropArticle(norm(showName)).replace(LEAD_TRAILERS, '');
  const leads = [phrase, ...(cfg.leads ?? []).map((l) => dropArticle(norm(l)))];
  return { name: showName, base, leads: [...new Set(leads.filter(Boolean))], cfg };
}

/**
 * Find and rank the show's recordings. Returns albums sorted best first (each with .cls and .country).
 * Defaults (the thorough bulk-enrichment search): album searches "<show> cast / recording /
 * soundtrack / musical" (+ cfg.extraTerms) and song searches "<show>", "<show> original cast" —
 * the album-title search misses some albums (e.g. newer cast albums), so albums are also discovered
 * through a song search for the show's name. CA first, then US only when CA had nothing usable.
 * The website passes a short list and `stopEarly` (stop at the first search that finds an album).
 * @param {{ name: string, base: string, leads: string[], cfg: object }} info from showInfo()
 * @param {typeof fetch} fetchImpl
 * @param {(msg: string, err?: Error) => void} [log]
 * @param {{ terms?: string[], discoveryTerms?: string[], countries?: string[], stopEarly?: boolean }} [opts]
 */
export async function findShowAlbums(info, fetchImpl, log = () => {}, opts = {}) {
  const terms = opts.terms ?? [`${info.base} cast`, `${info.base} recording`, `${info.base} soundtrack`, `${info.base} musical`, ...(info.cfg.extraTerms ?? [])];
  const discoveryTerms = opts.discoveryTerms ?? [info.base, `${info.base} original cast`];
  const stopEarly = Boolean(opts.stopEarly);
  let accepted = [];
  for (const country of opts.countries ?? ['CA', 'US']) {
    const seen = new Set(accepted.map((a) => a.collectionId));
    const consider = (album) => {
      if (seen.has(album.collectionId)) return;
      seen.add(album.collectionId);
      const cls = classifyAlbum(album, info);
      if (cls) accepted.push({ ...album, cls });
    };
    for (const term of terms) {
      if (stopEarly && accepted.length) break;
      try {
        (await searchAlbums(term, country, fetchImpl)).forEach(consider);
      } catch (err) {
        log(`   ⚠️  album search "${term}" (${country}) failed: ${err.message}`, err);
      }
    }
    for (const term of discoveryTerms) {
      if (stopEarly && accepted.length) break;
      try {
        (await discoverAlbumsViaSongs(term, country, fetchImpl)).forEach(consider);
      } catch (err) {
        log(`   ⚠️  song search "${term}" (${country}) failed: ${err.message}`, err);
      }
    }
    if (accepted.length) break;
  }
  // Collapse editions with the same name (clean/explicit, re-releases): prefer the clean edition
  // (school site), then the earliest release, then more tracks.
  accepted.sort((a, b) => b.cls.rank - a.cls.rank
    || (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999')
    || (b.trackCount ?? 0) - (a.trackCount ?? 0));
  const byName = new Map();
  for (const al of accepted) {
    const k = norm(al.collectionName).replace(/\b(\d{4} )?(remastered|remaster|clean|explicit|edition|expanded)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const prev = byName.get(k);
    if (!prev) byName.set(k, al);
    else if (prev.collectionExplicitness === 'explicit' && al.collectionExplicitness === 'cleaned') byName.set(k, al);
  }
  return [...byName.values()].sort((a, b) => b.cls.rank - a.cls.rank
    || (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999')
    || (b.trackCount ?? 0) - (a.trackCount ?? 0));
}

#!/usr/bin/env node
// Bulk enrichment (network): find 30-second Apple Music previews + album art for songs, and
// (with --shows) posters for shows that have none. Updates the DB and server/seed/media.json.
//
//   node scripts/enrich.js [--missing | --all] [--song <id>] [--show <slug|name>] [--shows]
//                          [--dry-run] [--refresh] [--community] [--db path] [--seed-dir dir] [--media-dir dir]
//
//   --missing   (default) only songs with no preview in the DB. Songs whose media.json value is null
//               (searched, no trustworthy match) are skipped.
//   --all       re-match every song, including the ones marked null ("verified" entries are kept).
//   --song <id> just that song (any source; community songs are updated in the DB only).
//   --show <x>  only songs of that show (slug or name).
//   --shows     also fill missing show posters from Wikipedia (SPEC §5 lookup rules).
//   --dry-run   search and print, but don't download art or write the DB / media.json.
//   --refresh   ignore the on-disk iTunes response cache (server/data/itunes-cache/).
//   --community also fill community songs that have no preview (DB only; never media.json).
//
// Strategy. Wrong audio is worse than no audio, so matching is album-first:
//   1. ALBUM SCAN per show: search iTunes albums ("<show> cast", "... recording", "... soundtrack",
//      "... musical"; CA, then US if CA has nothing usable), keep only albums whose name contains the
//      show's words and reads like a cast / studio / concept / film recording (never karaoke, tribute,
//      instrumental, foreign-language casts…), rank them (original cast > revival > studio/concept >
//      concert > film), fetch their track lists and match each song by normalized title.
//   2. FALLBACK per song: iTunes song search "<title> <show>", accepting a candidate only when the
//      title matches strictly AND its album passes the same album test (or the scorer is ≥ 90).
//   Every request goes through a throttle (≤ 18 requests/min) with retry + exponential backoff on
//   403/429/5xx, and raw responses are cached on disk so reruns are cheap.
//
// Writes: songs.preview_url/artwork_path/apple_music_url/recording_name/recording_artist/
// itunes_track_id (never updated_at/edited_at, so the next import doesn't mistake the row for a website edit),
// server/media/art/<sha256(url)[:16]>.jpg for spreadsheet songs (seed art — not in the repository;
// media.json records each file's artworkUrl so `npm run fetch-media` can download it again), and
// server/seed/media.json keyed "kind|canonical show|canonical title" (SPEC §6). Art and posters for
// community songs/shows (--community, --shows) go to the uploads folder like the website's own
// downloads (not committed; part of the backup). Relative paths resolve from where you run it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, DEFAULT_DB_PATH, SERVER_ROOT } from '../src/db.js';
import { fold } from '../src/lib/text.js';
import {
  normalizeForMatch as norm, showSignificantWords, searchItunes, lookupCollectionTracks, isUsablePreviewUrl, buildSearchTerm,
} from '../src/lib/itunes.js';
import { cacheRemoteImage, downloadRemoteImage } from '../src/lib/remote-image.js';
import { resolveUserPath } from '../src/lib/paths.js';
import { deleteIfUnreferenced } from '../src/lib/uploads.js';
import { lookupWikipedia } from '../src/lib/wikipedia.js';

const DEFAULT_SEED_DIR = path.join(SERVER_ROOT, 'seed');
const DEFAULT_MEDIA_DIR = path.join(SERVER_ROOT, 'media');
const DEFAULT_CACHE_DIR = path.join(SERVER_ROOT, 'data', 'itunes-cache');
const DEFAULT_REPORT = path.join(SERVER_ROOT, 'data', 'enrich-report.json');
const USER_AGENT = 'STARSongFinder/1.0 (school musical theatre song finder)';

const ITUNES_PER_MINUTE = 18;
const ITUNES_MIN_INTERVAL_MS = Math.ceil(60_000 / ITUNES_PER_MINUTE) + 200; // ≈ 3.5 s between requests
const MAX_RETRIES = 5;
const CACHE_TTL_MS = 14 * 24 * 3600 * 1000;
const MAX_ALBUM_LOOKUPS_PER_SHOW = 6;

// ---------------------------------------------------------------------------------------------
// Per-show configuration.
//   search     words to search iTunes with (default: the show name without a leading article)
//   leads      extra accepted album-name "leads" (the part before "(", "[", ":" or " - "); by default
//              an album must be named after the show ("Hadestown (Original Broadway Cast Recording)")
//   film       true = the show was filmed, so a film soundtrack may be used when no stage album has the song
//   prefer     [[regex over the normalized album name, bonus], …]
//   exclude    albums never to use (regex over normalized "album | artist")
//   extraTerms more album searches
//   note       (album) => text appended to verifiedBy
// ---------------------------------------------------------------------------------------------
const SHOW_CONFIG = {
  "Monty Python's Spamalot": { search: 'Spamalot', leads: ['spamalot'] },
  'Shrek The Musical': { search: 'Shrek the Musical', leads: ['shrek'], exclude: /\b(motion picture|shrek 2|shrek the third|forever after)\b/ },
  'Little Shop of Horrors': { film: true },
  Hadestown: {},
  'Into the Woods': { film: true },
  "A Gentleman's Guide to Love and Murder": { search: "Gentleman's Guide Love Murder" },
  // The 1996 Disney film soundtrack has film/pop versions (its "Someday" is the All-4-One single);
  // the stage show is represented by the Studio Cast Recording. The 1993 "Original Cast Recording"
  // and the 1982 TV-movie score are different works.
  'The Hunchback of Notre Dame': { search: 'Hunchback of Notre Dame', exclude: /\b(motion picture|soundtrack|film|television|movie|dennis deyoung)\b/ },
  // Wildhorn's musical premiered in German (St. Gallen, 2009). Apple Music's "(Original Vienna Cast)"
  // album is the English-language "Highlights from the Musical" (English titles and cover; its track
  // lengths match the spreadsheet exactly).
  'The Count of Monte Cristo': {
    search: 'Count of Monte Cristo', extraTerms: ['Monte Cristo Wildhorn'],
    exclude: /\b(motion picture|soundtrack|audiobook|dumas|overture|series)\b/,
    note: (album) => (/\bvienna\b/.test(norm(album.collectionName)) ? 'Apple Music labels the album "Original Vienna Cast", but it is the English-language "Highlights from the Musical" (English titles and cover)' : null),
  },
  'The Scarlet Pimpernel': { search: 'Scarlet Pimpernel' },
  "Something's Afoot": {},
  'The Robber Bridegroom': { search: 'Robber Bridegroom' },
  Curtains: {},
  'Oh What a Lovely War': { search: 'Oh What a Lovely War', film: true },
  // Prefer the 2025 Broadway cast album; otherwise the TV-series soundtracks.
  Smash: {
    extraTerms: ['Bombshell Smash', 'Music of Smash'],
    leads: ['bombshell', 'the music of smash', 'music of smash'],
    exclude: /\b(smash mouth|smashing|smash hits|smash bros|super smash)\b/,
    note: (album) => (/\boriginal broadway cast\b/.test(norm(album.collectionName))
      ? null
      : 'TV-series soundtrack (NBC "Smash"); the song was written for the TV show'),
  },
  'Operation Mincemeat': {},
  // The 1985 Original London Cast album matches the spreadsheet's lengths (e.g. the long "Little People").
  'Les Misérables': { search: 'Les Miserables', film: true, prefer: [[/\boriginal (\d{4} )?london cast\b/, 6]] },
  Cabaret: { film: true },
  Shucked: {},
  'Merrily We Roll Along': {},
  'Mr. Burns, a Post-Electric Play': { search: 'Mr. Burns', leads: ['mr burns'] },
  'The Book of Mormon': { search: 'Book of Mormon' },
};

// Known alternate track names (key: "kind|show|title" as in media.json).
const TITLE_ALIASES = {
  'solo|Les Misérables|What Have I Done?': ["Valjean's Soliloquy", "Valjean's Soliloquy (What Have I Done?)"],
  'solo|Les Misérables|Who Am I?': ['The Trial'],
  'duet|Les Misérables|Come To Me': ["Fantine's Death"],
  'solo|Les Misérables|Javert\'s Suicide': ["Javert's Soliloquy"],
  'duet|Les Misérables|Confrontation': ['The Confrontation'],
  'duet|Something\'s Afoot|Problematical Solution (The Dinghy Song)': ['The Dinghy Song', 'Dinghy'],
  'solo|Oh What a Lovely War|Good Byee': ['Goodbye-ee', 'Good-Byee', 'Goodbyee', 'Good-Bye-Ee'],
};

// ---------------------------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const words = (s) => s.split(' ').filter(Boolean);
const containsWords = (hay, needle) => Boolean(needle) && (' ' + hay + ' ').includes(' ' + needle + ' ');
const squash = (s) => s.replace(/ /g, '');
const dropArticle = (s) => s.replace(/^(the|a|an) /, '');
const ts = () => new Date().toISOString().slice(11, 19);

function mediaKey(kind, show, title) {
  return `${kind}|${show}|${title}`;
}

function dice(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// ---------------------------------------------------------------------------------------------
// Throttled, cached fetch for itunes.apple.com (drop-in fetchImpl for src/lib/itunes.js)
// ---------------------------------------------------------------------------------------------
export function makeItunesFetch({ cacheDir = DEFAULT_CACHE_DIR, useCache = true, ttlMs = CACHE_TTL_MS, log = console.log, stats = {}, fetchImpl = globalThis.fetch, minIntervalMs = ITUNES_MIN_INTERVAL_MS, backoffBaseMs = 8_000 } = {}) {
  let nextAt = 0;
  stats.requests ??= 0;
  stats.cacheHits ??= 0;
  stats.retries ??= 0;
  fs.mkdirSync(cacheDir, { recursive: true });
  return async function itunesFetch(url) {
    const file = path.join(cacheDir, `${sha1(url)}.json`);
    if (useCache) {
      try {
        const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (cached.url === url && Date.now() - Date.parse(cached.fetchedAt) < ttlMs) {
          stats.cacheHits++;
          return new Response(cached.body, { status: 200, headers: { 'content-type': 'application/json' } });
        }
      } catch { /* miss */ }
    }
    for (let attempt = 0; ; attempt++) {
      const wait = nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      nextAt = Date.now() + minIntervalMs;
      stats.requests++;
      let res = null;
      let error = null;
      try {
        res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      } catch (err) {
        error = err;
      }
      if (res?.ok) {
        const body = await res.text();
        try {
          JSON.parse(body);
        } catch {
          error = new Error('invalid JSON from iTunes');
        }
        if (!error) {
          const tmp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }));
          fs.renameSync(tmp, file);
          return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
        }
      }
      const status = res?.status ?? null;
      const retryable = !res || error || status === 403 || status === 429 || status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        if (res && !error) return res;
        throw error ?? new Error(`iTunes request failed (HTTP ${status})`);
      }
      const backoff = Math.min(120_000, backoffBaseMs * 2 ** attempt) + (backoffBaseMs ? Math.floor(Math.random() * 1500) : 0);
      stats.retries++;
      log(`   ⏳ iTunes ${status ?? error?.name ?? 'error'} — retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(backoff / 1000)} s`);
      nextAt = Date.now() + backoff;
    }
  };
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
  /\b(besetzung|deutsche|german|deutsch|wiener|wien|hamburg|stuttgart|berlin|st gallen|francaise|french|version francaise|dutch|nederlandse|japanese|japan|tokyo|takarazuka|korean|korea|seoul|svenska|swedish|espanol|spanish|en espanol|mexico|madrid|italiano|italian|hungarian|czech|polish|polska|danish|norwegian|finnish|suomi|brasil|brazil|portugues|hebrew|chinese|mandarin|russian|estonian|icelandic)\b/,
];
const SINGLE_RE = /\b(single|ep)\s*$/;

/**
 * Tier (0–100) for an album name that is a recording of a show, or null if it isn't one.
 * @param {string} n normalized collection name
 */
function albumTier(n) {
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

const LEAD_TRAILERS = / (the )?(musical|highlights|live|in concert|the broadway musical|a new musical|the new musical|original cast)$/;

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

function parentheticals(raw) {
  return [...String(raw ?? '').matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map((m) => norm(m[1] ?? m[2])).filter(Boolean);
}

/** Title without (...)/[...] groups and " - From ..." / " - Live" suffixes. */
function coreOf(raw) {
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
async function searchAlbums(term, country, fetchImpl) {
  const params = new URLSearchParams({ term, country, media: 'music', entity: 'album', attribute: 'albumTerm', limit: '50' });
  const res = await fetchImpl(`https://itunes.apple.com/search?${params}`);
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
async function discoverAlbumsViaSongs(term, country, fetchImpl) {
  const params = new URLSearchParams({ term, country, media: 'music', entity: 'song', limit: '50' });
  const res = await fetchImpl(`https://itunes.apple.com/search?${params}`);
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

function showInfoFor(showName) {
  const cfg = SHOW_CONFIG[showName] ?? {};
  const base = cfg.search ?? showName.replace(/^(the|a|an)\s+/i, '').replace(/!/g, '').trim();
  const phrase = dropArticle(norm(showName)).replace(LEAD_TRAILERS, '');
  const leads = [phrase, ...(cfg.leads ?? []).map((l) => dropArticle(norm(l)))];
  return { name: showName, base, leads, cfg };
}

/**
 * Find and rank the show's recordings. Returns albums sorted best first (each with .cls).
 */
async function findShowAlbums(info, fetchImpl, log) {
  const terms = [`${info.base} cast`, `${info.base} recording`, `${info.base} soundtrack`, `${info.base} musical`, ...(info.cfg.extraTerms ?? [])];
  // The album-title search misses some albums (e.g. newer cast albums), so also discover albums
  // through a song search for the show's name.
  const discoveryTerms = [info.base, `${info.base} original cast`];
  let accepted = [];
  for (const country of ['CA', 'US']) {
    const seen = new Set(accepted.map((a) => a.collectionId));
    const consider = (album) => {
      if (seen.has(album.collectionId)) return;
      seen.add(album.collectionId);
      const cls = classifyAlbum(album, info);
      if (cls) accepted.push({ ...album, cls });
    };
    for (const term of terms) {
      try {
        (await searchAlbums(term, country, fetchImpl)).forEach(consider);
      } catch (err) {
        log(`   ⚠️  album search "${term}" (${country}) failed: ${err.message}`);
      }
    }
    for (const term of discoveryTerms) {
      try {
        (await discoverAlbumsViaSongs(term, country, fetchImpl)).forEach(consider);
      } catch (err) {
        log(`   ⚠️  song search "${term}" (${country}) failed: ${err.message}`);
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

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------
function confidenceFor(level, via) {
  if (via === 'album-scan') return level >= 85 ? 'high' : 'medium';
  return level >= 94 ? 'high' : 'medium';
}

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

function describe(match) {
  const { track, album, level, how, via, song } = match;
  const bits = [`${via}: ${how} — "${track.trackName}" in ${track.collectionName}`];
  // (No year: Apple's releaseDate is often the reissue/digital date, e.g. 1986 for a 2019 cast album.)
  if (album?.cls) bits.push(`(${album.cls.label})`);
  if (song && track.durationSeconds && song.lengthSeconds) {
    const d = track.durationSeconds - song.lengthSeconds;
    if (Math.abs(d) <= LENGTH_MATCH_SECONDS) bits.push(`— length ${mmss(track.durationSeconds)} matches the spreadsheet`);
    else if (Math.abs(d) >= 45) bits.push(`— recording is ${mmss(track.durationSeconds)} vs ${mmss(song.lengthSeconds)} in the spreadsheet`);
  }
  const note = album && typeof album.note === 'string' ? album.note : null;
  if (note) bits.push(`— ${note}`);
  if (level < 85) bits.push('— review: not an exact title match');
  return bits.join(' ');
}

/**
 * Album-scan every song of one show. Returns Map(songId → match | null) plus the albums used.
 */
async function albumScanShow(info, songs, fetchImpl, log) {
  const albums = await findShowAlbums(info, fetchImpl, log);
  if (!albums.length) {
    log(`   no usable cast/film recording found on iTunes`);
    return { matches: new Map(), albums: [] };
  }
  log(`   ${albums.length} usable album(s); best: ${albums.slice(0, 4).map((a) => `"${a.collectionName}" [${a.cls.rank}]`).join(', ')}`);
  const cands = new Map(songs.map((s) => [s.id, []]));
  const looked = [];
  for (const album of albums) {
    if (looked.length >= MAX_ALBUM_LOOKUPS_PER_SHOW) break;
    // Stop once every song has a strong title match whose length agrees with the spreadsheet.
    const satisfied = (s) => cands.get(s.id).some((c) => c.level >= 94 && (lengthMatches(c.track, s) || !s.lengthSeconds));
    if (songs.every(satisfied)) break;
    let tracks;
    try {
      tracks = await lookupCollectionTracks(album.collectionId, fetchImpl, { country: album.country });
    } catch (err) {
      log(`   ⚠️  lookup of "${album.collectionName}" failed: ${err.message}`);
      continue;
    }
    album.note = info.cfg.note ? info.cfg.note(album) : null;
    looked.push({ album, tracks });
    for (const s of songs) {
      const aliases = TITLE_ALIASES[mediaKey(s.kind, s.show, s.title)] ?? [];
      for (const track of tracks) {
        if (!isUsablePreviewUrl(track.previewUrl)) continue;
        const m = matchTitle(track.trackName, s.title, aliases);
        if (m) cands.get(s.id).push({ ...m, track, album, via: 'album-scan', albumIndex: looked.length - 1 });
      }
    }
  }
  // The album whose track lengths agree with the spreadsheet for the most songs is very likely the
  // recording the spreadsheet was timed from: prefer it for the whole show.
  const hits = looked.map(() => 0);
  for (const s of songs) {
    const counted = new Set();
    for (const c of cands.get(s.id)) {
      if (c.level >= 85 && lengthMatches(c.track, s) && !counted.has(c.albumIndex)) {
        hits[c.albumIndex]++;
        counted.add(c.albumIndex);
      }
    }
  }
  let preferred = -1;
  hits.forEach((h, i) => {
    if (h >= 2 && (preferred < 0 || h > hits[preferred])) preferred = i;
  });
  if (preferred >= 0) log(`   lengths match the spreadsheet for ${hits[preferred]} song(s) on "${looked[preferred].album.collectionName}" → preferred`);
  const matches = new Map();
  for (const s of songs) {
    const list = cands.get(s.id);
    if (!list.length) continue;
    // Strong title matches (≥ 85) first; then the preferred album (one cast for the whole show); then
    // a track whose length agrees with the spreadsheet; then album rank; then the better title match;
    // then the closest length.
    list.sort((a, b) => (b.level >= 85) - (a.level >= 85)
      || (b.albumIndex === preferred) - (a.albumIndex === preferred)
      || lengthMatches(b.track, s) - lengthMatches(a.track, s)
      || a.albumIndex - b.albumIndex
      || b.level - a.level
      || lenDiff(a.track, s) - lenDiff(b.track, s));
    matches.set(s.id, { ...list[0], song: s });
  }
  return { matches, albums: looked.map((l) => l.album) };
}

const LENGTH_MATCH_SECONDS = 3;
/** true when the track's length is within 3 s of the spreadsheet's length. */
function lengthMatches(track, song) {
  return Boolean(track.durationSeconds && song.lengthSeconds && Math.abs(track.durationSeconds - song.lengthSeconds) <= LENGTH_MATCH_SECONDS);
}

function lenDiff(track, song) {
  if (!track.durationSeconds || !song.lengthSeconds) return 0;
  return Math.abs(track.durationSeconds - song.lengthSeconds);
}

/** Per-song fallback search. */
async function fallbackSearch(info, song, fetchImpl, log) {
  const aliases = TITLE_ALIASES[mediaKey(song.kind, song.show, song.title)] ?? [];
  const terms = [buildSearchTerm(song.title, info.base)];
  const best = [];
  for (const country of ['CA', 'US']) {
    for (const term of terms) {
      let cands;
      try {
        cands = await searchItunes({ title: song.title, show: song.show, country, term, lengthSeconds: song.lengthSeconds }, fetchImpl);
      } catch (err) {
        log(`   ⚠️  song search "${term}" (${country}) failed: ${err.message}`);
        continue;
      }
      for (const c of cands) {
        if (!isUsablePreviewUrl(c.previewUrl)) continue;
        const m = matchTitle(c.trackName, song.title, aliases);
        if (!m || m.level < 85) continue;
        const cls = classifyAlbum({ collectionName: c.collectionName, artistName: c.artistName }, info);
        if (!cls && c.score < 90) continue;
        const album = { collectionName: c.collectionName, cls: cls ?? { tier: 0, label: 'album not recognised as a cast recording', rank: 0 }, releaseDate: c.releaseDate };
        album.note = info.cfg.note ? info.cfg.note(album) : null;
        best.push({ ...m, track: c, album, via: 'song-search', score: c.score, song });
      }
    }
    if (best.length) break;
  }
  if (!best.length) return null;
  best.sort((a, b) => lengthMatches(b.track, song) - lengthMatches(a.track, song) || b.album.cls.rank - a.album.cls.rank || b.level - a.level || b.score - a.score);
  const pick = best[0];
  if (!pick.album.cls.tier) pick.level = Math.min(pick.level, 84); // unknown album → medium at most
  return pick;
}

// ---------------------------------------------------------------------------------------------
// media.json
// ---------------------------------------------------------------------------------------------
function readMediaJson(file) {
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file} must be a JSON object`);
  return data;
}

function writeMediaJson(file, data) {
  const keys = Object.keys(data).sort((a, b) => (a.startsWith('_') === b.startsWith('_') ? a.localeCompare(b) : a.startsWith('_') ? -1 : 1));
  const out = {};
  for (const k of keys) out[k] = data[k];
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** Find an existing media.json key for a song (exact, then accent/case-insensitive). */
function findMediaKey(media, key) {
  if (Object.prototype.hasOwnProperty.call(media, key)) return key;
  const f = fold(key);
  return Object.keys(media).find((k) => !k.startsWith('_') && fold(k) === f) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Show posters (--shows)
// ---------------------------------------------------------------------------------------------
async function fillShowImages({ db, mediaDir, uploadsDir, seedDir, dryRun, log, wikiFetchImpl, imageFetchImpl, pause = sleep }) {
  const shows = db.prepare('SELECT id, name, slug, source, wiki_url, image_path FROM shows WHERE image_path IS NULL ORDER BY name').all();
  if (!shows.length) {
    log('🖼️  Every show already has an image.');
    return [];
  }
  const showsJsonPath = path.join(seedDir, 'shows.json');
  const showsJson = fs.existsSync(showsJsonPath) ? JSON.parse(fs.readFileSync(showsJsonPath, 'utf8')) : null;
  let showsJsonChanged = false;
  const results = [];
  const update = db.prepare('UPDATE shows SET image_path = ?, image_credit = ?, image_source_url = ?, wiki_url = COALESCE(wiki_url, ?) WHERE id = ?');
  for (const sh of shows) {
    await pause(1000);
    let info;
    try {
      info = await lookupWikipedia(sh.name, wikiFetchImpl);
    } catch (err) {
      log(`   ⚠️  ${sh.name}: Wikipedia lookup failed (${err.message})`);
      results.push({ show: sh.name, ok: false, reason: err.message });
      continue;
    }
    if (!info.found || !info.imageUrl) {
      log(`   – ${sh.name}: ${info.found ? 'page has no image' : 'no matching Wikipedia page'}`);
      results.push({ show: sh.name, ok: false, reason: info.found ? 'no image' : 'not found' });
      continue;
    }
    if (dryRun) {
      log(`   would use ${info.imageUrl} for ${sh.name}`);
      results.push({ show: sh.name, ok: true, imageUrl: info.imageUrl, dryRun: true });
      continue;
    }
    let publicPath;
    try {
      publicPath = sh.source === 'spreadsheet'
        ? await cacheRemoteImage(info.imageUrl, { mediaDir, subdir: 'shows', prefix: `${sh.slug}-`, fetchImpl: imageFetchImpl })
        : await downloadRemoteImage(info.imageUrl, { uploadsDir, subdir: 'shows', prefix: `${sh.slug}-`, fetchImpl: imageFetchImpl });
    } catch (err) {
      log(`   ⚠️  ${sh.name}: image download failed (${err.message})`);
      results.push({ show: sh.name, ok: false, reason: err.message });
      continue;
    }
    const credit = 'Image via Wikipedia (fair use / see source)';
    update.run(publicPath, credit, info.imageUrl, info.wikiUrl ?? null, sh.id);
    log(`   🖼️  ${sh.name} → ${publicPath}`);
    results.push({ show: sh.name, ok: true, imagePath: publicPath });
    if (showsJson && sh.source === 'spreadsheet') {
      const entry = showsJson.find((e) => e && typeof e.name === 'string' && fold(e.name) === fold(sh.name));
      if (entry && !entry.imageFile) {
        Object.assign(entry, { imageFile: path.basename(publicPath), imageCredit: credit, imageSourceUrl: info.imageUrl });
        if (!entry.wikiUrl && info.wikiUrl) entry.wikiUrl = info.wikiUrl;
        showsJsonChanged = true;
      }
    }
  }
  if (showsJsonChanged) {
    fs.writeFileSync(showsJsonPath, JSON.stringify(showsJson, null, 2) + '\n');
    log(`   updated ${showsJsonPath}`);
  }
  return results;
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { mode: 'missing', songId: null, show: null, shows: false, dryRun: false, refresh: false, community: false, dbPath: null, seedDir: null, mediaDir: null, uploadsDir: null, report: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') o.mode = 'all';
    else if (a === '--missing') o.mode = 'missing';
    else if (a === '--song') o.songId = Number(argv[++i]);
    else if (a === '--show') o.show = argv[++i];
    else if (a === '--shows') o.shows = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--refresh') o.refresh = true;
    else if (a === '--community') o.community = true;
    else if (a === '--db') o.dbPath = argv[++i];
    else if (a === '--seed-dir') o.seedDir = argv[++i];
    else if (a === '--media-dir') o.mediaDir = argv[++i];
    else if (a === '--uploads-dir') o.uploadsDir = argv[++i];
    else if (a === '--report') o.report = argv[++i];
    else if (a === '--cache-dir') o.cacheDir = argv[++i];
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (o.songId !== null && !Number.isInteger(o.songId)) throw new Error('--song needs a numeric song id');
  return o;
}

const HELP = `Usage: node scripts/enrich.js [--missing|--all] [--song <id>] [--show <slug|name>] [--shows] [--dry-run] [--refresh] [--community]
  --missing   (default) only songs without a preview; media.json nulls are respected
  --all       re-match every song (media.json "verified" entries are kept)
  --song <id> only this song      --show <x>  only this show's songs
  --shows     also fill missing show posters from Wikipedia
  --dry-run   don't download art or write the DB / media.json
  --refresh   ignore the cached iTunes responses in server/data/itunes-cache/ (--cache-dir to move it)
  --community also fill community songs without a preview (DB only)`;

/**
 * @param {string[]} [argv]
 * @param {{ fetchImpl?: typeof fetch, imageFetchImpl?: typeof fetch, wikiFetchImpl?: typeof fetch, log?: (m: string) => void,
 *   minIntervalMs?: number, backoffBaseMs?: number, noPause?: boolean }} [deps] injection points for tests
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(HELP);
    return null;
  }
  const log = deps.log ?? ((m) => console.log(m));
  const pause = deps.noPause ? async () => {} : sleep;
  const dbPath = resolveUserPath(opts.dbPath ?? process.env.STAR_DB_PATH ?? DEFAULT_DB_PATH);
  const seedDir = resolveUserPath(opts.seedDir ?? DEFAULT_SEED_DIR);
  const mediaDir = resolveUserPath(opts.mediaDir ?? process.env.STAR_MEDIA_DIR ?? DEFAULT_MEDIA_DIR);
  const uploadsDir = resolveUserPath(opts.uploadsDir ?? process.env.STAR_UPLOADS_DIR ?? path.join(SERVER_ROOT, 'uploads'));
  const mediaJsonPath = path.join(seedDir, 'media.json');
  const reportPath = resolveUserPath(opts.report ?? DEFAULT_REPORT);
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath} — run \`npm run import\` first`);

  const db = openDb(dbPath);
  const stats = {};
  const fetchImpl = makeItunesFetch({
    useCache: !opts.refresh, stats, log, cacheDir: path.resolve(opts.cacheDir ?? DEFAULT_CACHE_DIR),
    fetchImpl: deps.fetchImpl ?? globalThis.fetch, minIntervalMs: deps.minIntervalMs ?? ITUNES_MIN_INTERVAL_MS, backoffBaseMs: deps.backoffBaseMs,
  });
  const media = readMediaJson(mediaJsonPath);
  const started = Date.now();

  try {
    let rows = db.prepare(`SELECT s.id, s.kind, s.title, s.length_seconds AS lengthSeconds, s.preview_url AS previewUrl, s.source,
        s.artwork_path AS artworkPath, s.created_at AS createdAt, s.edited_at AS editedAt, sh.name AS show, sh.slug AS showSlug
      FROM songs s JOIN shows sh ON sh.id = s.show_id ORDER BY sh.name, s.kind DESC, s.title`).all();
    const allSpreadsheetKeys = new Set(rows.filter((r) => r.source === 'spreadsheet').map((r) => fold(mediaKey(r.kind, r.show, r.title))));

    // ---- select songs ----
    const skipped = [];
    let songs;
    if (opts.songId !== null) {
      songs = rows.filter((r) => r.id === opts.songId);
      if (!songs.length) throw new Error(`No song with id ${opts.songId}`);
    } else {
      songs = rows.filter((r) => r.source === 'spreadsheet' || (opts.community && r.source === 'community'));
      if (opts.show) {
        const f = fold(opts.show);
        songs = songs.filter((r) => r.showSlug === opts.show || fold(r.show) === f);
        if (!songs.length) throw new Error(`No songs for show "${opts.show}"`);
      }
      songs = songs.filter((r) => {
        const key = r.source === 'spreadsheet' ? findMediaKey(media, mediaKey(r.kind, r.show, r.title)) : null;
        const entry = key ? media[key] : undefined;
        if (r.source === 'spreadsheet' && r.editedAt) {
          skipped.push({ id: r.id, reason: 'edited on the website' });
          return false;
        }
        if (entry && entry.confidence === 'verified') {
          skipped.push({ id: r.id, reason: 'media.json entry is verified' });
          return false;
        }
        if (opts.mode === 'all') return true;
        if (entry === null) {
          skipped.push({ id: r.id, reason: 'media.json says no match (use --all to retry)' });
          return false;
        }
        return !r.previewUrl;
      });
    }
    log(`🎧 Enriching ${songs.length} song(s) (${opts.mode}${opts.dryRun ? ', dry run' : ''}); ${skipped.length} skipped. iTunes throttle ≤ ${ITUNES_PER_MINUTE}/min.`);

    // Songs whose media.json entry already exists just need the DB updated — when its art is on disk,
    // or can be downloaded by `npm run fetch-media` (artworkUrl), like the import does.
    const updateSong = db.prepare(`UPDATE songs SET preview_url = ?, artwork_path = ?, apple_music_url = ?, recording_name = ?,
      recording_artist = ?, itunes_track_id = ? WHERE id = ?`);
    const results = [];
    const toSearch = [];
    for (const s of songs) {
      const key = s.source === 'spreadsheet' ? findMediaKey(media, mediaKey(s.kind, s.show, s.title)) : null;
      const entry = key ? media[key] : undefined;
      if (opts.mode !== 'all' && opts.songId === null && entry && entry.previewUrl
        && (!entry.artworkFile || entry.artworkUrl || fs.existsSync(path.join(mediaDir, 'art', entry.artworkFile)))) {
        if (!opts.dryRun) {
          updateSong.run(entry.previewUrl, entry.artworkFile ? `/media/art/${entry.artworkFile}` : null, entry.appleMusicUrl ?? null,
            entry.recordingName ?? null, entry.recordingArtist ?? null, entry.itunesTrackId ?? null, s.id);
        }
        results.push({ song: s, status: 'from-media.json', entry });
        continue;
      }
      toSearch.push(s);
    }

    // ---- search, show by show ----
    const byShow = new Map();
    for (const s of toSearch) {
      if (!byShow.has(s.show)) byShow.set(s.show, []);
      byShow.get(s.show).push(s);
    }
    let showIndex = 0;
    for (const [showName, showSongs] of byShow) {
      showIndex++;
      const info = showInfoFor(showName);
      log(`\n[${ts()}] (${showIndex}/${byShow.size}) 🎭 ${showName} — ${showSongs.length} song(s)`);
      let scan = { matches: new Map(), albums: [] };
      let scanFailed = false;
      try {
        scan = await albumScanShow(info, showSongs, fetchImpl, log);
      } catch (err) {
        scanFailed = true;
        log(`   ⚠️  album scan failed: ${err.message}`);
      }
      for (const s of showSongs) {
        let match = scan.matches.get(s.id) ?? null;
        let searchError = scanFailed;
        if (!match || match.level < 85) {
          let fb = null;
          try {
            fb = await fallbackSearch(info, s, fetchImpl, log);
          } catch (err) {
            searchError = true;
            log(`   ⚠️  fallback search failed for "${s.title}": ${err.message}`);
          }
          if (fb && (!match || fb.level > match.level)) match = fb;
        }
        if (!match) {
          log(`   ✗ ${s.kind} "${s.title}" — no trustworthy match`);
          results.push({ song: s, status: searchError ? 'error' : 'unmatched' });
          continue;
        }
        const confidence = confidenceFor(match.level, match.via);
        const verifiedBy = describe(match);
        log(`   ✓ ${s.kind} "${s.title}" → "${match.track.trackName}" (${match.track.collectionName}) [${confidence}, ${match.how}]`);
        results.push({ song: s, status: 'matched', match, confidence, verifiedBy });
      }
    }

    // ---- download art, write DB + media.json ----
    let artDownloaded = 0;
    for (const r of results) {
      if (r.status !== 'matched') continue;
      const { track } = r.match;
      let artworkPath = null;
      if (track.artworkUrl && !opts.dryRun) {
        try {
          const before = fs.existsSync(path.join(mediaDir, 'art')) ? fs.readdirSync(path.join(mediaDir, 'art')).length : 0;
          artworkPath = r.song.source === 'spreadsheet'
            ? await cacheRemoteImage(track.artworkUrl, { mediaDir, subdir: 'art', fetchImpl: deps.imageFetchImpl })
            : await downloadRemoteImage(track.artworkUrl, { uploadsDir, subdir: 'art', fetchImpl: deps.imageFetchImpl });
          const after = fs.existsSync(path.join(mediaDir, 'art')) ? fs.readdirSync(path.join(mediaDir, 'art')).length : 0;
          if (after > before || r.song.source !== 'spreadsheet') {
            artDownloaded++;
            await pause(250);
          }
        } catch (err) {
          log(`   ⚠️  artwork for "${r.song.title}" failed: ${err.message}`);
        }
      }
      r.artworkPath = artworkPath;
      r.entry = {
        itunesTrackId: track.trackId,
        previewUrl: track.previewUrl,
        artworkFile: artworkPath ? path.basename(artworkPath) : null,
        // where artworkFile came from (fetch-media downloads it again on a fresh checkout)
        artworkUrl: artworkPath ? track.artworkUrl : null,
        appleMusicUrl: track.appleMusicUrl ?? null,
        recordingName: track.collectionName || null,
        recordingArtist: track.artistName || null,
        confidence: r.confidence,
        verifiedBy: r.verifiedBy,
        trackName: track.trackName,
        durationSeconds: track.durationSeconds ?? null,
      };
    }

    if (!opts.dryRun) {
      db.transaction(() => {
        for (const r of results) {
          if (r.status === 'matched') {
            const e = r.entry;
            updateSong.run(e.previewUrl, r.artworkPath, e.appleMusicUrl, e.recordingName, e.recordingArtist, e.itunesTrackId, r.song.id);
          } else if (r.status === 'unmatched' && opts.mode === 'all') {
            updateSong.run(null, null, null, null, null, null, r.song.id);
          }
        }
      })();
      // a community song's previous downloaded art (uploads/art) is no longer used
      for (const r of results) {
        const old = r.song.artworkPath;
        const replaced = r.status === 'matched' || (r.status === 'unmatched' && opts.mode === 'all');
        if (replaced && old && old !== (r.artworkPath ?? null)) await deleteIfUnreferenced(db, uploadsDir, old);
      }
      const unmatchedNotes = media._unmatched && typeof media._unmatched === 'object' ? { ...media._unmatched } : {};
      for (const r of results) {
        if (r.song.source !== 'spreadsheet') continue;
        const key = mediaKey(r.song.kind, r.song.show, r.song.title);
        const oldKey = findMediaKey(media, key);
        if (r.status === 'matched') {
          if (oldKey && oldKey !== key) delete media[oldKey];
          media[key] = r.entry;
          delete unmatchedNotes[key];
        } else if (r.status === 'unmatched') {
          if (oldKey && oldKey !== key) delete media[oldKey];
          media[key] = null;
          unmatchedNotes[key] = `No trustworthy match on iTunes (album scan of the show's cast/film recordings + song search, ${new Date().toISOString().slice(0, 10)})`;
        }
      }
      media._about = 'Generated by server/scripts/enrich.js (npm run enrich). Keys: "kind|canonical show|canonical title". '
        + 'null = searched, no trustworthy match (import clears media; enrich skips it unless --all). '
        + 'confidence: high = exact/near-exact title on a cast/film recording of the show found by album scan; medium = needs a human look; '
        + 'verified = checked by a person (never overwritten). trackName/durationSeconds are informational.';
      media._unmatched = Object.fromEntries(Object.entries(unmatchedNotes).sort(([a], [b]) => a.localeCompare(b)));
      for (const k of Object.keys(media)) {
        if (!k.startsWith('_') && !allSpreadsheetKeys.has(fold(k))) log(`⚠️  media.json key "${k}" matches no spreadsheet song (left as-is)`);
      }
      writeMediaJson(mediaJsonPath, media);
    }

    let showResults = [];
    if (opts.shows) {
      log('\n🖼️  Show posters');
      showResults = await fillShowImages({ db, mediaDir, uploadsDir, seedDir, dryRun: opts.dryRun, log, wikiFetchImpl: deps.wikiFetchImpl, imageFetchImpl: deps.imageFetchImpl, pause });
    }

    // ---- report ----
    const count = (st, c) => results.filter((r) => r.status === st && (!c || r.confidence === c)).length;
    const summary = {
      processed: results.length,
      matchedHigh: count('matched', 'high'),
      matchedMedium: count('matched', 'medium'),
      fromMediaJson: count('from-media.json'),
      unmatched: count('unmatched'),
      errors: count('error'),
      skipped: skipped.length,
      artDownloaded,
      itunesRequests: stats.requests,
      cacheHits: stats.cacheHits,
      retries: stats.retries,
      seconds: Math.round((Date.now() - started) / 1000),
    };
    const report = {
      generatedAt: new Date().toISOString(),
      options: { ...opts },
      summary,
      songs: results.map((r) => ({
        id: r.song.id,
        key: mediaKey(r.song.kind, r.song.show, r.song.title),
        kind: r.song.kind,
        show: r.song.show,
        title: r.song.title,
        lengthSeconds: r.song.lengthSeconds,
        status: r.status,
        confidence: r.confidence ?? r.entry?.confidence ?? null,
        trackName: r.entry?.trackName ?? r.match?.track?.trackName ?? null,
        collectionName: r.entry?.recordingName ?? r.match?.track?.collectionName ?? null,
        collectionId: r.match?.track?.collectionId ?? null,
        artistName: r.entry?.recordingArtist ?? null,
        trackId: r.entry?.itunesTrackId ?? r.match?.track?.trackId ?? null,
        durationSeconds: r.entry?.durationSeconds ?? r.match?.track?.durationSeconds ?? null,
        previewUrl: r.entry?.previewUrl ?? r.match?.track?.previewUrl ?? null,
        artworkFile: r.entry?.artworkFile ?? null,
        verifiedBy: r.verifiedBy ?? r.entry?.verifiedBy ?? null,
      })),
      skipped,
      shows: showResults,
    };
    const reportFile = opts.dryRun ? reportPath.replace(/\.json$/, '.dry-run.json') : reportPath;
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    log(`\n✅ Done in ${summary.seconds} s: ${summary.matchedHigh} high + ${summary.matchedMedium} medium matches, ${summary.fromMediaJson} restored from media.json, `
      + `${summary.unmatched} unmatched, ${summary.errors} errors, ${summary.skipped} skipped; ${summary.artDownloaded} artwork file(s) downloaded; `
      + `${summary.itunesRequests} iTunes requests (${summary.cacheHits} cached, ${summary.retries} retries).`);
    log(opts.dryRun ? `   report → ${reportFile}` : `   media.json → ${mediaJsonPath}\n   report → ${reportFile}`);
    return report;
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}

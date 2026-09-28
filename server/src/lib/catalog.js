// Show & song catalog (SPEC §7c): loader + site linking.
//
// The catalog is built offline (`npm run catalog:build` → server/seed/catalog/catalog.json.gz, from
// Wikidata + English Wikipedia) and loaded into the catalog_* tables here:
//   - at server startup when the file's `version` differs from catalog_meta.version (or the tables
//     are empty) — a deploy with a new file updates the site by itself;
//   - by `npm --prefix server run catalog:load` (forced reload, for maintainers).
// A load is ONE transaction (all or nothing) with prepared statements. Rows keep their ids across
// loads: shows are matched by `key`, songs by (show, title, reprise) — so links from site songs and
// bookmarked /add?catalogSong=<id> URLs survive. Songs found on a cast album (source='recording')
// and the cached cast album (itunes_collection_id) are kept. Community data (songs, shows, users,
// comments) is never changed, except the catalog_show_id / catalog_song_id link columns, which are
// re-linked by accent/case-folded title after every load (see relinkSiteRows).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { SERVER_ROOT } from '../db.js';
import { cleanText, fold } from './text.js';
import { normalizeForMatch } from './itunes.js';
import { parentheticals } from './itunes-albums.js';
import { normalizeVocalRange } from './vocab.js';
import { resolveUserPath } from './paths.js';

export const DEFAULT_CATALOG_PATH = path.join(SERVER_ROOT, 'seed', 'catalog', 'catalog.json.gz');

/** Credit shown wherever catalog data appears. */
export const CATALOG_ATTRIBUTION = Object.freeze({
  text: 'Song lists from Wikipedia (CC BY-SA 4.0); show facts from Wikidata (CC0)',
  songLists: { source: 'English Wikipedia', licence: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  showFacts: { source: 'Wikidata', licence: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
});

/** STAR_CATALOG_PATH (relative to where npm was run), else server/seed/catalog/catalog.json.gz. */
export function catalogPathFromEnv(env = process.env) {
  return env.STAR_CATALOG_PATH ? resolveUserPath(env.STAR_CATALOG_PATH, env) : DEFAULT_CATALOG_PATH;
}

export class CatalogError extends Error {
  /** @param {string} message @param {'missing'|'invalid'} [code] */
  constructor(message, code = 'invalid') {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------
// Reading the file: gunzip into a Buffer (never one giant JS string) and split the top-level JSON
// object by scanning bytes; each show is JSON.parse'd on its own while it is inserted.
// ---------------------------------------------------------------------------------------------

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const isWs = (b) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

function skipWs(buf, i) {
  while (i < buf.length && isWs(buf[i])) i++;
  return i;
}

/** Index just after the closing quote of the string that starts at `i`. */
function stringEnd(buf, i) {
  let j = i + 1;
  for (;;) {
    const q = buf.indexOf(QUOTE, j);
    if (q === -1) throw new CatalogError('the file ends in the middle of a string (truncated?)');
    let k = q - 1;
    let slashes = 0;
    while (k > i && buf[k] === BACKSLASH) {
      slashes++;
      k--;
    }
    if (slashes % 2 === 0) return q + 1;
    j = q + 1;
  }
}

/** Index just after the JSON value that starts at `i` (object, array, string or literal). */
function valueEnd(buf, i) {
  const c = buf[i];
  if (c === QUOTE) return stringEnd(buf, i);
  if (c === 0x7b || c === 0x5b) {
    let depth = 0;
    for (let j = i; j < buf.length; j++) {
      const b = buf[j];
      if (b === QUOTE) {
        j = stringEnd(buf, j) - 1;
      } else if (b === 0x7b || b === 0x5b) {
        depth++;
      } else if (b === 0x7d || b === 0x5d) {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    throw new CatalogError('the file ends in the middle of the data (truncated?)');
  }
  let j = i;
  while (j < buf.length && buf[j] !== 0x2c && buf[j] !== 0x7d && buf[j] !== 0x5d && !isWs(buf[j])) j++;
  if (j === i) throw new CatalogError(`unexpected character at byte ${i}`);
  return j;
}

function parseSlice(buf, start, end, what) {
  try {
    return JSON.parse(buf.toString('utf8', start, end));
  } catch (err) {
    throw new CatalogError(`${what} isn't valid JSON (${err.message})`);
  }
}

/**
 * Split the top-level document: every key except "shows" is parsed; "shows" becomes a list of
 * [start, end) byte ranges, one per show.
 * @param {Buffer} buf
 * @returns {{ meta: Record<string, unknown>, showRanges: [number, number][] }}
 */
export function splitCatalogDocument(buf) {
  let i = 0;
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3; // UTF-8 BOM
  i = skipWs(buf, i);
  if (buf[i] !== 0x7b) throw new CatalogError('the catalog must be one JSON object ({ "version", "shows": [...] })');
  i = skipWs(buf, i + 1);
  // No prototype: a "__proto__" key in the file is just data, never the object's prototype.
  /** @type {Record<string, unknown>} */
  const meta = Object.create(null);
  /** @type {[number, number][] | null} */
  let showRanges = null;
  while (i < buf.length && buf[i] !== 0x7d) {
    if (buf[i] !== QUOTE) throw new CatalogError(`expected a key at byte ${i}`);
    const keyEnd = stringEnd(buf, i);
    const key = parseSlice(buf, i, keyEnd, 'a key');
    i = skipWs(buf, keyEnd);
    if (buf[i] !== 0x3a) throw new CatalogError(`expected ":" after "${key}"`);
    i = skipWs(buf, i + 1);
    if (key === 'shows') {
      if (buf[i] !== 0x5b) throw new CatalogError('"shows" must be a list');
      showRanges = [];
      i = skipWs(buf, i + 1);
      while (i < buf.length && buf[i] !== 0x5d) {
        const end = valueEnd(buf, i);
        showRanges.push([i, end]);
        i = skipWs(buf, end);
        if (buf[i] === 0x2c) i = skipWs(buf, i + 1);
        else if (buf[i] !== 0x5d) throw new CatalogError(`expected "," or "]" in "shows" at byte ${i}`);
      }
      if (buf[i] !== 0x5d) throw new CatalogError('the "shows" list is not closed (truncated?)');
      i = skipWs(buf, i + 1);
    } else {
      const end = valueEnd(buf, i);
      if (typeof key === 'string' && !UNSAFE_KEYS.has(key)) meta[key] = parseSlice(buf, i, end, `"${key}"`);
      i = skipWs(buf, end);
    }
    if (buf[i] === 0x2c) i = skipWs(buf, i + 1);
    else if (buf[i] !== 0x7d) throw new CatalogError(`expected "," or "}" at byte ${i}`);
  }
  if (buf[i] !== 0x7d) throw new CatalogError('the catalog object is not closed (truncated?)');
  if (!showRanges) throw new CatalogError('the catalog has no "shows" list');
  return { meta, showRanges };
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Size limits for the catalog file. The real one is ~1.2 MB gzipped / ~15 MB of JSON; the caps keep
 * a broken or malicious file (a "gzip bomb" of a few MB that inflates to gigabytes) from taking
 * the server down at startup.
 */
export const CATALOG_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const CATALOG_MAX_JSON_BYTES = 256 * 1024 * 1024;

const mb = (n) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

/** The file's raw bytes (≤ maxBytes). */
function readCatalogFile(file, maxBytes = CATALOG_MAX_FILE_BYTES) {
  try {
    const size = fs.statSync(file).size;
    if (size > maxBytes) {
      throw new CatalogError(`${path.basename(file)} is ${mb(size)} — more than the ${mb(maxBytes)} a catalog file may be`);
    }
    return fs.readFileSync(file);
  } catch (err) {
    if (err instanceof CatalogError) throw err;
    if (err.code === 'ENOENT') throw new CatalogError(`No catalog file at ${file}`, 'missing');
    throw new CatalogError(`Can't read ${file}: ${err.message}`);
  }
}

/** Decompress (plain JSON is accepted too, handy while developing); never more than maxBytes. */
function decompressCatalog(raw, file, maxBytes = CATALOG_MAX_JSON_BYTES) {
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      return zlib.gunzipSync(raw, { maxOutputLength: maxBytes });
    } catch (err) {
      if (err instanceof RangeError || err?.code === 'ERR_BUFFER_TOO_LARGE') {
        throw new CatalogError(`${path.basename(file)} unpacks to more than ${mb(maxBytes)} — that isn't a song catalog`);
      }
      throw new CatalogError(`${path.basename(file)} is not a valid gzip file (${err.message})`);
    }
  }
  if (raw.length > maxBytes) throw new CatalogError(`${path.basename(file)} is more than ${mb(maxBytes)}`);
  return raw;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const VERSION_RE = /"version"\s*:\s*"((?:[^"\\]|\\.){1,200})"/;
const GENERATED_RE = /"generatedAt"\s*:\s*"((?:[^"\\]|\\.){1,100})"/;

/**
 * The file's `version` from its first bytes only (no full decompress) — null when it isn't near
 * the start (the loader then reads the whole file to find it).
 */
export function peekCatalogVersion(file) {
  return peekCatalogHead(file)?.version ?? null;
}

/** `version` and `generatedAt` from the first bytes of a file (Buffer or path), or null. */
function peekCatalogHead(fileOrBuffer) {
  let fd;
  try {
    let head;
    let n;
    if (Buffer.isBuffer(fileOrBuffer)) {
      head = fileOrBuffer.subarray(0, 64 * 1024);
      n = head.length;
    } else {
      fd = fs.openSync(fileOrBuffer, 'r');
      head = Buffer.alloc(64 * 1024);
      n = fs.readSync(fd, head, 0, head.length, 0);
    }
    let text;
    if (head[0] === 0x1f && head[1] === 0x8b) {
      text = zlib.gunzipSync(head.subarray(0, n), { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: 1024 * 1024 }).toString('utf8', 0, 4096);
    } else {
      text = head.toString('utf8', 0, Math.min(n, 4096));
    }
    const v = VERSION_RE.exec(text);
    const g = GENERATED_RE.exec(text);
    return { version: v ? JSON.parse(`"${v[1]}"`) : null, generatedAt: g ? JSON.parse(`"${g[1]}"`) : null };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// ---------------------------------------------------------------------------------------------
// Validation / normalization of one show (data from the web: trimmed, control/bidi chars removed,
// lengths capped; a bad song is skipped, a show without key/title is skipped).
// ---------------------------------------------------------------------------------------------

const text = (v, max) => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  // Cut a huge string before cleaning it or splitting it into code points (a 50 MB title would
  // otherwise cost seconds); 4 UTF-16 units per character leave room for spaces cleanText collapses.
  const raw = typeof v === 'string' && v.length > max * 4 ? v.slice(0, max * 4) : v;
  const s = cleanText(raw);
  if (!s) return null;
  if (s.length <= max) return s;
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join('') : s;
};

const textList = (v, max, maxItems) => {
  if (!Array.isArray(v)) return [];
  const out = [];
  const seen = new Set();
  for (const x of v) {
    const s = text(x, max);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
};

const intOrNull = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

/**
 * @returns {{ show: object|null, skippedSongs: number }}
 */
export function normalizeCatalogShow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { show: null, skippedSongs: 0 };
  const key = text(raw.key, 200);
  const title = text(raw.title, 300);
  if (!key || !title) return { show: null, skippedSongs: Array.isArray(raw.songs) ? raw.songs.length : 0 };
  const characters = [];
  if (Array.isArray(raw.characters)) {
    for (const c of raw.characters.slice(0, 300)) {
      const name = text(c?.name, 200);
      if (name) characters.push({ name, voiceType: text(c?.voiceType, 80) });
    }
  }
  const songs = [];
  let skippedSongs = 0;
  if (Array.isArray(raw.songs)) {
    for (const s of raw.songs) {
      const songTitle = text(s?.title, 300);
      if (!songTitle) {
        skippedSongs++;
        continue;
      }
      songs.push({
        title: songTitle,
        act: intOrNull(s.act, 0, 20),
        position: intOrNull(s.position, 0, 100000),
        singers: textList(s.singers, 200, 40),
        singersRaw: text(s.singersRaw, 1000) ?? '',
        ensemble: Boolean(s.ensemble),
        reprise: Boolean(s.reprise),
        instrumental: Boolean(s.instrumental),
      });
    }
  }
  const wikidataId = typeof raw.wikidataId === 'string' && /^Q\d{1,12}$/.test(raw.wikidataId.trim()) ? raw.wikidataId.trim() : null;
  return {
    show: {
      key,
      title,
      altTitles: textList(raw.altTitles, 300, 30).filter((a) => a.toLowerCase() !== title.toLowerCase()),
      wikiTitle: text(raw.wikiTitle, 300),
      wikidataId,
      composer: text(raw.composer, 500),
      lyricist: text(raw.lyricist, 500),
      bookWriter: text(raw.bookWriter, 500),
      year: intOrNull(raw.year, 1000, 2200),
      genres: textList(raw.genres, 80, 20).map((g) => g.toLowerCase()),
      description: text(raw.description, 500),
      characters,
      songs,
    },
    skippedSongs,
  };
}

// ---------------------------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------------------------

export function getCatalogMeta(db) {
  const rows = db.prepare('SELECT key, value FROM catalog_meta').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Public status: what's loaded (for the client's empty state + attribution). */
export function catalogStatus(db) {
  const meta = getCatalogMeta(db);
  const shows = db.prepare('SELECT count(*) AS n FROM catalog_shows WHERE retired = 0').get().n;
  const songs = db.prepare(`SELECT count(*) AS n FROM catalog_songs s JOIN catalog_shows sh ON sh.id = s.show_id
    WHERE s.instrumental = 0 AND sh.retired = 0`).get().n;
  return {
    available: shows > 0,
    version: meta.version ?? null,
    generatedAt: meta.generatedAt ?? null,
    loadedAt: meta.loadedAt ?? null,
    shows,
    songs,
    attribution: CATALOG_ATTRIBUTION,
  };
}

// ---------------------------------------------------------------------------------------------
// Full-text index
// ---------------------------------------------------------------------------------------------

/** Rebuild both FTS tables from the catalog tables (instrumentals and retired shows aren't indexed). */
export function rebuildCatalogFts(db) {
  db.exec(`
    DELETE FROM catalog_fts;
    INSERT INTO catalog_fts (rowid, song_title, show_title, alt_titles, singers)
      SELECT s.id, s.title, sh.title, sh.alt_titles, s.singers
      FROM catalog_songs s JOIN catalog_shows sh ON sh.id = s.show_id
      WHERE s.instrumental = 0 AND sh.retired = 0;
    DELETE FROM catalog_show_fts;
    INSERT INTO catalog_show_fts (rowid, title, alt_titles, credits)
      SELECT id, title, alt_titles, concat_ws(' ', composer, lyricist, book_writer) FROM catalog_shows WHERE retired = 0;
  `);
  bumpCatalogGeneration(db);
}

/** Add FTS rows for some (new) catalog songs. */
export function indexCatalogSongs(db, songIds) {
  if (!songIds.length) return;
  db.prepare(`
    INSERT INTO catalog_fts (rowid, song_title, show_title, alt_titles, singers)
      SELECT s.id, s.title, sh.title, sh.alt_titles, s.singers
      FROM catalog_songs s JOIN catalog_shows sh ON sh.id = s.show_id
      WHERE s.instrumental = 0 AND sh.retired = 0 AND s.id IN (SELECT value FROM json_each(?))`).run(JSON.stringify(songIds));
  bumpCatalogGeneration(db);
}

/** Remove some catalog songs from the search index (before they are deleted). */
export function unindexCatalogSongs(db, songIds) {
  if (!songIds.length) return;
  db.prepare('DELETE FROM catalog_fts WHERE rowid IN (SELECT value FROM json_each(?))').run(JSON.stringify(songIds));
  bumpCatalogGeneration(db);
}

// In-process "the catalog changed" counter per connection: search results and the show-name index
// are cached against it (plus loadedAt and row counts, which also catch a `catalog:load` run from
// another process).
const generations = new WeakMap();
export function bumpCatalogGeneration(db) {
  generations.set(db, (generations.get(db) ?? 0) + 1);
}

/** Record in the database that catalog songs were added/removed outside a load (seen by other processes too). */
export function markCatalogChanged(db) {
  db.prepare("INSERT INTO catalog_meta (key, value) VALUES ('changedAt', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .run(`${new Date().toISOString()}#${Math.random().toString(36).slice(2, 8)}`);
  bumpCatalogGeneration(db);
}

/** A string that changes whenever catalog rows are added, removed, retired or reloaded. */
export function catalogSignature(db) {
  const r = db.prepare(`SELECT (SELECT value FROM catalog_meta WHERE key = 'loadedAt') AS loaded,
    (SELECT value FROM catalog_meta WHERE key = 'changedAt') AS changed,
    (SELECT count(*) FROM catalog_shows) AS shows, (SELECT max(id) FROM catalog_shows) AS maxShow,
    (SELECT total(retired) FROM catalog_shows) AS retired, (SELECT max(id) FROM catalog_songs) AS maxSong`).get();
  return `${generations.get(db) ?? 0}|${r.loaded}|${r.changed}|${r.shows}|${r.maxShow}|${r.retired}|${r.maxSong}`;
}

export function updateSongCounts(db, showId = null) {
  const sql = `UPDATE catalog_shows SET song_count =
    (SELECT count(*) FROM catalog_songs s WHERE s.show_id = catalog_shows.id AND s.instrumental = 0)`;
  if (showId) db.prepare(`${sql} WHERE id = ?`).run(showId);
  else db.exec(sql);
}

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

/** SQLite NOCASE folds ASCII letters only — dedupe the same way the UNIQUE constraint does. */
const nocase = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Refuse a file that would wipe most of the loaded catalog: fewer than half of today's shows or
 * song-list songs, or many shows it had to skip (no key/title). A broken build, a truncated file or
 * STAR_CATALOG_PATH pointing at a test fixture must never delete the site's catalog, the cast-album
 * data visitors collected, and every site link. `allowShrink` (catalog:load --force) overrides it.
 */
export const CATALOG_MIN_KEEP_RATIO = 0.5;

function checkCatalogSize({ shows, songs, entries, skippedShows, current, allowShrink }) {
  if (shows === 0) throw new CatalogError('the catalog lists no usable shows');
  if (allowShrink) return;
  const force = 'If that is really what you want: npm --prefix server run catalog:load -- --force';
  const tooManySkipped = Math.max(10, Math.ceil(entries * 0.05));
  if (skippedShows > tooManySkipped) {
    throw new CatalogError(`${skippedShows} of its ${entries} shows have no key or title — the file looks broken, so the loaded catalog was kept. ${force}`);
  }
  if (current.shows > 0 && shows < current.shows * CATALOG_MIN_KEEP_RATIO) {
    throw new CatalogError(`it has only ${shows} shows but ${current.shows} are loaded (less than half) — refusing to replace the catalog. ${force}`);
  }
  if (current.songs > 0 && songs < current.songs * CATALOG_MIN_KEEP_RATIO) {
    throw new CatalogError(`it has only ${songs} songs but ${current.songs} are loaded (less than half) — refusing to replace the catalog. ${force}`);
  }
}

/**
 * Load the catalog file into the database (one transaction).
 * "Changed" means different file contents (sha256), not just a different `version`: a rebuild that
 * reused a version number still reloads.
 * @param {import('better-sqlite3').Database} db
 * @param {string} file
 * @param {{ force?: boolean, allowShrink?: boolean, maxFileBytes?: number, maxJsonBytes?: number }} [opts]
 *   force = reload even if the file is unchanged; allowShrink = accept a file with far fewer
 *   shows/songs than the loaded catalog; max… = size limits (tests lower them)
 * @returns {object} summary: { loaded, reason?, version, previousVersion, shows, songs, recordingSongs,
 *   removed: {shows, songs}, retired, merged, recordingCleared, skipped: {shows, songs, duplicateShows, duplicateSongs},
 *   linksLost: {shows, songs}, links, ms }
 */
export function loadCatalog(db, file, {
  force = false, allowShrink = false, maxFileBytes = CATALOG_MAX_FILE_BYTES, maxJsonBytes = CATALOG_MAX_JSON_BYTES,
} = {}) {
  const started = performance.now();
  if (!fs.existsSync(file)) throw new CatalogError(`No catalog file at ${file}`, 'missing');
  const prev = getCatalogMeta(db);
  const previousVersion = prev.version ?? null;
  const haveRows = Boolean(db.prepare('SELECT 1 FROM catalog_shows LIMIT 1').get());
  const unchanged = (version) => ({
    loaded: false, reason: 'unchanged', version, previousVersion, ...currentCounts(db), ms: Math.round(performance.now() - started),
  });
  const raw = readCatalogFile(file, maxFileBytes);
  const fileHash = sha256(raw);
  if (!force && haveRows && previousVersion !== null) {
    if (prev.fileHash === fileHash) return unchanged(previousVersion);
    if (!prev.fileHash) {
      // Loaded before file hashes were kept: the same version AND build time is the same file.
      const head = peekCatalogHead(raw);
      if (head?.version === previousVersion && head.generatedAt && head.generatedAt === prev.generatedAt) {
        db.prepare("INSERT INTO catalog_meta (key, value) VALUES ('fileHash', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(fileHash);
        return unchanged(previousVersion);
      }
    }
  }

  const buf = decompressCatalog(raw, file, maxJsonBytes);
  const { meta, showRanges } = splitCatalogDocument(buf);
  const version = typeof meta.version === 'string' ? meta.version.trim() : '';
  if (!version || version.length > 200) throw new CatalogError('the catalog has no "version" (a non-empty string)');
  const generatedAt = typeof meta.generatedAt === 'string' ? meta.generatedAt.slice(0, 100) : null;
  const current = {
    shows: db.prepare('SELECT count(*) AS n FROM catalog_shows WHERE retired = 0').get().n,
    songs: db.prepare("SELECT count(*) AS n FROM catalog_songs WHERE source = 'wikipedia'").get().n,
  };

  // Scratch lists of the rows this load saw (connection-private; emptied again after the load).
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS catalog_seen_songs (id INTEGER PRIMARY KEY);
    CREATE TEMP TABLE IF NOT EXISTS catalog_seen_shows (id INTEGER PRIMARY KEY);`);
  const q = {
    upsertShow: db.prepare(`
      INSERT INTO catalog_shows (key, title, alt_titles, wiki_title, wikidata_id, composer, lyricist, book_writer,
        year, genres, description, characters)
      VALUES (@key, @title, @altTitles, @wikiTitle, @wikidataId, @composer, @lyricist, @bookWriter,
        @year, @genres, @description, @characters)
      ON CONFLICT (key) DO UPDATE SET title = excluded.title, alt_titles = excluded.alt_titles,
        wiki_title = excluded.wiki_title, wikidata_id = excluded.wikidata_id, composer = excluded.composer,
        lyricist = excluded.lyricist, book_writer = excluded.book_writer, year = excluded.year,
        genres = excluded.genres, description = excluded.description, characters = excluded.characters, retired = 0
      RETURNING id`),
    upsertSong: db.prepare(`
      INSERT INTO catalog_songs (show_id, title, act, position, singers, singers_raw, ensemble, reprise, instrumental, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'wikipedia')
      ON CONFLICT (show_id, title COLLATE NOCASE, reprise) DO UPDATE SET title = excluded.title, act = excluded.act,
        position = excluded.position, singers = excluded.singers, singers_raw = excluded.singers_raw,
        ensemble = excluded.ensemble, instrumental = excluded.instrumental, source = 'wikipedia'
      RETURNING id`),
    seenSong: db.prepare('INSERT OR IGNORE INTO temp.catalog_seen_songs (id) VALUES (?)'),
    seenShow: db.prepare('INSERT OR IGNORE INTO temp.catalog_seen_shows (id) VALUES (?)'),
  };

  const summary = db.transaction(() => {
    db.exec('DELETE FROM temp.catalog_seen_songs; DELETE FROM temp.catalog_seen_shows;');
    const skipped = { shows: 0, songs: 0, duplicateShows: 0, duplicateSongs: 0 };
    const seenKeys = new Set();
    let shows = 0;
    let songs = 0;
    for (const [start, end] of showRanges) {
      const raw = parseSlice(buf, start, end, `show #${shows + skipped.shows + skipped.duplicateShows + 1}`);
      const { show, skippedSongs } = normalizeCatalogShow(raw);
      skipped.songs += skippedSongs;
      if (!show) {
        skipped.shows++;
        continue;
      }
      if (seenKeys.has(show.key)) {
        skipped.duplicateShows++;
        continue;
      }
      seenKeys.add(show.key);
      const showId = q.upsertShow.get({
        ...show,
        altTitles: JSON.stringify(show.altTitles),
        genres: JSON.stringify(show.genres),
        characters: JSON.stringify(show.characters),
      }).id;
      q.seenShow.run(showId);
      shows++;
      const titles = new Set();
      for (const s of show.songs) {
        const dedupe = `${nocase(s.title)}|${s.reprise ? 1 : 0}`;
        if (titles.has(dedupe)) {
          skipped.duplicateSongs++;
          continue;
        }
        titles.add(dedupe);
        const id = q.upsertSong.get(showId, s.title, s.act, s.position, JSON.stringify(s.singers), s.singersRaw,
          s.ensemble ? 1 : 0, s.reprise ? 1 : 0, s.instrumental ? 1 : 0).id;
        q.seenSong.run(id);
        songs++;
      }
    }
    // Before anything is removed: is this file plausibly a whole catalog? (throwing rolls back)
    checkCatalogSize({ shows, songs, entries: showRanges.length, skippedShows: skipped.shows, current, allowShrink });

    // Shows gone from the file. One that holds data collected on the site — songs saved from its cast
    // album, a cached album, a site show or song someone linked to it by hand — is retired (hidden
    // from search and matching; its rows stay); any other goes, with its songs.
    db.prepare(`UPDATE catalog_shows SET retired = (CASE WHEN
        itunes_collection_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM catalog_songs cs WHERE cs.show_id = catalog_shows.id AND cs.source = 'recording')
        OR EXISTS (SELECT 1 FROM shows s WHERE s.catalog_show_id = catalog_shows.id AND s.catalog_link = 'manual')
        OR EXISTS (SELECT 1 FROM songs so JOIN catalog_songs cs ON cs.id = so.catalog_song_id
          WHERE cs.show_id = catalog_shows.id AND so.catalog_link = 'manual')
      THEN 1 ELSE 0 END) WHERE id NOT IN (SELECT id FROM temp.catalog_seen_shows)`).run();
    const retired = db.prepare('SELECT count(*) AS n FROM catalog_shows WHERE retired = 1').get().n;
    // Site links that point at rows about to go (re-linked by title below where possible).
    const linksLost = {
      shows: db.prepare(`SELECT count(*) AS n FROM shows WHERE catalog_show_id IN (SELECT id FROM catalog_shows
        WHERE retired = 0 AND id NOT IN (SELECT id FROM temp.catalog_seen_shows))`).get().n,
      songs: db.prepare(`SELECT count(*) AS n FROM songs so JOIN catalog_songs cs ON cs.id = so.catalog_song_id
        JOIN catalog_shows sh ON sh.id = cs.show_id
        WHERE (sh.retired = 0 AND sh.id NOT IN (SELECT id FROM temp.catalog_seen_shows))
          OR (cs.source = 'wikipedia' AND sh.id IN (SELECT id FROM temp.catalog_seen_shows) AND cs.id NOT IN (SELECT id FROM temp.catalog_seen_songs))`).get().n,
    };
    const removedShows = db.prepare('DELETE FROM catalog_shows WHERE retired = 0 AND id NOT IN (SELECT id FROM temp.catalog_seen_shows)').run().changes;
    // Wikipedia songs gone from their (still listed) show's list. Songs found on a cast album
    // (source='recording') stay, and so do the songs of retired shows.
    const removedSongs = db.prepare(`DELETE FROM catalog_songs WHERE source = 'wikipedia'
      AND show_id IN (SELECT id FROM temp.catalog_seen_shows) AND id NOT IN (SELECT id FROM temp.catalog_seen_songs)`).run().changes;
    const merged = mergeRecordingDuplicates(db);
    const recordingCleared = dropRecordingSongsOfListedShows(db);
    updateSongCounts(db);
    rebuildCatalogFts(db);
    db.exec('DELETE FROM temp.catalog_seen_songs; DELETE FROM temp.catalog_seen_shows;');
    const recordingSongs = db.prepare("SELECT count(*) AS n FROM catalog_songs WHERE source = 'recording'").get().n;
    const setMeta = db.prepare('INSERT INTO catalog_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
    const loadedAt = new Date().toISOString();
    setMeta.run('version', version);
    setMeta.run('generatedAt', generatedAt);
    setMeta.run('loadedAt', loadedAt);
    setMeta.run('fileHash', fileHash);
    setMeta.run('sources', meta.sources && typeof meta.sources === 'object' ? JSON.stringify(meta.sources).slice(0, 5000) : null);
    setMeta.run('showCount', String(shows));
    setMeta.run('songCount', String(songs + recordingSongs));
    const links = relinkSiteRows(db);
    return {
      loaded: true, version, previousVersion, shows, songs, recordingSongs, removed: { shows: removedShows, songs: removedSongs },
      retired, merged, recordingCleared, skipped, linksLost, links, loadedAt,
      sameVersion: previousVersion === version,
    };
  })();
  return { ...summary, ms: Math.round(performance.now() - started) };
}

function currentCounts(db) {
  return {
    shows: db.prepare('SELECT count(*) AS n FROM catalog_shows WHERE retired = 0').get().n,
    songs: db.prepare("SELECT count(*) AS n FROM catalog_songs WHERE source = 'wikipedia'").get().n,
    recordingSongs: db.prepare("SELECT count(*) AS n FROM catalog_songs WHERE source = 'recording'").get().n,
  };
}

const recordingKey = (k) => `${k.main}|${k.repriseNo}`;

/**
 * A cast-album song that the Wikipedia list now has too (same title ignoring punctuation and
 * articles, same reprise-ness) is merged into the Wikipedia row: site links move over, the
 * duplicate goes. Returns how many were merged.
 */
function mergeRecordingDuplicates(db) {
  const rec = db.prepare("SELECT id, show_id, title, reprise FROM catalog_songs WHERE source = 'recording' ORDER BY show_id, id").all();
  if (!rec.length) return 0;
  const wikiOf = db.prepare("SELECT id, title, reprise FROM catalog_songs WHERE show_id = ? AND source = 'wikipedia'");
  const relink = db.prepare('UPDATE songs SET catalog_song_id = ? WHERE catalog_song_id = ?');
  const del = db.prepare('DELETE FROM catalog_songs WHERE id = ?');
  let merged = 0;
  let showId = null;
  let keys = new Map();
  for (const r of rec) {
    if (r.show_id !== showId) {
      showId = r.show_id;
      keys = new Map();
      for (const w of wikiOf.all(showId)) {
        const k = songTitleKeys(w.title, Boolean(w.reprise));
        keys.set(recordingKey(k), w.id);
      }
    }
    const k = songTitleKeys(r.title, Boolean(r.reprise));
    const target = keys.get(recordingKey(k));
    if (target) {
      relink.run(target, r.id);
      del.run(r.id);
      merged++;
    }
  }
  return merged;
}

/**
 * Once a show has a Wikipedia song list, its cast-album track names are only noise next to it
 * (the same songs under slightly different names, e.g. "Everyday a Little Death" vs "Every Day a
 * Little Death"): they go. A site song linked to one moves to the matching listed song when there
 * is one; a track no listed song matches is kept only while a site song still links to it.
 * Returns how many cast-album songs were removed.
 */
function dropRecordingSongsOfListedShows(db) {
  const shows = db.prepare(`SELECT DISTINCT r.show_id AS id FROM catalog_songs r
    WHERE r.source = 'recording' AND EXISTS (SELECT 1 FROM catalog_songs w
      WHERE w.show_id = r.show_id AND w.source = 'wikipedia' AND w.instrumental = 0)`).all();
  if (!shows.length) return 0;
  const recOf = db.prepare(`SELECT r.id, r.title, r.reprise, (SELECT count(*) FROM songs s WHERE s.catalog_song_id = r.id) AS linked
    FROM catalog_songs r WHERE r.show_id = ? AND r.source = 'recording'`);
  const relink = db.prepare('UPDATE songs SET catalog_song_id = ? WHERE catalog_song_id = ?');
  const del = db.prepare('DELETE FROM catalog_songs WHERE id = ?');
  let dropped = 0;
  for (const { id: showId } of shows) {
    const listed = db.prepare("SELECT id, title, reprise, position FROM catalog_songs WHERE show_id = ? AND source = 'wikipedia' AND instrumental = 0 ORDER BY position IS NULL, position, id").all(showId);
    for (const r of recOf.all(showId)) {
      if (r.linked) {
        const target = findCatalogSongFor(db, showId, recordingTitleOf(r), listed);
        if (!target) continue; // a site song still points at it — keep it until that changes
        relink.run(target, r.id);
      }
      del.run(r.id);
      dropped++;
    }
  }
  return dropped;
}

const recordingTitleOf = (r) => (r.reprise && !isRepriseTitle(r.title) ? `${r.title} (Reprise)` : r.title);

/**
 * Startup: load when changed, never throw (a missing or broken file is a warning — the catalog
 * features then show their empty state and the previously loaded catalog, if any, stays).
 * @param {import('better-sqlite3').Database} db
 * @param {string|null} file
 * @param {{ info: Function, warn: Function }} log
 */
export function loadCatalogAtStartup(db, file, log) {
  if (!file) return null;
  const n = (x) => Number(x).toLocaleString('en-CA');
  try {
    const r = loadCatalog(db, file);
    if (r.loaded) {
      log.info(`📚 Song catalog ${r.version} loaded in ${(r.ms / 1000).toFixed(1)} s: ${n(r.shows)} shows, ${n(r.songs)} songs`
        + (r.recordingSongs ? ` (+ ${n(r.recordingSongs)} from cast albums kept)` : '')
        + (r.removed.shows || r.removed.songs ? `; removed ${n(r.removed.shows)} shows / ${n(r.removed.songs)} songs no longer listed` : '')
        + (r.retired ? `; ${n(r.retired)} show(s) no longer listed kept as retired (they hold site data)` : ''));
      if (r.sameVersion && r.previousVersion) log.warn(`   ⚠️  the file has the same version (${r.version}) as the catalog that was loaded, but different contents — reloaded it`);
      if (r.linksLost.shows || r.linksLost.songs) {
        log.warn(`   ⚠️  ${n(r.linksLost.shows)} site show link(s) and ${n(r.linksLost.songs)} site song link(s) pointed at catalog rows that are gone (re-linked by title where possible)`);
      }
      log.info(`   linked ${r.links.showsLinked}/${r.links.shows} site shows and ${r.links.songsLinked}/${r.links.songs} site songs to the catalog`);
      const bad = r.skipped.shows + r.skipped.songs + r.skipped.duplicateShows + r.skipped.duplicateSongs;
      if (bad) log.warn(`   ⚠️  skipped ${n(r.skipped.shows)} show(s) without key/title, ${n(r.skipped.songs)} song(s) without a title, ${n(r.skipped.duplicateShows + r.skipped.duplicateSongs)} duplicate(s)`);
    } else {
      const links = relinkSiteRows(db);
      log.info(`📚 Song catalog ${r.version}: ${n(r.shows)} shows, ${n(r.songs + r.recordingSongs)} songs (up to date)`
        + (links.changed ? `; linked ${links.changed} more site show(s)/song(s)` : ''));
    }
    return r;
  } catch (err) {
    if (err instanceof CatalogError && err.code === 'missing') {
      log.warn(`⚠️  No song catalog at ${file} — "Find your song" search stays empty until it's there (maintainers: npm run catalog:build, then restart or npm --prefix server run catalog:load)`);
    } else {
      log.warn(`⚠️  Couldn't load the song catalog from ${file}: ${err.message} — keeping the catalog that was already loaded`);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Title / name matching (accent/case-folded, punctuation and leading articles ignored)
// ---------------------------------------------------------------------------------------------

const dropArticle = (s) => s.replace(/^(the|a|an) /, '');
const REPRISE_WORD = /\breprise\b/i;
const REPRISE_NO = /\breprise\s*(?:no\.?\s*|#\s*)?(\d{1,2}|one|two|three|four|five|ii|iii|iv)\b/i;
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, ii: 2, iii: 3, iv: 4 };

/** Normalized key: accents/case folded, "&" → and, punctuation → spaces, leading article dropped. */
export function matchKey(s) {
  return dropArticle(normalizeForMatch(s));
}

export const isRepriseTitle = (title) => REPRISE_WORD.test(String(title ?? ''));

/** 0 = not a reprise, 1 = "(Reprise)" / a reprise flag, n = "(Reprise n)". */
function repriseNumber(title, flag) {
  if (!flag && !isRepriseTitle(title)) return 0;
  const m = REPRISE_NO.exec(title);
  if (!m) return 1;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
  return n >= 1 ? n : 1;
}

/**
 * Keys for matching a song title: `main` (without "(Reprise)" markers), `core` (without any
 * parenthetical), `subs` (other names the song goes by: parenthetical subtitles of 2+ words, "X"
 * from "(The X Song)", and each part of a slash medley), `squash` (main without spaces or doubled
 * letters, so "Good Byee" meets "Good-bye-ee!"), whether it's a reprise and which one (`repriseNo`: 1 for
 * "(Reprise)", 2 for "(Reprise 2)" — a numbered reprise only matches the same number).
 * "Valjean's Soliloquy (What Have I Done?)" → main "valjeans soliloquy what have i done",
 * core "valjeans soliloquy", subs ["what have i done"]; "The Sewers/Dog Eats Dog" → subs
 * ["sewers", "dog eats dog"].
 */
export function songTitleKeys(title, repriseFlag = false) {
  const t = String(title ?? '');
  const noReprise = t
    .replace(/[([][^)\]]*\breprise\b[^)\]]*[)\]]/gi, ' ')
    .replace(/\s[-–—:]\s*reprise\b.*$/i, ' ')
    .replace(/\breprise\b(\s*(no\.?\s*|#\s*)?(\d{1,2}|one|two|three|four|five|ii|iii|iv)\b)?/gi, ' ');
  const main = matchKey(noReprise);
  const subs = new Set();
  for (const p of parentheticals(noReprise).map(dropArticle)) {
    if (p.split(' ').length >= 2) subs.add(p);
    const song = /^(.+?) song$/.exec(p); // "(The Dinghy Song)" → "dinghy"
    if (song && song[1].length >= 3) subs.add(song[1]);
  }
  const outside = noReprise.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  if (outside.includes('/')) {
    for (const part of outside.split('/')) {
      const k = matchKey(part);
      if (k.length >= 3 && k !== main) subs.add(k);
    }
  }
  const reprise = repriseNumber(t, repriseFlag);
  return {
    main,
    core: matchKey(outside),
    subs: [...subs],
    squash: main.replace(/ /g, '').replace(/(.)\1+/g, '$1'), // "good bye ee" / "good byee" → "godbye"
    reprise: reprise > 0,
    repriseNo: reprise,
  };
}

/** 2 = same title, 1 = same apart from a parenthetical/subtitle/medley part/spacing, 0 = different. */
export function songTitleMatchLevel(a, b) {
  if (!a.main || !b.main || a.reprise !== b.reprise) return 0;
  if ((a.repriseNo ?? Number(a.reprise)) !== (b.repriseNo ?? Number(b.reprise))) return 0;
  if (a.main === b.main) return 2;
  if ((a.core && (a.core === b.core || a.core === b.main)) || (b.core && b.core === a.main)) return 1;
  if (a.subs.includes(b.main) || b.subs.includes(a.main)) return 1;
  if (a.squash && a.squash.length >= 4 && a.squash === b.squash) return 1;
  return 0;
}

/** Keys a show name can match on ("Shrek The Musical" → ["shrek the musical", "shrek"]). */
export function showNameKeys(name) {
  const k = matchKey(name);
  const keys = new Set([k]);
  const stripped = k.replace(/ (the |a new |the new |the broadway )?musical$/, '').trim();
  if (stripped) keys.add(stripped);
  keys.delete('');
  return [...keys];
}

// Words that make "<word> <name>" a different person from "<name>": ages ("Young Cosette"), family
// relations ("Father Flynn" is fine to miss) and the wife forms that turn a surname into another
// person ("Madame Thénardier"). Plain titles are not here: "Princess Fiona" is Fiona, "King Arthur"
// is Arthur, "Lord Farquaad" is Farquaad.
const NOT_THE_SAME = new Set(['young', 'younger', 'little', 'old', 'older', 'adult', 'teen', 'teenage', 'baby', 'child', 'kid', 'grown',
  'junior', 'jr', 'senior', 'sr', 'madame', 'mme', 'mrs', 'missus', 'father', 'mother', 'son', 'daughter', 'brother', 'sister', 'uncle',
  'aunt', 'grandma', 'grandpa', 'granny', 'grandfather', 'grandmother', 'cousin', 'wife', 'husband', 'widow']);

/**
 * The last words (family names) that more than one character of a show carries — "Thénardier" for
 * Thénardier / Madame Thénardier / Éponine Thénardier, "Hamilton" for Alexander / Eliza / Philip.
 * A bare family name can't say which of them is meant.
 * @param {string[]} names the show's character names (catalog character list + song-list singers)
 */
export function sharedFamilyNames(names) {
  const holders = new Map();
  for (const n of names) {
    const k = matchKey(n);
    if (!k) continue;
    const last = k.split(' ').pop();
    if (!holders.has(last)) holders.set(last, new Set());
    holders.get(last).add(k);
  }
  return new Set([...holders].filter(([, set]) => set.size > 1).map(([w]) => w));
}

/**
 * How two character names match: 'exact' (folded, article-insensitive), 'first' (a first name:
 * "Cathy" ~ "Cathy Hiatt", "Marguerite" ~ "Marguerite St. Just"), 'last' ("Valjean" ~ "Jean
 * Valjean", "Fiona" ~ "Princess Fiona" — never across an age/relation word such as "Young Cosette" /
 * "Madame Thénardier", and never for a family name several characters share), or null.
 * @param {{ sharedLastWords?: Set<string> }} [opts] from sharedFamilyNames()
 */
export function characterMatch(a, b, { sharedLastWords } = {}) {
  const ka = matchKey(a);
  const kb = matchKey(b);
  if (!ka || !kb) return null;
  if (ka === kb) return 'exact';
  const wa = ka.split(' ');
  const wb = kb.split(' ');
  if (wa.length === wb.length) return null;
  const [short, long] = wa.length < wb.length ? [wa, wb] : [wb, wa];
  if (short.length !== 1 || short[0].length < 3) return null;
  const w = short[0];
  if (long[0] === w) {
    return long.slice(1).some((x) => NOT_THE_SAME.has(x)) ? null : 'first';
  }
  if (long[long.length - 1] === w) {
    const extra = long.slice(0, -1);
    if (extra.some((x) => NOT_THE_SAME.has(x)) || extra[0] === 'st' || extra[0] === 'saint') return null; // "St. Jimmy" isn't Jimmy
    if (sharedLastWords?.has(w)) return null;
    return 'last';
  }
  return null;
}

/**
 * Do two character names mean the same person? 'exact', 'partial' (see characterMatch) or null.
 * @param {{ sharedLastWords?: Set<string> }} [opts]
 */
export function sameCharacter(a, b, opts) {
  const m = characterMatch(a, b, opts);
  return m === 'exact' ? 'exact' : m ? 'partial' : null;
}

const VOICE_PATTERNS = [
  [/bass[\s-]*baritone/, 'Baritone'], [/baritenor/, 'Tenor'], [/counter[\s-]*tenor/, 'Alto'], [/contralto/, 'Alto'],
  [/mezzo/, 'Mezzo-soprano'], [/soprano/, 'Soprano'], [/treble/, 'Soprano'], [/\balto\b/, 'Alto'], [/tenor/, 'Tenor'],
  [/baritone/, 'Baritone'], [/\bbass\b/, 'Bass'], [/\bbelt(er)?\b/, 'Mezzo-soprano'],
];

/** A Wikipedia voice type ("Bass-baritone", "Tenor/Baritone", "mezzo belt") → one of VOCAL_RANGES, or null. */
export function voiceTypeToRange(voiceType) {
  if (!voiceType) return null;
  const direct = normalizeVocalRange(voiceType);
  if (direct) return direct;
  const f = normalizeForMatch(voiceType);
  let best = null;
  for (const [re, range] of VOICE_PATTERNS) {
    const m = re.exec(f);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, range };
  }
  return best?.range ?? null;
}

// ---------------------------------------------------------------------------------------------
// Linking site shows/songs to the catalog
// ---------------------------------------------------------------------------------------------

/**
 * Words the way the FTS5 unicode61 tokenizer sees them (accents/case folded; every character that
 * isn't a letter or digit separates words, so "Python's" → "python", "s").
 */
export function ftsTokens(value) {
  return (fold(value) ?? '').match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Safe FTS5 syntax: every token double-quoted (a string, never an operator or column name). */
export function ftsQuoted(words, { prefix = false } = {}) {
  return words.map((w) => `"${String(w).replace(/"/g, '""')}"${prefix ? '*' : ''}`).join(' ');
}

// Show names → catalog shows, per connection, rebuilt when the catalog changes (catalogSignature).
// Keys are showNameKeys() of titles and alt titles (so "Everybodys Welcome" meets "Everybody's
// Welcome" and "Monty Pythons Spamalot" meets "Monty Python's Spamalot"), plus space-less forms.
const nameIndexes = new WeakMap();

function showNameIndex(db) {
  const sig = catalogSignature(db);
  const cached = nameIndexes.get(db);
  if (cached && cached.sig === sig) return cached;
  const byTitle = new Map();
  const byAlt = new Map();
  const bySquash = new Map();
  const add = (map, key, id) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };
  for (const r of db.prepare('SELECT id, title, alt_titles FROM catalog_shows WHERE retired = 0').all()) {
    for (const k of showNameKeys(r.title)) {
      add(byTitle, k, r.id);
      add(bySquash, k.replace(/ /g, ''), r.id);
    }
    for (const alt of parseJsonList(r.alt_titles)) {
      if (typeof alt === 'string') for (const k of showNameKeys(alt)) add(byAlt, k, r.id);
    }
  }
  const index = { sig, byTitle, byAlt, bySquash };
  nameIndexes.set(db, index);
  return index;
}

/**
 * Every catalog show a site show name can be, best first: { id, score, exact }. The title or an alt
 * title must match, article-/"the Musical"-insensitive (`exact` = the title); the score adds the
 * same year (±1), a shared composer/lyricist name and having a song list.
 * @param {import('better-sqlite3').Database} db
 * @param {{ name: string, year?: number|null, composer?: string|null }} site
 */
export function rankCatalogShows(db, site) {
  const keys = showNameKeys(site?.name ?? '');
  if (!keys.length) return [];
  const index = showNameIndex(db);
  const how = new Map();
  for (const k of keys) {
    for (const id of index.byTitle.get(k) ?? []) how.set(id, 'title');
    for (const id of index.bySquash.get(k.replace(/ /g, '')) ?? []) if (!how.has(id)) how.set(id, 'title');
  }
  for (const k of keys) for (const id of index.byAlt.get(k) ?? []) if (!how.has(id)) how.set(id, 'alt');
  if (!how.size) return [];
  const rows = db.prepare(`SELECT id, year, composer, lyricist, song_count FROM catalog_shows
    WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify([...how.keys()]));
  const siteComposerWords = new Set(matchKey(site.composer ?? '').split(' ').filter((w) => w.length >= 4));
  return rows.map((r) => {
    const exact = how.get(r.id) === 'title';
    const credits = new Set(matchKey(`${r.composer ?? ''} ${r.lyricist ?? ''}`).split(' '));
    // A title and an alt title count the same: "Cinderella" is Lloyd Webber's title AND an alt title
    // of Rodgers & Hammerstein's — only the year, credits, song list or the site's songs can tell.
    const score = 8
      + (site.year && r.year && Math.abs(site.year - r.year) <= 1 ? 3 : 0)
      + ([...siteComposerWords].some((w) => credits.has(w)) ? 2 : 0)
      + (r.song_count > 0 ? 1 : 0);
    return { id: r.id, score, exact };
  }).sort((a, b) => b.score - a.score || a.id - b.id);
}

/**
 * The catalog show a site show most likely is, or null. When several catalog shows share the name
 * and year/composer/song list don't separate them ("Parade" 1960 vs 1998, "Aladdin", "The Phantom
 * of the Opera"), the site show's own songs decide: the one whose song list has most of them. Still
 * a tie → null (a wrong automatic link is worse than none; the song form links it when someone
 * picks a song from the catalog).
 * @param {import('better-sqlite3').Database} db
 * @param {{ id?: number, name: string, year?: number|null, composer?: string|null }} site
 */
export function findCatalogShowFor(db, site) {
  const ranked = rankCatalogShows(db, site);
  if (!ranked.length) return null;
  const top = ranked.filter((r) => r.score === ranked[0].score);
  if (top.length === 1) return top[0].id;
  if (!site.id) return null;
  const titles = db.prepare('SELECT title FROM songs WHERE show_id = ?').all(site.id).map((r) => songTitleKeys(r.title));
  if (!titles.length) return null;
  const listOf = db.prepare('SELECT title, reprise FROM catalog_songs WHERE show_id = ? AND instrumental = 0');
  const votes = top.map((r) => {
    const list = listOf.all(r.id).map((c) => songTitleKeys(c.title, Boolean(c.reprise)));
    return { id: r.id, n: titles.filter((t) => list.some((c) => songTitleMatchLevel(t, c) > 0)).length };
  }).sort((a, b) => b.n - a.n);
  return votes[0].n > 0 && votes[0].n > votes[1].n ? votes[0].id : null;
}

/**
 * The catalog song of `catalogShowId` a site song title means (same title ignoring punctuation,
 * articles and "(Reprise)" markers; reprise only matches reprise, "(Reprise 2)" only "(Reprise 2)";
 * else a subtitle / medley-part / spacing match), or null. Instrumentals never match.
 * @param {{ id: number, title: string, reprise: number, position: number|null }[]} [catalogSongs] preloaded rows
 */
export function findCatalogSongFor(db, catalogShowId, title, catalogSongs) {
  const rows = catalogSongs ?? db.prepare('SELECT id, title, reprise, position FROM catalog_songs WHERE show_id = ? AND instrumental = 0 ORDER BY position IS NULL, position, id').all(catalogShowId);
  const want = songTitleKeys(title);
  let partial = null;
  for (const r of rows) {
    const level = songTitleMatchLevel(want, r.keys ?? (r.keys = songTitleKeys(r.title, Boolean(r.reprise))));
    if (level === 2) return r.id;
    if (level === 1 && partial === null) partial = r.id;
  }
  return partial;
}

/**
 * Re-link site shows and songs to the catalog. Only the link columns are written (no
 * updated_at/edited_at).
 * Shows: a link someone chose (catalog_link 'manual') or refused ('none') stays; every other link
 * is automatic and re-computed (findCatalogShowFor) — so a better match after a catalog update, a
 * rename, or new songs that settle an ambiguous name moves it.
 * Songs: 'none' stays unlinked; a link into the site show's own catalog show stays; a link into a
 * same-named catalog show stays when the site show isn't linked or the link was chosen on the form;
 * any other link (a song moved to another show) and every missing link is re-matched by title.
 * @param {{ showIds?: number[]|null, songIds?: number[]|null }} [scope] limit to some rows
 * @returns {{ shows: number, showsLinked: number, songs: number, songsLinked: number, changed: number }}
 */
export function relinkSiteRows(db, { showIds = null, songIds = null } = {}) {
  const hasCatalog = Boolean(db.prepare('SELECT 1 FROM catalog_shows WHERE retired = 0 LIMIT 1').get());
  const showCols = 'id, name, year, composer, catalog_show_id, catalog_link';
  const shows = showIds
    ? db.prepare(`SELECT ${showCols} FROM shows WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(showIds))
    : db.prepare(`SELECT ${showCols} FROM shows`).all();
  const setShow = db.prepare('UPDATE shows SET catalog_show_id = ?, catalog_link = NULL WHERE id = ?');
  let changed = 0;
  if (hasCatalog) {
    for (const s of shows) {
      if (s.catalog_link === 'none' || (s.catalog_link === 'manual' && s.catalog_show_id)) continue;
      const id = findCatalogShowFor(db, s);
      if (id !== (s.catalog_show_id ?? null) || s.catalog_link) {
        setShow.run(id, s.id);
        if (id !== (s.catalog_show_id ?? null)) changed++;
        s.catalog_show_id = id;
      }
    }
  }
  const songScope = songIds
    ? { sql: ' WHERE s.id IN (SELECT value FROM json_each(?))', params: [JSON.stringify(songIds)] }
    : showIds ? { sql: ' WHERE s.show_id IN (SELECT value FROM json_each(?))', params: [JSON.stringify(showIds)] }
      : { sql: '', params: [] };
  const songs = db.prepare(`SELECT s.id, s.title, s.catalog_song_id, s.catalog_link, sh.name AS show_name, sh.catalog_show_id,
      cs.show_id AS linked_show
    FROM songs s JOIN shows sh ON sh.id = s.show_id LEFT JOIN catalog_songs cs ON cs.id = s.catalog_song_id${songScope.sql}`).all(...songScope.params);
  const setSong = db.prepare('UPDATE songs SET catalog_song_id = ?, catalog_link = NULL WHERE id = ?');
  const catSongs = db.prepare('SELECT id, title, reprise, position FROM catalog_songs WHERE show_id = ? AND instrumental = 0 ORDER BY position IS NULL, position, id');
  const cache = new Map();
  const nameCache = new Map();
  const sameName = (name, catalogShowId) => {
    const k = `${catalogShowId}|${name}`;
    if (!nameCache.has(k)) nameCache.set(k, catalogShowNamed(db, name, catalogShowId));
    return nameCache.get(k);
  };
  for (const s of songs) {
    if (s.catalog_link === 'none') continue;
    if (s.catalog_song_id && s.linked_show !== null) {
      if (s.linked_show === s.catalog_show_id) continue;
      if ((!s.catalog_show_id || s.catalog_link === 'manual') && sameName(s.show_name, s.linked_show)) continue;
    }
    let id = null;
    if (s.catalog_show_id) {
      if (!cache.has(s.catalog_show_id)) cache.set(s.catalog_show_id, catSongs.all(s.catalog_show_id));
      id = findCatalogSongFor(db, s.catalog_show_id, s.title, cache.get(s.catalog_show_id));
    }
    if ((id ?? null) !== (s.catalog_song_id ?? null)) {
      setSong.run(id, s.id);
      s.catalog_song_id = id;
      changed++;
    }
  }
  return {
    shows: shows.length,
    showsLinked: shows.filter((s) => s.catalog_show_id).length,
    songs: songs.length,
    songsLinked: songs.filter((s) => s.catalog_song_id).length,
    changed,
  };
}

/** Is catalog show `catalogShowId` named like `name` (its title or an alt title)? */
function catalogShowNamed(db, name, catalogShowId) {
  const cat = db.prepare('SELECT title, alt_titles FROM catalog_shows WHERE id = ?').get(catalogShowId);
  if (!cat) return false;
  const keys = new Set([cat.title, ...parseJsonList(cat.alt_titles).filter((x) => typeof x === 'string')].flatMap(showNameKeys));
  return showNameKeys(name ?? '').some((k) => keys.has(k));
}

/**
 * Is a site show the same show as catalog show `catalogShowId`: linked to it, or named like it
 * (title or alt title)? A same-named catalog show counts even when the site show is linked to
 * another one ("Parade" 1960 vs 1998) — the name is what keeps one mistake from linking, say,
 * "Hadestown" to Wicked for everybody.
 */
export function siteShowMatchesCatalog(db, siteShow, catalogShowId) {
  if (siteShow.catalog_show_id && siteShow.catalog_show_id === catalogShowId) return true;
  return catalogShowNamed(db, siteShow.name, catalogShowId);
}

/** How many catalog shows a site show name can be (0, 1, or more when the name is ambiguous). */
export function catalogShowsNamed(db, name) {
  return rankCatalogShows(db, { name }).length;
}

/** Catalog credits for a site show created from the catalog. */
export function catalogShowCredits(db, catalogShowId) {
  const c = db.prepare('SELECT title, composer, lyricist, book_writer, year, wiki_title FROM catalog_shows WHERE id = ?').get(catalogShowId);
  if (!c) return null;
  const cap = (x, n) => (typeof x === 'string' && x.length > n ? `${x.slice(0, n - 1).trimEnd()}…` : x ?? null);
  return {
    title: c.title,
    composer: cap(c.composer, 120),
    lyricist: cap(c.lyricist, 120),
    book_writer: cap(c.book_writer, 120),
    year: Number.isInteger(c.year) && c.year >= 1600 && c.year <= 2100 ? c.year : null,
    wiki_url: wikipediaUrl(c.wiki_title),
  };
}

// ---------------------------------------------------------------------------------------------
// Row → JSON helpers shared by the routes
// ---------------------------------------------------------------------------------------------

export function parseJsonList(value) {
  try {
    const v = JSON.parse(value ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** https://en.wikipedia.org/wiki/<title> */
export function wikipediaUrl(wikiTitle) {
  if (!wikiTitle) return null;
  const t = encodeURIComponent(String(wikiTitle).replace(/ /g, '_')).replace(/%3A/gi, ':').replace(/%2F/gi, '/');
  return `https://en.wikipedia.org/wiki/${t}`;
}

/**
 * Solo/duet from the song list: 1 singer → solo, 2 → duet; null (with a reason) for instrumentals,
 * no named singers, 3+ singers or an ensemble number.
 * @returns {{ kind: 'solo'|'duet'|null, reason: 'instrumental'|'unknown'|'ensemble'|'group'|null }}
 */
export function kindFromSingers({ singers, ensemble, instrumental }) {
  if (instrumental) return { kind: null, reason: 'instrumental' };
  if (ensemble) return { kind: null, reason: 'ensemble' };
  if (singers.length === 1) return { kind: 'solo', reason: null };
  if (singers.length === 2) return { kind: 'duet', reason: null };
  return { kind: null, reason: singers.length ? 'group' : 'unknown' };
}

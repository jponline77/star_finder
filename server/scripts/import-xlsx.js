#!/usr/bin/env node
// Import the STAR spreadsheet (+ seed corrections/shows/media) into SQLite. Idempotent.
//
//   npm run import                         # server/seed/star_spreadsheet.xlsx → server/data/star.db
//   npm run import -- --reset              # delete the DB first (refuses if it's in use; --force to skip check)
//   npm run import -- path/to/other.xlsx   # a different spreadsheet
//   npm run import -- --overwrite-edits    # also overwrite spreadsheet rows an admin edited (or deleted) on the website
//   npm run import -- --allow-deletions    # allow removing more than a few stale spreadsheet songs
//   npm run import -- --adopt-community    # a community show/song with a spreadsheet row's name becomes the official one
//   options: --db <path>  --seed-dir <dir>  --media-dir <dir>  --uploads-dir <dir>  --quiet
// Relative paths are resolved from the directory you run the command in.
//
// Seed files (all optional, in --seed-dir, default server/seed/): corrections.json, shows.json, media.json
// (formats in SPEC §6) and festivals.json (SPEC §7b: upserted by slug; festivals added, changed or
// deleted on the website are kept that way unless --overwrite-edits; festivals missing from the file
// are never deleted).
// Community rows (source='community') are never modified or deleted (unless --adopt-community).
// Spreadsheet rows are matched by a stable key made from their RAW spreadsheet values
// (songs.import_key / shows.import_key), so an admin renaming or moving a row on the website doesn't
// make the next import create a duplicate; rows an admin deleted stay deleted.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import Database from 'better-sqlite3';
import { openDb, SERVER_ROOT, DEFAULT_DB_PATH, nowIso } from '../src/db.js';
import { fold } from '../src/lib/text.js';
import { uniqueSlug } from '../src/lib/slug.js';
import { GENRES, normalizeVocalRange, fixSubGenre, matchExisting } from '../src/lib/vocab.js';
import { isItunesPreviewHost, isAppleHost } from '../src/lib/validate.js';
import { songImportKey, showImportKey, songNameKey, showNameKey } from '../src/lib/import-keys.js';
import { deleteIfUnreferenced } from '../src/lib/uploads.js';
import { relinkSiteRows } from '../src/lib/catalog.js';
import { resolveUserPath } from '../src/lib/paths.js';
import { readFestivalSeed, upsertFestivals } from '../src/lib/festivals.js';
import { isSeedImageName, MISSING_IMAGES_HINT } from '../src/lib/seed-media.js';

export const DEFAULT_XLSX = path.join(SERVER_ROOT, 'seed', 'star_spreadsheet.xlsx');
export const DEFAULT_SEED_DIR = path.join(SERVER_ROOT, 'seed');
export const DEFAULT_MEDIA_DIR = path.join(SERVER_ROOT, 'media');
export const DEFAULT_UPLOADS_DIR = path.join(SERVER_ROOT, 'uploads');

// Column layout (1-based). Solos A–H, duets J–S (duets list Show before the characters).
// The header row ("Song", …, "Show") is located, not assumed (it is row 2 in the STAR spreadsheet).
const SOLO_COLS = { title: 1, character: 2, show: 3, genre: 4, subGenre: 5, range: 6, length: 7, mature: 8 };
const DUET_COLS = { title: 10, show: 11, character1: 12, character2: 13, genre: 14, subGenre: 15, range1: 16, range2: 17, length: 18, mature: 19 };
const HEADER_SEARCH_ROWS = 10;

/** A spreadsheet that can't be imported safely (wrong layout, nothing to read, …). */
export class ImportError extends Error {}

// ---------------------------------------------------------------------------------------------
// Spreadsheet parsing
// ---------------------------------------------------------------------------------------------

/** Plain trimmed text of an exceljs cell value (rich text, hyperlinks, formulas handled). */
export function cellText(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return cellText(value.richText.map((r) => r.text ?? '').join(''));
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return cellText(value.text);
    if ('error' in value) return null;
    return null;
  }
  const s = String(value).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

/**
 * Spreadsheet length → seconds. Excel stored "m:ss" as time-of-day "h:mm", so 02:33:00 means
 * 2 min 33 s = 153 s, i.e. seconds = minutes-since-midnight. Accepts Date (UTC), a day-fraction
 * number (round(v*24*60)), or strings "2:33" / "02:33:00".
 * @returns {number|null}
 */
export function spreadsheetLengthToSeconds(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const t = value.getTime();
    if (Number.isNaN(t)) return null;
    const midnight = Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
    return Math.round((t - midnight) / 60000);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 24 * 60) : null;
  if (typeof value === 'object') {
    if ('result' in value) return spreadsheetLengthToSeconds(value.result);
    return spreadsheetLengthToSeconds(cellText(value));
  }
  const s = String(value).trim();
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(s); // "02:33:00" = the h:mm quirk
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^\d+(\.\d+)?$/.exec(s);
  if (m) return Math.round(Number(s) * 24 * 60);
  return null;
}

const yes = (v) => /^(y|yes|true|1)$/i.test(String(cellText(v) ?? ''));

/**
 * Read raw (trimmed, uncorrected) rows from the spreadsheet.
 * @param {string} xlsxPath
 * @returns {Promise<{ rows: RawRow[], warnings: string[] }>}
 *
 * @typedef {{ kind: 'solo'|'duet', row: number, title: string, show: string|null, characters: (string|null)[],
 *   genre: string|null, subGenre: string|null, ranges: (string|null)[], lengthSeconds: number|null, mature: boolean }} RawRow
 */
export async function readSpreadsheet(xlsxPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const name = path.basename(xlsxPath);
  if (!wb.getWorksheet('Sheet1') && wb.getWorksheet('Solos') && wb.getWorksheet('Duets')) {
    throw new ImportError(`${name} looks like the list downloaded from the website (separate "Solos" and "Duets" sheets). `
      + 'Import the original STAR spreadsheet layout instead: one sheet, solos in columns A–H and duets in columns J–S.');
  }
  const ws = wb.getWorksheet('Sheet1') ?? wb.worksheets[0];
  if (!ws) throw new ImportError(`No worksheet found in ${name}`);
  const rows = [];
  const warnings = [];
  const heading = (row, col) => fold(cellText(row.getCell(col).value) ?? '');
  let headerRow = null;
  let hasSolos = false;
  let hasDuets = false;
  for (let r = 1; r <= Math.min(HEADER_SEARCH_ROWS, ws.rowCount); r++) {
    const row = ws.getRow(r);
    hasSolos = heading(row, SOLO_COLS.title) === 'song' && heading(row, SOLO_COLS.show) === 'show';
    hasDuets = heading(row, DUET_COLS.title) === 'song' && heading(row, DUET_COLS.show) === 'show';
    if (hasSolos || hasDuets) {
      headerRow = r;
      break;
    }
  }
  if (headerRow === null) {
    throw new ImportError(`Couldn't find the header row in ${name} ("Song" … "Show" in columns A–C for solos and/or J–K for duets). `
      + 'Is this the STAR spreadsheet?');
  }
  if (!hasSolos) warnings.push(`${name}: no solo columns (A–H) found — only duets were read`);
  if (!hasDuets) warnings.push(`${name}: no duet columns (J–S) found — only solos were read`);
  const lengthOf = (row, col, label) => {
    const raw = row.getCell(col).value;
    const secs = spreadsheetLengthToSeconds(raw);
    if (raw !== null && raw !== undefined && raw !== '' && (secs === null || secs <= 0 || secs >= 3600)) {
      warnings.push(`${label}: couldn't read length ${JSON.stringify(raw)} — left empty`);
      return null;
    }
    return secs;
  };
  const last = ws.rowCount;
  for (let r = headerRow + 1; r <= last; r++) {
    const row = ws.getRow(r);
    const t = (c) => cellText(row.getCell(c).value);
    const soloTitle = hasSolos ? t(SOLO_COLS.title) : null;
    if (soloTitle) {
      const label = `Solo row ${r} "${soloTitle}"`;
      rows.push({
        kind: 'solo', row: r, title: soloTitle, show: t(SOLO_COLS.show),
        characters: [t(SOLO_COLS.character)],
        genre: t(SOLO_COLS.genre), subGenre: t(SOLO_COLS.subGenre),
        ranges: [t(SOLO_COLS.range)],
        lengthSeconds: lengthOf(row, SOLO_COLS.length, label),
        mature: yes(row.getCell(SOLO_COLS.mature).value),
      });
    }
    const duetTitle = hasDuets ? t(DUET_COLS.title) : null;
    if (duetTitle) {
      const label = `Duet row ${r} "${duetTitle}"`;
      rows.push({
        kind: 'duet', row: r, title: duetTitle, show: t(DUET_COLS.show),
        characters: [t(DUET_COLS.character1), t(DUET_COLS.character2)],
        genre: t(DUET_COLS.genre), subGenre: t(DUET_COLS.subGenre),
        ranges: [t(DUET_COLS.range1), t(DUET_COLS.range2)],
        lengthSeconds: lengthOf(row, DUET_COLS.length, label),
        mature: yes(row.getCell(DUET_COLS.mature).value),
      });
    }
  }
  if (!rows.length) throw new ImportError(`${name} has no song rows under its header row — nothing was imported (and nothing deleted)`);
  return { rows, warnings };
}

// ---------------------------------------------------------------------------------------------
// Seed files
// ---------------------------------------------------------------------------------------------

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Could not parse ${file}: ${err.message}`);
  }
}

/**
 * Load corrections.json / shows.json / media.json / festivals.json from `seedDir` (each optional).
 * `festivals` is null when festivals.json is missing (the festivals table is then left alone).
 * @param {string} seedDir
 */
export function loadSeedFiles(seedDir) {
  const corrections = readJsonIfExists(path.join(seedDir, 'corrections.json')) ?? {};
  const shows = readJsonIfExists(path.join(seedDir, 'shows.json')) ?? [];
  const media = readJsonIfExists(path.join(seedDir, 'media.json')) ?? {};
  const festivals = readFestivalSeed(path.join(seedDir, 'festivals.json'));
  if (typeof corrections !== 'object' || Array.isArray(corrections)) throw new Error('corrections.json must be an object');
  if (!Array.isArray(shows)) throw new Error('shows.json must be an array');
  if (typeof media !== 'object' || Array.isArray(media)) throw new Error('media.json must be an object');
  return {
    corrections,
    shows,
    media,
    festivals,
    present: {
      corrections: fs.existsSync(path.join(seedDir, 'corrections.json')),
      shows: fs.existsSync(path.join(seedDir, 'shows.json')),
      media: fs.existsSync(path.join(seedDir, 'media.json')),
      festivals: festivals !== null,
    },
  };
}

const CORRECTION_MAPS = ['shows', 'characters', 'titles', 'subGenres', 'vocalRanges', 'parts', 'notes'];

/** A lookup over one corrections map that records which keys were used. */
class CorrectionMap {
  constructor(name, obj) {
    this.name = name;
    this.map = new Map();
    this.folded = new Map();
    this.used = new Set();
    this.applied = 0;
    for (const [k, v] of Object.entries(obj && typeof obj === 'object' ? obj : {})) {
      if (k.startsWith('_')) continue; // "_comment" etc.
      this.map.set(k, v);
      this.folded.set(fold(k).replace(/\s+/g, ' ').trim(), k);
    }
  }

  /** @returns {{ found: boolean, value?: any }} exact key first, then accent/case/space-insensitive. */
  get(key) {
    let k = this.map.has(key) ? key : null;
    if (k === null) k = this.folded.get(fold(key).replace(/\s+/g, ' ').trim()) ?? null;
    if (k === null) return { found: false };
    this.used.add(k);
    return { found: true, value: this.map.get(k) };
  }

  unused() {
    return [...this.map.keys()].filter((k) => !this.used.has(k));
  }
}

/**
 * Apply built-in normalizations + corrections.json to raw rows.
 * Order: titles/shows/characters → vocalRanges/subGenres → parts override → notes.
 * @param {RawRow[]} rawRows
 * @param {object} corrections
 */
export function normalizeRows(rawRows, corrections = {}) {
  const maps = Object.fromEntries(CORRECTION_MAPS.map((n) => [n, new CorrectionMap(n, corrections[n])]));
  const warnings = [];
  const songs = [];
  const seenSubGenres = [];
  const bump = (name, before, after) => {
    if (before !== after) maps[name].applied++;
  };

  for (const r of rawRows) {
    const label = `${r.kind === 'solo' ? 'Solo' : 'Duet'} row ${r.row} "${r.title}"`;
    if (!r.show) {
      warnings.push(`${label}: no show — skipped`);
      continue;
    }
    const partsKey = `${r.kind}|${r.show}|${r.title}`;

    // 1. titles / shows / characters
    const t = maps.titles.get(`${r.show}|${r.title}`);
    const title = t.found && typeof t.value === 'string' && t.value.trim() ? t.value.trim() : r.title;
    bump('titles', r.title, title);
    const s = maps.shows.get(r.show);
    const show = s.found && typeof s.value === 'string' && s.value.trim() ? s.value.trim() : r.show;
    bump('shows', r.show, show);
    const characters = r.characters.map((c) => {
      if (!c) return c;
      const m = maps.characters.get(`${r.show}|${c}`);
      const out = m.found && typeof m.value === 'string' && m.value.trim() ? m.value.trim() : c;
      bump('characters', c, out);
      return out;
    });

    // 2. vocal ranges / sub-genres
    const ranges = r.ranges.map((raw, i) => {
      if (!raw) return null;
      const m = maps.vocalRanges.get(raw);
      const mapped = m.found && typeof m.value === 'string' ? m.value : raw;
      const norm = normalizeVocalRange(mapped);
      if (norm === undefined) {
        warnings.push(`${label}: unknown vocal range "${raw}" (part ${i + 1}) — left empty`);
        return null;
      }
      if (m.found) bump('vocalRanges', raw, norm);
      return norm;
    });
    let subGenre = r.subGenre;
    if (subGenre) {
      const m = maps.subGenres.get(subGenre);
      const mapped = m.found && typeof m.value === 'string' && m.value.trim() ? m.value.trim() : fixSubGenre(subGenre);
      if (m.found) bump('subGenres', subGenre, mapped);
      subGenre = matchExisting(mapped, seenSubGenres);
      if (!seenSubGenres.includes(subGenre)) seenSubGenres.push(subGenre);
    }
    const genre = r.genre ? matchExisting(r.genre, GENRES) : null;

    let parts = characters.map((c, i) => ({ position: i + 1, character: c, vocalRange: ranges[i] ?? null }));

    // 3. parts override (canonical, replaces parts entirely)
    const p = maps.parts.get(partsKey);
    if (p.found) {
      const expected = r.kind === 'duet' ? 2 : 1;
      if (!Array.isArray(p.value) || p.value.length !== expected || p.value.some((x) => !x || typeof x.character !== 'string' || !x.character.trim())) {
        warnings.push(`corrections.parts["${partsKey}"] must be an array of ${expected} {character, vocalRange} — ignored`);
      } else {
        parts = p.value.map((x, i) => {
          const vr = normalizeVocalRange(x.vocalRange ?? null);
          if (vr === undefined) warnings.push(`corrections.parts["${partsKey}"]: unknown vocal range "${x.vocalRange}" — left empty`);
          return { position: i + 1, character: x.character.trim(), vocalRange: vr ?? null };
        });
        maps.parts.applied++;
      }
    }

    // 4. notes
    let notes = null;
    const n = maps.notes.get(partsKey);
    if (n.found && typeof n.value === 'string' && n.value.trim()) {
      notes = n.value.trim();
      maps.notes.applied++;
    }

    const missing = parts.findIndex((x) => !x.character);
    if (missing !== -1) {
      warnings.push(`${label}: missing character for part ${missing + 1} — using "Unknown"`);
      parts = parts.map((x) => ({ ...x, character: x.character || 'Unknown' }));
    }

    songs.push({
      kind: r.kind,
      row: r.row,
      rawTitle: r.title,
      rawShow: r.show,
      title,
      show,
      genre,
      subGenre: subGenre ?? null,
      lengthSeconds: r.lengthSeconds,
      mature: r.mature,
      notes,
      parts,
    });
  }

  // Duplicate canonical keys: last row wins.
  const byKey = new Map();
  for (const s of songs) {
    const key = `${s.kind}|${fold(s.show)}|${fold(s.title)}`;
    if (byKey.has(key)) warnings.push(`Duplicate ${s.kind} "${s.title}" (${s.show}) on rows ${byKey.get(key).row} and ${s.row} — using row ${s.row}`);
    byKey.set(key, s);
  }

  const applied = Object.fromEntries(CORRECTION_MAPS.map((name) => [name, maps[name].applied]));
  const unused = Object.fromEntries(CORRECTION_MAPS.map((name) => [name, maps[name].unused()]).filter(([, keys]) => keys.length));
  return { songs: [...byKey.values()], warnings, applied, unused };
}

// ---------------------------------------------------------------------------------------------
// Database upsert
// ---------------------------------------------------------------------------------------------

// "Edited on the website": set by PUT /api/songs|shows only when a field really changed (uploads
// and no-op saves don't count), so corrections keep reaching rows that just got practice audio.
const edited = (row) => row.edited_at !== null && row.edited_at !== undefined;
const isUpload = (p) => typeof p === 'string' && p.startsWith('/uploads/');

function httpsOk(url, hostOk) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hostOk(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Most stale spreadsheet songs one import may delete without --allow-deletions. */
export function maxStaleDeletions(spreadsheetSongCount) {
  return Math.max(5, Math.floor(spreadsheetSongCount * 0.1));
}

/**
 * Import the spreadsheet into `db`.
 * @param {{ db: import('better-sqlite3').Database, xlsxPath?: string, seedDir?: string, mediaDir?: string,
 *   uploadsDir?: string, overwriteEdits?: boolean, allowDeletions?: boolean, adoptCommunity?: boolean,
 *   log?: (msg: string) => void }} opts
 * @returns {Promise<object>} summary
 */
export async function importSpreadsheet({
  db, xlsxPath = DEFAULT_XLSX, seedDir = DEFAULT_SEED_DIR, mediaDir = DEFAULT_MEDIA_DIR, uploadsDir = DEFAULT_UPLOADS_DIR,
  overwriteEdits = false, allowDeletions = false, adoptCommunity = false, log = () => {},
}) {
  const { rows, warnings: readWarnings } = await readSpreadsheet(xlsxPath);
  const seed = loadSeedFiles(seedDir);
  const { songs, warnings: normWarnings, applied, unused } = normalizeRows(rows, seed.corrections);
  const warnings = [...readWarnings, ...normWarnings, ...(seed.festivals?.warnings ?? [])];
  for (const [name, keys] of Object.entries(unused)) {
    for (const k of keys) warnings.push(`corrections.${name}: key "${k}" matched nothing in the spreadsheet`);
  }

  const showMeta = new Map();
  for (const entry of seed.shows) {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
      warnings.push('shows.json: entry without a name — ignored');
      continue;
    }
    showMeta.set(fold(entry.name.trim()), entry);
  }
  const mediaEntries = new Map();
  for (const [k, v] of Object.entries(seed.media)) {
    if (k.startsWith('_')) continue;
    const [kind, show, ...titleParts] = k.split('|');
    mediaEntries.set(`${fold(kind)}|${fold(show)}|${fold(titleParts.join('|'))}`, { key: k, value: v, used: false });
  }

  const summary = {
    xlsxPath,
    rows: { solos: rows.filter((r) => r.kind === 'solo').length, duets: rows.filter((r) => r.kind === 'duet').length },
    shows: { created: 0, updated: 0, unchanged: 0, skippedEdited: 0, skippedDeleted: 0, community: 0, adopted: 0, deleted: 0, withMetadata: 0, withImage: 0 },
    songs: { created: 0, updated: 0, skippedEdited: 0, skippedDeleted: 0, skippedCommunity: 0, adopted: 0, deleted: 0, keptStale: 0 },
    correctionsApplied: applied,
    notesApplied: applied.notes,
    mediaApplied: 0,
    mediaCleared: 0,
    // null when there is no festivals.json
    festivals: null,
    seedFiles: seed.present,
    warnings,
  };

  const q = {
    showByName: db.prepare('SELECT * FROM shows WHERE fold(name) = fold(?) ORDER BY id LIMIT 1'),
    showByKey: db.prepare('SELECT * FROM shows WHERE import_key = ?'),
    slugTaken: db.prepare('SELECT id FROM shows WHERE slug = ?'),
    insertShow: db.prepare(`INSERT INTO shows (name, slug, source, created_by, import_key, created_at, updated_at) VALUES (?, ?, 'spreadsheet', NULL, ?, ?, ?)`),
    renameShow: db.prepare('UPDATE shows SET name = ?, slug = ? WHERE id = ?'),
    setShowKey: db.prepare('UPDATE shows SET import_key = ? WHERE id = ?'),
    adoptShow: db.prepare("UPDATE shows SET source = 'spreadsheet', created_by = NULL, edited_at = NULL WHERE id = ?"),
    showMetaUpdate: db.prepare(`UPDATE shows SET composer = ?, lyricist = ?, book_writer = ?, year = ?, licensor = ?, licensing_note = ?,
      description = ?, wiki_url = ?, image_path = ?, image_credit = ?, image_source_url = ?, updated_at = created_at, edited_at = NULL WHERE id = ?`),
    songByKey: db.prepare('SELECT * FROM songs WHERE import_key = ?'),
    songByTitle: db.prepare('SELECT * FROM songs WHERE kind = ? AND show_id = ? AND fold(title) = fold(?)'),
    setSongKey: db.prepare('UPDATE songs SET import_key = ? WHERE id = ?'),
    insertSong: db.prepare(`INSERT INTO songs (kind, title, show_id, genre, sub_genre, length_seconds, mature, notes, source, created_by, import_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'spreadsheet', NULL, ?, ?, ?)`),
    updateSong: db.prepare(`UPDATE songs SET kind = ?, title = ?, show_id = ?, genre = ?, sub_genre = ?, length_seconds = ?, mature = ?, notes = ?,
      source = 'spreadsheet', created_by = NULL, import_key = ?, updated_at = created_at, edited_at = NULL WHERE id = ?`),
    updateMedia: db.prepare(`UPDATE songs SET preview_url = ?, artwork_path = ?, apple_music_url = ?, recording_name = ?, recording_artist = ?,
      itunes_track_id = ?, updated_at = created_at WHERE id = ?`),
    deleteParts: db.prepare('DELETE FROM song_parts WHERE song_id = ?'),
    insertPart: db.prepare('INSERT INTO song_parts (song_id, position, character, vocal_range) VALUES (?, ?, ?, ?)'),
    tombstoned: db.prepare('SELECT 1 FROM import_tombstones WHERE kind = ? AND import_key IN (SELECT value FROM json_each(?))'),
    clearTombstones: db.prepare('DELETE FROM import_tombstones WHERE kind = ? AND import_key IN (SELECT value FROM json_each(?))'),
    creatorName: db.prepare('SELECT display_name FROM users WHERE id = ?'),
  };
  const isTombstoned = (kind, keys) => Boolean(q.tombstoned.get(kind, JSON.stringify(keys)));
  const clearTombstones = (kind, keys) => q.clearTombstones.run(kind, JSON.stringify(keys));
  /** Website files an import replaced or whose row it deleted — removed after the commit. */
  const replacedUploads = new Set();

  /** Seed images (shows/<file>, art/<file>) named in the seed but not downloaded yet. */
  const missingImages = new Set();
  /**
   * A shows.json imageFile / media.json artworkFile → its file name, or null. The path is stored even
   * when the file isn't in mediaDir yet (third-party images aren't in the repository; `npm run
   * fetch-media` downloads them, and the website shows a gradient until then).
   */
  const seedImage = (file, subdir, label) => {
    if (file === null || file === undefined || (typeof file === 'string' && !file.trim())) return null;
    const name = typeof file === 'string' ? file.trim() : file;
    if (!isSeedImageName(name)) {
      warnings.push(`${label} ${JSON.stringify(file)} is not a plain image file name — ignored`);
      return null;
    }
    if (!fs.existsSync(path.join(mediaDir, subdir, name))) missingImages.add(`${subdir}/${name}`);
    return name;
  };

  const mediaValue = (value, key) => {
    if (value === null) return null;
    if (!value || typeof value !== 'object') {
      warnings.push(`media.json["${key}"]: expected an object or null — ignored`);
      return undefined;
    }
    let previewUrl = typeof value.previewUrl === 'string' ? value.previewUrl.trim() : null;
    if (previewUrl && !httpsOk(previewUrl, isItunesPreviewHost)) {
      warnings.push(`media.json["${key}"]: previewUrl must be https on itunes.apple.com/mzstatic.com — ignored`);
      previewUrl = null;
    }
    const artFile = seedImage(value.artworkFile, 'art', `media.json["${key}"]: artworkFile`);
    const artworkPath = artFile ? `/media/art/${artFile}` : null;
    const appleMusicUrl = typeof value.appleMusicUrl === 'string' && httpsOk(value.appleMusicUrl, isAppleHost) ? value.appleMusicUrl : null;
    const trackId = Number.isInteger(value.itunesTrackId) ? value.itunesTrackId : Number.isInteger(Number(value.itunesTrackId)) && value.itunesTrackId !== null ? Number(value.itunesTrackId) : null;
    return {
      previewUrl,
      artworkPath,
      appleMusicUrl,
      recordingName: typeof value.recordingName === 'string' ? value.recordingName.trim() || null : null,
      recordingArtist: typeof value.recordingArtist === 'string' ? value.recordingArtist.trim() || null : null,
      itunesTrackId: trackId,
    };
  };

  db.transaction(() => {
    const now = nowIso();
    const seenShowIds = new Set();
    const seenSongIds = new Set();
    const renameTo = (row, name) => {
      const other = q.showByName.get(name);
      if (other && other.id !== row.id) {
        warnings.push(`Show "${row.name}" should be renamed "${name}", but another show already has that name — kept "${row.name}"`);
        return row;
      }
      const slug = uniqueSlug(name, (sl) => {
        const hit = q.slugTaken.get(sl);
        return Boolean(hit) && hit.id !== row.id;
      });
      q.renameShow.run(name, slug, row.id);
      return { ...row, name, slug };
    };

    // ---- shows ----
    /** @type {Map<string, number>} fold(canonical show) → id */
    const showIds = new Map();
    const rawNamesByShow = new Map();
    for (const s of songs) {
      const k = fold(s.show);
      if (!rawNamesByShow.has(k)) rawNamesByShow.set(k, { name: s.show, raws: new Set() });
      rawNamesByShow.get(k).raws.add(s.rawShow);
    }
    const communityConflicts = [];
    for (const [key, { name, raws }] of rawNamesByShow) {
      const rawKeys = [...new Set([...raws].map(showImportKey))].sort();
      // 1. the row this spreadsheet show was imported as before (survives renames on the website)
      let row = null;
      for (const k of rawKeys) {
        row = q.showByKey.get(k) ?? null;
        if (row) break;
      }
      if (row) {
        if (row.name !== name && (!edited(row) || overwriteEdits)) row = renameTo(row, name); // e.g. a new correction
      } else {
        // 2. older databases (no keys yet): match by name
        row = q.showByName.get(name) ?? null;
        if (row && row.name !== name && row.source === 'spreadsheet' && (!edited(row) || overwriteEdits)) row = renameTo(row, name);
        if (!row) {
          // A correction may have renamed a show imported earlier under its raw name.
          for (const raw of raws) {
            const old = q.showByName.get(raw);
            if (old && old.source === 'spreadsheet' && (!edited(old) || overwriteEdits)) {
              row = renameTo(old, name);
              break;
            }
          }
        }
        if (row && row.source === 'spreadsheet' && !row.import_key) q.setShowKey.run(rawKeys[0], row.id);
      }
      if (row && row.source === 'community') {
        if (!adoptCommunity) {
          const by = row.created_by ? q.creatorName.get(row.created_by)?.display_name : null;
          communityConflicts.push(`"${row.name}" (show #${row.id}${by ? `, added by "${by}"` : ''})`);
          continue;
        }
        // --adopt-community: the student's show becomes the official one (admins edit it from now on;
        // the student's own songs in it stay theirs).
        q.adoptShow.run(row.id);
        if (!row.import_key) q.setShowKey.run(rawKeys[0], row.id);
        if (row.name !== name) row = renameTo({ ...row, source: 'spreadsheet' }, name);
        row = { ...row, source: 'spreadsheet', edited_at: null };
        summary.shows.adopted++;
        warnings.push(`Community show "${name}" (#${row.id}) was adopted as the official spreadsheet show`);
      }
      let id;
      if (!row) {
        if (!overwriteEdits && isTombstoned('show', [...rawKeys, showNameKey(name)])) {
          summary.shows.skippedDeleted++;
          warnings.push(`Show "${name}" was deleted on the website — not re-created, and its songs were skipped (use --overwrite-edits to restore)`);
          continue;
        }
        clearTombstones('show', [...rawKeys, showNameKey(name)]);
        const slug = uniqueSlug(name, (sl) => Boolean(q.slugTaken.get(sl)));
        id = Number(q.insertShow.run(name, slug, rawKeys[0], now, now).lastInsertRowid);
        row = { id, source: 'spreadsheet', created_at: now, updated_at: now, edited_at: null, name, image_path: null };
        summary.shows.created++;
      } else {
        id = row.id;
      }
      showIds.set(key, id);
      seenShowIds.add(id);

      const meta = showMeta.get(key);
      if (meta) meta.__used = true;
      if (edited(row) && !overwriteEdits) {
        summary.shows.skippedEdited++;
        continue;
      }
      if (!meta) {
        if (row.created_at !== now) summary.shows.unchanged++;
        continue;
      }
      const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      let image = [null, null, null];
      if (isUpload(row.image_path)) {
        // A poster uploaded (or fetched) on the website wins over the seed poster.
        image = [row.image_path, row.image_credit ?? null, row.image_source_url ?? null];
      } else {
        const imageFile = seedImage(meta.imageFile, 'shows', `shows.json "${meta.name}": imageFile`);
        if (imageFile) image = [`/media/shows/${imageFile}`, str(meta.imageCredit), str(meta.imageSourceUrl)];
      }
      const year = Number.isInteger(meta.year) ? meta.year : Number.isInteger(Number(meta.year)) && meta.year !== null && meta.year !== '' ? Number(meta.year) : null;
      q.showMetaUpdate.run(
        str(meta.composer), str(meta.lyricist), str(meta.bookWriter), year, str(meta.licensor), str(meta.licensingNote),
        str(meta.description), str(meta.wikiUrl), image[0], image[1], image[2], id,
      );
      summary.shows.withMetadata++;
      if (image[0]) summary.shows.withImage++;
      if (row.created_at !== now) summary.shows.updated++;
    }
    if (communityConflicts.length) {
      throw new ImportError(`These spreadsheet shows already exist as community shows added by students: ${communityConflicts.join(', ')}. `
        + 'Nothing was imported. Re-run with --adopt-community to make them the official shows (admins edit them from then on; '
        + "the students' own songs stay theirs), or rename/delete those community shows first.");
    }
    for (const [, entry] of showMeta) {
      if (!entry.__used) warnings.push(`shows.json: "${entry.name}" doesn't match any show in the spreadsheet — ignored`);
    }

    // ---- songs ----
    for (const s of songs) {
      const showId = showIds.get(fold(s.show));
      const key = songImportKey(s.kind, s.rawShow, s.rawTitle);
      const media = mediaEntries.get(`${s.kind}|${fold(s.show)}|${fold(s.title)}`);
      if (media) media.used = true; // matched a spreadsheet row, even if that row is skipped below
      // 1. the row this spreadsheet row was imported as before (survives renames/moves on the website)
      let row = q.songByKey.get(key) ?? null;
      if (!row && showId) {
        // 2. older databases (no keys yet): match by canonical title, then by the raw title
        row = q.songByTitle.get(s.kind, showId, s.title) ?? null;
        if (!row && fold(s.rawTitle) !== fold(s.title)) {
          const old = q.songByTitle.get(s.kind, showId, s.rawTitle);
          if (old && old.source === 'spreadsheet') row = old; // renamed by a titles correction
        }
      }
      if (row && seenSongIds.has(row.id)) row = null; // don't let two rows collapse into one
      if (!showId) {
        // its show was deleted on the website (see above)
        if (row) seenSongIds.add(row.id);
        summary.songs.skippedDeleted++;
        continue;
      }
      if (row && row.source === 'community') {
        if (!adoptCommunity) {
          summary.songs.skippedCommunity++;
          warnings.push(`"${s.title}" (${s.show}, ${s.kind}) already exists as a community song — spreadsheet row skipped (use --adopt-community to make it the official row)`);
          seenSongIds.add(row.id);
          continue;
        }
        summary.songs.adopted++;
        row = { ...row, edited_at: null };
      }
      if (row && edited(row) && !overwriteEdits) {
        summary.songs.skippedEdited++;
        if (!row.import_key) q.setSongKey.run(key, row.id);
        seenSongIds.add(row.id);
        continue;
      }
      if (row) {
        // e.g. a new titles correction that collides with a song someone added on the website
        const clash = q.songByTitle.get(s.kind, showId, s.title);
        if (clash && clash.id !== row.id) {
          warnings.push(`"${s.title}" (${s.show}, ${s.kind}): song #${clash.id} (${clash.source}) already has that title — song #${row.id} was left as it is`);
          seenSongIds.add(row.id);
          seenSongIds.add(clash.id);
          continue;
        }
      }
      let id;
      if (row) {
        id = row.id;
        q.updateSong.run(s.kind, s.title, showId, s.genre, s.subGenre, s.lengthSeconds, s.mature ? 1 : 0, s.notes, key, id);
        summary.songs.updated++;
      } else {
        const tombstoneKeys = [key, songNameKey(s.kind, s.show, s.title)];
        if (!overwriteEdits && isTombstoned('song', tombstoneKeys)) {
          summary.songs.skippedDeleted++;
          continue;
        }
        clearTombstones('song', tombstoneKeys);
        id = Number(q.insertSong.run(s.kind, s.title, showId, s.genre, s.subGenre, s.lengthSeconds, s.mature ? 1 : 0, s.notes, key, now, now).lastInsertRowid);
        summary.songs.created++;
      }
      seenSongIds.add(id);
      q.deleteParts.run(id);
      for (const p of s.parts) q.insertPart.run(id, p.position, p.character, p.vocalRange);

      if (media) {
        const mv = mediaValue(media.value, media.key);
        if (mv !== undefined && isUpload(row?.artwork_path)) replacedUploads.add(row.artwork_path);
        if (mv === null) {
          q.updateMedia.run(null, null, null, null, null, null, id);
          summary.mediaCleared++;
        } else if (mv) {
          q.updateMedia.run(mv.previewUrl, mv.artworkPath, mv.appleMusicUrl, mv.recordingName, mv.recordingArtist, mv.itunesTrackId, id);
          summary.mediaApplied++;
        }
      }
    }
    if (summary.songs.skippedDeleted) {
      warnings.push(`${summary.songs.skippedDeleted} spreadsheet song(s) were deleted on the website and were not re-created (use --overwrite-edits to restore them)`);
    }
    for (const m of mediaEntries.values()) {
      if (!m.used) warnings.push(`media.json: key "${m.key}" doesn't match any song — ignored`);
    }

    // ---- stale spreadsheet rows (no longer in the spreadsheet) ----
    const allSpreadsheet = db.prepare("SELECT s.*, (SELECT count(*) FROM comments c WHERE c.song_id = s.id) AS comment_count FROM songs s WHERE source = 'spreadsheet'").all();
    const stale = allSpreadsheet.filter((r) => !seenSongIds.has(r.id));
    const toDelete = [];
    for (const r of stale) {
      if ((edited(r) && !overwriteEdits) || r.comment_count > 0 || r.audio_path || r.custom_artwork_path) {
        summary.songs.keptStale++;
        warnings.push(`Song "${r.title}" (id ${r.id}) is no longer in the spreadsheet but was kept (it has comments, uploads or website edits)`);
        continue;
      }
      toDelete.push(r);
    }
    // A spreadsheet with the wrong layout, a truncated copy or the wrong file would otherwise wipe
    // the catalogue (and new ids break shared links and setlists when it's re-imported).
    const maxDeletions = maxStaleDeletions(allSpreadsheet.length);
    if (toDelete.length > maxDeletions && !allowDeletions) {
      throw new ImportError(`This spreadsheet would remove ${toDelete.length} of the ${allSpreadsheet.length} spreadsheet songs on the site `
        + `(more than ${maxDeletions}). Nothing was changed. Check that it's the right file; if those songs really were removed `
        + 'from the spreadsheet, re-run with --allow-deletions.');
    }
    for (const r of toDelete) {
      db.prepare('DELETE FROM songs WHERE id = ?').run(r.id);
      if (isUpload(r.artwork_path)) replacedUploads.add(r.artwork_path);
      summary.songs.deleted++;
    }
    const staleShows = db.prepare(`SELECT sh.* FROM shows sh WHERE sh.source = 'spreadsheet'
      AND NOT EXISTS (SELECT 1 FROM songs s WHERE s.show_id = sh.id)
      AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.show_id = sh.id)`).all()
      .filter((r) => !seenShowIds.has(r.id) && (!edited(r) || overwriteEdits));
    for (const r of staleShows) {
      db.prepare('DELETE FROM shows WHERE id = ?').run(r.id);
      if (isUpload(r.image_path)) replacedUploads.add(r.image_path);
      summary.shows.deleted++;
    }

    // ---- festivals (SPEC §7b) ----
    if (seed.festivals) {
      summary.festivals = upsertFestivals(db, seed.festivals.entries, { overwriteEdits, now });
      if (summary.festivals.skippedEdited) {
        warnings.push(`${summary.festivals.skippedEdited} festival(s) were added or changed on the website and were kept as they are (use --overwrite-edits to replace them from festivals.json)`);
      }
      if (summary.festivals.skippedDeleted) {
        warnings.push(`${summary.festivals.skippedDeleted} festival(s) were deleted on the website and were not re-created (use --overwrite-edits to restore them from festivals.json)`);
      }
    }
  })();

  for (const p of replacedUploads) await deleteIfUnreferenced(db, uploadsDir, p);

  // Song catalog (SPEC §7c): link new/renamed spreadsheet shows and songs to it (only the link columns).
  summary.catalogLinks = relinkSiteRows(db);

  // One line for all of them: on a fresh checkout every poster/cover is missing until fetch-media runs.
  summary.missingImages = [...missingImages].sort();
  if (missingImages.size) {
    const n = missingImages.size;
    warnings.push(`${n} image${n === 1 ? '' : 's'} missing from ${mediaDir} — ${MISSING_IMAGES_HINT}`);
  }

  const counts = db.prepare(`SELECT sum(kind = 'solo') AS solos, sum(kind = 'duet') AS duets, count(*) AS songs,
    sum(source = 'community') AS community, (SELECT count(*) FROM shows) AS shows FROM songs`).get();
  summary.totals = {
    songs: counts.songs ?? 0, solos: counts.solos ?? 0, duets: counts.duets ?? 0, community: counts.community ?? 0, shows: counts.shows ?? 0,
  };
  printSummary(summary, log);
  return summary;
}

function printSummary(s, log) {
  log(`📄 Read ${s.rows.solos} solo rows and ${s.rows.duets} duet rows from ${path.basename(s.xlsxPath)}`);
  const files = Object.entries(s.seedFiles).map(([k, v]) => `${k}.json ${v ? '✓' : '—'}`).join(', ');
  log(`🌱 Seed files: ${files}`);
  log(`🎭 Shows: ${s.shows.created} created, ${s.shows.updated} updated, ${s.shows.withMetadata} with metadata, ${s.shows.withImage} with posters` +
    (s.shows.skippedEdited ? `, ${s.shows.skippedEdited} kept (edited on the website)` : '') +
    (s.shows.skippedDeleted ? `, ${s.shows.skippedDeleted} not re-created (deleted on the website)` : '') +
    (s.shows.adopted ? `, ${s.shows.adopted} community shows adopted` : '') +
    (s.shows.deleted ? `, ${s.shows.deleted} stale removed` : ''));
  log(`🎵 Songs: ${s.songs.created} created, ${s.songs.updated} updated` +
    (s.songs.skippedEdited ? `, ${s.songs.skippedEdited} kept (edited on the website — use --overwrite-edits to replace)` : '') +
    (s.songs.skippedCommunity ? `, ${s.songs.skippedCommunity} skipped (community duplicates)` : '') +
    (s.songs.skippedDeleted ? `, ${s.songs.skippedDeleted} not re-created (deleted on the website)` : '') +
    (s.songs.adopted ? `, ${s.songs.adopted} community songs adopted` : '') +
    (s.songs.deleted ? `, ${s.songs.deleted} stale removed` : ''));
  const c = s.correctionsApplied;
  log(`✏️  Corrections applied: titles ${c.titles}, shows ${c.shows}, characters ${c.characters}, vocalRanges ${c.vocalRanges}, subGenres ${c.subGenres}, parts ${c.parts}, notes ${c.notes}`);
  log(`🎧 Media: ${s.mediaApplied} applied, ${s.mediaCleared} cleared`);
  if (s.festivals) {
    const f = s.festivals;
    log(`📍 Festivals: ${f.created} created, ${f.updated} updated, ${f.unchanged} unchanged` +
      (f.skippedEdited ? `, ${f.skippedEdited} kept (changed on the website — use --overwrite-edits to replace)` : '') +
      (f.skippedDeleted ? `, ${f.skippedDeleted} not re-created (deleted on the website)` : '') +
      (f.notInSeed ? `, ${f.notInSeed} not in festivals.json (kept)` : ''));
  }
  log(`📊 Database now has ${s.totals.songs} songs (${s.totals.solos} solos, ${s.totals.duets} duets; ${s.totals.community} community) in ${s.totals.shows} shows`);
  if (s.warnings.length) {
    log(`⚠️  ${s.warnings.length} warning(s):`);
    for (const w of s.warnings) log(`   - ${w}`);
  }
}

/** Throw if another process has the DB open (can't leave WAL mode while others are connected). */
export function assertDbNotInUse(dbPath) {
  if (!fs.existsSync(dbPath)) return;
  let probe;
  try {
    probe = new Database(dbPath, { timeout: 0 });
    const mode = probe.pragma('journal_mode = DELETE', { simple: true });
    if (String(mode).toLowerCase() !== 'delete') throw new Error('busy');
  } catch {
    throw new Error(`The database ${dbPath} is in use (is the server running?). Stop it and try again, or pass --force.`);
  } finally {
    probe?.close();
  }
}

function parseArgs(argv) {
  const opts = {
    reset: false, force: false, overwriteEdits: false, allowDeletions: false, adoptCommunity: false, quiet: false,
    xlsxPath: null, dbPath: null, seedDir: null, mediaDir: null, uploadsDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reset') opts.reset = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--overwrite-edits') opts.overwriteEdits = true;
    else if (a === '--allow-deletions') opts.allowDeletions = true;
    else if (a === '--adopt-community') opts.adoptCommunity = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--db') opts.dbPath = argv[++i];
    else if (a === '--seed-dir') opts.seedDir = argv[++i];
    else if (a === '--media-dir') opts.mediaDir = argv[++i];
    else if (a === '--uploads-dir') opts.uploadsDir = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else opts.xlsxPath = a;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/import-xlsx.js [--reset] [--force] [--overwrite-edits] [--allow-deletions] [--adopt-community]\n'
      + '         [--db path] [--seed-dir dir] [--media-dir dir] [--uploads-dir dir] [file.xlsx]\n'
      + 'Relative paths are resolved from the directory you run the command in.');
    return;
  }
  const userPath = (p, env, dflt) => (p ?? env ? resolveUserPath(p ?? env) : dflt);
  const dbPath = userPath(opts.dbPath, process.env.STAR_DB_PATH, DEFAULT_DB_PATH);
  const xlsxPath = userPath(opts.xlsxPath, undefined, DEFAULT_XLSX);
  const seedDir = userPath(opts.seedDir, undefined, DEFAULT_SEED_DIR);
  const mediaDir = userPath(opts.mediaDir, process.env.STAR_MEDIA_DIR, DEFAULT_MEDIA_DIR);
  const uploadsDir = userPath(opts.uploadsDir, process.env.STAR_UPLOADS_DIR, DEFAULT_UPLOADS_DIR);
  if (!fs.existsSync(xlsxPath)) throw new Error(`Spreadsheet not found: ${xlsxPath}`);
  if (opts.reset && fs.existsSync(dbPath)) {
    if (!opts.force) assertDbNotInUse(dbPath);
    for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(dbPath + suffix, { force: true });
    console.log(`🧹 Deleted ${dbPath}`);
  }
  const db = openDb(dbPath);
  try {
    await importSpreadsheet({
      db, xlsxPath, seedDir, mediaDir, uploadsDir,
      overwriteEdits: opts.overwriteEdits, allowDeletions: opts.allowDeletions, adoptCommunity: opts.adoptCommunity,
      log: opts.quiet ? () => {} : (m) => console.log(m),
    });
    console.log(`✅ Import complete → ${dbPath}`);
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

// /api/songs — browse, detail, create/edit/delete, audio uploads (SPEC §5, §5a).
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { HttpError, badRequest, notFound, forbidden, conflict } from '../lib/errors.js';
import {
  Validator, parseId, isItunesPreviewHost, isMzstaticHost, isAppleHost,
} from '../lib/validate.js';
import { parseLength } from '../lib/text.js';
import {
  KINDS, GENRES, normalizeVocalRange, fixSubGenre, matchExisting, VOCAL_RANGES,
} from '../lib/vocab.js';
import { uniqueSlug } from '../lib/slug.js';
import {
  singleFileUpload, sniffAudio, sniffImage, storeUploadRange, saveBuffer, deleteIfUnreferenced, requireFile, removeTemp,
  AUDIO_MAX_BYTES, IMAGE_MAX_BYTES,
} from '../lib/uploads.js';
import { stripImageMetadata, imageDimensions, imageSizeProblem } from '../lib/image-meta.js';
import {
  relinkSiteRows, siteShowMatchesCatalog, catalogShowCredits, songTitleKeys, songTitleMatchLevel,
} from '../lib/catalog.js';
import { fold } from '../lib/text.js';
import { downloadRemoteImage } from '../lib/remote-image.js';
import { requireUser, canEdit } from '../middleware.js';
import {
  listSongs, getSong, getSongRow, similarSongs, SONG_SORTS, findShowRowByName, distinctGenres, distinctSubGenres,
  songTombstoneKey, othersCommentCount,
} from '../repo.js';
import { nowIso } from '../db.js';

const NOT_YOURS = 'You can only edit songs you added';

/** Most songs one GET /api/songs returns (also the default when no `limit` is given). */
export const SONGS_MAX_PAGE = 5000;

/** Flatten repeated/comma-separated query values into a trimmed, non-empty list. */
export function toList(value) {
  if (value === undefined || value === null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr
    .flatMap((v) => String(v).split(','))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
}

const truthy = (v) => ['1', 'true', 'yes', 'on'].includes(String(Array.isArray(v) ? v[0] : v ?? '').toLowerCase());

/** Parse GET /api/songs query → listSongs filters (400 on invalid values). */
export function parseSongFilters(query) {
  const v = new Validator();
  const first = (x) => (Array.isArray(x) ? x[0] : x);
  const q = typeof first(query.q) === 'string' ? first(query.q).trim().slice(0, 200) : '';
  const kinds = toList(query.kind).map((k) => k.toLowerCase());
  for (const k of kinds) if (!KINDS.includes(k)) v.error('kind', 'kind must be solo or duet');
  const ranges = [];
  for (const raw of toList(query.range)) {
    const r = normalizeVocalRange(raw);
    if (!r) v.error('range', `Unknown vocal range "${raw}"`);
    else ranges.push(r);
  }
  const maxSeconds = v.integer('maxSeconds', first(query.maxSeconds), { min: 0, max: 100000 });
  const minSeconds = v.integer('minSeconds', first(query.minSeconds), { min: 0, max: 100000 });
  const limit = v.integer('limit', first(query.limit), { min: 1, max: SONGS_MAX_PAGE });
  const offset = v.integer('offset', first(query.offset), { min: 0, max: 1_000_000 }) ?? 0;
  const sort = first(query.sort) ? String(first(query.sort)).trim() : 'title';
  if (!SONG_SORTS.includes(sort)) v.error('sort', `sort must be one of: ${SONG_SORTS.join(', ')}`);
  v.check('Invalid filter');
  return {
    q: q || null,
    kinds,
    shows: toList(query.show),
    genres: toList(query.genre),
    subGenres: toList(query.subGenre),
    ranges,
    maxSeconds,
    minSeconds,
    hideMature: truthy(query.hideMature),
    hasAudio: truthy(query.hasAudio),
    sort,
    // "all matches" (SPEC), but never more than SONGS_MAX_PAGE rows per request
    limit: limit ?? SONGS_MAX_PAGE,
    offset,
  };
}

/** true for the plain "every song, default order" listing the Browse page loads (cacheable). */
function isDefaultListing(f) {
  return !f.q && !f.kinds.length && !f.shows.length && !f.genres.length && !f.subGenres.length && !f.ranges.length
    && f.maxSeconds === null && f.minSeconds === null && !f.hideMature && !f.hasAudio
    && f.sort === 'title' && f.limit === SONGS_MAX_PAGE && f.offset === 0;
}

const SEED_ARTWORK_RE = /^\/media\/art\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(jpe?g|png|webp|gif)$/;

/** A seed album-art file on disk under server/media/art (shared seed art, never deleted by the API). */
function isSeedArtwork(mediaDir, publicPath) {
  if (!SEED_ARTWORK_RE.test(publicPath)) return false;
  try {
    return fs.statSync(path.join(mediaDir, 'art', path.basename(publicPath))).isFile();
  } catch {
    return false;
  }
}

/**
 * Validate a POST/PUT song body. Returns normalized values; `preview` is undefined when the key is
 * absent (PUT keeps existing media), null to clear, or an object.
 * A local `preview.artworkUrl` is accepted only if it is the song's current artwork or a
 * seed image — never another song's downloaded file (which that song may delete). The song's own
 * uploaded art (shown as media.artworkUrl) sent back means "keep the recording art as it is".
 * `catalogSongId`: undefined = absent (PUT keeps the link), null = unlink, else a catalog song id
 * (checked here). `catalogShowId` (optional) links a show created implicitly from `showName`.
 * @param {import('../app.js').AppContext} ctx
 * @param {{ currentArtwork?: string|null, customArtwork?: string|null }} [opts]
 */
function parseSongBody(ctx, body, { currentArtwork = null, customArtwork = null } = {}) {
  const { db } = ctx;
  const v = new Validator();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Request body must be a JSON object');
  const kind = v.oneOf('kind', body.kind, KINDS, { required: true, label: 'Solo or duet' });
  const title = v.string('title', body.title, { required: true, max: 120, label: 'Title' });

  let showId = null;
  let showName = null;
  if (body.showId !== undefined && body.showId !== null && body.showId !== '') {
    showId = v.integer('showId', body.showId, { min: 1, label: 'Show' });
  } else {
    showName = v.string('showName', body.showName, { max: 120, label: 'Show name' });
    if (!showName) v.error('showName', 'Pick a show (or type the name of a new one)');
  }

  let genre = v.string('genre', body.genre, { max: 40, label: 'Genre' });
  if (genre) genre = matchExisting(genre, [...GENRES, ...distinctGenres(db)]);
  let subGenre = v.string('subGenre', body.subGenre, { max: 40, label: 'Sub-genre' });
  if (subGenre) subGenre = matchExisting(fixSubGenre(subGenre), distinctSubGenres(db));

  let lengthSeconds = null;
  if (body.lengthSeconds !== undefined && body.lengthSeconds !== null && body.lengthSeconds !== '') {
    lengthSeconds = v.integer('lengthSeconds', body.lengthSeconds, { min: 1, max: 3599, label: 'Length' });
  } else if (body.length !== undefined && body.length !== null && body.length !== '') {
    const n = typeof body.length === 'string' ? parseLength(body.length) : Number.NaN;
    if (!Number.isInteger(n) || !/:/.test(String(body.length))) v.error('length', 'Length must look like m:ss (e.g. 3:25)');
    else if (n < 1 || n > 3599) v.error('length', 'Length must be between 0:01 and 59:59');
    else lengthSeconds = n;
  }

  const mature = v.boolean('mature', body.mature, { label: 'Mature content' });
  const notes = v.string('notes', body.notes, { max: 2000, multiline: true, label: 'Notes' });

  const parts = [];
  const expected = kind === 'duet' ? 2 : 1;
  if (!Array.isArray(body.parts)) {
    v.error('parts', kind === 'duet' ? 'A duet needs 2 characters' : 'A solo needs 1 character');
  } else {
    if (kind && body.parts.length !== expected) {
      v.error('parts', kind === 'duet' ? 'A duet needs exactly 2 parts' : 'A solo needs exactly 1 part');
    }
    body.parts.slice(0, 2).forEach((p, i) => {
      const obj = p && typeof p === 'object' ? p : {};
      const character = v.string(`parts.${i}.character`, obj.character, { required: true, max: 80, label: 'Character' });
      const range = normalizeVocalRange(typeof obj.vocalRange === 'string' || obj.vocalRange == null ? obj.vocalRange : '?');
      if (range === undefined) v.error(`parts.${i}.vocalRange`, `Pick a vocal range: ${VOCAL_RANGES.join(', ')}`);
      parts.push({ position: i + 1, character, vocalRange: range ?? null });
    });
  }

  const audioLink = v.httpsUrl('audioLink', body.audioLink, { max: 500, label: 'Audio link' });

  let preview;
  if (body.preview === null) preview = null;
  else if (body.preview !== undefined) {
    const p = body.preview;
    if (typeof p !== 'object' || Array.isArray(p)) {
      v.error('preview', 'preview must be an object');
    } else {
      const previewUrl = v.httpsUrl('preview.previewUrl', p.previewUrl, {
        hosts: isItunesPreviewHost, hostMessage: 'Preview must come from Apple (itunes.apple.com / mzstatic.com)', label: 'Preview',
      });
      let artworkUrl = null;
      let artworkLocal = null;
      const art = typeof p.artworkUrl === 'string' ? p.artworkUrl.trim() : p.artworkUrl;
      if (typeof art === 'string' && art.startsWith('/')) {
        if ((currentArtwork && art === currentArtwork) || isSeedArtwork(ctx.mediaDir, art)) artworkLocal = art;
        else if (customArtwork && art === customArtwork) artworkLocal = currentArtwork; // null → no recording art
        else v.error('preview.artworkUrl', 'Unknown artwork file');
      } else {
        artworkUrl = v.httpsUrl('preview.artworkUrl', art, {
          hosts: isMzstaticHost, hostMessage: 'Artwork must come from Apple (mzstatic.com)', label: 'Artwork',
        });
      }
      const appleMusicUrl = v.httpsUrl('preview.appleMusicUrl', p.appleMusicUrl, {
        hosts: isAppleHost, hostMessage: 'Must be an Apple Music link', label: 'Apple Music link',
      });
      // Apple credits whole casts on some albums — shorten very long names instead of rejecting the song
      const clip = (x, n) => (typeof x === 'string' && x.trim().length > n ? `${x.trim().slice(0, n - 1).trimEnd()}…` : x);
      const recordingName = v.string('preview.recordingName', clip(p.recordingName, 300), { max: 300, label: 'Recording' });
      const recordingArtist = v.string('preview.recordingArtist', clip(p.recordingArtist, 300), { max: 300, label: 'Artist' });
      const itunesTrackId = v.integer('preview.itunesTrackId', p.itunesTrackId, { min: 1, label: 'iTunes track id' });
      preview = { previewUrl, artworkUrl, artworkLocal, appleMusicUrl, recordingName, recordingArtist, itunesTrackId };
    }
  }
  let catalogSongId;
  if (body.catalogSongId === null || body.catalogSongId === '') catalogSongId = null;
  else if (body.catalogSongId !== undefined) {
    catalogSongId = v.integer('catalogSongId', body.catalogSongId, { min: 1, label: 'Catalog song' });
    if (catalogSongId && !db.prepare('SELECT 1 FROM catalog_songs WHERE id = ?').get(catalogSongId)) {
      v.error('catalogSongId', "That song isn't in the catalog (any more) — pick it again or enter it manually");
    }
  }
  let catalogShowId = null;
  if (body.catalogShowId !== undefined && body.catalogShowId !== null && body.catalogShowId !== '') {
    catalogShowId = v.integer('catalogShowId', body.catalogShowId, { min: 1, label: 'Catalog show' });
    if (catalogShowId && !db.prepare('SELECT 1 FROM catalog_shows WHERE id = ?').get(catalogShowId)) {
      v.error('catalogShowId', "That show isn't in the catalog");
    }
  }
  v.check();
  return {
    kind, title, showId, showName, genre, subGenre, lengthSeconds, mature, notes, parts, audioLink, preview, catalogSongId, catalogShowId,
  };
}


const sameParts = (before, after) =>
  before.length === after.length
  && before.every((b, i) => b.position === after[i].position && b.character === after[i].character && (b.vocal_range ?? null) === after[i].vocalRange);

/** @param {import('../app.js').AppContext} ctx */
export function songsRouter(ctx) {
  const { db, uploadsDir, caps, uploadGuard, catalogCache } = ctx;
  const r = Router();

  function loadEditable(req) {
    const id = parseId(req.params.id);
    const row = id ? getSongRow(db, id) : null;
    if (!row) throw notFound('Song not found');
    if (!canEdit(req.user, row)) throw forbidden(NOT_YOURS);
    return row;
  }

  function resolveShow(input) {
    if (input.showId) {
      const show = db.prepare('SELECT * FROM shows WHERE id = ?').get(input.showId);
      if (!show) throw badRequest('Please fix the highlighted fields', { showId: "That show doesn't exist" });
      return { show, create: null };
    }
    const show = findShowRowByName(db, input.showName);
    return show ? { show, create: null } : { show: null, create: input.showName };
  }

  /**
   * The same song already on the list: same show and kind, and the same title (ignoring case,
   * accents, punctuation and a leading article — "What have I done" is "What Have I Done?") or the
   * same catalog song picked on the form ("Valjean's Soliloquy (What Have I Done?)" from the
   * catalog is the site's "What Have I Done?"). Another kind of the same song (a duet version of a
   * solo) is fine.
   */
  function findDuplicate(kind, showId, title, excludeId = null, catalogSongId = null) {
    if (!showId) return null;
    const rows = db.prepare('SELECT id, title, catalog_song_id FROM songs WHERE kind = ? AND show_id = ? AND id != ? ORDER BY id')
      .all(kind, showId, excludeId ?? -1);
    if (!rows.length) return null;
    const want = songTitleKeys(title);
    const folded = fold(title);
    return rows.find((r) => (catalogSongId && r.catalog_song_id === catalogSongId)
      || fold(r.title) === folded
      || songTitleMatchLevel(songTitleKeys(r.title), want) === 2) ?? null;
  }

  const duplicateError = (id) =>
    conflict('That song is already on the list', { existingId: String(id), title: 'That song is already on the list' }, { existingId: id });

  /** → { path, downloaded } — downloaded files belong to this request until the row is saved. */
  async function resolveArtwork(preview) {
    if (!preview) return { path: null, downloaded: false };
    if (preview.artworkLocal) return { path: preview.artworkLocal, downloaded: false };
    if (!preview.artworkUrl) return { path: null, downloaded: false };
    try {
      const p = await downloadRemoteImage(preview.artworkUrl, { uploadsDir, subdir: 'art', fetchImpl: ctx.fetchImpl });
      return { path: p, downloaded: true };
    } catch (err) {
      ctx.log.warn(`artwork download failed: ${err.message}`);
      return { path: null, downloaded: false };
    }
  }

  const insertShow = db.prepare(`INSERT INTO shows (name, slug, composer, lyricist, book_writer, year, wiki_url, catalog_show_id, catalog_link, source, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'community', ?)`);
  const slugTaken = db.prepare('SELECT 1 FROM shows WHERE slug = ?');
  /** A show created implicitly from `showName`; from the catalog it gets the link + credits/year. */
  function createShow(name, userId, catalogShowId = null) {
    const slug = uniqueSlug(name, (s) => Boolean(slugTaken.get(s)));
    const c = catalogShowId ? catalogShowCredits(db, catalogShowId) : null;
    return Number(insertShow.run(
      name, slug, c?.composer ?? null, c?.lyricist ?? null, c?.book_writer ?? null, c?.year ?? null, c?.wiki_url ?? null,
      c ? catalogShowId : null, c ? 'manual' : null, userId,
    ).lastInsertRowid);
  }

  /**
   * The catalog show the song form's choice points at (from catalogSongId, else catalogShowId), after
   * checking it is the same show as the site show the song goes into (by link or by name) → 400 if not.
   * @param {object|null} siteShow existing show row, or null when `newName` will be created
   */
  function catalogShowFor(input, siteShow, newName) {
    const catSong = input.catalogSongId ? db.prepare('SELECT show_id FROM catalog_songs WHERE id = ?').get(input.catalogSongId) : null;
    if (catSong && input.catalogShowId && input.catalogShowId !== catSong.show_id) {
      throw badRequest('Please fix the highlighted fields', { catalogShowId: "The catalog show doesn't match the catalog song" });
    }
    const catShowId = catSong?.show_id ?? input.catalogShowId ?? null;
    if (!catShowId) return null;
    const site = siteShow ?? { name: newName, catalog_show_id: null };
    if (!siteShowMatchesCatalog(db, site, catShowId)) {
      const cat = db.prepare('SELECT title FROM catalog_shows WHERE id = ?').get(catShowId);
      throw badRequest('Please fix the highlighted fields', {
        [catSong ? 'catalogSongId' : 'catalogShowId']: `That's from “${cat?.title ?? 'another show'}” in the catalog, not “${site.name}” — pick that show, or enter the song without the catalog`,
      });
    }
    return catShowId;
  }

  /**
   * After a save: link the song's show and the song to the catalog.
   * The show: picking a song from catalog show X links the site show to X only when the user may
   * edit the show (its owner or an admin) — then it's their choice ('manual'), and it may replace an
   * automatic link to a same-named show ("Parade" 1960 vs 1998). Anyone else's pick never re-points
   * a shared show; the automatic matcher (relinkSiteRows) decides, with the show's songs as votes.
   * The song: catalogSongId → 'manual'; null → 'none' (stays unlinked, also after restarts) — except
   * when the song just moved to another show, where null only drops the old link (the form sends it
   * then) and the song is matched again by title in its new show.
   */
  function linkToCatalog(user, showId, siteShow, catShowId, songId, input, { movedShow = false } = {}) {
    if (siteShow && catShowId && siteShow.catalog_show_id !== catShowId && siteShow.catalog_link !== 'none'
      && !(siteShow.catalog_link === 'manual' && siteShow.catalog_show_id) && canEdit(user, siteShow)) {
      db.prepare("UPDATE shows SET catalog_show_id = ?, catalog_link = 'manual' WHERE id = ?").run(catShowId, showId);
    }
    if (input.catalogSongId !== undefined) {
      const source = input.catalogSongId !== null ? 'manual' : movedShow ? null : 'none';
      db.prepare('UPDATE songs SET catalog_link = ? WHERE id = ?').run(source, songId);
    }
    relinkSiteRows(db, { showIds: [showId], songIds: [songId] });
  }

  const insertPart = db.prepare('INSERT INTO song_parts (song_id, position, character, vocal_range) VALUES (?, ?, ?, ?)');
  function writeParts(songId, parts) {
    db.prepare('DELETE FROM song_parts WHERE song_id = ?').run(songId);
    for (const p of parts) insertPart.run(songId, p.position, p.character, p.vocalRange);
  }

  const isUniqueViolation = (err) => String(err?.code ?? '').startsWith('SQLITE_CONSTRAINT');

  // ---- browse ----
  r.get('/', (req, res) => {
    const filters = parseSongFilters(req.query);
    if (isDefaultListing(filters)) {
      // The Browse page loads every song on each visit: serve it from a cache that is rebuilt
      // only after the catalogue changes, instead of re-reading every row per request.
      return res.type('json').send(catalogCache.get('songs:all', () => JSON.stringify(listSongs(db, filters))));
    }
    res.json(listSongs(db, filters));
  });

  r.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const song = id ? getSong(db, id) : null;
    if (!song) throw notFound('Song not found');
    res.json({ ...song, similar: similarSongs(db, song) });
  });

  // ---- create ----
  r.post('/', requireUser, async (req, res) => {
    caps.checkSongs(req.user);
    const input = parseSongBody(ctx, req.body);
    const { show } = resolveShow(input);
    if (!show) caps.checkShows(req.user);
    const dup = show && findDuplicate(input.kind, show.id, input.title, null, input.catalogSongId);
    if (dup) throw duplicateError(dup.id);
    const art = await resolveArtwork(input.preview);
    const p = input.preview ?? {};
    let songId;
    try {
      songId = db.transaction(() => {
        const current = resolveShow(input);
        const catShowId = catalogShowFor(input, current.show, current.create);
        const showId = current.show ? current.show.id : createShow(current.create, req.user.id, catShowId);
        const again = findDuplicate(input.kind, showId, input.title, null, input.catalogSongId);
        if (again) throw duplicateError(again.id);
        const now = nowIso();
        const id = Number(db.prepare(`
          INSERT INTO songs (kind, title, show_id, genre, sub_genre, length_seconds, mature, notes,
            preview_url, artwork_path, apple_music_url, recording_name, recording_artist, itunes_track_id,
            audio_link, catalog_song_id, source, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'community', ?, ?, ?)`).run(
          input.kind, input.title, showId, input.genre, input.subGenre, input.lengthSeconds, input.mature ? 1 : 0, input.notes,
          p.previewUrl ?? null, art.path, p.appleMusicUrl ?? null, p.recordingName ?? null, p.recordingArtist ?? null,
          p.itunesTrackId ?? null, input.audioLink, input.catalogSongId ?? null, req.user.id, now, now,
        ).lastInsertRowid);
        writeParts(id, input.parts);
        linkToCatalog(req.user, showId, current.show, catShowId, id, input);
        return id;
      })();
    } catch (err) {
      if (art.downloaded) await deleteIfUnreferenced(db, uploadsDir, art.path);
      if (err instanceof HttpError) throw err;
      if (isUniqueViolation(err)) {
        const current = resolveShow(input);
        const d = current.show && findDuplicate(input.kind, current.show.id, input.title, null, input.catalogSongId);
        if (d) throw duplicateError(d.id);
      }
      throw err;
    }
    res.status(201).json(getSong(db, songId));
  });

  // ---- update (full replace of editable fields; `preview` absent = keep media) ----
  r.put('/:id', requireUser, async (req, res) => {
    const row = loadEditable(req);
    const input = parseSongBody(ctx, req.body, { currentArtwork: row.artwork_path, customArtwork: row.custom_artwork_path });
    const { show } = resolveShow(input);
    if (!show) caps.checkShows(req.user);
    // Only a change of show, kind, title or catalog song can make a duplicate (an old pair of
    // look-alike rows must not block unrelated edits).
    const dupCheck = (showId) => showId !== row.show_id || input.kind !== row.kind || input.title !== row.title
      || (input.catalogSongId !== undefined && input.catalogSongId !== row.catalog_song_id);
    const dupOf = (showId) => (dupCheck(showId)
      ? findDuplicate(input.kind, showId, input.title, row.id, input.catalogSongId === undefined ? row.catalog_song_id : input.catalogSongId)
      : null);
    const dup = show && dupOf(show.id);
    if (dup) throw duplicateError(dup.id);
    const art = input.preview === undefined ? { path: row.artwork_path, downloaded: false } : await resolveArtwork(input.preview);
    const media = input.preview === undefined
      ? {
        previewUrl: row.preview_url, appleMusicUrl: row.apple_music_url, recordingName: row.recording_name,
        recordingArtist: row.recording_artist, itunesTrackId: row.itunes_track_id,
      }
      : input.preview ?? {};
    let result;
    try {
      result = db.transaction(() => {
        const current = getSongRow(db, row.id); // it may have changed while the artwork downloaded
        if (!current) throw notFound('Song not found');
        const target = resolveShow(input);
        const catShowId = catalogShowFor(input, target.show, target.create);
        const showId = target.show ? target.show.id : createShow(target.create, req.user.id, catShowId);
        const again = dupOf(showId);
        if (again) throw duplicateError(again.id);
        const movedShow = showId !== current.show_id;
        // The catalog link is bookkeeping, not an edit (no updated_at/edited_at).
        if (input.catalogSongId !== undefined && (current.catalog_song_id ?? null) !== input.catalogSongId) {
          db.prepare('UPDATE songs SET catalog_song_id = ? WHERE id = ?').run(input.catalogSongId, row.id);
        }
        const next = {
          kind: input.kind, title: input.title, show_id: showId, genre: input.genre, sub_genre: input.subGenre,
          length_seconds: input.lengthSeconds, mature: input.mature ? 1 : 0, notes: input.notes,
          preview_url: media.previewUrl ?? null, artwork_path: art.path ?? null, apple_music_url: media.appleMusicUrl ?? null,
          recording_name: media.recordingName ?? null, recording_artist: media.recordingArtist ?? null,
          itunes_track_id: media.itunesTrackId ?? null, audio_link: input.audioLink,
        };
        const partsBefore = db.prepare('SELECT position, character, vocal_range FROM song_parts WHERE song_id = ? ORDER BY position').all(row.id);
        const changed = Object.keys(next).some((k) => (current[k] ?? null) !== next[k]) || !sameParts(partsBefore, input.parts);
        // A save that changes nothing isn't an edit (the importer keeps edited spreadsheet rows as they are).
        if (!changed) {
          linkToCatalog(req.user, showId, target.show, catShowId, row.id, input, { movedShow });
          return { oldArtwork: null };
        }
        const now = nowIso();
        const cols = Object.keys(next);
        db.prepare(`UPDATE songs SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, edited_at = ? WHERE id = ?`)
          .run(...cols.map((c) => next[c]), now, now, row.id);
        writeParts(row.id, input.parts);
        linkToCatalog(req.user, showId, target.show, catShowId, row.id, input, { movedShow });
        return { oldArtwork: current.artwork_path !== next.artwork_path ? current.artwork_path : null };
      })();
    } catch (err) {
      if (art.downloaded) await deleteIfUnreferenced(db, uploadsDir, art.path);
      if (err instanceof HttpError) throw err;
      if (isUniqueViolation(err)) {
        const current = resolveShow(input);
        const d = current.show && dupOf(current.show.id);
        if (d) throw duplicateError(d.id);
      }
      throw err;
    }
    if (result.oldArtwork) await deleteIfUnreferenced(db, uploadsDir, result.oldArtwork);
    res.json(getSong(db, row.id));
  });

  // ---- delete ----
  r.delete('/:id', requireUser, async (req, res) => {
    const row = loadEditable(req);
    if (req.user.role !== 'admin') {
      // Deleting cascades to comments; only an admin may remove other people's comments.
      const n = othersCommentCount(db, { songId: row.id, userId: req.user.id });
      if (n > 0) {
        throw conflict(`This song has ${n} comment${n === 1 ? '' : 's'} from other people — ask an admin to remove it`, { commentCount: String(n) });
      }
    }
    db.transaction(() => {
      // An admin deleting a spreadsheet song: remember it, so `npm run import` doesn't bring it back.
      if (row.source === 'spreadsheet') {
        db.prepare("INSERT OR REPLACE INTO import_tombstones (kind, import_key, deleted_at) VALUES ('song', ?, ?)")
          .run(songTombstoneKey(db, row), nowIso());
      }
      db.prepare('DELETE FROM songs WHERE id = ?').run(row.id);
    })();
    await deleteIfUnreferenced(db, uploadsDir, row.audio_path);
    await deleteIfUnreferenced(db, uploadsDir, row.artwork_path);
    await deleteIfUnreferenced(db, uploadsDir, row.custom_artwork_path);
    res.status(204).end();
  });

  // ---- audio upload ----
  const audioUpload = singleFileUpload(AUDIO_MAX_BYTES, uploadsDir);
  r.post('/:id/audio', requireUser, (req, _res, next) => {
    loadEditable(req); // 401/403/404 before the body is read
    next();
  }, uploadGuard.before, audioUpload, async (req, res) => {
    const file = req.file;
    let song;
    try {
      requireFile(req); // an empty upload still left a temp file: the finally below removes it
      const row = loadEditable(req);
      const kind = sniffAudio(file.path);
      if (!kind) {
        throw badRequest("That file doesn't look like an audio file (mp3, m4a, aac, wav, aiff or ogg)", { file: 'Unsupported file type' });
      }
      uploadGuard.checkQuota(req.user, { newBytes: kind.end - kind.start, ownerId: row.created_by, replacedPath: row.audio_path });
      const publicPath = await storeUploadRange(uploadsDir, 'audio', file.path, kind.ext, kind);
      let previous;
      try {
        // Read the current path and swap it in one step, so overlapping uploads can't orphan a file.
        previous = db.transaction(() => {
          const current = getSongRow(db, row.id);
          if (!current) throw notFound('Song not found');
          db.prepare('UPDATE songs SET audio_path = ?, updated_at = ? WHERE id = ?').run(publicPath, nowIso(), row.id);
          return current.audio_path;
        })();
      } catch (err) {
        await deleteIfUnreferenced(db, uploadsDir, publicPath);
        throw err;
      }
      if (previous && previous !== publicPath) await deleteIfUnreferenced(db, uploadsDir, previous);
      song = getSong(db, row.id);
    } finally {
      await removeTemp(file); // before answering, so nothing is left behind once the client sees the result
    }
    res.json(song);
  });

  r.delete('/:id/audio', requireUser, async (req, res) => {
    const row = loadEditable(req);
    if (row.audio_path) {
      db.prepare('UPDATE songs SET audio_path = NULL, updated_at = ? WHERE id = ?').run(nowIso(), row.id);
      await deleteIfUnreferenced(db, uploadsDir, row.audio_path);
    }
    res.json(getSong(db, row.id));
  });

  // ---- album art upload (SPEC §7c): the owner's own image, shown instead of the recording's art ----
  const artworkUpload = singleFileUpload(IMAGE_MAX_BYTES, uploadsDir);
  r.post('/:id/artwork', requireUser, (req, _res, next) => {
    loadEditable(req); // 401/403/404 before the body is read
    next();
  }, uploadGuard.before, artworkUpload, async (req, res) => {
    const file = req.file;
    let song;
    try {
      requireFile(req); // an empty upload still left a temp file: the finally below removes it
      const row = loadEditable(req);
      const bytes = await fs.promises.readFile(file.path); // ≤ 5 MB
      const kind = sniffImage(bytes);
      if (!kind) throw badRequest('Album art must be a JPEG, PNG, WebP or GIF image', { file: 'Unsupported image type' });
      // Phone photos carry GPS position, camera serials and timestamps — never publish those.
      const clean = stripImageMetadata(bytes, kind.ext);
      if (!clean) throw badRequest('That image file looks damaged — try saving it again as a JPEG or PNG', { file: 'Damaged image' });
      // A few MB of compressed pixels can declare gigapixels: every visitor's browser would decode it.
      const tooBig = imageSizeProblem(imageDimensions(clean, kind.ext));
      if (tooBig) throw badRequest(tooBig, { file: 'Image is too large' });
      uploadGuard.checkQuota(req.user, { newBytes: clean.length, ownerId: row.created_by, replacedPath: row.custom_artwork_path });
      const publicPath = await saveBuffer(uploadsDir, 'art', clean, kind.ext, '/uploads');
      let previous;
      try {
        // Read the current upload and swap it in one step, so overlapping uploads can't orphan a file.
        previous = db.transaction(() => {
          const current = getSongRow(db, row.id);
          if (!current) throw notFound('Song not found');
          db.prepare('UPDATE songs SET custom_artwork_path = ?, updated_at = ? WHERE id = ?').run(publicPath, nowIso(), row.id);
          return current.custom_artwork_path;
        })();
      } catch (err) {
        await deleteIfUnreferenced(db, uploadsDir, publicPath);
        throw err;
      }
      if (previous && previous !== publicPath) await deleteIfUnreferenced(db, uploadsDir, previous);
      song = getSong(db, row.id);
    } finally {
      await removeTemp(file); // before answering, so nothing is left behind once the client sees the result
    }
    res.json(song);
  });

  // Remove the uploaded art: the song shows its recording's art again (or none).
  r.delete('/:id/artwork', requireUser, async (req, res) => {
    const row = loadEditable(req);
    if (row.custom_artwork_path) {
      db.prepare('UPDATE songs SET custom_artwork_path = NULL, updated_at = ? WHERE id = ? AND custom_artwork_path = ?')
        .run(nowIso(), row.id, row.custom_artwork_path);
      await deleteIfUnreferenced(db, uploadsDir, row.custom_artwork_path);
    }
    res.json(getSong(db, row.id));
  });

  return r;
}

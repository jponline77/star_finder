// Apple Music (iTunes Search API) side of the catalog (SPEC §7c):
//   - checkCastAlbum: does Apple have the show's cast album? (show pages of shows without a song
//     list). Found with the same album-scan rules as `npm run enrich` (lib/itunes-albums.js — album
//     named after the show, a cast/studio/concept/concert recording, never karaoke/tribute/foreign-
//     language casts/film soundtracks). The answer is kept in the database (itunes_checked_at) so
//     every visitor doesn't ask Apple again; a page view never saves an album for the show.
//   - loadRecordingTracks: a show with no song list gets the album's tracks as catalog songs
//     (source='recording', singers unknown). Saving needs a logged-in user (POST from the song form);
//     anyone else gets a preview that saves nothing. Saved tracks are shared with everyone, so the
//     rules are strict: an album another same-named show may own is refused, explicit tracks are
//     skipped, at most CAST_ALBUM_MAX_TRACKS are saved, albums an admin rejected are never used
//     again, and every save is logged with the user's id. Admins undo a save with
//     clearCatalogShowRecording (DELETE /api/admin/catalog/shows/:id/recording, or the
//     catalog:clear-recording script).
//   - recordingCandidates: recordings of one catalog song, best first — tracks of the show's cached
//     cast album, then song-search results on a recognised cast recording, then the rest.
import {
  findShowAlbums, showInfo, classifyAlbum, matchTitle, isUnwantedAlbum,
} from './itunes-albums.js';
import {
  lookupCollectionTracks, findItunesCandidates, isUsablePreviewUrl, normalizeForMatch,
} from './itunes.js';
import { isAppleBusy } from './apple-budget.js';
import { cleanText, fold } from './text.js';
import {
  parseJsonList, songTitleKeys, indexCatalogSongs, unindexCatalogSongs, updateSongCounts, isRepriseTitle, rankCatalogShows,
  markCatalogChanged,
} from './catalog.js';

const CANDIDATES_MAX = 8;
/** Lowest song-search score for a hit that isn't on a recognised recording of the show (a "possible match"). */
const WEAK_MIN_SCORE = 60;
/** Most cast-album tracks saved for one show (a real cast album has 15–40). */
export const CAST_ALBUM_MAX_TRACKS = 60;
/** How long a show page's "no cast album on Apple" answer is trusted before Apple is asked again. */
const CHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** After Apple failed (or the site-wide Apple budget was spent), don't ask again for this long. */
const FAILURE_TTL_MS = 2 * 60 * 1000;
const INSTRUMENTAL_RE = /\b(overture|entr ?acte|instrumental|underscor(e|ing)|play ?off|exit music|bows|curtain call|incidental music|scene change)\b/;

/** Track name → song title: "- From …"/"- Live" suffixes and "(Original Broadway Cast …)" notes removed. */
export function cleanTrackTitle(name) {
  let s = String(name ?? '');
  s = s.replace(/\s[-–—]\s(from|live|original|bonus|single|demo|remaster(ed)?)\b.*$/i, '');
  s = s.replace(/\s*[([][^)\]]*\b(cast|recording|broadway|london|west end|soundtrack|live|version|from|feat\.?|featuring|remaster(ed)?|bonus|edit)\b[^)\]]*[)\]]/gi, '');
  const t = cleanText(s);
  return t ? [...t].slice(0, 300).join('') : null;
}

/** Title to look for on a recording ("Wait for Me" flagged as a reprise → "Wait for Me (Reprise)"). */
export function recordingTitle(song) {
  return song.reprise && !isRepriseTitle(song.title) ? `${song.title} (Reprise)` : song.title;
}

/** The public shape of a candidate (like /api/lookup/itunes, plus album info). */
function toCandidate(c) {
  return {
    trackId: c.trackId,
    trackName: c.trackName,
    collectionId: c.collectionId ?? null,
    collectionName: c.collectionName,
    artistName: c.artistName,
    previewUrl: c.previewUrl,
    artworkUrl: c.artworkUrl,
    appleMusicUrl: c.appleMusicUrl,
    durationSeconds: c.durationSeconds,
    score: c.score,
    castAlbum: c.castAlbum,
    albumLabel: c.albumLabel,
  };
}

const yearOf = (date) => {
  const y = Number(String(date ?? '').slice(0, 4));
  return Number.isInteger(y) && y > 1000 ? y : null;
};
const containsWords = (hay, needle) => Boolean(needle) && (` ${hay} `).includes(` ${needle} `);

/** Surnames of a show's composer/lyricist ("Frank Wildhorn, Jack Murphy" → wildhorn, murphy). */
function creditSurnames(show) {
  const out = new Set();
  for (const field of [show.composer, show.lyricist]) {
    for (const person of String(field ?? '').split(/\s*(?:,|&|\band\b|\bwith\b|;|\/)\s*/i)) {
      const last = normalizeForMatch(person).split(' ').filter(Boolean).pop();
      if (last && last.length >= 4) out.add(last);
    }
  }
  return [...out];
}

/**
 * Remove a show's saved cast album and cast-album songs (admin tool). The album is remembered as
 * rejected for this show (unless `reject` is false), so it's never picked for it again. Site songs
 * linked to the removed songs just lose the link.
 * @param {import('better-sqlite3').Database} db
 * @param {number} showId
 * @param {{ reject?: boolean, userId?: number|null }} [opts]
 * @returns {{ removedSongs: number, collectionId: number|null, rejected: boolean }|null} null = no such show
 */
export function clearCatalogShowRecording(db, showId, { reject = true, userId = null } = {}) {
  const show = db.prepare('SELECT id, key, itunes_collection_id FROM catalog_shows WHERE id = ?').get(showId);
  if (!show) return null;
  return db.transaction(() => {
    const ids = db.prepare("SELECT id FROM catalog_songs WHERE show_id = ? AND source = 'recording'").all(show.id).map((r) => r.id);
    unindexCatalogSongs(db, ids);
    db.prepare("DELETE FROM catalog_songs WHERE show_id = ? AND source = 'recording'").run(show.id);
    db.prepare(`UPDATE catalog_shows SET itunes_collection_id = NULL, itunes_collection_name = NULL, itunes_checked_at = NULL,
      itunes_check_found = NULL, itunes_saved_at = NULL, itunes_saved_by = NULL WHERE id = ?`).run(show.id);
    updateSongCounts(db, show.id);
    markCatalogChanged(db);
    const rejected = Boolean(reject && show.itunes_collection_id);
    if (rejected) {
      db.prepare(`INSERT INTO catalog_rejected_albums (show_key, collection_id, rejected_at, rejected_by) VALUES (?, ?, ?, ?)
        ON CONFLICT (show_key, collection_id) DO UPDATE SET rejected_at = excluded.rejected_at, rejected_by = excluded.rejected_by`)
        .run(show.key, show.itunes_collection_id, new Date().toISOString(), userId);
    }
    return { removedSongs: ids.length, collectionId: show.itunes_collection_id ?? null, rejected };
  })();
}

/**
 * @param {{ db: import('better-sqlite3').Database, fetchImpl: typeof fetch, cache: import('./cache.js').TtlCache,
 *   log: { info?: Function, warn: Function } }} deps
 */
export function createCatalogRecordings({ db, fetchImpl, cache, log }) {
  /** @type {Map<string, Promise<unknown>>} one Apple lookup per key at a time */
  const inflight = new Map();
  const once = (key, fn) => {
    if (inflight.has(key)) return inflight.get(key);
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
  const getShow = db.prepare('SELECT * FROM catalog_shows WHERE id = ?');

  function infoFor(show) {
    const alts = parseJsonList(show.alt_titles).filter((s) => typeof s === 'string');
    const search = (fold(show.title) ?? '').replace(/^(the|a|an)\s+/, '').replace(/!/g, '').trim();
    const info = showInfo(show.title, { search, leads: alts });
    // Alt titles only widen the names an album may carry. Unlike enrich's hand-checked `leads`, they
    // must not make a bare "<show>" album (no cast/recording words) count: for "Death Becomes Her"
    // (alt title "Death Becomer Her") that accepted an unrelated electronic album of the same name.
    return { ...info, cfg: { ...info.cfg, leads: undefined } };
  }

  /** Other catalog shows with the same title or alt title ("The Count of Monte Cristo" 2009 / 2010). */
  function siblingsOf(show) {
    const names = [show.title, ...parseJsonList(show.alt_titles).filter((s) => typeof s === 'string')];
    const ids = new Set();
    for (const name of names) for (const r of rankCatalogShows(db, { name })) if (r.id !== show.id) ids.add(r.id);
    if (!ids.size) return [];
    return db.prepare(`SELECT id, title, alt_titles, year, composer, lyricist FROM catalog_shows
      WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify([...ids]));
  }

  const rejectedFor = (show) => new Set(db.prepare('SELECT collection_id AS id FROM catalog_rejected_albums WHERE show_key = ?')
    .all(show.key).map((r) => r.id));

  /**
   * Can this album be THIS show's recording, and not a same-named other show's? Without a same-named
   * show every classified album can. With one, the album must not carry a title only the other show
   * has ("Chaplin: The Musical"), and either credit this show's composer/lyricist or come out
   * between this show's premiere and the next same-named show's (Wildhorn's 2009 "Count of Monte
   * Cristo" album isn't the 2010 show's).
   */
  function albumFitsShow(album, show, siblings) {
    if (!siblings.length) return true;
    const name = normalizeForMatch(album.collectionName);
    const own = new Set([show.title, ...parseJsonList(show.alt_titles)].filter((x) => typeof x === 'string').map(normalizeForMatch));
    for (const sib of siblings) {
      for (const t of [sib.title, ...parseJsonList(sib.alt_titles)].filter((x) => typeof x === 'string').map(normalizeForMatch)) {
        if (t && !own.has(t) && t.split(' ').length >= 2 && containsWords(name, t)) return false;
      }
    }
    // A composer/lyricist only THIS show has (both "Here Lies Love"s are David Byrne's: no help there)
    const theirs = new Set(siblings.flatMap(creditSurnames));
    const artist = normalizeForMatch(album.artistName);
    if (creditSurnames(show).some((w) => !theirs.has(w) && (containsWords(artist, w) || containsWords(name, w)))) return true;
    const y = yearOf(album.releaseDate);
    if (!y || !show.year || y < show.year) return false;
    if (siblings.some((s) => !s.year || s.year === show.year)) return false;
    const later = siblings.map((s) => s.year).filter((sy) => sy > show.year);
    return !later.length || y < Math.min(...later);
  }

  const albumCacheKey = (showId) => `catalog-album:${showId}`;
  const failKey = (showId) => `catalog-album-fail:${showId}`;

  /**
   * true/false when we already know whether the show has a cast album, null when Apple failed a
   * moment ago (don't ask again yet), undefined when Apple has to be asked.
   */
  function knownAlbum(show) {
    if (show.itunes_collection_id) return true;
    if (show.itunes_checked_at && Date.now() - Date.parse(show.itunes_checked_at) < CHECK_TTL_MS && show.itunes_check_found !== null) {
      return Boolean(show.itunes_check_found);
    }
    const hit = cache.get(albumCacheKey(show.id));
    if (hit === null) return false;
    if (hit && !rejectedFor(show).has(hit.collectionId)) return true;
    if (cache.get(failKey(show.id))) return null;
    return undefined;
  }

  /**
   * The show's cast album from Apple ({ collectionId, collectionName, releaseDate } or null) — never
   * saved here. Throws when Apple can't be reached (or the Apple budget is spent).
   * @param {{ countries?: string[], retryFailed?: boolean }} [opts] CA only for page views; CA then
   *   US when someone asks. Page views don't retry a failure from the last 2 minutes; a person asking does.
   */
  async function searchCastAlbum(show, { countries = ['CA', 'US'], retryFailed = true } = {}) {
    // (an album an admin has since rejected for the show is never reused from the cache)
    const usable = (album) => album === null || !rejectedFor(show).has(album.collectionId);
    const found = cache.get(albumCacheKey(show.id));
    if (found && usable(found)) return found; // an album any earlier search found
    const key = `${albumCacheKey(show.id)}:${countries.join(',')}`;
    const hit = cache.get(key);
    if (hit !== undefined && usable(hit)) return hit;
    if (!retryFailed && cache.get(failKey(show.id))) throw new Error('Apple Music could not be reached a moment ago');
    return once(key, async () => {
      const info = infoFor(show);
      let failure = null;
      const albums = await findShowAlbums(info, fetchImpl, (msg, err) => {
        failure = isAppleBusy(err) ? err : failure ?? err ?? new Error(String(msg));
        log.warn(`catalog: ${String(msg).trim()}`);
      }, { terms: [`${info.base} cast`], discoveryTerms: [`${info.base} original cast`], stopEarly: true, countries });
      const rejected = rejectedFor(show);
      const siblings = siblingsOf(show);
      const best = albums.find((a) => !rejected.has(a.collectionId) && a.collectionExplicitness !== 'explicit' && albumFitsShow(a, show, siblings));
      if (!best && failure) {
        cache.set(failKey(show.id), true, FAILURE_TTL_MS);
        throw isAppleBusy(failure) ? failure : new Error('Apple Music could not be reached');
      }
      const album = best ? {
        collectionId: best.collectionId, collectionName: best.collectionName, artistName: best.artistName ?? null, releaseDate: best.releaseDate ?? null,
      } : null;
      cache.set(key, album);
      cache.set(albumCacheKey(show.id), album);
      return album;
    });
  }

  /**
   * Show page: does Apple have a cast album for this show without songs? One CA-store search, then
   * the answer is kept in the database for a week (a page view doesn't save the album itself).
   * @returns {Promise<boolean>} throws when Apple can't be reached right now
   */
  async function checkCastAlbum(show) {
    const album = await searchCastAlbum(show, { countries: ['CA'], retryFailed: false });
    db.prepare('UPDATE catalog_shows SET itunes_checked_at = ?, itunes_check_found = ? WHERE id = ? AND itunes_collection_id IS NULL')
      .run(new Date().toISOString(), album ? 1 : 0, show.id);
    return Boolean(album);
  }

  /** Tracks of an album (cached for an hour), CA store first, then US. */
  async function albumTracks(collectionId) {
    const key = `catalog-tracks:${collectionId}`;
    const hit = cache.get(key);
    if (hit) return hit;
    return once(key, async () => {
      let tracks = await lookupCollectionTracks(collectionId, fetchImpl, { country: 'CA' });
      if (!tracks.length) tracks = await lookupCollectionTracks(collectionId, fetchImpl, { country: 'US' });
      cache.set(key, tracks);
      return tracks;
    });
  }

  /** Album tracks → the songs they'd become (cleaned, deduped, explicit ones and extras dropped). */
  function tracksToSongs(tracks, existingKeys = new Set()) {
    const seen = new Set(existingKeys);
    const out = [];
    for (const t of tracks) {
      if (t.explicit) continue;
      const title = cleanTrackTitle(t.trackName);
      if (!title) continue;
      const k = songTitleKeys(title);
      const key = `${k.main}|${k.repriseNo}`;
      if (!k.main || seen.has(key)) continue;
      seen.add(key);
      out.push({ title, reprise: k.reprise, instrumental: INSTRUMENTAL_RE.test(normalizeForMatch(title)) });
      if (out.length >= CAST_ALBUM_MAX_TRACKS) break;
    }
    return out;
  }

  const albumJson = (album, tracks) => ({
    collectionId: album.collectionId,
    collectionName: album.collectionName ?? null,
    artistName: tracks[0]?.artistName ?? album.artistName ?? null,
    artworkUrl: tracks[0]?.artworkUrl ?? null,
  });

  /**
   * A show's cast-album tracks as catalog songs. With `userId` they are saved (source='recording')
   * for everyone; without, they're only returned as a preview (`preview`: songs with id null).
   * @param {number} showId
   * @param {{ userId?: number|null }} [opts]
   * @returns {Promise<{ album: object|null, added: number, saved: boolean, preview?: object[] }|null>} null = no such show
   */
  async function loadRecordingTracks(showId, { userId = null } = {}) {
    const show = getShow.get(showId);
    if (!show) return null;
    // Only for shows without a song list (a Wikipedia list is better than track names, and mixing
    // both would list songs twice under slightly different names), and only once: after that
    // everyone gets the saved tracks without asking Apple.
    const has = db.prepare(`SELECT sum(source = 'recording') AS rec, sum(source = 'wikipedia' AND instrumental = 0) AS wiki
      FROM catalog_songs WHERE show_id = ?`).get(show.id);
    if (has.rec || has.wiki || show.retired) {
      const saved = show.itunes_collection_id ? { collectionId: show.itunes_collection_id, collectionName: show.itunes_collection_name ?? null, artistName: null, artworkUrl: null } : null;
      return { album: saved, added: 0, saved: Boolean(has.rec) };
    }
    const album = await searchCastAlbum(show);
    if (!album) return { album: null, added: 0, saved: false };
    const tracks = await albumTracks(album.collectionId);
    if (!userId) {
      return {
        album: albumJson(album, tracks),
        added: 0,
        saved: false,
        preview: tracksToSongs(tracks).map((s, i) => ({ ...s, position: i + 1 })),
      };
    }
    return once(`catalog-persist:${show.id}`, async () => {
      const added = db.transaction(() => {
        const current = getShow.get(show.id);
        if (current.itunes_collection_id && current.itunes_collection_id !== album.collectionId) return 0; // someone else saved another one meanwhile
        const existing = db.prepare('SELECT title, reprise, position FROM catalog_songs WHERE show_id = ?').all(show.id);
        const keys = new Set(existing.map((r) => {
          const k = songTitleKeys(r.title, Boolean(r.reprise));
          return `${k.main}|${k.repriseNo}`;
        }));
        let position = existing.reduce((m, r) => Math.max(m, r.position ?? 0), 0);
        const insert = db.prepare(`INSERT OR IGNORE INTO catalog_songs (show_id, title, act, position, singers, singers_raw, ensemble, reprise, instrumental, source)
          VALUES (?, ?, NULL, ?, '[]', '', 0, ?, ?, 'recording')`);
        const ids = [];
        for (const s of tracksToSongs(tracks, keys).slice(0, Math.max(0, CAST_ALBUM_MAX_TRACKS - existing.length))) {
          position++;
          const info = insert.run(show.id, s.title, position, s.reprise ? 1 : 0, s.instrumental ? 1 : 0);
          if (info.changes) ids.push(Number(info.lastInsertRowid));
        }
        db.prepare(`UPDATE catalog_shows SET itunes_collection_id = ?, itunes_collection_name = ?, itunes_saved_at = ?, itunes_saved_by = ?,
          itunes_checked_at = ?, itunes_check_found = 1 WHERE id = ?`)
          .run(album.collectionId, album.collectionName, new Date().toISOString(), userId, new Date().toISOString(), show.id);
        indexCatalogSongs(db, ids);
        updateSongCounts(db, show.id);
        markCatalogChanged(db);
        return ids.length;
      })();
      (log.info ?? log.warn)(`catalog: user #${userId} saved ${added} cast-album song(s) for catalog show #${show.id} “${show.title}” from Apple album ${album.collectionId} “${album.collectionName}”`);
      const fresh = getShow.get(show.id);
      return {
        album: albumJson({ ...album, collectionId: fresh.itunes_collection_id ?? album.collectionId, collectionName: fresh.itunes_collection_name ?? album.collectionName }, tracks),
        added,
        saved: true,
      };
    });
  }

  /**
   * Recordings of one catalog song, best first (max 8). Throws only when Apple can't be reached
   * and nothing was found. With `userId`, a clearly identified ORIGINAL cast album (tier 100, strong
   * title match, not a same-named other show's, not rejected) is remembered for the show.
   * @param {object} song catalog_songs row
   * @param {{ userId?: number|null }} [opts]
   */
  async function recordingCandidates(song, { userId = null } = {}) {
    const show = getShow.get(song.show_id);
    const title = recordingTitle(song);
    const info = infoFor(show);
    const rejected = rejectedFor(show);
    const out = new Map();
    let failure = null;
    if (show.itunes_collection_id && !rejected.has(show.itunes_collection_id)) {
      try {
        for (const t of await albumTracks(show.itunes_collection_id)) {
          if (!isUsablePreviewUrl(t.previewUrl)) continue;
          const m = matchTitle(t.trackName, title);
          if (!m || m.level < 85) continue;
          out.set(t.trackId, {
            ...t, score: m.level, castAlbum: true, albumLabel: 'cast recording', group: 0, rank: m.level,
          });
        }
      } catch (err) {
        failure = err;
      }
    }
    const key = `catalog-rec:${fold(title)}|${fold(show.title)}`;
    const fail = `${key}:failed`;
    let found = cache.get(key);
    if (!found) {
      if (cache.get(fail)) {
        failure = failure ?? cache.get(fail);
        found = [];
      } else {
        try {
          found = await once(key, async () => cache.set(key, await findItunesCandidates({ title, show: show.title }, fetchImpl, { top: 12 })));
        } catch (err) {
          cache.set(fail, err, FAILURE_TTL_MS / 2);
          failure = failure ?? err;
          found = [];
        }
      }
    }
    let best = null;
    for (const c of found) {
      if (out.has(c.trackId) || rejected.has(c.collectionId)) continue;
      const cls = classifyAlbum({ collectionName: c.collectionName, artistName: c.artistName }, info);
      const m = matchTitle(c.trackName, title);
      const strong = Boolean(cls && m && m.level >= 85);
      // Weak hits (not on a recognised recording of the show) are only offered as "possible matches — listen
      // first": at least a fair title + show match, and never karaoke/covers/tribute or a foreign-language cast.
      if (!strong && (c.score < WEAK_MIN_SCORE || isUnwantedAlbum(c))) continue;
      const cand = {
        ...c, castAlbum: Boolean(strong && cls.tier >= 82), albumLabel: cls?.label ?? null, group: strong ? 1 : 2, rank: strong ? cls.rank : 0,
      };
      out.set(c.trackId, cand);
      // Only the ORIGINAL cast album is worth remembering for the whole show (a revival album with an
      // exact title match must not beat the original for every later song).
      if (strong && cls.tier === 100 && m.level >= 94 && (!best || cls.rank > best.rank)) best = cand;
    }
    if (!out.size && failure) throw failure;
    // Remember a clearly identified original cast album for the whole show (later lookups start from it).
    if (userId && !show.itunes_collection_id && best?.collectionId && albumFitsShow(best, show, siblingsOf(show))) {
      const saved = db.prepare(`UPDATE catalog_shows SET itunes_collection_id = ?, itunes_collection_name = ?, itunes_saved_at = ?, itunes_saved_by = ?
        WHERE id = ? AND itunes_collection_id IS NULL`).run(best.collectionId, best.collectionName, new Date().toISOString(), userId, show.id);
      if (saved.changes) (log.info ?? log.warn)(`catalog: user #${userId} set the cast album of catalog show #${show.id} “${show.title}” to Apple album ${best.collectionId} “${best.collectionName}”`);
    }
    return [...out.values()]
      .sort((a, b) => a.group - b.group || b.rank - a.rank || b.score - a.score)
      .slice(0, CANDIDATES_MAX)
      .map(toCandidate);
  }

  return {
    knownAlbum, checkCastAlbum, searchCastAlbum, albumTracks, loadRecordingTracks, recordingCandidates,
  };
}

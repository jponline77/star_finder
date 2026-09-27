// Data access + response serialization (DB rows → camelCase API shapes, SPEC §5).
// Emails and password hashes never leave this module except via toUser()/toAdminUser().
import { fold, escapeLike } from './lib/text.js';
import { VOCAL_RANGES, vocalRangeOrder } from './lib/vocab.js';
import { songNameKey, showNameKey } from './lib/import-keys.js';

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------

/** The logged-in user's own view (includes their email). */
export function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at,
    // Their chosen festival (SPEC §7b), even if an admin has since hidden it (the client ignores
    // slugs that aren't in its active list; showing the festival again restores the choice).
    festivalSlug: row.festival_slug ?? null,
  };
}

/** Admin view of a user (with counts). */
export function toAdminUser(row) {
  return {
    ...toUser(row),
    disabled: Boolean(row.disabled),
    lastLoginAt: row.last_login_at ?? null,
    songCount: row.song_count ?? 0,
    showCount: row.show_count ?? 0,
    commentCount: row.comment_count ?? 0,
  };
}

/** Users rows for toUser(): the festival's slug comes along as festival_slug. */
const USER_SELECT = 'SELECT u.*, f.slug AS festival_slug FROM users u LEFT JOIN festivals f ON f.id = u.festival_id';

const ADMIN_USER_SELECT = `
  SELECT u.*, f.slug AS festival_slug,
    (SELECT count(*) FROM songs s WHERE s.created_by = u.id) AS song_count,
    (SELECT count(*) FROM shows sh WHERE sh.created_by = u.id) AS show_count,
    (SELECT count(*) FROM comments c WHERE c.user_id = u.id) AS comment_count
  FROM users u LEFT JOIN festivals f ON f.id = u.festival_id`;

export function listAdminUsers(db) {
  return db.prepare(`${ADMIN_USER_SELECT} ORDER BY u.created_at, u.id`).all().map(toAdminUser);
}

export function getAdminUser(db, id) {
  const row = db.prepare(`${ADMIN_USER_SELECT} WHERE u.id = ?`).get(id);
  return row ? toAdminUser(row) : null;
}

export function getUserRow(db, id) {
  return db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id) ?? null;
}

export function getUserRowByEmail(db, email) {
  return db.prepare(`${USER_SELECT} WHERE u.email = ?`).get(String(email).trim().toLowerCase()) ?? null;
}

const creatorRef = (row) => (row.creator_id ? { id: row.creator_id, displayName: row.creator_name } : null);

// ---------------------------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------------------------

const SONG_SELECT = `
  SELECT s.*, sh.name AS show_name, sh.slug AS show_slug, sh.image_path AS show_image_path,
    u.id AS creator_id, u.display_name AS creator_name,
    (SELECT count(*) FROM comments c WHERE c.song_id = s.id) AS comment_count
  FROM songs s
  JOIN shows sh ON sh.id = s.show_id
  LEFT JOIN users u ON u.id = s.created_by`;

function loadParts(db, ids) {
  /** @type {Map<number, {position: 1|2, character: string, vocalRange: string|null}[]>} */
  const map = new Map();
  if (!ids.length) return map;
  const rows = db
    .prepare('SELECT song_id, position, character, vocal_range FROM song_parts WHERE song_id IN (SELECT value FROM json_each(?)) ORDER BY song_id, position')
    .all(JSON.stringify(ids));
  for (const r of rows) {
    if (!map.has(r.song_id)) map.set(r.song_id, []);
    map.get(r.song_id).push({ position: r.position, character: r.character, vocalRange: r.vocal_range ?? null });
  }
  return map;
}

function toSong(row, parts) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    show: { id: row.show_id, name: row.show_name, slug: row.show_slug, imageUrl: row.show_image_path ?? null },
    genre: row.genre ?? null,
    subGenre: row.sub_genre ?? null,
    lengthSeconds: row.length_seconds ?? null,
    mature: Boolean(row.mature),
    notes: row.notes ?? null,
    parts: parts ?? [],
    media: {
      previewUrl: row.preview_url ?? null,
      artworkUrl: row.artwork_path ?? null,
      appleMusicUrl: row.apple_music_url ?? null,
      recordingName: row.recording_name ?? null,
      recordingArtist: row.recording_artist ?? null,
      audioUrl: row.audio_path ?? null,
      audioLink: row.audio_link ?? null,
    },
    source: row.source,
    createdBy: creatorRef(row),
    commentCount: row.comment_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hydrateSongs(db, rows) {
  const parts = loadParts(db, rows.map((r) => r.id));
  return rows.map((r) => toSong(r, parts.get(r.id)));
}

export function getSongRow(db, id) {
  return db.prepare('SELECT * FROM songs WHERE id = ?').get(id) ?? null;
}

/** @returns {object|null} Song */
export function getSong(db, id) {
  const row = db.prepare(`${SONG_SELECT} WHERE s.id = ?`).get(id);
  return row ? hydrateSongs(db, [row])[0] : null;
}

const SORTS = {
  title: 'fold(s.title), fold(sh.name), s.id',
  show: 'fold(sh.name), fold(s.title), s.id',
  length: 's.length_seconds IS NULL, s.length_seconds, fold(s.title), s.id',
  '-length': 's.length_seconds IS NULL, s.length_seconds DESC, fold(s.title), s.id',
  newest: 's.created_at DESC, s.id DESC',
};
export const SONG_SORTS = Object.keys(SORTS);

/**
 * List songs with SPEC §5 filters. All filters AND together; list values OR within a field.
 * `q` is split on whitespace; every token must appear (accent/case-insensitive substring) in the
 * title, show name, a character, genre or sub-genre.
 * @param {import('better-sqlite3').Database} db
 * @param {{ q?: string|null, kinds?: string[], shows?: string[], genres?: string[], subGenres?: string[],
 *   ranges?: string[], maxSeconds?: number|null, minSeconds?: number|null, hideMature?: boolean,
 *   hasAudio?: boolean, sort?: string, limit?: number|null, offset?: number, createdBy?: number|null, showId?: number|null }} [f]
 * @returns {{ songs: object[], total: number }}
 */
export function listSongs(db, f = {}) {
  const where = [];
  const params = [];
  const tokens = f.q ? fold(f.q).split(/\s+/).filter(Boolean).slice(0, 12) : [];
  for (const t of tokens) {
    const like = `%${escapeLike(t)}%`;
    where.push(`(fold(s.title) LIKE ? ESCAPE '\\' OR fold(sh.name) LIKE ? ESCAPE '\\'
      OR fold(coalesce(s.genre, '')) LIKE ? ESCAPE '\\' OR fold(coalesce(s.sub_genre, '')) LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM song_parts qp WHERE qp.song_id = s.id AND fold(qp.character) LIKE ? ESCAPE '\\'))`);
    params.push(like, like, like, like, like);
  }
  if (f.kinds?.length) {
    where.push('s.kind IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(f.kinds));
  }
  if (f.shows?.length) {
    const ids = f.shows.filter((v) => /^\d+$/.test(v)).map(Number);
    const slugs = f.shows.map((v) => v.toLowerCase());
    where.push('(sh.id IN (SELECT value FROM json_each(?)) OR sh.slug IN (SELECT value FROM json_each(?)))');
    params.push(JSON.stringify(ids), JSON.stringify(slugs));
  }
  if (f.genres?.length) {
    where.push('fold(s.genre) IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(f.genres.map(fold)));
  }
  if (f.subGenres?.length) {
    where.push('fold(s.sub_genre) IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(f.subGenres.map(fold)));
  }
  if (f.ranges?.length) {
    where.push('EXISTS (SELECT 1 FROM song_parts rp WHERE rp.song_id = s.id AND rp.vocal_range IN (SELECT value FROM json_each(?)))');
    params.push(JSON.stringify(f.ranges));
  }
  if (Number.isFinite(f.maxSeconds)) {
    where.push('s.length_seconds IS NOT NULL AND s.length_seconds <= ?');
    params.push(f.maxSeconds);
  }
  if (Number.isFinite(f.minSeconds)) {
    where.push('s.length_seconds IS NOT NULL AND s.length_seconds >= ?');
    params.push(f.minSeconds);
  }
  if (f.hideMature) where.push('s.mature = 0');
  if (f.hasAudio) where.push('(s.preview_url IS NOT NULL OR s.audio_path IS NOT NULL OR s.audio_link IS NOT NULL)');
  if (f.showId) {
    where.push('s.show_id = ?');
    params.push(f.showId);
  }
  if (f.createdBy) {
    where.push('s.created_by = ?');
    params.push(f.createdBy);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT count(*) AS n FROM songs s JOIN shows sh ON sh.id = s.show_id ${whereSql}`).get(...params).n;
  const order = SORTS[f.sort ?? 'title'] ?? SORTS.title;
  let sql = `${SONG_SELECT} ${whereSql} ORDER BY ${order}`;
  const pageParams = [...params];
  if (Number.isInteger(f.limit) || (f.offset ?? 0) > 0) {
    sql += ' LIMIT ? OFFSET ?';
    pageParams.push(Number.isInteger(f.limit) ? f.limit : -1, f.offset ?? 0);
  }
  const rows = db.prepare(sql).all(...pageParams);
  return { songs: hydrateSongs(db, rows), total };
}

/**
 * Up to `max` similar songs: same sub-genre or overlapping vocal range (required), same kind
 * preferred, then same genre, then same show last (variety), then title.
 * Scored and limited in SQL, so only the winners are loaded (not the whole catalogue).
 */
export function similarSongs(db, song, max = 6) {
  const ranges = [...new Set(song.parts.map((p) => p.vocalRange).filter(Boolean))];
  // Built-in lower()/NOCASE instead of the JS fold() UDF keeps this cheap on a big catalogue
  // (genre/sub-genre spellings are already normalized to existing values on write).
  const ids = db.prepare(`
    SELECT s.id,
      (CASE WHEN s.kind = @kind THEN 4 ELSE 0 END)
        + (CASE WHEN @sub IS NOT NULL AND lower(s.sub_genre) = lower(@sub) THEN 3 ELSE 0 END)
        + (CASE WHEN r.song_id IS NOT NULL THEN 2 ELSE 0 END)
        + (CASE WHEN @genre IS NOT NULL AND lower(s.genre) = lower(@genre) THEN 1 ELSE 0 END)
        + (CASE WHEN s.show_id != @showId THEN 0.5 ELSE 0 END) AS score
    FROM songs s
    LEFT JOIN (SELECT DISTINCT song_id FROM song_parts
      WHERE vocal_range IN (SELECT value FROM json_each(@ranges))) r ON r.song_id = s.id
    WHERE s.id != @id AND ((@sub IS NOT NULL AND lower(s.sub_genre) = lower(@sub)) OR r.song_id IS NOT NULL)
    ORDER BY score DESC, s.title COLLATE NOCASE, s.id
    LIMIT @max`).all({
    id: song.id,
    kind: song.kind,
    sub: song.subGenre ?? null,
    genre: song.genre ?? null,
    showId: song.show.id,
    ranges: JSON.stringify(ranges),
    max,
  }).map((r) => r.id);
  if (!ids.length) return [];
  const rows = db.prepare(`${SONG_SELECT} WHERE s.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids));
  const byId = new Map(hydrateSongs(db, rows).map((x) => [x.id, x]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** Number of comments on a song or show written by someone other than `userId`. */
export function othersCommentCount(db, { songId = null, showId = null, userId }) {
  const col = songId ? 'song_id' : 'show_id';
  return db.prepare(`SELECT count(*) AS n FROM comments WHERE ${col} = ? AND user_id != ?`).get(songId ?? showId, userId).n;
}

/** Tombstone key for a spreadsheet song being deleted on the website (see lib/import-keys.js). */
export function songTombstoneKey(db, row) {
  if (row.import_key) return row.import_key;
  const show = db.prepare('SELECT name FROM shows WHERE id = ?').get(row.show_id);
  return songNameKey(row.kind, show?.name ?? '', row.title);
}

export function showTombstoneKey(row) {
  return row.import_key ?? showNameKey(row.name);
}

/**
 * Changes whenever the catalogue may have changed: `total_changes()` counts this connection's
 * writes, `data_version` moves when another process (e.g. `npm run import`) commits.
 */
export function catalogVersion(db) {
  const own = db.prepare('SELECT total_changes() AS n').get().n;
  return `${db.pragma('data_version', { simple: true })}:${own}`;
}

// ---------------------------------------------------------------------------------------------
// Shows
// ---------------------------------------------------------------------------------------------

const SHOW_SELECT = `
  SELECT sh.*, u.id AS creator_id, u.display_name AS creator_name,
    (SELECT count(*) FROM comments c WHERE c.show_id = sh.id) AS comment_count,
    (SELECT count(*) FROM songs s WHERE s.show_id = sh.id) AS song_count,
    (SELECT count(*) FROM songs s WHERE s.show_id = sh.id AND s.kind = 'solo') AS solo_count,
    (SELECT count(*) FROM songs s WHERE s.show_id = sh.id AND s.kind = 'duet') AS duet_count
  FROM shows sh
  LEFT JOIN users u ON u.id = sh.created_by`;

function toShow(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    composer: row.composer ?? null,
    lyricist: row.lyricist ?? null,
    bookWriter: row.book_writer ?? null,
    year: row.year ?? null,
    licensor: row.licensor ?? null,
    licensingNote: row.licensing_note ?? null,
    description: row.description ?? null,
    wikiUrl: row.wiki_url ?? null,
    imageUrl: row.image_path ?? null,
    imageCredit: row.image_credit ?? null,
    imageSourceUrl: row.image_source_url ?? null,
    source: row.source,
    createdBy: creatorRef(row),
    commentCount: row.comment_count ?? 0,
    songCount: row.song_count ?? 0,
    soloCount: row.solo_count ?? 0,
    duetCount: row.duet_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Find a show row by numeric id or slug. */
export function findShowRow(db, idOrSlug) {
  const v = String(idOrSlug ?? '').trim();
  if (!v) return null;
  if (/^\d{1,15}$/.test(v)) {
    const row = db.prepare('SELECT * FROM shows WHERE id = ?').get(Number(v));
    if (row) return row;
  }
  return db.prepare('SELECT * FROM shows WHERE slug = ?').get(v.toLowerCase()) ?? null;
}

/** Find a show by name, case- and accent-insensitively. */
export function findShowRowByName(db, name) {
  return db.prepare('SELECT * FROM shows WHERE fold(name) = fold(?) ORDER BY id LIMIT 1').get(String(name).trim()) ?? null;
}

export function listShows(db, { createdBy = null } = {}) {
  const rows = createdBy
    ? db.prepare(`${SHOW_SELECT} WHERE sh.created_by = ? ORDER BY fold(sh.name), sh.id`).all(createdBy)
    : db.prepare(`${SHOW_SELECT} ORDER BY fold(sh.name), sh.id`).all();
  return rows.map(toShow);
}

/** Show without songs/characters. */
export function getShow(db, id) {
  const row = db.prepare(`${SHOW_SELECT} WHERE sh.id = ?`).get(id);
  return row ? toShow(row) : null;
}

/** Show detail with `songs` (by title) and `characters`. */
export function getShowDetail(db, id) {
  const show = getShow(db, id);
  if (!show) return null;
  show.songs = listSongs(db, { showId: id }).songs;
  /** @type {Map<string, { name: string, vocalRanges: string[], songIds: number[] }>} */
  const chars = new Map();
  for (const s of show.songs) {
    for (const p of s.parts) {
      const key = fold(p.character).replace(/\s+/g, ' ').trim();
      if (!chars.has(key)) chars.set(key, { name: p.character, vocalRanges: [], songIds: [] });
      const c = chars.get(key);
      if (p.vocalRange && !c.vocalRanges.includes(p.vocalRange)) c.vocalRanges.push(p.vocalRange);
      if (!c.songIds.includes(s.id)) c.songIds.push(s.id);
    }
  }
  show.characters = [...chars.values()]
    .map((c) => ({ ...c, vocalRanges: c.vocalRanges.sort((a, b) => vocalRangeOrder(a) - vocalRangeOrder(b)) }))
    .sort((a, b) => fold(a.name.replace(/^the\s+/i, '')).localeCompare(fold(b.name.replace(/^the\s+/i, ''))));
  return show;
}

// ---------------------------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------------------------

const COMMENT_SELECT = `
  SELECT c.*, u.display_name AS author_name, u.role AS author_role,
    s.title AS song_title, sh.name AS show_name, sh.slug AS show_slug
  FROM comments c
  JOIN users u ON u.id = c.user_id
  LEFT JOIN songs s ON s.id = c.song_id
  LEFT JOIN shows sh ON sh.id = c.show_id`;

function toComment(row) {
  const isSong = row.song_id !== null && row.song_id !== undefined;
  return {
    id: row.id,
    body: row.body,
    tag: row.tag,
    author: { id: row.user_id, displayName: row.author_name, role: row.author_role },
    target: isSong
      ? { type: 'song', id: row.song_id, title: row.song_title }
      : { type: 'show', id: row.show_id, title: row.show_name, slug: row.show_slug },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    edited: row.updated_at > row.created_at,
  };
}

export function getCommentRow(db, id) {
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id) ?? null;
}

export function getComment(db, id) {
  const row = db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(id);
  return row ? toComment(row) : null;
}

/** Comments for one song or show, oldest first. */
export function listComments(db, { songId = null, showId = null, userId = null } = {}) {
  if (songId) return db.prepare(`${COMMENT_SELECT} WHERE c.song_id = ? ORDER BY c.created_at, c.id`).all(songId).map(toComment);
  if (showId) return db.prepare(`${COMMENT_SELECT} WHERE c.show_id = ? ORDER BY c.created_at, c.id`).all(showId).map(toComment);
  if (userId) return db.prepare(`${COMMENT_SELECT} WHERE c.user_id = ? ORDER BY c.created_at DESC, c.id DESC`).all(userId).map(toComment);
  return [];
}

/** Newest first (moderation feed). */
export function listRecentComments(db, limit = 100) {
  return db.prepare(`${COMMENT_SELECT} ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(limit).map(toComment);
}

// ---------------------------------------------------------------------------------------------
// Meta & stats
// ---------------------------------------------------------------------------------------------

/** Distinct genres in use (plus the suggested ones). */
export function distinctGenres(db) {
  return db.prepare('SELECT DISTINCT genre FROM songs WHERE genre IS NOT NULL').all().map((r) => r.genre);
}

export function distinctSubGenres(db) {
  return db.prepare('SELECT DISTINCT sub_genre FROM songs WHERE sub_genre IS NOT NULL').all().map((r) => r.sub_genre);
}

/** Sub-genres with their most common genre and a count, sorted by name. */
export function subGenreSummary(db) {
  const rows = db
    .prepare(`SELECT sub_genre AS name, genre, count(*) AS n FROM songs WHERE sub_genre IS NOT NULL GROUP BY sub_genre, genre`)
    .all();
  const map = new Map();
  for (const r of rows) {
    const cur = map.get(r.name) ?? { name: r.name, genre: null, count: 0, best: -1 };
    cur.count += r.n;
    if (r.n > cur.best || (r.n === cur.best && r.genre && (cur.genre === null || r.genre < cur.genre))) {
      cur.best = r.n;
      cur.genre = r.genre ?? null;
    }
    map.set(r.name, cur);
  }
  return [...map.values()]
    .map(({ name, genre, count }) => ({ name, genre, count }))
    .sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
}

export { VOCAL_RANGES };

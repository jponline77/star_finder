// /api/catalog — the show & song catalog (SPEC §7c). Public GETs (nothing here returns user data —
// only ids/slugs of site songs and shows) plus one write: saving a show's cast-album tracks, which
// needs a logged-in user (POST …/recording-tracks). Endpoints that call Apple use the lookup rate
// limit (STAR_LOOKUP_LIMIT) and the site-wide Apple budget (STAR_APPLE_LIMIT); search has its own
// limit (STAR_SEARCH_LIMIT). A show page never answers 429: past the limits it says "couldn't check".
import { Router } from 'express';
import { notFound } from '../lib/errors.js';
import { Validator, parseId } from '../lib/validate.js';
import {
  catalogStatus, parseJsonList, wikipediaUrl, kindFromSingers,
} from '../lib/catalog.js';
import { searchCatalog, siteSongsFor, siteShowsFor, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from '../lib/catalog-search.js';
import { catalogSuggestions } from '../lib/catalog-suggest.js';
import { createCatalogRecordings } from '../lib/catalog-recordings.js';
import { appleHttpError } from '../lib/apple-budget.js';
import { requireUser } from '../middleware.js';

const first = (x) => (Array.isArray(x) ? x[0] : x);
const truthy = (v) => ['1', 'true', 'yes', 'on'].includes(String(first(v) ?? '').toLowerCase());

/** catalog_shows row → CatalogShow JSON (without songs). */
export function toCatalogShow(row) {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    altTitles: parseJsonList(row.alt_titles),
    wikiTitle: row.wiki_title ?? null,
    wikiUrl: wikipediaUrl(row.wiki_title),
    wikidataId: row.wikidata_id ?? null,
    composer: row.composer ?? null,
    lyricist: row.lyricist ?? null,
    bookWriter: row.book_writer ?? null,
    year: row.year ?? null,
    genres: parseJsonList(row.genres),
    description: row.description ?? null,
    characters: parseJsonList(row.characters),
    songCount: row.song_count,
    castAlbum: row.itunes_collection_id ? { collectionId: row.itunes_collection_id, collectionName: row.itunes_collection_name ?? null } : null,
    // No longer in the catalog file, kept because site data points at it (hidden from search).
    retired: Boolean(row.retired),
  };
}

/** catalog_songs row → CatalogSong JSON. */
export function toCatalogSong(row, onSite = null) {
  const singers = parseJsonList(row.singers).filter((x) => typeof x === 'string');
  return {
    id: row.id,
    title: row.title,
    act: row.act ?? null,
    position: row.position ?? null,
    singers,
    singersRaw: row.singers_raw ?? '',
    ensemble: Boolean(row.ensemble),
    reprise: Boolean(row.reprise),
    instrumental: Boolean(row.instrumental),
    source: row.source,
    kindGuess: kindFromSingers({ singers, ensemble: Boolean(row.ensemble), instrumental: Boolean(row.instrumental) }).kind,
    onSite,
  };
}

/** @param {import('../app.js').AppContext} ctx */
export function catalogRouter(ctx) {
  const { db, limiters } = ctx;
  const rec = createCatalogRecordings({ db, fetchImpl: ctx.fetchImpl, cache: ctx.cache, log: ctx.log });
  const r = Router();
  const showById = db.prepare('SELECT * FROM catalog_shows WHERE id = ?');
  const songById = db.prepare('SELECT * FROM catalog_songs WHERE id = ?');

  function loadShow(req) {
    const id = parseId(req.params.id);
    const row = id ? showById.get(id) : null;
    if (!row) throw notFound('Show not found in the catalog');
    return row;
  }

  function loadSong(req) {
    const id = parseId(req.params.id);
    const row = id ? songById.get(id) : null;
    if (!row) throw notFound('Song not found in the catalog');
    return row;
  }

  /** The show's songs in list order (Wikipedia first, then cast-album tracks), each with onSite. */
  function showSongs(showId, { all = false } = {}) {
    const rows = db.prepare(`SELECT * FROM catalog_songs WHERE show_id = ? ${all ? '' : 'AND instrumental = 0'}
      ORDER BY source = 'recording', position IS NULL, position, id`).all(showId);
    const onSite = siteSongsFor(db, rows.map((x) => x.id));
    return rows.map((x) => toCatalogSong(x, onSite.get(x.id) ?? null));
  }

  const hasSongs = (showId) => Boolean(db.prepare('SELECT 1 FROM catalog_songs WHERE show_id = ? AND instrumental = 0 LIMIT 1').get(showId));

  r.get('/', (_req, res) => {
    res.json(catalogStatus(db));
  });

  r.get('/search', limiters.search, (req, res) => {
    const v = new Validator();
    const limit = v.integer('limit', first(req.query.limit), { min: 1, max: 10_000, label: 'limit' });
    v.check('Invalid search');
    const q = first(req.query.q);
    const results = searchCatalog(db, typeof q === 'string' ? q : '', { limit: Math.min(limit ?? SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT) });
    res.json({ results });
  });

  // Show details + song list. A show without songs says whether Apple has its cast album, so the
  // page can offer "Load songs from the cast album": answered from the database when known, else
  // one CA-store check (kept for a week). Never a 429 and never a save: over the per-user/IP or
  // site-wide Apple budget, or with Apple down, it's `recordingTracksAvailable: null`.
  r.get('/shows/:id', async (req, res) => {
    const row = loadShow(req);
    const songs = showSongs(row.id, { all: truthy(req.query.all) });
    const hidden = db.prepare('SELECT count(*) AS n FROM catalog_songs WHERE show_id = ? AND instrumental = 1').get(row.id).n;
    const body = {
      ...toCatalogShow(row),
      onSite: siteShowsFor(db, [row.id]).get(row.id) ?? null,
      instrumentalCount: hidden,
      songs,
    };
    if (!hasSongs(row.id)) {
      let available = rec.knownAlbum(row);
      if (available === undefined) {
        if (row.retired || !limiters.appleChecks.take(req)) {
          available = null;
        } else {
          try {
            available = await rec.checkCastAlbum(row);
          } catch (err) {
            ctx.log.warn(`catalog: cast album check failed: ${err.message}`);
            available = null; // couldn't check right now
          }
        }
      }
      body.recordingTracksAvailable = available;
    }
    res.json(body);
  });

  /** Tracks of a show's cast album, saved for everyone (logged-in user) or as a preview. */
  async function recordingTracks(req, res, { save }) {
    const row = loadShow(req);
    let result;
    try {
      result = await rec.loadRecordingTracks(row.id, { userId: save ? req.user.id : null });
    } catch (err) {
      ctx.log.warn(`catalog: loading cast-album tracks failed: ${err.message}`);
      throw appleHttpError(err, res);
    }
    const all = truthy(req.query.all);
    const songs = result.preview
      ? result.preview.filter((s) => all || !s.instrumental).map((s) => ({
        id: null, title: s.title, act: null, position: s.position, singers: [], singersRaw: '', ensemble: false,
        reprise: s.reprise, instrumental: s.instrumental, source: 'recording', kindGuess: null, onSite: null,
      }))
      : showSongs(row.id, { all });
    res.json({ album: result.album, added: result.added, saved: result.saved, songs });
  }

  // Save the show's cast-album tracks as catalog songs for everyone (the song form's "Load songs from
  // the cast album"). Logged-in users only (+ the CSRF header every write needs); logged with the user.
  r.post('/shows/:id/recording-tracks', requireUser, limiters.lookups, (req, res) => recordingTracks(req, res, { save: true }));

  // Read-only: the saved tracks, or — when none are saved yet — a preview (songs with id null) that
  // saves nothing. Deprecated compatibility: a logged-in user's own same-site request (no
  // cross-site Sec-Fetch-Site) still saves like the POST, for clients from before the POST existed.
  // A link or <img> on another website can't save anything (no session cookie cross-site under
  // SameSite=Lax, and Sec-Fetch-Site says cross-site).
  r.get('/shows/:id/recording-tracks', limiters.lookups, (req, res) => {
    const save = Boolean(req.user) && req.get('sec-fetch-site') !== 'cross-site';
    return recordingTracks(req, res, { save });
  });

  r.get('/songs/:id/suggestions', (req, res) => {
    const row = loadSong(req);
    res.json(catalogSuggestions(db, row.id));
  });

  r.get('/songs/:id/recordings', limiters.lookups, async (req, res) => {
    const row = loadSong(req);
    let candidates;
    try {
      candidates = await rec.recordingCandidates(row, { userId: req.user && req.get('sec-fetch-site') !== 'cross-site' ? req.user.id : null });
    } catch (err) {
      ctx.log.warn(`catalog: recording lookup failed: ${err.message}`);
      throw appleHttpError(err, res);
    }
    res.json({ candidates });
  });

  return r;
}

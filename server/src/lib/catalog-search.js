// Catalog typeahead (GET /api/catalog/search): songs AND shows, FTS5 prefix search on every word,
// accent/case-insensitive. User input never reaches MATCH raw: it is split into letter/digit words
// (the way the unicode61 tokenizer splits text) and every word is double-quoted, so FTS5 syntax
// characters and keywords (" * - ^ : ( ) NEAR OR AND NOT) are just text.
//
// Ranking: exact title (or alt title) > title starts with the query > every word in the title >
// matched elsewhere (show title, singers, credits); ties by bm25 with a small boost for songs of
// shows already on the site; a reprise sorts after its main number.
//
// Cost: better-sqlite3 is synchronous, so a search blocks the event loop while it runs. Queries made
// only of one-letter words ("s t", "a e i o u") would expand to most of the index — they answer []
// (a real title always has a longer word by the time it's typed) — and the FTS part of recent
// queries is cached (typeahead repeats the same prefixes), keyed by the catalog's signature so a
// reload or newly saved cast-album songs are seen at once. The route also has its own rate limit.
import {
  ftsTokens, ftsQuoted, matchKey, showNameKeys, parseJsonList, kindFromSingers, catalogSignature,
} from './catalog.js';

export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;
const CANDIDATES = 200;
const ON_SITE_BOOST = 1.25;
const CACHE_MAX = 1000;
const COMMON = new Set(['the', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'at', 'with', 'is', 'it', 'me', 'my', 'you', 'be', 'we']);

/** Per connection: { sig, map: Map<query key, { songRows, showRows }> } (LRU by insertion order). */
const ftsCaches = new WeakMap();

function cachedFts(db, key, compute) {
  const sig = catalogSignature(db);
  let c = ftsCaches.get(db);
  if (!c || c.sig !== sig) {
    c = { sig, map: new Map() };
    ftsCaches.set(db, c);
  }
  const hit = c.map.get(key);
  if (hit) {
    c.map.delete(key);
    c.map.set(key, hit);
    return hit;
  }
  const value = compute();
  c.map.set(key, value);
  while (c.map.size > CACHE_MAX) c.map.delete(c.map.keys().next().value);
  return value;
}

/** true if every query word is the start of some word in `words`. */
const allWordsPrefix = (qTokens, words) => qTokens.every((t) => words.some((w) => w.startsWith(t)));

/**
 * @param {import('better-sqlite3').Database} db
 * @param {unknown} rawQuery
 * @param {{ limit?: number }} [opts]
 * @returns {object[]} CatalogHit[] (SPEC §7c)
 */
export function searchCatalog(db, rawQuery, { limit = SEARCH_DEFAULT_LIMIT } = {}) {
  const q = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 200) : '';
  if ([...q].length < 2) return [];
  const tokens = [...new Set(ftsTokens(q))].slice(0, 8);
  if (!tokens.length) return [];
  const max = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Number.isInteger(limit) ? limit : SEARCH_DEFAULT_LIMIT));
  // One-letter words ("bring h") would expand to every word with that letter: they filter the
  // candidates afterwards instead. A query of nothing but one-letter words finds nothing.
  const long = tokens.filter((t) => t.length > 1);
  if (!long.length) return [];
  // Very common words ("the", "of") match a large part of the index: when the query has other
  // words, they only filter the candidates afterwards too.
  const rare = long.filter((t) => !COMMON.has(t));
  const matchTokens = rare.length ? rare : long;
  const anywhere = ftsQuoted(matchTokens, { prefix: true });
  // Titles that start with the query (a one-letter last word isn't expanded: "bring h" looks for
  // titles starting with "bring" and the letter filters them below).
  const lastIsLetter = tokens[tokens.length - 1].length === 1;
  const phraseTokens = lastIsLetter ? tokens.slice(0, -1) : tokens;
  const phrase = phraseTokens.length ? `^"${phraseTokens.join(' ')}"${lastIsLetter ? '' : '*'}` : null;
  const qKey = matchKey(q);

  let candidates;
  try {
    // The expensive part (FTS + reading and scoring the matched rows) depends only on the query and
    // the catalog, so it's cached; whether a hit is on the site is looked up fresh every time.
    candidates = cachedFts(db, tokens.join(' '), () => findCandidates(db, { tokens, filtered: matchTokens.length < tokens.length, anywhere, phrase, qKey }));
  } catch (err) {
    // Can't happen with quoted words, but a search box must never answer 500.
    if (/fts5|MATCH/i.test(String(err?.message))) return [];
    throw err;
  }
  const onSiteSongs = siteSongsFor(db, candidates.filter((c) => !c.sort.show).map((c) => c.hit.id));
  const onSiteShows = siteShowsFor(db, candidates.map((c) => (c.sort.show ? c.hit.id : c.hit.show.id)));
  const hits = candidates.map((c) => {
    const siteShow = onSiteShows.get(c.sort.show ? c.hit.id : c.hit.show.id) ?? null;
    const sort = { ...c.sort, boost: siteShow ? ON_SITE_BOOST : 1 };
    const hit = c.sort.show
      ? { ...c.hit, onSite: siteShow }
      : { ...c.hit, show: { ...c.hit.show, onSite: siteShow }, onSite: onSiteSongs.get(c.hit.id) ?? null };
    return { sort, hit };
  });
  hits.sort((a, b) => compareHits(a.sort, b.sort));
  return hits.slice(0, max).map((h) => h.hit);
}

/** FTS matches for a query, read and scored (without the site's onSite data). */
function findCandidates(db, { tokens, filtered, anywhere, phrase, qKey }) {
  const songRows = mergeRanked(
    db.prepare('SELECT rowid AS id, bm25(catalog_fts, 10.0, 4.0, 3.0, 2.0) AS rank FROM catalog_fts WHERE catalog_fts MATCH ? ORDER BY rank LIMIT ?')
      .all(anywhere, CANDIDATES),
    phrase ? db.prepare('SELECT rowid AS id FROM catalog_fts WHERE catalog_fts MATCH ? LIMIT 100').all(`{song_title} : ${phrase}`) : [],
  );
  const showRows = mergeRanked(
    db.prepare('SELECT rowid AS id, bm25(catalog_show_fts, 10.0, 6.0, 1.0) AS rank FROM catalog_show_fts WHERE catalog_show_fts MATCH ? ORDER BY rank LIMIT ?')
      .all(anywhere, 100),
    phrase ? db.prepare('SELECT rowid AS id FROM catalog_show_fts WHERE catalog_show_fts MATCH ? LIMIT 50').all(`{title alt_titles} : ${phrase}`) : [],
  );
  const out = [];
  if (songRows.size) {
    const rows = db.prepare(`
      SELECT s.id, s.title, s.singers, s.reprise, s.ensemble, s.instrumental, s.show_id,
        sh.title AS show_title, sh.year AS show_year, sh.alt_titles AS show_alts
      FROM catalog_songs s JOIN catalog_shows sh ON sh.id = s.show_id
      WHERE s.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify([...songRows.keys()]));
    for (const r of rows) {
      const singers = parseJsonList(r.singers).filter((x) => typeof x === 'string');
      const titleWords = ftsTokens(r.title);
      if (filtered) {
        const words = [...titleWords, ...ftsTokens(r.show_title), ...ftsTokens(r.show_alts), ...singers.flatMap(ftsTokens)];
        if (!allWordsPrefix(tokens, words)) continue;
      }
      const tKey = matchKey(r.title);
      const tier = tKey === qKey ? 3 : tKey.startsWith(qKey) ? 2 : allWordsPrefix(tokens, titleWords) ? 1 : 0;
      out.push({
        sort: { tier, rank: songRows.get(r.id), reprise: r.reprise, len: r.title.length, id: r.id, show: false },
        hit: {
          type: 'song',
          id: r.id,
          title: r.title,
          show: { id: r.show_id, title: r.show_title, year: r.show_year ?? null, onSite: null },
          singers,
          reprise: Boolean(r.reprise),
          ensemble: Boolean(r.ensemble),
          kindGuess: kindFromSingers({ singers, ensemble: Boolean(r.ensemble), instrumental: Boolean(r.instrumental) }).kind,
          onSite: null,
        },
      });
    }
  }
  if (showRows.size) {
    const rows = db.prepare(`SELECT id, title, alt_titles, year, composer, song_count FROM catalog_shows
      WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify([...showRows.keys()]));
    for (const r of rows) {
      const alts = parseJsonList(r.alt_titles).filter((x) => typeof x === 'string');
      const names = [r.title, ...alts];
      const nameWords = names.flatMap(ftsTokens);
      if (filtered && !allWordsPrefix(tokens, nameWords)) continue;
      const keys = names.flatMap(showNameKeys);
      const nameTier = keys.includes(qKey) ? 3 : keys.some((k) => k.startsWith(qKey)) ? 2 : allWordsPrefix(tokens, nameWords) ? 1 : 0;
      // A show without a song list ("Frozen – Live at the Hyperion") has nothing to pick: unless its name
      // is exactly what was typed, it goes after the songs (with shows that matched only on credits).
      const tier = !r.song_count && nameTier < 3 ? 0 : nameTier;
      out.push({
        sort: { tier, rank: showRows.get(r.id), reprise: 0, len: r.title.length, id: r.id, show: true },
        hit: {
          type: 'show',
          id: r.id,
          title: r.title,
          year: r.year ?? null,
          composer: r.composer ?? null,
          songCount: r.song_count,
          onSite: null,
        },
      });
    }
  }
  return out;
}

/** Map id → bm25 rank (undefined when the id only came from the title-start query). */
function mergeRanked(ranked, extra) {
  const map = new Map(ranked.map((r) => [r.id, r.rank]));
  for (const r of extra) if (!map.has(r.id)) map.set(r.id, undefined);
  return map;
}

function compareHits(a, b) {
  if (a.tier !== b.tier) return b.tier - a.tier;
  // A show whose own name matched comes before its songs; a show that matched only on its
  // credits (tier 0) comes after songs.
  if (a.show !== b.show) return (a.tier >= 1 ? (a.show ? -1 : 1) : (a.show ? 1 : -1));
  if (a.reprise !== b.reprise) return a.reprise - b.reprise;
  const ra = a.rank === undefined ? 0 : -a.rank * a.boost;
  const rb = b.rank === undefined ? 0 : -b.rank * b.boost;
  if (ra !== rb) return rb - ra;
  if (a.len !== b.len) return a.len - b.len;
  return a.id - b.id;
}

/** catalog song id → { songId } of the (first) site song linked to it. */
export function siteSongsFor(db, catalogSongIds) {
  const map = new Map();
  if (!catalogSongIds.length) return map;
  const rows = db.prepare(`SELECT catalog_song_id AS cid, min(id) AS id FROM songs
    WHERE catalog_song_id IN (SELECT value FROM json_each(?)) GROUP BY catalog_song_id`).all(JSON.stringify(catalogSongIds));
  for (const r of rows) map.set(r.cid, { songId: r.id });
  return map;
}

/** catalog show id → { showId, slug } of the (first) site show linked to it. */
export function siteShowsFor(db, catalogShowIds) {
  const map = new Map();
  if (!catalogShowIds.length) return map;
  const rows = db.prepare(`SELECT catalog_show_id AS cid, id, slug FROM shows
    WHERE catalog_show_id IN (SELECT value FROM json_each(?)) ORDER BY id`).all(JSON.stringify([...new Set(catalogShowIds)]));
  for (const r of rows) if (!map.has(r.cid)) map.set(r.cid, { showId: r.id, slug: r.slug });
  return map;
}

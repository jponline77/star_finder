// Pre-fill suggestions for the song form (GET /api/catalog/songs/:id/suggestions, SPEC §7c).
// Fast and local (no Apple calls). Every suggestion says where it came from and how sure we are.
//
// Priority rules:
//   title          ← the catalog song ('high' from the Wikipedia list, 'medium' from a cast-album track list)
//   kind           ← 1 named singer → solo ('high'), 2 → duet ('medium': a second listed singer may
//                    only have a few lines, so Solo is offered as an alternative unless the site
//                    already has the song only as a duet); for 0 / 3+ singers, an ensemble number or an
//                    instrumental: the kind of the version already on the site ('medium'), else
//                    null — with a kindNote either way
//   parts          ← the named singers (the site's spelling of a character when the site already has
//                    them); each part's vocal range ← the same show + character already on the site
//                    (most common value; 'high' if unanimous and the same name, else 'medium' +
//                    alternatives) ← the catalog character's voice type ('medium') ← none
//   genre/subGenre/mature ← the site's OTHER songs from the same show (most common; 'medium',
//                    alternatives = the other values) ← the show's catalog genres mapped
//                    comedy→Comedy, tragedy/drama→Drama, romance→Romantic ('low', genre only) ← none
// The site's copies of this very song (existingSongs) never count as "other songs" of the show.
import {
  parseJsonList, characterMatch, sharedFamilyNames, voiceTypeToRange, kindFromSingers, songTitleKeys, songTitleMatchLevel,
  showNameKeys, wikipediaUrl, isRepriseTitle, matchKey,
} from './catalog.js';
import { vocalRangeOrder } from './vocab.js';

const strings = (v) => parseJsonList(v).filter((x) => typeof x === 'string' && x.trim());

/** "A", "A and B", "A, B and C" */
export function humanList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "from 3 other Les Misérables songs on the site" / "from another … song on the site" */
function fromSiteSongs(n, showName) {
  return n === 1 ? `from another ${showName} song on the site` : `from ${n} other ${showName} songs on the site`;
}

/** Values by how often they occur (ties: `tieOrder`, then first seen). */
function tally(values, tieOrder = () => 0) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, n], i) => ({ value, n, i }))
    .sort((a, b) => b.n - a.n || tieOrder(a.value) - tieOrder(b.value) || a.i - b.i);
}

/** Site shows that are this catalog show: linked ones, else ones with the same (folded) name. */
function siteShowsFor(db, show) {
  const linked = db.prepare('SELECT id, name, slug FROM shows WHERE catalog_show_id = ? ORDER BY id').all(show.id);
  if (linked.length) return linked;
  const keys = new Set([show.title, ...strings(show.alt_titles)].flatMap(showNameKeys));
  return db.prepare('SELECT id, name, slug FROM shows WHERE catalog_show_id IS NULL ORDER BY id').all()
    .filter((s) => showNameKeys(s.name).some((k) => keys.has(k)));
}

const GENRE_MAP = [[/comed/, 'Comedy'], [/traged|drama/, 'Drama'], [/roman/, 'Romantic']];

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} catalogSongId
 * @returns {object|null} CatalogSuggestions (SPEC §7c) + extras: kindNote, existingSongs, per-part range details
 */
export function catalogSuggestions(db, catalogSongId) {
  const song = db.prepare('SELECT * FROM catalog_songs WHERE id = ?').get(catalogSongId);
  if (!song) return null;
  const show = db.prepare('SELECT * FROM catalog_shows WHERE id = ?').get(song.show_id);
  const singers = strings(song.singers);
  const ensemble = Boolean(song.ensemble);
  const instrumental = Boolean(song.instrumental);
  const reprise = Boolean(song.reprise);
  const fromList = song.source === 'recording'
    ? `from the ${show.itunes_collection_name ? `“${show.itunes_collection_name}”` : 'cast album'} track list`
    : 'from the Wikipedia song list';

  // ---- the site's side: this show's site songs (+ parts) and songs that already are this song ----
  const siteShows = siteShowsFor(db, show);
  const siteShow = siteShows[0] ?? null;
  const showName = siteShow?.name ?? show.title;
  const siteSongs = siteShows.length
    ? db.prepare(`SELECT id, title, kind, genre, sub_genre, mature, catalog_song_id FROM songs
        WHERE show_id IN (SELECT value FROM json_each(?)) ORDER BY id`).all(JSON.stringify(siteShows.map((s) => s.id)))
    : [];
  const siteParts = siteSongs.length
    ? db.prepare(`SELECT song_id, character, vocal_range FROM song_parts
        WHERE song_id IN (SELECT value FROM json_each(?)) ORDER BY song_id, position`).all(JSON.stringify(siteSongs.map((s) => s.id)))
    : [];
  const wanted = songTitleKeys(song.title, reprise);
  const existing = db.prepare('SELECT id, title, kind FROM songs WHERE catalog_song_id = ? ORDER BY id').all(song.id);
  // Unlinked site songs of the show with the same title; else the one site song that is clearly a
  // form of it ("Dog Eats Dog" for "The Sewers/Dog Eats Dog") when there is exactly one.
  const unlinked = siteSongs.filter((s) => s.catalog_song_id === null && !existing.some((e) => e.id === s.id))
    .map((s) => ({ s, level: songTitleMatchLevel(songTitleKeys(s.title), wanted) }));
  const sameTitle = unlinked.filter((x) => x.level === 2);
  const similar = unlinked.filter((x) => x.level === 1);
  for (const { s } of sameTitle.length ? sameTitle : similar.length === 1 ? similar : []) existing.push({ id: s.id, title: s.title, kind: s.kind });
  // Everything below counts the show's OTHER site songs.
  const existingIds = new Set(existing.map((e) => e.id));
  const otherSongs = siteSongs.filter((s) => !existingIds.has(s.id));
  const otherParts = siteParts.filter((p) => !existingIds.has(p.song_id));

  // ---- title ----
  const displayTitle = reprise && !isRepriseTitle(song.title) ? `${song.title} (Reprise)` : song.title;
  const titleAlternatives = [];
  const paren = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(song.title);
  if (paren && !/\breprise\b/i.test(paren[2]) && paren[1].trim() && paren[2].trim().split(/\s+/).length >= 2) {
    titleAlternatives.push(paren[2].trim(), paren[1].trim());
  }
  const title = {
    value: displayTitle,
    source: fromList,
    confidence: song.source === 'wikipedia' ? 'high' : 'medium',
    ...(titleAlternatives.length ? { alternatives: titleAlternatives } : {}),
  };

  // ---- kind ----
  const guess = kindFromSingers({ singers, ensemble, instrumental });
  let kind = null;
  let kindNote = null;
  if (guess.kind) {
    kind = { value: guess.kind, source: `${fromList} (sung by ${humanList(singers)})`, confidence: guess.kind === 'solo' ? 'high' : 'medium' };
    // Song lists often name a second character who only has a line or two ("The Wizard and I": Madame Morrible
    // and Elphaba; "Summertime": Clara and Jake) — offer Solo as a one-tap alternative, unless the site already
    // has this song and only as a duet.
    if (guess.kind === 'duet' && !(existing.length && existing.every((e) => e.kind === 'duet'))) {
      kind.alternatives = ['solo'];
      kind.note = 'If one of them only sings a line or two, it’s really a solo — pick Solo, then the character who sings it.';
    }
  } else if (guess.reason === 'instrumental') {
    kindNote = "This is an instrumental number — there's nothing to sing in it.";
  } else if (guess.reason === 'ensemble') {
    kindNote = `An ensemble number${singers.length ? ` led by ${humanList(singers)}` : ''} — pick Solo or Duet for the part you'll sing.`;
  } else if (guess.reason === 'group') {
    kindNote = `${singers.length} characters sing this (${humanList(singers)}) — pick Solo or Duet for the part you'll sing.`;
  } else {
    kindNote = song.source === 'recording'
      ? "We only know this song from the cast album, which doesn't say who sings it — pick Solo or Duet."
      : "The song list doesn't say who sings this — pick Solo or Duet.";
  }
  if (!kind && !instrumental && existing.length) {
    const kinds = [...new Set(existing.map((e) => e.kind))];
    kind = {
      value: kinds[0],
      source: `from the version already on the site (${existing[0].kind === 'duet' ? 'a duet' : 'a solo'})`,
      confidence: 'medium',
      ...(kinds.length > 1 ? { alternatives: kinds.slice(1) } : {}),
    };
  }

  // ---- parts (+ vocal ranges) ----
  const catalogCharacters = parseJsonList(show.characters).filter((c) => c && typeof c.name === 'string');
  // Family names several of the show's characters share ("Thénardier") never match on their own.
  const showSingers = db.prepare('SELECT singers FROM catalog_songs WHERE show_id = ?').all(show.id).flatMap((r) => strings(r.singers));
  const sharedLastWords = sharedFamilyNames([...catalogCharacters.map((c) => c.name), ...showSingers]);
  const partsValue = singers.slice(0, 6).map((name) => suggestPart(name, {
    siteParts: otherParts, catalogCharacters, showName, sharedLastWords,
  }));
  const parts = {
    value: partsValue,
    source: singers.length ? fromList : 'no singers are listed for this song',
    confidence: !singers.length ? 'low' : (ensemble || singers.length > 2) ? 'medium' : 'high',
    ...(singers.length > 2 || (ensemble && singers.length)
      ? { note: "Use the first character for a solo, the first two for a duet — or pick the ones you'll sing." }
      : {}),
  };

  // ---- genre / sub-genre / mature ----
  const fromSite = (values, label) => {
    const t = tally(values);
    if (!t.length) return null;
    return {
      value: t[0].value,
      source: fromSiteSongs(values.length, showName),
      confidence: 'medium',
      ...(t.length > 1 ? { alternatives: t.slice(1).map((x) => x.value), note: `${t[0].n} of ${values.length} say ${label(t[0].value)}` } : {}),
    };
  };
  let genre = fromSite(otherSongs.map((s) => s.genre).filter(Boolean), (v) => v);
  if (!genre) {
    const genres = strings(show.genres);
    const mapped = [];
    for (const g of genres) {
      for (const [re, value] of GENRE_MAP) if (re.test(g) && !mapped.includes(value)) mapped.push(value);
    }
    if (mapped.length) {
      const matched = genres.filter((g) => GENRE_MAP.some(([re]) => re.test(g)));
      genre = {
        value: mapped[0],
        source: `from the show's genre (${humanList(matched.map((g) => `“${g}”`))})`,
        confidence: 'low',
        ...(mapped.length > 1 ? { alternatives: mapped.slice(1) } : {}),
      };
    }
  }
  const subGenre = fromSite(otherSongs.map((s) => s.sub_genre).filter(Boolean), (v) => v);
  let mature = null;
  if (otherSongs.length) {
    const yes = otherSongs.filter((s) => s.mature).length;
    const no = otherSongs.length - yes;
    const value = yes >= no && yes > 0; // a tie leans to "mature" — safer for a school site
    mature = {
      value,
      source: fromSiteSongs(otherSongs.length, showName),
      confidence: 'medium',
      ...(yes && no ? { alternatives: [!value], note: `${value ? yes : no} of ${otherSongs.length} are marked ${value ? 'mature' : 'not mature'}` } : {}),
    };
  }

  return {
    catalogSong: {
      id: song.id,
      title: song.title,
      act: song.act ?? null,
      position: song.position ?? null,
      singers,
      singersRaw: song.singers_raw ?? '',
      ensemble,
      reprise,
      instrumental,
      source: song.source,
    },
    existingSong: existing[0] ?? null,
    existingSongs: existing,
    show: {
      siteShow: siteShow ? { id: siteShow.id, name: siteShow.name, slug: siteShow.slug } : null,
      catalogShowId: show.id,
      name: show.title,
      composer: show.composer ?? null,
      lyricist: show.lyricist ?? null,
      bookWriter: show.book_writer ?? null,
      year: show.year ?? null,
      wikiTitle: show.wiki_title ?? null,
      wikiUrl: wikipediaUrl(show.wiki_title),
    },
    title,
    kind,
    kindNote,
    parts,
    genre,
    subGenre,
    mature,
  };
}

/**
 * One singer → { character, vocalRange, rangeSource?, rangeConfidence?, rangeAlternatives?, catalogName? }.
 * The site's parts that name this character are grouped by spelling; the best-matching spelling
 * (exact name > first name > family name, then the most songs) is suggested, and only ITS songs
 * vote on the range — "Thénardier" never lends Éponine a Baritone.
 */
function suggestPart(name, { siteParts, catalogCharacters, showName, sharedLastWords }) {
  const RANK = { exact: 3, first: 2, last: 1 };
  const bySpelling = new Map();
  for (const p of siteParts) {
    const how = characterMatch(name, p.character, { sharedLastWords });
    if (!how) continue;
    const k = matchKey(p.character);
    if (!bySpelling.has(k)) bySpelling.set(k, { how, rows: [], spellings: [] });
    const g = bySpelling.get(k);
    g.rows.push(p);
    g.spellings.push(p.character);
  }
  const best = [...bySpelling.values()].sort((a, b) => RANK[b.how] - RANK[a.how]
    || new Set(b.rows.map((p) => p.song_id)).size - new Set(a.rows.map((p) => p.song_id)).size)[0];
  const part = { character: name, vocalRange: null };
  if (best) {
    const spelling = tally(best.spellings)[0].value;
    if (spelling !== name) {
      part.character = spelling;
      part.catalogName = name;
    }
    // one vote per site song
    const perSong = new Map();
    for (const p of best.rows) if (p.vocal_range && !perSong.has(p.song_id)) perSong.set(p.song_id, p.vocal_range);
    const t = tally([...perSong.values()], vocalRangeOrder);
    if (t.length) {
      const n = perSong.size;
      part.vocalRange = t[0].value;
      if (t.length === 1) {
        part.rangeSource = fromSiteSongs(n, showName);
        part.rangeConfidence = best.how === 'exact' ? 'high' : 'medium'; // a partial name is never "sure"
      } else {
        part.rangeSource = `from ${t[0].n} of ${n} other ${showName} songs on the site — the rest say ${humanList(t.slice(1).map((x) => x.value))}`;
        part.rangeConfidence = 'medium';
        part.rangeAlternatives = t.slice(1).map((x) => x.value);
      }
      return part;
    }
  }
  // The catalog's character list (voice type as Wikipedia states it).
  const c = catalogCharacters.find((x) => characterMatch(name, x.name) === 'exact')
    ?? catalogCharacters.find((x) => characterMatch(name, x.name, { sharedLastWords }));
  const range = c ? voiceTypeToRange(c.voiceType) : null;
  if (range) {
    part.vocalRange = range;
    part.rangeSource = `from the Wikipedia character list (${c.name}: ${c.voiceType})`;
    part.rangeConfidence = 'medium';
  }
  return part;
}

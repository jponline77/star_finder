// Song catalog (SPEC §7c): migration v5, the loader (version check, reload, preservation, bad files),
// re-linking site shows/songs, and load/search performance on a synthetic 50k-song catalog.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { openDb, MIGRATIONS } from '../src/db.js';
import {
  loadCatalog, loadCatalogAtStartup, peekCatalogVersion, relinkSiteRows, CatalogError, songTitleKeys, songTitleMatchLevel,
  sameCharacter, voiceTypeToRange, showNameKeys, catalogStatus, splitCatalogDocument,
} from '../src/lib/catalog.js';
import { searchCatalog } from '../src/lib/catalog-search.js';
import {
  CATALOG_FIXTURE, FIXTURES, insertShow, insertSong,
} from './helpers.js';

const SCHEMA_SQL = fs.readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8');
const FIXTURE_JSON = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'catalog.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'star-catalog-'));
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Write a catalog object as .json.gz (or raw bytes) and return its path. */
function writeCatalog(dir, data, name = 'catalog.json.gz') {
  const file = path.join(dir, name);
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  fs.writeFileSync(file, name.endsWith('.gz') ? zlib.gzipSync(bytes) : bytes);
  return file;
}

const songId = (db, show, title, reprise = 0) => db.prepare(`SELECT s.id FROM catalog_songs s JOIN catalog_shows sh ON sh.id = s.show_id
  WHERE sh.title = ? AND s.title = ? AND s.reprise = ?`).get(show, title, reprise)?.id;
const showId = (db, key) => db.prepare('SELECT id FROM catalog_shows WHERE key = ?').get(key)?.id;
const logger = () => {
  const lines = { info: [], warn: [] };
  return { lines, info: (m) => lines.info.push(m), warn: (m) => lines.warn.push(m), error: (m) => lines.warn.push(m) };
};

test('the fixture catalog.json.gz is the gzip of catalog.json (keep them in sync)', () => {
  const gz = JSON.parse(zlib.gunzipSync(fs.readFileSync(CATALOG_FIXTURE)).toString('utf8'));
  assert.deepEqual(gz, FIXTURE_JSON);
});

describe('migrations v5 + v6', () => {
  test('a v4 database with accounts and community rows upgrades without losing anything', () => {
    const dir = tmp();
    try {
      const file = path.join(dir, 'v4.db');
      const old = new Database(file);
      old.pragma('foreign_keys = ON');
      old.exec(SCHEMA_SQL);
      for (const m of MIGRATIONS.filter((x) => x.version <= 4)) m.up(old);
      old.pragma('user_version = 4');
      const u = old.prepare("INSERT INTO users (email, display_name, password_hash, role) VALUES ('kid@school.ca', 'Kid', 'scrypt$x', 'admin')").run().lastInsertRowid;
      old.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h', ?, '2999-01-01')").run(u);
      const sh = old.prepare("INSERT INTO shows (name, slug, source, created_by, composer) VALUES ('Hadestown', 'hadestown', 'community', ?, 'Anaïs Mitchell')").run(u).lastInsertRowid;
      const so = old.prepare(`INSERT INTO songs (kind, title, show_id, genre, source, created_by, artwork_path, audio_path, import_key, edited_at)
        VALUES ('solo', 'Flowers', ?, 'Drama', 'community', ?, '/uploads/art/a.jpg', '/uploads/audio/b.mp3', NULL, '2026-01-01')`).run(sh, u).lastInsertRowid;
      old.prepare("INSERT INTO song_parts (song_id, position, character, vocal_range) VALUES (?, 1, 'Eurydice', 'Mezzo-soprano')").run(so);
      old.prepare("INSERT INTO comments (song_id, user_id, body, tag) VALUES (?, ?, 'Great song', 'tip')").run(so, u);
      old.prepare("INSERT INTO festivals (slug, name, kind) VALUES ('surrey', 'Surrey Regional STAR Fest', 'regional')").run();
      old.prepare("INSERT INTO festival_tombstones (slug, deleted_at) VALUES ('gone', '2026-01-01')").run();
      const before = {
        users: old.prepare('SELECT * FROM users').all(),
        shows: old.prepare('SELECT * FROM shows').all(),
        songs: old.prepare('SELECT * FROM songs').all(),
        parts: old.prepare('SELECT * FROM song_parts').all(),
        comments: old.prepare('SELECT * FROM comments').all(),
        sessions: old.prepare('SELECT * FROM sessions').all(),
        festivals: old.prepare('SELECT * FROM festivals').all(),
      };
      old.close();

      const db = openDb(file);
      try {
        assert.equal(db.pragma('user_version', { simple: true }), Math.max(...MIGRATIONS.map((m) => m.version)));
        assert.deepEqual(db.prepare('SELECT * FROM users').all(), before.users);
        assert.deepEqual(db.prepare('SELECT * FROM song_parts').all(), before.parts);
        assert.deepEqual(db.prepare('SELECT * FROM comments').all(), before.comments);
        assert.deepEqual(db.prepare('SELECT * FROM sessions').all(), before.sessions);
        assert.deepEqual(db.prepare('SELECT * FROM festivals').all(), before.festivals);
        // new columns are added (NULL) and nothing else changes
        const shows = db.prepare('SELECT * FROM shows').all();
        assert.deepEqual(shows.map(({ catalog_show_id: c, catalog_link: l, ...rest }) => rest), before.shows);
        assert.ok(shows.every((s) => s.catalog_show_id === null && s.catalog_link === null));
        const songs = db.prepare('SELECT * FROM songs').all();
        assert.deepEqual(songs.map(({ catalog_song_id: c, custom_artwork_path: a, catalog_link: l, ...rest }) => rest), before.songs);
        assert.ok(songs.every((s) => s.catalog_song_id === null && s.custom_artwork_path === null && s.catalog_link === null));
        for (const t of ['catalog_shows', 'catalog_songs', 'catalog_meta', 'catalog_fts', 'catalog_show_fts', 'catalog_rejected_albums']) {
          assert.equal(db.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name = ?').get(t).n, 1, t);
        }
        assert.equal(db.pragma('foreign_key_check').length, 0);
        // loading a catalog afterwards links the community show/song but changes nothing else
        const r = loadCatalog(db, CATALOG_FIXTURE);
        assert.equal(r.links.showsLinked, 1);
        assert.equal(r.links.songsLinked, 1);
        const after = db.prepare('SELECT * FROM songs').all();
        assert.deepEqual(after.map(({ catalog_song_id: c, custom_artwork_path: a, catalog_link: l, ...rest }) => rest), before.songs);
        assert.equal(db.prepare('SELECT title FROM catalog_songs WHERE id = ?').get(after[0].catalog_song_id).title, 'Flowers');
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('re-running the migration list is harmless (idempotent DDL)', () => {
    const db = openDb(':memory:');
    try {
      assert.doesNotThrow(() => MIGRATIONS.find((m) => m.version === 5).up(db));
      assert.doesNotThrow(() => MIGRATIONS.find((m) => m.version === 6).up(db));
    } finally {
      db.close();
    }
  });
});

describe('catalog loader', () => {
  test('loads the fixture: shows, songs, flags, meta and the search index', () => {
    const db = openDb(':memory:');
    try {
      const r = loadCatalog(db, CATALOG_FIXTURE);
      assert.equal(r.loaded, true);
      assert.equal(r.version, 'fixture-2026-09-27.1');
      assert.equal(r.shows, 6);
      assert.equal(r.songs, 74);
      assert.deepEqual(r.skipped, { shows: 0, songs: 0, duplicateShows: 0, duplicateSongs: 0 });
      const lesMis = db.prepare("SELECT * FROM catalog_shows WHERE key = 'Q192111'").get();
      assert.equal(lesMis.title, 'Les Misérables');
      assert.deepEqual(JSON.parse(lesMis.alt_titles), ['Les Mis', 'Les Miz']);
      assert.equal(lesMis.composer, 'Claude-Michel Schönberg');
      assert.equal(lesMis.year, 1980);
      assert.equal(lesMis.song_count, 27, 'instrumentals are not counted');
      const come = db.prepare("SELECT * FROM catalog_shows WHERE key = 'wp:Come From Away'").get();
      assert.equal(come.wikidata_id, null);
      assert.equal(come.song_count, 0);
      const entr = db.prepare("SELECT * FROM catalog_songs WHERE title = 'Entr''acte'").get();
      assert.equal(entr.instrumental, 1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM catalog_fts WHERE rowid = ?').get(entr.id).n, 0, 'instrumentals are not searchable');
      // "Wait for Me" and its reprise are two rows with the same title
      assert.ok(songId(db, 'Hadestown', 'Wait for Me', 0));
      assert.ok(songId(db, 'Hadestown', 'Wait for Me', 1));
      assert.equal(db.prepare('SELECT count(*) AS n FROM catalog_fts').get().n, 72);
      assert.equal(db.prepare('SELECT count(*) AS n FROM catalog_show_fts').get().n, 6);
      const status = catalogStatus(db);
      assert.equal(status.available, true);
      assert.equal(status.version, 'fixture-2026-09-27.1');
      assert.equal(status.generatedAt, '2026-09-27T12:00:00.000Z');
      assert.equal(status.songs, 72);
      assert.match(status.attribution.text, /Wikipedia \(CC BY-SA 4\.0\)/);
    } finally {
      db.close();
    }
  });

  test('same version → skipped without reading the whole file; force reloads with the same ids', () => {
    const db = openDb(':memory:');
    try {
      loadCatalog(db, CATALOG_FIXTURE);
      const ids = db.prepare('SELECT id, title FROM catalog_songs ORDER BY id').all();
      const loadedAt = db.prepare("SELECT value FROM catalog_meta WHERE key = 'loadedAt'").get().value;
      const changesBefore = db.prepare('SELECT total_changes() AS n').get().n;
      const again = loadCatalog(db, CATALOG_FIXTURE);
      assert.equal(again.loaded, false);
      assert.equal(again.reason, 'unchanged');
      assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changesBefore, 'nothing written');
      assert.equal(db.prepare("SELECT value FROM catalog_meta WHERE key = 'loadedAt'").get().value, loadedAt);
      assert.equal(peekCatalogVersion(CATALOG_FIXTURE), 'fixture-2026-09-27.1');
      const forced = loadCatalog(db, CATALOG_FIXTURE, { force: true });
      assert.equal(forced.loaded, true);
      assert.deepEqual(db.prepare('SELECT id, title FROM catalog_songs ORDER BY id').all(), ids, 'ids are stable');
      // empty tables with a matching version → reloads
      db.exec('DELETE FROM catalog_shows');
      assert.equal(loadCatalog(db, CATALOG_FIXTURE).loaded, true);
    } finally {
      db.close();
    }
  });

  test('a new version: updates in place, removes what is gone, keeps cast-album songs, the cached album and site links', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      loadCatalog(db, CATALOG_FIXTURE);
      const hades = showId(db, 'Q5636956');
      const flowers = songId(db, 'Hadestown', 'Flowers');
      const wicked = showId(db, 'Q156396');
      // a cast album was found for Come From Away and Hadestown; tracks were saved
      const cfa = showId(db, 'wp:Come From Away');
      db.prepare("UPDATE catalog_shows SET itunes_collection_id = 111, itunes_collection_name = 'Come From Away (Original Broadway Cast Recording)' WHERE id = ?").run(cfa);
      db.prepare('UPDATE catalog_shows SET itunes_collection_id = 222 WHERE id = ?').run(hades);
      const rec = Number(db.prepare("INSERT INTO catalog_songs (show_id, title, position, source) VALUES (?, 'Welcome to the Rock', 1, 'recording')").run(cfa).lastInsertRowid);
      const recDup = Number(db.prepare("INSERT INTO catalog_songs (show_id, title, position, source) VALUES (?, 'Livin It Up On Top!', 30, 'recording')").run(hades).lastInsertRowid);
      // a site song linked (on the song form) to a cast-album song, and one to Flowers
      const site = insertShow(db, 'Hadestown');
      const s1 = insertSong(db, { title: 'Flowers', showId: site, source: 'community' });
      const s2 = insertSong(db, { title: 'Livin’ It Up on Top', showId: site, source: 'community' });
      relinkSiteRows(db);
      db.prepare('UPDATE songs SET catalog_song_id = ? WHERE id = ?').run(recDup, s2);

      const next = clone(FIXTURE_JSON);
      next.version = 'fixture-2026-09-28.1';
      const h = next.shows.find((s) => s.key === 'Q5636956');
      h.title = 'Hadestown (musical)';
      h.songs = h.songs.filter((s) => s.title !== 'Epic I');
      h.songs.push({ title: 'Nothing Changes', act: 2, position: 24, singers: ['The Fates'], singersRaw: 'Fates', ensemble: false, reprise: false, instrumental: false });
      next.shows = next.shows.filter((s) => s.key !== 'Q156396'); // Wicked removed
      const file = writeCatalog(dir, next);
      const r = loadCatalog(db, file);

      assert.equal(r.loaded, true);
      assert.equal(r.previousVersion, 'fixture-2026-09-27.1');
      assert.equal(r.version, 'fixture-2026-09-28.1');
      assert.deepEqual(r.removed, { shows: 1, songs: 1 });
      assert.equal(r.merged, 1, 'the cast-album copy of a listed song is merged');
      assert.equal(showId(db, 'Q156396'), undefined);
      assert.equal(db.prepare('SELECT count(*) AS n FROM catalog_songs WHERE show_id = ?').get(wicked).n, 0, 'its songs went too');
      assert.equal(showId(db, 'Q5636956'), hades, 'same show id');
      assert.equal(db.prepare('SELECT title FROM catalog_shows WHERE id = ?').get(hades).title, 'Hadestown (musical)');
      assert.equal(songId(db, 'Hadestown (musical)', 'Flowers'), flowers, 'same song id');
      assert.equal(songId(db, 'Hadestown (musical)', 'Epic I'), undefined);
      assert.ok(songId(db, 'Hadestown (musical)', 'Nothing Changes'));
      // preserved: cast-album songs + cached albums
      assert.equal(db.prepare('SELECT source FROM catalog_songs WHERE id = ?').get(rec).source, 'recording');
      assert.equal(db.prepare('SELECT itunes_collection_id AS c, itunes_collection_name AS n FROM catalog_shows WHERE id = ?').get(cfa).c, 111);
      assert.equal(db.prepare('SELECT itunes_collection_id AS c FROM catalog_shows WHERE id = ?').get(hades).c, 222);
      assert.equal(db.prepare('SELECT song_count FROM catalog_shows WHERE id = ?').get(cfa).song_count, 1);
      // the merged cast-album song's site link moved to the Wikipedia row
      assert.equal(db.prepare('SELECT id FROM catalog_songs WHERE id = ?').get(recDup), undefined);
      assert.equal(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(s2).c, songId(db, 'Hadestown (musical)', "Livin' It Up on Top"));
      assert.equal(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(s1).c, flowers);
      // the search index follows the new titles
      assert.equal(searchCatalog(db, 'epic i').filter((h2) => h2.title === 'Epic I').length, 0);
      assert.ok(searchCatalog(db, 'nothing changes').some((h2) => h2.title === 'Nothing Changes'));
      assert.ok(searchCatalog(db, 'welcome to the rock').some((h2) => h2.title === 'Welcome to the Rock'));
      assert.equal(searchCatalog(db, 'popular').length, 0, 'Wicked is gone from the index');
      assert.equal(db.pragma('foreign_key_check').length, 0);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('bad files never change anything: missing, not gzip, truncated, no version, broken JSON inside', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      loadCatalog(db, CATALOG_FIXTURE);
      const snapshot = () => db.prepare('SELECT id, title FROM catalog_songs ORDER BY id').all();
      const before = snapshot();
      assert.throws(() => loadCatalog(db, path.join(dir, 'nope.json.gz')), (e) => e instanceof CatalogError && e.code === 'missing');
      const gz = fs.readFileSync(CATALOG_FIXTURE);
      const cases = {
        'garbage.json.gz': Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from('definitely not gzip')]),
        'truncated.json.gz': gz.subarray(0, Math.floor(gz.length / 2)),
        'text.json': Buffer.from('hello'),
        'array.json': Buffer.from('[1,2,3]'),
      };
      for (const [name, bytes] of Object.entries(cases)) {
        const file = path.join(dir, name);
        fs.writeFileSync(file, bytes);
        assert.throws(() => loadCatalog(db, file, { force: true }), CatalogError, name);
      }
      const noVersion = clone(FIXTURE_JSON);
      delete noVersion.version;
      assert.throws(() => loadCatalog(db, writeCatalog(dir, noVersion, 'nov.json.gz'), { force: true }), /no "version"/);
      const noShows = { version: 'x' };
      assert.throws(() => loadCatalog(db, writeCatalog(dir, noShows, 'nos.json.gz'), { force: true }), /no "shows"/);
      // the last show is broken JSON: everything before it was already inserted → rolled back
      const text = JSON.stringify({ ...FIXTURE_JSON, version: 'broken' }).replace(/"title":"Come From Away"/, '"title":Come From Away');
      assert.throws(() => loadCatalog(db, writeCatalog(dir, text, 'broken.json.gz')), /isn't valid JSON/);
      assert.deepEqual(snapshot(), before);
      assert.equal(catalogStatus(db).version, 'fixture-2026-09-27.1');
      // startup never throws — it warns and keeps what was loaded
      const log = logger();
      assert.equal(loadCatalogAtStartup(db, path.join(dir, 'broken.json.gz'), log), null);
      assert.match(log.lines.warn.join('\n'), /Couldn't load the song catalog .*keeping the catalog that was already loaded/);
      const log2 = logger();
      assert.equal(loadCatalogAtStartup(db, path.join(dir, 'missing.json.gz'), log2), null);
      assert.match(log2.lines.warn.join('\n'), /No song catalog at .*missing\.json\.gz/);
      assert.deepEqual(snapshot(), before);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('plain JSON works; "version" after "shows"; junk entries skipped; text cleaned and capped', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      const doc = {
        shows: [
          { key: 'Q1', title: '  Bidi‮test  Show ', songs: [
            { title: 'Song\u0000 One', singers: ['A', 'a', '', 42], singersRaw: 'A' },
            { title: 'song one', singers: [] }, // same title (case-insensitively) → duplicate
            { title: '' }, // no title → skipped
            { title: 'X'.repeat(400), act: 'two', position: -1 },
          ], altTitles: ['BIDITEST show', 'Other'], genres: ['Musical Comedy'], year: 'nineteen' },
          { key: 'Q1', title: 'Duplicate key', songs: [] },
          { title: 'No key' },
          'not an object',
        ],
        generatedAt: '2026-01-01',
        sources: { note: 'x'.repeat(5000) },
        version: 'late-version',
      };
      const file = writeCatalog(dir, JSON.stringify(doc, null, 2), 'plain.json');
      assert.equal(peekCatalogVersion(file), null, 'not near the start');
      const r = loadCatalog(db, file);
      assert.equal(r.version, 'late-version');
      assert.deepEqual(r.skipped, { shows: 2, songs: 1, duplicateShows: 1, duplicateSongs: 1 });
      const show = db.prepare('SELECT * FROM catalog_shows').get();
      assert.equal(show.title, 'Biditest Show', 'bidi override removed, spaces collapsed');
      assert.deepEqual(JSON.parse(show.alt_titles), ['Other'], 'alt title equal to the title dropped');
      assert.deepEqual(JSON.parse(show.genres), ['musical comedy']);
      assert.equal(show.year, null);
      const songs = db.prepare('SELECT * FROM catalog_songs ORDER BY id').all();
      assert.equal(songs.length, 2);
      assert.equal(songs[0].title, 'Song One');
      assert.deepEqual(JSON.parse(songs[0].singers), ['A', '42']);
      assert.equal([...songs[1].title].length, 300);
      assert.equal(songs[1].act, null);
      assert.equal(songs[1].position, null);
      // same version again: found by the full read → skipped
      assert.equal(loadCatalog(db, file).loaded, false);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('splitCatalogDocument copes with braces, brackets and escaped quotes inside strings', () => {
    const doc = { version: 'v"1', shows: [{ key: 'a', title: 'Brace { [ "quoted" \\ ] }', songs: [] }, { key: 'b', title: 'B' }] };
    const { meta, showRanges } = splitCatalogDocument(Buffer.from(JSON.stringify(doc)));
    assert.equal(meta.version, 'v"1');
    assert.equal(showRanges.length, 2);
  });
});

describe('matching helpers', () => {
  test('song titles: punctuation, articles, parenthetical subtitles and reprises', () => {
    const lvl = (a, b, ra = false, rb = false) => songTitleMatchLevel(songTitleKeys(a, ra), songTitleKeys(b, rb));
    assert.equal(lvl('Hey, Little Songbird', 'Hey Little Songbird'), 2);
    assert.equal(lvl('Confrontation', 'The Confrontation'), 2);
    assert.equal(lvl("Javert’s Suicide", "Javert's Suicide"), 2);
    assert.equal(lvl('What Have I Done?', "Valjean's Soliloquy (What Have I Done?)"), 1);
    assert.equal(lvl('Come To Me', "Come to Me (Fantine's Death)"), 1);
    assert.equal(lvl('Wait for Me (Reprise)', 'Wait for Me', false, true), 2);
    assert.equal(lvl('Wait for Me', 'Wait for Me', false, true), 0, 'a reprise only matches a reprise');
    assert.equal(lvl("I'm Not That Girl - Reprise", "I'm Not That Girl (Reprise)"), 2);
    assert.equal(lvl('Stars', 'Starstruck'), 0);
  });

  test('show names and characters', () => {
    assert.deepEqual(showNameKeys('Shrek The Musical'), ['shrek the musical', 'shrek']);
    assert.deepEqual(showNameKeys('The Book of Mormon'), ['book of mormon']);
    assert.equal(sameCharacter('Éponine', 'Eponine'), 'exact');
    assert.equal(sameCharacter('The Fates', 'Fates'), 'exact');
    assert.equal(sameCharacter('Valjean', 'Jean Valjean'), 'partial');
    assert.equal(sameCharacter('Cathy', 'Cathy Hiatt'), 'partial');
    assert.equal(sameCharacter('Cosette', 'Young Cosette'), null);
    assert.equal(sameCharacter('Thénardier', 'Madame Thénardier'), null);
    assert.equal(sameCharacter('Marius', 'Enjolras'), null);
  });

  test('voice types → vocal ranges', () => {
    assert.equal(voiceTypeToRange('Bass-baritone'), 'Baritone');
    assert.equal(voiceTypeToRange('mezzo'), 'Mezzo-soprano');
    assert.equal(voiceTypeToRange('Tenor/Baritone'), 'Tenor');
    assert.equal(voiceTypeToRange('Baritone or tenor'), 'Baritone');
    assert.equal(voiceTypeToRange('Contralto'), 'Alto');
    assert.equal(voiceTypeToRange('boy treble'), 'Soprano');
    assert.equal(voiceTypeToRange('Belter'), 'Mezzo-soprano');
    assert.equal(voiceTypeToRange('Speaking role'), null);
    assert.equal(voiceTypeToRange(null), null);
  });
});

describe('re-linking site shows and songs', () => {
  let db;
  const ids = {};
  before(() => {
    db = openDb(':memory:');
    ids.hades = insertShow(db, 'Hadestown', { source: 'spreadsheet' });
    ids.lesMis = insertShow(db, 'Les Misérables');
    ids.spam = insertShow(db, "Monty Python's Spamalot", { source: 'community' });
    ids.shrek = insertShow(db, 'Shrek The Musical');
    const song = (title, show, kind = 'solo') => insertSong(db, { title, showId: show, kind, parts: kind === 'duet' ? [['A', null], ['B', null]] : [['A', null]] });
    ids.flowers = song('Flowers', ids.hades);
    ids.songbird = song('Hey, Little Songbird', ids.hades, 'duet');
    ids.waitReprise = song('Wait for Me (Reprise)', ids.hades);
    ids.what = song('What Have I Done?', ids.lesMis);
    ids.come = song('Come To Me', ids.lesMis, 'duet');
    ids.confront = song('Confrontation', ids.lesMis, 'duet');
    ids.who = song('Who Am I?', ids.lesMis);
    ids.made = song('A Song Nobody Wrote', ids.lesMis);
    ids.diva = song('Whatever Happened to My Part?', ids.spam);
    ids.donkey = song("Don't Let Me Go", ids.shrek);
  });
  after(() => db.close());

  test('loading links by folded title, alt titles, punctuation and reprise; reports counts; touches only link columns', () => {
    const before = db.prepare('SELECT id, title, updated_at, edited_at, source FROM songs ORDER BY id').all();
    const r = loadCatalog(db, CATALOG_FIXTURE);
    assert.deepEqual(r.links, { shows: 4, showsLinked: 3, songs: 10, songsLinked: 8, changed: 11 });
    const link = (id) => db.prepare('SELECT cs.title, cs.reprise FROM songs s JOIN catalog_songs cs ON cs.id = s.catalog_song_id WHERE s.id = ?').get(id);
    const showLink = (id) => db.prepare('SELECT cs.key FROM shows s JOIN catalog_shows cs ON cs.id = s.catalog_show_id WHERE s.id = ?').get(id)?.key;
    assert.equal(showLink(ids.hades), 'Q5636956');
    assert.equal(showLink(ids.lesMis), 'Q192111');
    assert.equal(showLink(ids.spam), 'Q1392416', 'via the alt title');
    assert.equal(showLink(ids.shrek), undefined, 'not in the catalog');
    assert.equal(link(ids.flowers).title, 'Flowers');
    assert.equal(link(ids.songbird).title, 'Hey Little Songbird');
    assert.deepEqual({ ...link(ids.waitReprise) }, { title: 'Wait for Me', reprise: 1 });
    assert.equal(link(ids.what).title, "Valjean's Soliloquy (What Have I Done?)");
    assert.equal(link(ids.come).title, "Come to Me (Fantine's Death)");
    assert.equal(link(ids.confront).title, 'The Confrontation');
    assert.equal(link(ids.who).title, 'Who Am I? (The Trial)');
    assert.equal(link(ids.diva).title, "The Diva's Lament (Whatever Happened to My Part?)");
    assert.equal(link(ids.made), undefined);
    assert.deepEqual(db.prepare('SELECT id, title, updated_at, edited_at, source FROM songs ORDER BY id').all(), before);
  });

  test('links chosen on the song form are kept; a song moved to another show is re-linked', () => {
    const bring = songId(db, 'Les Misérables', 'Bring Him Home');
    db.prepare('UPDATE songs SET catalog_song_id = ? WHERE id = ?').run(bring, ids.made); // chosen on the form
    const epic = songId(db, 'Hadestown', 'Epic II');
    db.prepare('UPDATE songs SET catalog_song_id = ? WHERE id = ?').run(epic, ids.who); // points into another show
    const r = relinkSiteRows(db);
    assert.equal(r.changed, 1);
    assert.equal(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(ids.made).c, bring);
    assert.equal(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(ids.who).c, songId(db, 'Les Misérables', 'Who Am I? (The Trial)'));
    loadCatalog(db, CATALOG_FIXTURE, { force: true });
    assert.equal(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(ids.made).c, bring, 'survives a reload');
  });
});

test('search: songs of shows already on the site get a small boost', () => {
  const dir = tmp();
  const db = openDb(':memory:');
  try {
    const song = (title) => ({ title, singers: ['A'], singersRaw: 'A' });
    const doc = {
      version: 'boost',
      shows: [
        { key: 'Q1', title: 'Alpha Show', songs: [song('Home')] },
        { key: 'Q2', title: 'Beta Show', songs: [song('Home')] },
        { key: 'Q3', title: 'Gamma Show', songs: [song('Home Again')] },
      ],
    };
    loadCatalog(db, writeCatalog(dir, doc));
    const order = () => searchCatalog(db, 'home').map((h) => `${h.title}/${h.show.title}`);
    assert.deepEqual(order(), ['Home/Alpha Show', 'Home/Beta Show', 'Home Again/Gamma Show']);
    insertShow(db, 'Beta Show');
    relinkSiteRows(db);
    assert.deepEqual(order(), ['Home/Beta Show', 'Home/Alpha Show', 'Home Again/Gamma Show'], 'the boost never beats a better title match');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('performance: synthetic 50k-song catalog', () => {
  test('loads in < 10 s and searches in < 100 ms', () => {
    const dir = tmp();
    const db = openDb(path.join(dir, 'perf.db'));
    try {
      const words = ['love', 'night', 'dream', 'heart', 'home', 'star', 'light', 'song', 'rain', 'dance', 'fire', 'moon', 'city', 'road',
        'river', 'king', 'queen', 'wicked', 'shadow', 'morning', 'ballad', 'waltz', 'finale', 'prologue', 'misérables', 'élan', 'café', 'blue'];
      let seed = 42;
      const rnd = (n) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
      };
      const phrase = (n) => Array.from({ length: n }, () => words[rnd(words.length)]).join(' ');
      const shows = [];
      for (let i = 0; i < 5000; i++) {
        const songs = [];
        for (let j = 0; j < 10; j++) {
          songs.push({
            title: `${phrase(1 + rnd(4))} ${i}-${j}`, act: 1 + (j >= 5 ? 1 : 0), position: j + 1, singers: [`Character ${rnd(30)}`, `Hero ${i}`].slice(0, 1 + rnd(2)),
            singersRaw: 'x', ensemble: rnd(5) === 0, reprise: false, instrumental: j === 0 && rnd(3) === 0,
          });
        }
        shows.push({
          key: `Q${1000000 + i}`, title: `${phrase(1 + rnd(3))} Show ${i}`, altTitles: [], wikiTitle: `Show ${i}`, wikidataId: `Q${1000000 + i}`,
          composer: `Composer ${rnd(500)}`, lyricist: null, bookWriter: null, year: 1900 + rnd(125), genres: ['musical'], description: null,
          characters: [{ name: `Hero ${i}`, voiceType: 'Tenor' }], songs,
        });
      }
      const file = writeCatalog(dir, { version: 'perf-1', generatedAt: new Date().toISOString(), sources: {}, shows });
      insertShow(db, 'Show 17');
      const t0 = performance.now();
      const r = loadCatalog(db, file);
      const loadMs = performance.now() - t0;
      assert.equal(r.songs, 50000);
      assert.ok(loadMs < 10_000, `load took ${Math.round(loadMs)} ms`);
      const t1 = performance.now();
      const again = loadCatalog(db, file, { force: true });
      const reloadMs = performance.now() - t1;
      assert.ok(reloadMs < 10_000, `reload took ${Math.round(reloadMs)} ms`);
      assert.equal(again.removed.songs, 0);
      const t2 = performance.now();
      assert.equal(loadCatalog(db, file).loaded, false);
      const skipMs = performance.now() - t2;
      assert.ok(skipMs < 200, `an unchanged catalog is skipped quickly (${Math.round(skipMs)} ms)`);
      const queries = ['love', 'lo', 'dream hea', 'miserables', 'cafe', 'bring hi', 'the', 'show 4999', 'hero 123', 'b', 'x y', 'wicked sha', 'finale 10-9'];
      const times = [];
      // Best of 3 uncached runs: `npm test` runs test files in parallel, so one timing can be mostly CPU
      // contention. Each run uses its own connection, i.e. its own (empty) search cache.
      const readers = [db, openDb(path.join(dir, 'perf.db')), openDb(path.join(dir, 'perf.db'))];
      try {
        for (const q of queries) {
          let best = Infinity;
          for (const reader of readers) {
            const s = performance.now();
            searchCatalog(reader, q, { limit: 50 });
            best = Math.min(best, performance.now() - s);
          }
          times.push([q, best]);
        }
      } finally {
        readers.slice(1).forEach((r) => r.close());
      }
      const worst = times.reduce((a, b) => (b[1] > a[1] ? b : a));
      assert.ok(worst[1] < 100, `slowest search "${worst[0]}" took ${worst[1].toFixed(1)} ms`);
      // a peek at the numbers when run with --test-reporter=spec
      console.log(`    perf: load ${Math.round(loadMs)} ms, reload ${Math.round(reloadMs)} ms, slowest search "${worst[0]}" ${worst[1].toFixed(1)} ms`
        + ` (${times.map(([q, ms]) => `${q}:${ms.toFixed(0)}`).join(', ')})`);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

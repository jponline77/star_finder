// Catalog loader and matching — hardening regressions (review findings on SPEC §7c):
// size guards and retiring instead of wiping, gzip-bomb / huge-string / __proto__ files, reloads by
// file contents, cast-album songs next to a new song list, numbered reprises, medley/spacing
// titles, character names (family names, titles), ambiguous show names and sticky link choices.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { openDb } from '../src/db.js';
import {
  loadCatalog, loadCatalogAtStartup, relinkSiteRows, CatalogError, songTitleKeys, songTitleMatchLevel, sameCharacter,
  characterMatch, sharedFamilyNames, findCatalogShowFor, findCatalogSongFor, catalogStatus,
} from '../src/lib/catalog.js';
import { searchCatalog } from '../src/lib/catalog-search.js';
import { catalogSuggestions } from '../src/lib/catalog-suggest.js';
import { CATALOG_FIXTURE, FIXTURES, insertShow, insertSong } from './helpers.js';

const FIXTURE_JSON = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'catalog.json'), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'star-catalog-h-'));
const clone = (x) => JSON.parse(JSON.stringify(x));
function writeCatalog(dir, data, name = 'catalog.json.gz') {
  const file = path.join(dir, name);
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  fs.writeFileSync(file, name.endsWith('.gz') ? zlib.gzipSync(bytes) : bytes);
  return file;
}
const logger = () => {
  const lines = { info: [], warn: [] };
  return { lines, info: (m) => lines.info.push(m), warn: (m) => lines.warn.push(m) };
};
const song = (title, singers = [], extra = {}) => ({ title, singers, singersRaw: singers.join(', '), ensemble: false, reprise: false, instrumental: false, ...extra });
const counts = (db) => ({
  shows: db.prepare('SELECT count(*) AS n FROM catalog_shows').get().n,
  songs: db.prepare('SELECT count(*) AS n FROM catalog_songs').get().n,
  linkedShows: db.prepare('SELECT count(*) AS n FROM shows WHERE catalog_show_id IS NOT NULL').get().n,
  linkedSongs: db.prepare('SELECT count(*) AS n FROM songs WHERE catalog_song_id IS NOT NULL').get().n,
});

describe('a file that would wipe the catalog is refused', () => {
  test('no shows, the 6-show fixture over a bigger catalog, or mostly keyless shows → CatalogError, nothing changes; --force accepts a smaller file', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      // a "real" catalog: the fixture + 20 more shows
      const big = clone(FIXTURE_JSON);
      big.version = 'big.1';
      for (let i = 0; i < 20; i++) big.shows.push({ key: `Qx${i}`, title: `Extra Show ${i}`, songs: [song(`Extra Song ${i}`)] });
      loadCatalog(db, writeCatalog(dir, big, 'big.json.gz'));
      const site = insertShow(db, 'Hadestown');
      insertSong(db, { title: 'Flowers', showId: site });
      relinkSiteRows(db);
      const before = counts(db);
      assert.deepEqual(before, { shows: 26, songs: 94, linkedShows: 1, linkedSongs: 1 });

      const empty = writeCatalog(dir, { version: 'empty.1', shows: [] }, 'empty.json.gz');
      assert.throws(() => loadCatalog(db, empty), (e) => e instanceof CatalogError && /no usable shows/.test(e.message));
      assert.throws(() => loadCatalog(db, empty, { force: true, allowShrink: true }), /no usable shows/, 'never, not even with --force');
      const keyless = { version: 'keyless.1', shows: big.shows.map(({ key, ...rest }) => rest) };
      assert.throws(() => loadCatalog(db, writeCatalog(dir, keyless, 'keyless.json.gz')), /no usable shows/);
      const mostlyKeyless = { version: 'mostly.1', shows: big.shows.map((s, i) => (i < 12 ? { ...s, key: undefined } : s)) };
      assert.throws(() => loadCatalog(db, writeCatalog(dir, mostlyKeyless, 'mostly.json.gz')), /12 of its 26 shows have no key or title/);
      // the test fixture pointed at a real database
      assert.throws(() => loadCatalog(db, CATALOG_FIXTURE), /only 6 shows but 26 are loaded/);
      const fewSongs = clone(big);
      fewSongs.version = 'fewsongs.1';
      for (const s of fewSongs.shows) s.songs = s.songs.slice(0, 1);
      assert.throws(() => loadCatalog(db, writeCatalog(dir, fewSongs, 'few.json.gz')), /only 25 songs but 94 are loaded/);
      assert.deepEqual(counts(db), before, 'nothing changed');
      assert.equal(catalogStatus(db).version, 'big.1');

      // startup: a warning, the loaded catalog stays
      const log = logger();
      assert.equal(loadCatalogAtStartup(db, CATALOG_FIXTURE, log), null);
      assert.match(log.lines.warn.join('\n'), /Couldn't load the song catalog .*less than half.*catalog:load -- --force.*keeping the catalog/s);
      assert.deepEqual(counts(db), before);

      // a maintainer who means it
      const r = loadCatalog(db, CATALOG_FIXTURE, { allowShrink: true });
      assert.equal(r.loaded, true);
      assert.equal(r.shows, 6);
      assert.equal(counts(db).shows, 6);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a show gone from the file that holds site data is retired (hidden, rows kept), not deleted; listing it again brings it back', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      loadCatalog(db, CATALOG_FIXTURE);
      const cfa = db.prepare("SELECT id FROM catalog_shows WHERE key = 'wp:Come From Away'").get().id;
      const wicked = db.prepare("SELECT id FROM catalog_shows WHERE key = 'Q156396'").get().id;
      const l5y = db.prepare("SELECT id FROM catalog_shows WHERE key = 'Q2533140'").get().id;
      // Come From Away: cast-album songs + album saved on the site; Wicked: a site show linked by hand; L5Y: nothing
      db.prepare('UPDATE catalog_shows SET itunes_collection_id = 900 WHERE id = ?').run(cfa);
      const rec = Number(db.prepare("INSERT INTO catalog_songs (show_id, title, position, source) VALUES (?, 'Welcome to the Rock', 1, 'recording')").run(cfa).lastInsertRowid);
      const siteWicked = insertShow(db, 'Wicked');
      db.prepare("UPDATE shows SET catalog_show_id = ?, catalog_link = 'manual' WHERE id = ?").run(wicked, siteWicked);
      const popular = db.prepare("SELECT id FROM catalog_songs WHERE title = 'Popular'").get().id;
      const s = insertSong(db, { title: 'Popular', showId: siteWicked });
      db.prepare("UPDATE songs SET catalog_song_id = ?, catalog_link = 'manual' WHERE id = ?").run(popular, s);

      const next = clone(FIXTURE_JSON);
      next.version = 'fixture-next.1';
      next.shows = next.shows.filter((x) => !['wp:Come From Away', 'Q156396', 'Q2533140'].includes(x.key));
      const r = loadCatalog(db, writeCatalog(dir, next), { allowShrink: true });
      assert.equal(r.retired, 2);
      assert.equal(r.removed.shows, 1, 'only the Last Five Years (no site data) is deleted');
      assert.equal(db.prepare('SELECT id FROM catalog_shows WHERE id = ?').get(l5y), undefined);
      assert.equal(db.prepare('SELECT retired FROM catalog_shows WHERE id = ?').get(cfa).retired, 1);
      assert.equal(db.prepare('SELECT itunes_collection_id AS c FROM catalog_shows WHERE id = ?').get(cfa).c, 900, 'album kept');
      assert.ok(db.prepare('SELECT 1 FROM catalog_songs WHERE id = ?').get(rec), 'cast-album song kept');
      assert.equal(db.prepare('SELECT catalog_show_id AS c FROM shows WHERE id = ?').get(siteWicked).c, wicked, 'manual link kept');
      assert.equal(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(s).c, popular, 'song link kept (its songs stay)');
      // hidden from search, status and automatic matching
      assert.equal(searchCatalog(db, 'popular').length, 0);
      assert.equal(searchCatalog(db, 'welcome to the rock').length, 0);
      assert.equal(catalogStatus(db).shows, 3);
      assert.equal(findCatalogShowFor(db, { name: 'Come From Away' }), null);
      // listed again → back, same id
      const again = clone(FIXTURE_JSON);
      again.version = 'fixture-again.1';
      loadCatalog(db, writeCatalog(dir, again, 'again.json.gz'));
      assert.equal(db.prepare('SELECT retired FROM catalog_shows WHERE id = ?').get(cfa).retired, 0);
      assert.ok(searchCatalog(db, 'popular').some((h) => h.id === popular));
      assert.equal(db.pragma('foreign_key_check').length, 0);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('hostile or broken files', () => {
  test('a gzip that unpacks past the limit, or a file past the size cap → CatalogError (nothing loaded)', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      // ~3 MB of spaces inside the shows list compresses to a few KB
      const text = `{"version":"bomb-1","shows":[${' '.repeat(3 * 1024 * 1024)}{"key":"Q1","title":"X","songs":[]}]}`;
      const file = writeCatalog(dir, text, 'bomb.json.gz');
      assert.ok(fs.statSync(file).size < 20_000);
      assert.throws(() => loadCatalog(db, file, { maxJsonBytes: 1024 * 1024 }), (e) => e instanceof CatalogError && /unpacks to more than 1 MB/.test(e.message));
      assert.throws(() => loadCatalog(db, file, { maxFileBytes: 1000 }), /more than the .* a catalog file may be/);
      assert.equal(catalogStatus(db).shows, 0);
      // within the limits it's just whitespace
      assert.equal(loadCatalog(db, file).shows, 1);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('huge strings are cut before they are processed (fast); a "__proto__" key is just data', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      const huge = 'Á'.repeat(5_000_000);
      const doc = { version: 'huge-1', shows: [{ key: 'Q1', title: huge, songs: [song(huge, [huge])], characters: [{ name: huge, voiceType: huge }] }] };
      const started = performance.now();
      const r = loadCatalog(db, writeCatalog(dir, doc));
      assert.ok(performance.now() - started < 3000, `took ${Math.round(performance.now() - started)} ms`);
      assert.equal(r.shows, 1);
      const show = db.prepare('SELECT title FROM catalog_shows').get();
      assert.equal([...show.title].length, 300);
      // a top-level "__proto__" must not supply the version (or anything else)
      const proto = `{"__proto__":{"version":"from-proto","generatedAt":"x"},"shows":[{"key":"Q2","title":"Y","songs":[]}]}`;
      assert.throws(() => loadCatalog(db, writeCatalog(dir, proto, 'proto.json.gz'), { force: true }), /no "version"/);
      const withBoth = `{"version":"real-1","__proto__":{"polluted":true},"constructor":{"x":1},"shows":[{"key":"Q1","title":"Z","songs":[]}]}`;
      assert.equal(loadCatalog(db, writeCatalog(dir, withBoth, 'both.json.gz'), { allowShrink: true }).version, 'real-1');
      assert.equal({}.polluted, undefined);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('reloads follow the file contents, not just the version string', () => {
  test('same version + different contents → reloaded (with a warning); same file → skipped; an older database without a stored hash is checked by version + build time', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      loadCatalog(db, CATALOG_FIXTURE);
      const changed = clone(FIXTURE_JSON); // same "version", a rebuilt file
      changed.generatedAt = '2026-09-27T22:24:06.494Z';
      changed.shows.find((s) => s.key === 'Q5636956').songs.push(song('Brand New Hadestown Song', ['Orpheus']));
      const file = writeCatalog(dir, changed);
      const log = logger();
      const r = loadCatalogAtStartup(db, file, log);
      assert.equal(r.loaded, true);
      assert.equal(r.version, FIXTURE_JSON.version);
      assert.match(log.lines.warn.join('\n'), /same version .* but different contents/);
      assert.ok(searchCatalog(db, 'brand new hadestown').length > 0);
      assert.equal(loadCatalog(db, file).loaded, false, 'the same file again → unchanged');

      // a database loaded before hashes were stored: same version + generatedAt → unchanged (hash stored now)
      db.prepare("DELETE FROM catalog_meta WHERE key = 'fileHash'").run();
      const same = loadCatalog(db, file);
      assert.equal(same.loaded, false);
      assert.ok(db.prepare("SELECT value FROM catalog_meta WHERE key = 'fileHash'").get());
      // … while the same version with another build time reloads
      db.prepare("DELETE FROM catalog_meta WHERE key = 'fileHash'").run();
      db.prepare("UPDATE catalog_meta SET value = '2026-09-27T18:24:15.934Z' WHERE key = 'generatedAt'").run();
      assert.equal(loadCatalog(db, file).loaded, true);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cast-album songs once the show gets a song list', () => {
  test('track names that differ in wording go; one a site song links to moves to its listed song (or stays until unlinked)', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      const doc = { version: 'rec.1', shows: [{ key: 'Q1', title: 'Monte Test', songs: [] }, { key: 'Q2', title: 'Other', songs: [song('Filler')] }] };
      loadCatalog(db, writeCatalog(dir, doc));
      const show = db.prepare("SELECT id FROM catalog_shows WHERE key = 'Q1'").get().id;
      const add = (title) => Number(db.prepare("INSERT INTO catalog_songs (show_id, title, position, source) VALUES (?, ?, 1, 'recording')").run(show, title).lastInsertRowid);
      const prologue = add('Prologue to the Count of Monte Cristo');
      const everyday = add('Every Day a Little Death');
      const doorstep = add('Hell to Your Doorstep');
      add('I Will Be There');
      const site = insertShow(db, 'Monte Test');
      const linked = insertSong(db, { title: 'Everyday a Little Death', showId: site });
      const linked2 = insertSong(db, { title: 'Some Other Name', showId: site });
      relinkSiteRows(db);
      db.prepare('UPDATE songs SET catalog_song_id = ? WHERE id = ?').run(everyday, linked);
      db.prepare('UPDATE songs SET catalog_song_id = ? WHERE id = ?').run(doorstep, linked2);

      const next = clone(doc);
      next.version = 'rec.2';
      next.shows[0].songs = [song('Prologue (Let Justice Be Done)'), song('Everyday a Little Death'), song('I Will Be There')];
      const r = loadCatalog(db, writeCatalog(dir, next, 'next.json.gz'));
      const titles = db.prepare('SELECT title, source FROM catalog_songs WHERE show_id = ? ORDER BY title').all(show).map((x) => `${x.title}/${x.source}`);
      assert.deepEqual(titles, ['Everyday a Little Death/wikipedia', 'Hell to Your Doorstep/recording', 'I Will Be There/wikipedia', 'Prologue (Let Justice Be Done)/wikipedia']);
      assert.equal(db.prepare('SELECT id FROM catalog_songs WHERE id = ?').get(prologue), undefined);
      assert.ok(r.recordingCleared >= 2);
      const wikiEveryday = db.prepare("SELECT id FROM catalog_songs WHERE show_id = ? AND title = 'Everyday a Little Death'").get(show).id;
      assert.equal(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(linked).c, wikiEveryday, 'moved to the listed song');
      assert.equal(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(linked2).c, doorstep, 'no listed match: kept while linked');
      assert.equal(db.prepare('SELECT song_count FROM catalog_shows WHERE id = ?').get(show).song_count, 4);
      assert.equal(searchCatalog(db, 'prologue to the count').length, 0);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('title matching', () => {
  const lvl = (a, b, ra = false, rb = false) => songTitleMatchLevel(songTitleKeys(a, ra), songTitleKeys(b, rb));

  test('numbered reprises only match the same number', () => {
    assert.equal(lvl('Maybe (Reprise 2)', 'Maybe (Reprise 2)', false, true), 2);
    assert.equal(lvl('MAYBE (REPRISE 2)', 'Maybe (Reprise 2)', false, true), 2);
    assert.equal(lvl('Maybe (Reprise 2)', 'Maybe', false, true), 0, '"(Reprise 2)" is not the first reprise');
    assert.equal(lvl('Maybe (Reprise)', 'Maybe', false, true), 2);
    assert.equal(lvl('Maybe - Reprise 2', 'Maybe (Reprise #2)', false, true), 2);
    assert.equal(lvl('Maybe (Reprise Two)', 'Maybe (Reprise 2)'), 2);
    const db = openDb(':memory:');
    try {
      const dir = tmp();
      const doc = { version: 'annie', shows: [{ key: 'Q1', title: 'Annie', songs: [song('Maybe'), song('Maybe', [], { reprise: true }), song('Maybe (Reprise 2)', [], { reprise: true }), song('Maybe (Reprise 3)', [], { reprise: true })] }] };
      loadCatalog(db, writeCatalog(dir, doc));
      const id = (title, reprise) => db.prepare('SELECT id FROM catalog_songs WHERE title = ? AND reprise = ?').get(title, reprise).id;
      const show = db.prepare('SELECT id FROM catalog_shows').get().id;
      assert.equal(findCatalogSongFor(db, show, 'Maybe (Reprise 2)'), id('Maybe (Reprise 2)', 1));
      assert.equal(findCatalogSongFor(db, show, 'Maybe (Reprise 3)'), id('Maybe (Reprise 3)', 1));
      assert.equal(findCatalogSongFor(db, show, 'Maybe (Reprise)'), id('Maybe', 1));
      assert.equal(findCatalogSongFor(db, show, 'Maybe'), id('Maybe', 0));
      fs.rmSync(dir, { recursive: true, force: true });
    } finally {
      db.close();
    }
  });

  test('slash medleys, "(The X Song)" subtitles and spacing/hyphen variants match (partially)', () => {
    assert.equal(lvl('Dog Eats Dog', 'The Sewers/Dog Eats Dog'), 1);
    assert.equal(lvl('The Sewers', 'The Sewers/Dog Eats Dog'), 1);
    assert.equal(lvl('Valjean Forgiven', 'Valjean Arrested/Valjean Forgiven'), 1);
    assert.equal(lvl('Good Byee', 'Good-bye-ee!'), 1);
    assert.equal(lvl('Dinghy', 'Problematical Solution (The Dinghy Song)'), 1);
    assert.equal(lvl('Problematical Solution (The Dinghy Song)', 'Dinghy'), 1);
    assert.equal(lvl('24/7', '7'), 0, 'tiny medley parts are ignored');
    assert.equal(lvl('Dog Eats Dog', 'Dog Eats Cat'), 0);
  });

  test('show names that differ only by an apostrophe', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      loadCatalog(db, writeCatalog(dir, { version: 'apos', shows: [{ key: 'Q1', title: "Everybody's Welcome", songs: [song('A')] }, { key: 'Q2', title: "Monty Python's Spamalot", songs: [song('B')] }] }));
      assert.ok(findCatalogShowFor(db, { name: 'Everybodys Welcome' }));
      assert.ok(findCatalogShowFor(db, { name: 'Monty Pythons Spamalot' }));
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('character names', () => {
  test('titles are fine, ages/relations/wife forms and saints are not', () => {
    assert.equal(sameCharacter('Fiona', 'Princess Fiona'), 'partial');
    assert.equal(sameCharacter('Arthur', 'King Arthur'), 'partial');
    assert.equal(sameCharacter('Farquaad', 'Lord Farquaad'), 'partial');
    assert.equal(sameCharacter('Marguerite', 'Marguerite St. Just'), 'partial');
    assert.equal(characterMatch('Marguerite', 'Marguerite St. Just'), 'first');
    assert.equal(characterMatch('Valjean', 'Jean Valjean'), 'last');
    assert.equal(sameCharacter('Cosette', 'Young Cosette'), null);
    assert.equal(sameCharacter('Cosette', 'Little Cosette'), null);
    assert.equal(sameCharacter('Thénardier', 'Madame Thénardier'), null);
    assert.equal(sameCharacter('Jimmy', 'St. Jimmy'), null);
  });

  test('a family name several characters share never stands for one of them', () => {
    const shared = sharedFamilyNames(['Jean Valjean', 'Thénardier', 'Madame Thénardier', 'Éponine Thénardier', 'Marius Pontmercy']);
    assert.deepEqual([...shared], ['thenardier']);
    assert.equal(sameCharacter('Thénardier', 'Éponine Thénardier', { sharedLastWords: shared }), null);
    assert.equal(sameCharacter('Éponine', 'Éponine Thénardier', { sharedLastWords: shared }), 'partial', 'the first name still works');
    assert.equal(sameCharacter('Valjean', 'Jean Valjean', { sharedLastWords: shared }), 'partial');
    const ham = sharedFamilyNames(['Alexander Hamilton', 'Eliza Hamilton', 'Philip Hamilton', 'Aaron Burr']);
    assert.equal(sameCharacter('Hamilton', 'Eliza Hamilton', { sharedLastWords: ham }), null);
  });

  test('suggestions: Éponine never gets Thénardier\'s range; Eliza never becomes "Hamilton"; one spelling, its own ranges', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      const doc = {
        version: 'chars',
        shows: [
          {
            key: 'Q1', title: 'Les Mis Test',
            characters: [{ name: 'Thénardier', voiceType: 'Baritone' }, { name: 'Madame Thénardier', voiceType: 'Mezzo-soprano' }, { name: 'Éponine Thénardier', voiceType: null }],
            songs: [song('On My Own', ['Éponine Thénardier']), song('Dog Eats Dog', ['Thénardier']), song('Master of the House', ['Thénardier', 'Madame Thénardier']),
              song('Castle on a Cloud', ['Little Cosette', 'Little Eponine', 'Madame Thénardier'])],
          },
          {
            key: 'Q2', title: 'Hamilton Test',
            characters: [{ name: 'Alexander Hamilton', voiceType: null }, { name: 'Eliza Hamilton', voiceType: null }, { name: 'Aaron Burr', voiceType: null }],
            songs: [song('Burn', ['Eliza Hamilton']), song('My Shot', ['Alexander Hamilton']), song('Wait for It', ['Aaron Burr'])],
          },
          {
            key: 'Q3', title: 'Shrek Test', characters: [{ name: 'Princess Fiona', voiceType: null }],
            songs: [song('I Think I Got You Beat', ['Shrek', 'Princess Fiona']), song('Morning Person', ['Princess Fiona'])],
          },
        ],
      };
      loadCatalog(db, writeCatalog(dir, doc));
      const lesMis = insertShow(db, 'Les Mis Test');
      insertSong(db, { title: 'Dog Eats Dog', showId: lesMis, parts: [['Thénardier', 'Baritone']] });
      insertSong(db, { title: 'Some Duet', kind: 'duet', showId: lesMis, parts: [['Eponine', 'Mezzo-soprano'], ['Marius', 'Tenor']] });
      const ham = insertShow(db, 'Hamilton Test');
      insertSong(db, { title: 'My Shot', showId: ham, parts: [['Hamilton', 'Baritone']] });
      insertSong(db, { title: 'Wait for It', showId: ham, parts: [['Burr', 'Tenor']] });
      const castle = insertSong(db, { title: 'Castle on a Cloud', showId: lesMis, parts: [['Young Cosette', 'Soprano']] });
      const shrek = insertShow(db, 'Shrek Test');
      insertSong(db, { title: 'Morning Person', showId: shrek, parts: [['Fiona', 'Mezzo-soprano']] });
      relinkSiteRows(db);
      const sug = (title) => catalogSuggestions(db, db.prepare('SELECT id FROM catalog_songs WHERE title = ?').get(title).id);
      assert.deepEqual(sug('On My Own').parts.value, [{
        character: 'Eponine', catalogName: 'Éponine Thénardier', vocalRange: 'Mezzo-soprano', rangeSource: 'from another Les Mis Test song on the site', rangeConfidence: 'medium',
      }]);
      assert.deepEqual(sug('Burn').parts.value, [{ character: 'Eliza Hamilton', vocalRange: null }], 'not "Hamilton" (Alexander), not Baritone');
      // a group number the site already has as a solo: that's the kind suggested (the list can't say)
      const c = sug('Castle on a Cloud');
      assert.deepEqual(c.existingSong, { id: castle, title: 'Castle on a Cloud', kind: 'solo' });
      assert.deepEqual(c.kind, { value: 'solo', source: 'from the version already on the site (a solo)', confidence: 'medium' });
      assert.match(c.kindNote, /3 characters sing this/);
      assert.equal(c.genre, null, 'the only other Les Mis Test songs have no genre; this song itself never counts');
      const beat = sug('I Think I Got You Beat');
      assert.deepEqual(beat.parts.value[1], {
        character: 'Fiona', catalogName: 'Princess Fiona', vocalRange: 'Mezzo-soprano', rangeSource: 'from another Shrek Test song on the site', rangeConfidence: 'medium',
      });
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ambiguous show names and link choices', () => {
  const doc = {
    version: 'ambig.1',
    shows: [
      { key: 'Q-parade-1960', title: 'Parade', year: 1960, composer: 'Jerry Herman', songs: [song('Show Tune'), song('Your Hand in Mine')] },
      { key: 'Q-parade-1998', title: 'Parade', year: 1998, composer: 'Jason Robert Brown', songs: [song('This Is Not Over Yet'), song('All the Wasted Time')] },
      { key: 'Q-phantom-1976', title: 'The Phantom of the Opera', year: 1976, composer: 'Ken Hill', songs: [song('Ah! Je veux vivre')] },
      { key: 'Q-phantom-1986', title: 'The Phantom of the Opera', year: 1986, composer: 'Andrew Lloyd Webber', songs: [song('Think of Me'), song('The Music of the Night')] },
      { key: 'Q-cind-2021', title: 'Cinderella', year: 2021, songs: [song('Bad Cinderella')] },
      { key: 'Q-cind-rh', title: "Rodgers & Hammerstein's Cinderella", altTitles: ['Cinderella'], year: 1957, songs: [song('In My Own Little Corner')] },
      { key: 'Q-wicked', title: 'Wicked', year: 2003, songs: [song('Popular')] },
    ],
  };

  test('a tie is never broken by catalog order: the site show\'s songs decide, else no automatic link', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      loadCatalog(db, writeCatalog(dir, doc));
      const cat = (key) => db.prepare('SELECT id FROM catalog_shows WHERE key = ?').get(key).id;
      assert.equal(findCatalogShowFor(db, { name: 'The Phantom of the Opera' }), null);
      assert.equal(findCatalogShowFor(db, { name: 'Parade' }), null);
      assert.equal(findCatalogShowFor(db, { name: 'Cinderella' }), null, 'a title and another show\'s alt title tie too');
      assert.equal(findCatalogShowFor(db, { name: 'Parade', year: 1998 }), cat('Q-parade-1998'), 'the year settles it');
      assert.equal(findCatalogShowFor(db, { name: 'Parade', composer: 'Jerry Herman' }), cat('Q-parade-1960'), 'so does the composer');
      assert.equal(findCatalogShowFor(db, { name: 'Wicked' }), cat('Q-wicked'));
      const phantom = insertShow(db, 'The Phantom of the Opera', { source: 'community' });
      relinkSiteRows(db);
      assert.equal(db.prepare('SELECT catalog_show_id AS c FROM shows WHERE id = ?').get(phantom).c, null);
      insertSong(db, { title: 'Think of Me', showId: phantom });
      relinkSiteRows(db);
      assert.equal(db.prepare('SELECT catalog_show_id AS c FROM shows WHERE id = ?').get(phantom).c, cat('Q-phantom-1986'), 'its song is in that list');
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('automatic links are re-computed; a chosen link (manual) or "not in the catalog" (none) is kept across reloads', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      loadCatalog(db, writeCatalog(dir, doc));
      const cat = (key) => db.prepare('SELECT id FROM catalog_shows WHERE key = ?').get(key).id;
      const a = insertShow(db, 'Parade');
      const b = insertShow(db, 'Wicked');
      const c = insertShow(db, 'Cinderella');
      // an old automatic link to the "lowest id" Parade (what the old tie-break chose)
      db.prepare('UPDATE shows SET catalog_show_id = ? WHERE id = ?').run(cat('Q-parade-1960'), a);
      db.prepare("UPDATE shows SET catalog_show_id = NULL, catalog_link = 'none' WHERE id = ?").run(b);
      db.prepare("UPDATE shows SET catalog_show_id = ?, catalog_link = 'manual' WHERE id = ?").run(cat('Q-cind-rh'), c);
      relinkSiteRows(db);
      const link = (id) => db.prepare('SELECT catalog_show_id AS c, catalog_link AS l FROM shows WHERE id = ?').get(id);
      assert.deepEqual({ ...link(a) }, { c: null, l: null }, 'an automatic tie-break link is undone');
      assert.deepEqual({ ...link(b) }, { c: null, l: 'none' }, '"not in the catalog" sticks');
      assert.deepEqual({ ...link(c) }, { c: cat('Q-cind-rh'), l: 'manual' }, 'a chosen link sticks');
      const next = clone(doc);
      next.version = 'ambig.2';
      loadCatalog(db, writeCatalog(dir, next, 'next.json.gz'));
      assert.deepEqual({ ...link(b) }, { c: null, l: 'none' });
      assert.deepEqual({ ...link(c) }, { c: cat('Q-cind-rh'), l: 'manual' });
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('songs: "not from the catalog" survives restarts; a song in an unlinked show keeps a link only into a same-named catalog show', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      const file = writeCatalog(dir, doc);
      loadCatalog(db, file);
      const wicked = insertShow(db, 'Wicked');
      const s = insertSong(db, { title: 'Popular', showId: wicked });
      relinkSiteRows(db);
      assert.ok(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(s).c);
      db.prepare("UPDATE songs SET catalog_song_id = NULL, catalog_link = 'none' WHERE id = ?").run(s);
      loadCatalogAtStartup(db, file, logger()); // a restart (unchanged catalog → full re-link)
      assert.equal(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(s).c, null);
      // a song moved (by the API) into an unlinked show of another name keeps no cross-show link
      const other = insertShow(db, 'My Totally Original Show 77');
      const popular = db.prepare("SELECT id FROM catalog_songs WHERE title = 'Popular'").get().id;
      const moved = insertSong(db, { title: 'Popular', showId: other });
      db.prepare('UPDATE songs SET catalog_song_id = ? WHERE id = ?').run(popular, moved);
      relinkSiteRows(db, { songIds: [moved] });
      assert.equal(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(moved).c, null);
      // … but a Parade song picked from either Parade keeps its link while the site show is unlinked
      const parade = insertShow(db, 'Parade');
      const pick = insertSong(db, { title: 'This Is Not Over Yet', showId: parade });
      const target = db.prepare("SELECT id FROM catalog_songs WHERE title = 'This Is Not Over Yet'").get().id;
      db.prepare("UPDATE songs SET catalog_song_id = ?, catalog_link = 'manual' WHERE id = ?").run(target, pick);
      relinkSiteRows(db);
      assert.equal(db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(pick).c, target);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('search ranking', () => {
  test('a show without songs goes after the songs unless its name is exactly the query', () => {
    const dir = tmp();
    const db = openDb(':memory:');
    try {
      const data = clone(FIXTURE_JSON);
      data.version = 'rank.1';
      data.shows.push(
        { key: 'Q-zorro', title: 'Zorro', altTitles: [], wikiTitle: 'Zorro (musical)', wikidataId: 'Q-zorro', composer: 'Gipsy Kings', lyricist: null, bookWriter: null, year: 2008, genres: [], description: null, characters: [],
          songs: [song('Hope', ['Diego']), song('Bamboleo', [], { ensemble: true }), song('Freedom', ['Diego', 'Luisa'])] },
        { key: 'Q-zorro-live', title: 'Zorro – Live in Concert', altTitles: [], wikiTitle: 'Zorro Live', wikidataId: 'Q-zorro-live', composer: null, lyricist: null, bookWriter: null, year: 2010, genres: [], description: null, characters: [], songs: [] },
        { key: 'Q-zzz', title: 'Zzyzx', altTitles: [], wikiTitle: 'Zzyzx', wikidataId: 'Q-zzz', composer: null, lyricist: null, bookWriter: null, year: 2011, genres: [], description: null, characters: [], songs: [] },
      );
      loadCatalog(db, writeCatalog(dir, data));
      const hits = searchCatalog(db, 'zorro', { limit: 10 }).map((h) => `${h.type}:${h.title}`);
      assert.equal(hits[0], 'show:Zorro');
      assert.equal(hits.at(-1), 'show:Zorro – Live in Concert', hits.join(' | '));
      assert.ok(hits.indexOf('song:Hope') < hits.indexOf('show:Zorro – Live in Concert'));
      // typed exactly: the empty show still comes first (it may offer "Load songs from the cast album")
      assert.equal(searchCatalog(db, 'zzyzx')[0].title, 'Zzyzx');
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

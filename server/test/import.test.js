import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { openDb } from '../src/db.js';
import {
  importSpreadsheet, spreadsheetLengthToSeconds, cellText, normalizeRows, assertDbNotInUse,
} from '../scripts/import-xlsx.js';
import { makeTestApp, signup, signupAdmin, soloBody, PNG } from './helpers.js';
import { createApp } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const XLSX = path.join(here, '..', 'seed', 'star_spreadsheet.xlsx');

function tmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-import-'));
  const seedDir = path.join(dir, 'seed');
  const mediaDir = path.join(dir, 'media');
  fs.mkdirSync(seedDir, { recursive: true });
  fs.mkdirSync(path.join(mediaDir, 'shows'), { recursive: true });
  fs.mkdirSync(path.join(mediaDir, 'art'), { recursive: true });
  const db = openDb(path.join(dir, 'star.db'));
  return { dir, seedDir, mediaDir, db, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const songRow = (db, title, kind = null) =>
  db.prepare(`SELECT s.*, sh.name AS show_name FROM songs s JOIN shows sh ON sh.id = s.show_id WHERE s.title = ? ${kind ? 'AND kind = ?' : ''}`).get(...(kind ? [title, kind] : [title]));
const partsOf = (db, id) => db.prepare('SELECT position, character, vocal_range FROM song_parts WHERE song_id = ? ORDER BY position').all(id);

describe('length + cell parsing', () => {
  test('h:mm quirk → seconds', () => {
    assert.equal(spreadsheetLengthToSeconds(new Date(Date.UTC(1899, 11, 30, 2, 33, 0))), 153);
    assert.equal(spreadsheetLengthToSeconds(new Date(Date.UTC(1899, 11, 30, 6, 46, 0))), 406);
    assert.equal(spreadsheetLengthToSeconds(new Date(Date.UTC(1899, 11, 30, 2, 32, 59, 999))), 153, 'float noise rounds');
    assert.equal(spreadsheetLengthToSeconds(0.10625), 153);
    assert.equal(spreadsheetLengthToSeconds('2:33'), 153);
    assert.equal(spreadsheetLengthToSeconds('02:33:00'), 153);
    assert.equal(spreadsheetLengthToSeconds({ formula: 'x', result: 0.10625 }), 153);
    assert.equal(spreadsheetLengthToSeconds(null), null);
    assert.equal(spreadsheetLengthToSeconds('abc'), null);
  });
  test('cellText trims and flattens rich text', () => {
    assert.equal(cellText('  Who am I  '), 'Who am I');
    assert.equal(cellText({ richText: [{ text: 'Hello ' }, { text: 'World ' }] }), 'Hello World');
    assert.equal(cellText({ text: 'Link', hyperlink: 'https://x' }), 'Link');
    assert.equal(cellText('   '), null);
  });
});

describe('import the real spreadsheet (no seed files)', () => {
  let e;
  let summary;
  before(async () => {
    e = tmpEnv();
    summary = await importSpreadsheet({ db: e.db, xlsxPath: XLSX, seedDir: e.seedDir, mediaDir: e.mediaDir });
  });
  after(() => e.cleanup());

  test('87 solos and 35 duets', () => {
    assert.equal(summary.rows.solos, 87);
    assert.equal(summary.rows.duets, 35);
    const c = e.db.prepare("SELECT sum(kind='solo') AS solos, sum(kind='duet') AS duets FROM songs").get();
    assert.equal(c.solos, 87);
    assert.equal(c.duets, 35);
    assert.equal(e.db.prepare("SELECT count(*) AS n FROM songs WHERE source != 'spreadsheet' OR created_by IS NOT NULL").get().n, 0);
    assert.ok(summary.shows.created >= 20);
  });

  test('lengths: "Diva\'s Lament" 153 s, "Corn" 406 s', () => {
    assert.equal(songRow(e.db, "Diva's Lament").length_seconds, 153);
    assert.equal(songRow(e.db, 'Corn').length_seconds, 406);
    assert.equal(songRow(e.db, 'Corn').mature, 1);
    assert.equal(songRow(e.db, "Diva's Lament").mature, 0);
  });

  test('parts: 1 per solo, 2 per duet, duet column order respected', () => {
    const bad = e.db.prepare(`SELECT s.id FROM songs s WHERE (SELECT count(*) FROM song_parts p WHERE p.song_id = s.id) != CASE s.kind WHEN 'solo' THEN 1 ELSE 2 END`).all();
    assert.equal(bad.length, 0);
    const corn = songRow(e.db, 'Corn');
    assert.equal(corn.show_name, 'Shucked');
    assert.deepEqual(partsOf(e.db, corn.id), [
      { position: 1, character: 'Storyteller 1', vocal_range: 'Baritone' },
      { position: 2, character: 'Storyteller 2', vocal_range: 'Mezzo-soprano' },
    ]);
  });

  test('built-in normalizations: Mezzo, sub-genres, trimming', () => {
    assert.equal(e.db.prepare("SELECT count(*) AS n FROM song_parts WHERE vocal_range = 'Mezzo'").get().n, 0);
    assert.deepEqual(partsOf(e.db, songRow(e.db, "Somewhere That's Green").id)[0].vocal_range, 'Mezzo-soprano');
    assert.equal(e.db.prepare("SELECT count(*) AS n FROM songs WHERE sub_genre IN ('Tongue & Cheek', 'Intimidating/angry')").get().n, 0);
    assert.ok(e.db.prepare("SELECT count(*) AS n FROM songs WHERE sub_genre = 'Tongue-in-Cheek'").get().n > 0);
    assert.ok(e.db.prepare("SELECT count(*) AS n FROM songs WHERE sub_genre = 'Intimidating / Angry'").get().n > 0);
    assert.ok(songRow(e.db, 'Who am I'), 'trailing space trimmed from "Who am I "');
    assert.equal(e.db.prepare("SELECT count(*) AS n FROM song_parts WHERE character != trim(character)").get().n, 0);
    assert.equal(e.db.prepare("SELECT count(*) AS n FROM songs WHERE title != trim(title)").get().n, 0);
    assert.equal(e.db.prepare("SELECT count(*) AS n FROM song_parts WHERE character = 'Emcee'").get().n, 2);
  });

  test('re-import is idempotent (same ids, same counts)', async () => {
    const before = e.db.prepare('SELECT id, title, show_id FROM songs ORDER BY id').all();
    const beforeShows = e.db.prepare('SELECT id, name, slug FROM shows ORDER BY id').all();
    const s2 = await importSpreadsheet({ db: e.db, xlsxPath: XLSX, seedDir: e.seedDir, mediaDir: e.mediaDir });
    assert.equal(s2.songs.created, 0);
    assert.equal(s2.shows.created, 0);
    assert.equal(s2.songs.updated, 122);
    assert.deepEqual(e.db.prepare('SELECT id, title, show_id FROM songs ORDER BY id').all(), before);
    assert.deepEqual(e.db.prepare('SELECT id, name, slug FROM shows ORDER BY id').all(), beforeShows);
  });
});

describe('import with seed files', () => {
  let e;
  let summary;
  before(async () => {
    e = tmpEnv();
    fs.writeFileSync(path.join(e.seedDir, 'corrections.json'), JSON.stringify({
      _comment: 'test fixture',
      shows: { 'Les Miserables': 'Les Misérables', 'A Gentlemans Guide to Love and Murder': "A Gentleman's Guide to Love and Murder" },
      characters: { 'Les Miserables|Young Cossette': 'Young Cosette', 'SPAMalot|Gallahad': 'Galahad' },
      titles: { 'Les Miserables|Who am I': 'Who Am I?', 'Nope|Nothing': 'Never used' },
      subGenres: { 'Tongue & Cheek': 'Tongue-in-Cheek' },
      vocalRanges: { Mezzo: 'Mezzo-soprano' },
      parts: { "duet|SPAMalot|I'm All Alone": [{ character: 'King Arthur', vocalRange: 'Baritone' }, { character: 'Patsy', vocalRange: 'Tenor' }] },
      notes: { 'solo|Smash!|Let Me Be Your Star': 'Written for the TV series Smash — check with your teacher that it is in a stage version.' },
    }));
    fs.writeFileSync(path.join(e.mediaDir, 'shows', 'hadestown.png'), PNG);
    fs.writeFileSync(path.join(e.seedDir, 'shows.json'), JSON.stringify([
      { name: 'Hadestown', composer: 'Anaïs Mitchell', lyricist: 'Anaïs Mitchell', bookWriter: 'Anaïs Mitchell', year: 2019, licensor: 'Music Theatre International (MTI)', licensingNote: null, description: 'Orpheus and Eurydice, retold.', wikiTitle: 'Hadestown', wikiUrl: 'https://en.wikipedia.org/wiki/Hadestown', imageFile: 'hadestown.png', imageCredit: 'Poster via Wikipedia (fair use)', imageSourceUrl: 'https://upload.wikimedia.org/x.png' },
      { name: 'Les Misérables', composer: 'Claude-Michel Schönberg', year: 1985, imageFile: 'missing.jpg' },
      { name: 'Not In Spreadsheet' },
    ]));
    fs.writeFileSync(path.join(e.mediaDir, 'art', 'abc123.jpg'), PNG);
    fs.writeFileSync(path.join(e.seedDir, 'media.json'), JSON.stringify({
      'solo|Hadestown|Flowers': { itunesTrackId: 123, previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/x.m4a', artworkFile: 'abc123.jpg', appleMusicUrl: 'https://music.apple.com/ca/album/x', recordingName: 'Hadestown (Original Broadway Cast Recording)', recordingArtist: 'Eva Noblezada', confidence: 'high' },
      'solo|Les Misérables|Who Am I?': { itunesTrackId: 5, previewUrl: 'https://audio-ssl.itunes.apple.com/y.m4a', artworkFile: null },
      'solo|Les Misérables|Stars': null,
      'solo|Hadestown|Not A Song': { previewUrl: 'https://audio-ssl.itunes.apple.com/z.m4a' },
    }));
    summary = await importSpreadsheet({ db: e.db, xlsxPath: XLSX, seedDir: e.seedDir, mediaDir: e.mediaDir });
  });
  after(() => e.cleanup());

  test('corrections are applied (shows, titles, characters, parts, notes)', () => {
    assert.equal(e.db.prepare("SELECT count(*) AS n FROM shows WHERE name = 'Les Miserables'").get().n, 0);
    const lm = e.db.prepare("SELECT * FROM shows WHERE name = 'Les Misérables'").get();
    assert.equal(lm.slug, 'les-miserables');
    assert.ok(e.db.prepare("SELECT * FROM shows WHERE slug = 'a-gentlemans-guide-to-love-and-murder'").get());
    const who = songRow(e.db, 'Who Am I?');
    assert.ok(who);
    assert.equal(who.show_name, 'Les Misérables');
    assert.equal(partsOf(e.db, songRow(e.db, 'Castle on a Cloud').id)[0].character, 'Young Cosette');
    assert.equal(partsOf(e.db, songRow(e.db, 'The Song That Goes Like This').id)[0].character, 'Galahad');
    assert.deepEqual(partsOf(e.db, songRow(e.db, "I'm All Alone").id), [
      { position: 1, character: 'King Arthur', vocal_range: 'Baritone' },
      { position: 2, character: 'Patsy', vocal_range: 'Tenor' },
    ]);
    assert.match(songRow(e.db, 'Let Me Be Your Star').notes, /TV series/);
    assert.ok(summary.correctionsApplied.shows > 0);
    assert.equal(summary.correctionsApplied.titles, 1);
    assert.equal(summary.correctionsApplied.parts, 1);
    assert.equal(summary.correctionsApplied.notes, 1);
    assert.ok(summary.warnings.some((w) => w.includes('Nope|Nothing')), 'unmatched correction key warned');
  });

  test('shows.json metadata + poster applied by canonical name', () => {
    const h = e.db.prepare("SELECT * FROM shows WHERE name = 'Hadestown'").get();
    assert.equal(h.composer, 'Anaïs Mitchell');
    assert.equal(h.year, 2019);
    assert.equal(h.licensor, 'Music Theatre International (MTI)');
    assert.equal(h.image_path, '/media/shows/hadestown.png');
    assert.equal(h.image_credit, 'Poster via Wikipedia (fair use)');
    const lm = e.db.prepare("SELECT * FROM shows WHERE name = 'Les Misérables'").get();
    assert.equal(lm.year, 1985);
    assert.equal(lm.image_path, null, 'missing image file → no poster');
    assert.ok(summary.warnings.some((w) => w.includes('missing.jpg')));
    assert.ok(summary.warnings.some((w) => w.includes('Not In Spreadsheet')));
    assert.equal(e.db.prepare("SELECT count(*) AS n FROM shows WHERE name = 'Not In Spreadsheet'").get().n, 0);
  });

  test('media.json applied (keys use canonical names), null = no media', () => {
    const f = songRow(e.db, 'Flowers');
    assert.equal(f.preview_url, 'https://audio-ssl.itunes.apple.com/itunes-assets/x.m4a');
    assert.equal(f.artwork_path, '/media/art/abc123.jpg');
    assert.equal(f.itunes_track_id, 123);
    assert.equal(f.recording_name, 'Hadestown (Original Broadway Cast Recording)');
    assert.equal(songRow(e.db, 'Who Am I?').preview_url, 'https://audio-ssl.itunes.apple.com/y.m4a');
    assert.equal(songRow(e.db, 'Stars').preview_url, null);
    assert.equal(summary.mediaApplied, 2);
    assert.equal(summary.mediaCleared, 1);
    assert.ok(summary.warnings.some((w) => w.includes('Not A Song')));
  });

  test('API serves the imported data (accent search on corrected show)', async () => {
    const app = createApp({ db: e.db, uploadsDir: path.join(e.dir, 'uploads'), mediaDir: e.mediaDir, env: {}, logger: { info() {}, warn() {}, error() {} } });
    try {
      const res = await request(app).get('/api/songs?q=les%20miserables&kind=solo');
      assert.equal(res.body.total, 11);
      const show = await request(app).get('/api/shows/hadestown');
      assert.equal(show.body.imageUrl, '/media/shows/hadestown.png');
      const img = await request(app).get('/media/shows/hadestown.png');
      assert.equal(img.status, 200);
      const flowers = res.body.songs.length && (await request(app).get(`/api/songs/${songRow(e.db, 'Flowers').id}`)).body;
      assert.equal(flowers.media.artworkUrl, '/media/art/abc123.jpg');
    } finally {
      app.locals.close();
    }
  });
});

describe('re-import semantics', () => {
  test('corrections added later rename rows in place (ids + comments kept); community rows preserved; admin edits kept', async () => {
    const t = makeTestApp();
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-seed-'));
    try {
      await importSpreadsheet({ db: t.db, xlsxPath: XLSX, seedDir, mediaDir: t.mediaDir });
      const whoId = songRow(t.db, 'Who am I').id;
      const showId = t.db.prepare("SELECT id FROM shows WHERE name = 'Les Miserables'").get().id;

      const user = await signup(t.app, { displayName: 'Student' });
      const admin = await signupAdmin(t.app, t.db, { email: 'admin@example.com', displayName: 'Admin' });
      // community rows, including a community song in a spreadsheet show
      const community = (await user.post('/api/songs', soloBody({ title: 'Master of the House', showId, showName: undefined, parts: [{ character: 'Thénardier', vocalRange: 'Baritone' }] }))).body;
      const communityShow = (await user.post('/api/shows', { name: 'Totally New Show' })).body;
      await user.post(`/api/songs/${whoId}/comments`, { body: 'Love this one' });
      // admin edits a spreadsheet song on the website
      const starsId = songRow(t.db, 'Stars').id;
      const edit = await admin.put(`/api/songs/${starsId}`, { kind: 'solo', title: 'Stars', showId, genre: 'Drama', subGenre: 'Reflective', lengthSeconds: 200, parts: [{ character: 'Javert', vocalRange: 'Bass' }] });
      assert.equal(edit.status, 200);

      fs.writeFileSync(path.join(seedDir, 'corrections.json'), JSON.stringify({
        shows: { 'Les Miserables': 'Les Misérables' },
        titles: { 'Les Miserables|Who am I': 'Who Am I?' },
      }));
      const s = await importSpreadsheet({ db: t.db, xlsxPath: XLSX, seedDir, mediaDir: t.mediaDir });
      assert.equal(s.songs.created, 0);
      assert.equal(s.songs.skippedEdited, 1);
      assert.equal(s.songs.deleted, 0);
      const renamed = t.db.prepare('SELECT * FROM songs WHERE id = ?').get(whoId);
      assert.equal(renamed.title, 'Who Am I?');
      const show = t.db.prepare('SELECT * FROM shows WHERE id = ?').get(showId);
      assert.equal(show.name, 'Les Misérables', 'show renamed in place');
      assert.equal(t.db.prepare('SELECT count(*) AS n FROM comments WHERE song_id = ?').get(whoId).n, 1);
      const c = t.db.prepare('SELECT * FROM songs WHERE id = ?').get(community.id);
      assert.equal(c.source, 'community');
      assert.equal(c.title, 'Master of the House');
      assert.ok(t.db.prepare('SELECT * FROM shows WHERE id = ?').get(communityShow.id));
      const stars = t.db.prepare('SELECT * FROM songs WHERE id = ?').get(starsId);
      assert.equal(stars.sub_genre, 'Reflective', 'admin edit kept');
      const counts = t.db.prepare("SELECT sum(kind='solo') AS solos, sum(kind='duet') AS duets FROM songs WHERE source = 'spreadsheet'").get();
      assert.deepEqual({ ...counts }, { solos: 87, duets: 35 });

      // --overwrite-edits restores spreadsheet values
      await importSpreadsheet({ db: t.db, xlsxPath: XLSX, seedDir, mediaDir: t.mediaDir, overwriteEdits: true });
      assert.equal(t.db.prepare('SELECT sub_genre FROM songs WHERE id = ?').get(starsId).sub_genre, 'Intimidating / Angry');
    } finally {
      t.cleanup();
      fs.rmSync(seedDir, { recursive: true, force: true });
    }
  });

  test('normalizeRows warns about bad parts overrides and unknown ranges', () => {
    const rows = [{ kind: 'duet', row: 3, title: 'X', show: 'S', characters: ['A', 'B'], genre: 'comedy', subGenre: null, ranges: ['Squeak', 'Tenor'], lengthSeconds: 100, mature: false }];
    const r = normalizeRows(rows, { parts: { 'duet|S|X': [{ character: 'Only one' }] } });
    assert.equal(r.songs[0].genre, 'Comedy');
    assert.deepEqual(r.songs[0].parts.map((p) => p.vocalRange), [null, 'Tenor']);
    assert.ok(r.warnings.some((w) => w.includes('Squeak')));
    assert.ok(r.warnings.some((w) => w.includes('corrections.parts')));
  });

  test('--reset safety: refuses when another connection has the DB open', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-reset-'));
    try {
      const p = path.join(dir, 'star.db');
      const db = openDb(p);
      assert.throws(() => assertDbNotInUse(p), /in use/);
      db.close();
      assert.doesNotThrow(() => assertDbNotInUse(p));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

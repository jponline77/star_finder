// Regression tests for the importer: stable row identity (admin renames/moves/deletes), the
// "edited" marker, wrong-layout / truncated spreadsheets, stale-row deletion guards, and
// community shows that collide with spreadsheet shows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { openDb } from '../src/db.js';
import { importSpreadsheet, ImportError, maxStaleDeletions } from '../scripts/import-xlsx.js';
import {
  makeTestApp, signup, signupAdmin, soloBody, binaryParser, MP3, PNG,
} from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const XLSX = path.join(here, '..', 'seed', 'star_spreadsheet.xlsx');

const songId = (db, title, kind = 'solo') => db.prepare('SELECT id FROM songs WHERE title = ? AND kind = ?').get(title, kind)?.id;
const count = (db, sql = 'SELECT count(*) AS n FROM songs') => db.prepare(sql).get().n;

/** A temp workbook made from the real spreadsheet, changed by `edit(worksheet)`. */
async function workbook(dir, name, edit) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  await edit(wb.worksheets[0], wb);
  const file = path.join(dir, name);
  await wb.xlsx.writeFile(file);
  return file;
}

/** Blank the solo columns (A–H) of the row whose solo title is `title`. */
function removeSolo(ws, title) {
  for (let r = 3; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (String(row.getCell(1).value ?? '').trim() === title) {
      for (let c = 1; c <= 8; c++) row.getCell(c).value = null;
      return;
    }
  }
  throw new Error(`no solo row "${title}"`);
}

function setup() {
  const t = makeTestApp();
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-seed-'));
  const run = (opts = {}) => importSpreadsheet({ db: t.db, xlsxPath: XLSX, seedDir, mediaDir: t.mediaDir, uploadsDir: t.uploadsDir, ...opts });
  return {
    t, seedDir, run,
    cleanup: () => {
      t.cleanup();
      fs.rmSync(seedDir, { recursive: true, force: true });
    },
  };
}

describe('spreadsheet rows keep their identity through website edits', () => {
  test('admin renames, moves and deletes → re-import creates no duplicates and keeps ids', async () => {
    const e = setup();
    try {
      await e.run();
      const { db } = e.t;
      const admin = await signupAdmin(e.t.app, db);
      const lesMis = db.prepare("SELECT id FROM shows WHERE name = 'Les Miserables'").get().id;
      const hadestown = db.prepare("SELECT id FROM shows WHERE name = 'Hadestown'").get().id;
      const starsId = songId(db, 'Stars');
      const cornId = songId(db, 'Corn', 'duet');
      const whoId = songId(db, 'Who am I');
      const before = count(db);
      const beforeShows = count(db, 'SELECT count(*) AS n FROM shows');

      const corn = (await request(e.t.app).get(`/api/songs/${cornId}`)).body;
      assert.equal((await admin.put(`/api/songs/${starsId}`, { kind: 'solo', title: 'Stars (edited title)', showId: lesMis, parts: [{ character: 'Javert', vocalRange: 'Baritone' }] })).status, 200);
      assert.equal((await admin.put(`/api/songs/${cornId}`, { kind: 'duet', title: 'Corn', showId: hadestown, parts: corn.parts.map((p) => ({ character: p.character, vocalRange: p.vocalRange })) })).status, 200);
      assert.equal((await admin.put(`/api/shows/${lesMis}`, { name: 'Les Misérables (School Edition)' })).status, 200);
      assert.equal((await admin.del(`/api/songs/${whoId}`)).status, 204);

      const s = await e.run();
      assert.equal(s.songs.created, 0, 'no duplicates of renamed/moved songs, deleted song not re-created');
      assert.equal(s.shows.created, 0, 'no second copy of the renamed show');
      assert.equal(s.songs.skippedDeleted, 1);
      assert.equal(s.songs.deleted, 0);
      assert.equal(count(db), before - 1);
      assert.equal(count(db, 'SELECT count(*) AS n FROM shows'), beforeShows);
      assert.equal(db.prepare('SELECT title FROM songs WHERE id = ?').get(starsId).title, 'Stars (edited title)');
      assert.equal(db.prepare('SELECT show_id FROM songs WHERE id = ?').get(cornId).show_id, hadestown);
      assert.equal(db.prepare('SELECT name FROM shows WHERE id = ?').get(lesMis).name, 'Les Misérables (School Edition)');
      assert.equal(songId(db, 'Who am I'), undefined);

      // --overwrite-edits puts the spreadsheet back (same ids for the rows that still exist)
      const o = await e.run({ overwriteEdits: true });
      assert.equal(o.songs.created, 1, 'the deleted song is restored');
      assert.equal(db.prepare('SELECT title FROM songs WHERE id = ?').get(starsId).title, 'Stars');
      assert.equal(db.prepare('SELECT show_id FROM songs WHERE id = ?').get(cornId).show_id, db.prepare("SELECT id FROM shows WHERE name = 'Shucked'").get().id);
      assert.equal(db.prepare('SELECT name FROM shows WHERE id = ?').get(lesMis).name, 'Les Miserables');
      assert.equal(count(db), before);
      assert.equal(count(db, "SELECT count(*) AS n FROM import_tombstones WHERE kind = 'song'"), 0);
    } finally {
      e.cleanup();
    }
  });

  test('databases imported before import keys existed get them on the next import', async () => {
    const e = setup();
    try {
      await e.run();
      const { db } = e.t;
      const ids = db.prepare('SELECT id FROM songs ORDER BY id').all();
      db.prepare('UPDATE songs SET import_key = NULL').run();
      db.prepare('UPDATE shows SET import_key = NULL').run();
      const s = await e.run();
      assert.equal(s.songs.created, 0);
      assert.equal(count(db, 'SELECT count(*) AS n FROM songs WHERE import_key IS NULL'), 0);
      assert.equal(count(db, 'SELECT count(*) AS n FROM shows WHERE import_key IS NULL'), 0);
      assert.deepEqual(db.prepare('SELECT id FROM songs ORDER BY id').all(), ids);
    } finally {
      e.cleanup();
    }
  });
});

describe('uploads and no-op saves are not "edits"', () => {
  test('after practice audio, a poster upload or an unchanged save, corrections and seed data still apply', async () => {
    const e = setup();
    try {
      await e.run();
      const { db } = e.t;
      const admin = await signupAdmin(e.t.app, db);
      const travelId = songId(db, 'Travel Song', 'duet');
      const starsId = songId(db, 'Stars');
      const shrekId = db.prepare("SELECT show_id FROM songs WHERE id = ?").get(travelId).show_id;
      assert.equal((await admin.upload(`/api/songs/${travelId}/audio`, MP3, 'track.mp3', 'audio/mpeg')).status, 200);
      const stars = (await request(e.t.app).get(`/api/songs/${starsId}`)).body;
      const unchanged = await admin.put(`/api/songs/${starsId}`, {
        kind: stars.kind, title: stars.title, showId: stars.show.id, genre: stars.genre, subGenre: stars.subGenre,
        lengthSeconds: stars.lengthSeconds, mature: stars.mature, notes: stars.notes,
        parts: stars.parts.map((p) => ({ character: p.character, vocalRange: p.vocalRange })),
      });
      assert.equal(unchanged.status, 200);
      assert.equal(unchanged.body.updatedAt, stars.updatedAt, 'a save that changes nothing changes nothing');
      const poster = await admin.upload(`/api/shows/${shrekId}/image`, PNG, 'p.png', 'image/png');
      assert.equal(poster.status, 200);
      // an unchanged show save (the edit dialog always sends every field)
      assert.equal((await admin.put(`/api/shows/${shrekId}`, { name: poster.body.name, composer: poster.body.composer })).status, 200);
      assert.equal(count(db, 'SELECT count(*) AS n FROM songs WHERE edited_at IS NOT NULL'), 0);
      assert.equal(count(db, 'SELECT count(*) AS n FROM shows WHERE edited_at IS NOT NULL'), 0);

      fs.writeFileSync(path.join(e.seedDir, 'corrections.json'), JSON.stringify({
        notes: { 'duet|Shrek|Travel Song': 'New verified note', 'solo|Les Miserables|Stars': 'Another note' },
      }));
      fs.writeFileSync(path.join(e.seedDir, 'shows.json'), JSON.stringify([{ name: 'Shrek', composer: 'Jeanine Tesori' }]));
      fs.writeFileSync(path.join(e.seedDir, 'media.json'), JSON.stringify({
        'duet|Shrek|Travel Song': { previewUrl: 'https://audio-ssl.itunes.apple.com/t.m4a' },
      }));
      const s = await e.run();
      assert.equal(s.songs.skippedEdited, 0);
      assert.equal(db.prepare('SELECT notes FROM songs WHERE id = ?').get(travelId).notes, 'New verified note');
      assert.equal(db.prepare('SELECT notes FROM songs WHERE id = ?').get(starsId).notes, 'Another note');
      assert.equal(db.prepare('SELECT preview_url FROM songs WHERE id = ?').get(travelId).preview_url, 'https://audio-ssl.itunes.apple.com/t.m4a');
      assert.ok(db.prepare('SELECT audio_path FROM songs WHERE id = ?').get(travelId).audio_path, 'uploaded audio kept');
      const shrek = db.prepare('SELECT * FROM shows WHERE id = ?').get(shrekId);
      assert.equal(shrek.composer, 'Jeanine Tesori');
      assert.equal(shrek.image_path, poster.body.imageUrl, 'the uploaded poster is kept');
      assert.ok(!s.warnings.some((w) => /media\.json: key/.test(w)), s.warnings.join('\n'));
    } finally {
      e.cleanup();
    }
  });

  test('a real edit still keeps the row, without a bogus "media.json key matches nothing" warning', async () => {
    const e = setup();
    try {
      await e.run();
      const { db } = e.t;
      const admin = await signupAdmin(e.t.app, db);
      const travelId = songId(db, 'Travel Song', 'duet');
      const song = (await request(e.t.app).get(`/api/songs/${travelId}`)).body;
      await admin.put(`/api/songs/${travelId}`, { kind: 'duet', title: song.title, showId: song.show.id, notes: 'Admin note', parts: song.parts.map((p) => ({ character: p.character, vocalRange: p.vocalRange })) });
      fs.writeFileSync(path.join(e.seedDir, 'media.json'), JSON.stringify({ 'duet|Shrek|Travel Song': { previewUrl: 'https://audio-ssl.itunes.apple.com/t.m4a' } }));
      const s = await e.run();
      assert.equal(s.songs.skippedEdited, 1);
      assert.equal(db.prepare('SELECT notes FROM songs WHERE id = ?').get(travelId).notes, 'Admin note');
      assert.ok(!s.warnings.some((w) => /media\.json: key/.test(w)), s.warnings.join('\n'));
    } finally {
      e.cleanup();
    }
  });

  test('the migration carries over the old "edited" signal', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-mig-'));
    try {
      const file = path.join(dir, 'old.db');
      const db = openDb(file);
      const show = db.prepare("INSERT INTO shows (name, slug) VALUES ('X', 'x')").run().lastInsertRowid;
      db.prepare("INSERT INTO songs (kind, title, show_id, created_at, updated_at) VALUES ('solo', 'Edited', ?, '2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'), ('solo', 'Plain', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')").run(show, show);
      db.prepare('UPDATE songs SET edited_at = NULL').run();
      db.pragma('user_version = 1');
      db.close();
      const again = openDb(file);
      assert.deepEqual(again.prepare('SELECT title, edited_at FROM songs ORDER BY id').all().map((r) => ({ ...r })), [
        { title: 'Edited', edited_at: '2026-02-01T00:00:00.000Z' }, { title: 'Plain', edited_at: null },
      ]);
      again.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('stale rows and wrong files', () => {
  test('a song dropped from the spreadsheet is deleted, unless it has comments or audio', async () => {
    const e = setup();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-xlsx-'));
    try {
      await e.run();
      const { db } = e.t;
      const admin = await signupAdmin(e.t.app, db);
      const student = await signup(e.t.app);
      await student.post(`/api/songs/${songId(db, 'Stars')}/comments`, { body: 'Great audition song' });
      await admin.upload(`/api/songs/${songId(db, 'Flowers')}/audio`, MP3, 'f.mp3', 'audio/mpeg');
      const trimmed = await workbook(dir, 'trimmed.xlsx', (ws) => {
        for (const title of ['Stars', 'Flowers', "Somewhere That's Green"]) removeSolo(ws, title);
      });
      const s = await e.run({ xlsxPath: trimmed });
      assert.equal(s.songs.deleted, 1);
      assert.equal(s.songs.keptStale, 2);
      assert.equal(songId(db, "Somewhere That's Green"), undefined, 'the plain solo is gone');
      assert.ok(songId(db, 'Stars'), 'kept: it has a comment');
      assert.ok(songId(db, 'Flowers'), 'kept: it has uploaded audio');
      assert.ok(s.warnings.some((w) => /"Stars".*kept/.test(w)));
    } finally {
      e.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an import that would remove many songs is refused (nothing changes) unless --allow-deletions', async () => {
    const e = setup();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-xlsx-'));
    try {
      await e.run();
      const { db } = e.t;
      const before = db.prepare('SELECT id, title FROM songs ORDER BY id').all();
      assert.equal(maxStaleDeletions(122), 12);
      const half = await workbook(dir, 'half.xlsx', (ws) => {
        for (let r = 20; r <= ws.rowCount; r++) for (let c = 1; c <= 19; c++) ws.getRow(r).getCell(c).value = null;
      });
      await assert.rejects(e.run({ xlsxPath: half }), (err) => err instanceof ImportError && /--allow-deletions/.test(err.message));
      assert.deepEqual(db.prepare('SELECT id, title FROM songs ORDER BY id').all(), before, 'rolled back');
      const s = await e.run({ xlsxPath: half, allowDeletions: true });
      assert.ok(s.songs.deleted > 12);
    } finally {
      e.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an empty or unrecognised workbook fails without deleting anything', async () => {
    const e = setup();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-xlsx-'));
    try {
      await e.run();
      const before = count(e.t.db);
      const empty = new ExcelJS.Workbook();
      empty.addWorksheet('Sheet1');
      await empty.xlsx.writeFile(path.join(dir, 'empty.xlsx'));
      await assert.rejects(e.run({ xlsxPath: path.join(dir, 'empty.xlsx') }), /header row/);
      const headerOnly = await workbook(dir, 'header-only.xlsx', (ws) => {
        for (let r = 3; r <= ws.rowCount; r++) for (let c = 1; c <= 19; c++) ws.getRow(r).getCell(c).value = null;
      });
      await assert.rejects(e.run({ xlsxPath: headerOnly }), /no song rows/);
      assert.equal(count(e.t.db), before);
    } finally {
      e.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the site's own export is recognised and refused (it has a different layout)", async () => {
    const e = setup();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-xlsx-'));
    try {
      await e.run();
      const before = count(e.t.db);
      const res = await request(e.t.app).get('/api/export.xlsx').buffer(true).parse(binaryParser);
      fs.writeFileSync(path.join(dir, 'export.xlsx'), res.body);
      await assert.rejects(e.run({ xlsxPath: path.join(dir, 'export.xlsx') }), (err) => err instanceof ImportError && /downloaded from the website/.test(err.message));
      assert.equal(count(e.t.db), before);
    } finally {
      e.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the header row is found wherever it is (an extra title row is fine)', async () => {
    const e = setup();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-xlsx-'));
    try {
      await e.run();
      const shifted = await workbook(dir, 'shifted.xlsx', (ws) => ws.spliceRows(1, 0, ['STAR Festival list, 2026 edition']));
      const s = await e.run({ xlsxPath: shifted });
      assert.equal(s.songs.created, 0);
      assert.equal(s.songs.deleted, 0);
      assert.equal(s.songs.updated, 122, 'row 3 (the first data row) is no longer skipped');
    } finally {
      e.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('community shows that collide with spreadsheet shows', () => {
  test('import stops and explains unless --adopt-community; with it the show becomes official', async () => {
    const e = setup();
    try {
      const { db } = e.t;
      const kid = await signup(e.t.app, { displayName: 'Kid' });
      const show = (await kid.post('/api/shows', { name: 'hadestown', description: 'lol my show' })).body;
      const own = (await kid.post('/api/songs', soloBody({ title: 'My Hadestown Song', showId: show.id, showName: undefined }))).body;
      const flowers = (await kid.post('/api/songs', soloBody({ title: 'Flowers', showId: show.id, showName: undefined }))).body;
      await assert.rejects(e.run(), (err) => err instanceof ImportError && /--adopt-community/.test(err.message) && /"hadestown"/.test(err.message) && /Kid/.test(err.message));
      assert.equal(count(db, "SELECT count(*) AS n FROM songs WHERE source = 'spreadsheet'"), 0, 'nothing imported');

      fs.writeFileSync(path.join(e.seedDir, 'shows.json'), JSON.stringify([{ name: 'Hadestown', composer: 'Anaïs Mitchell', description: 'Official description' }]));
      const s = await e.run({ adoptCommunity: true });
      assert.equal(s.shows.adopted, 1);
      const row = db.prepare('SELECT * FROM shows WHERE id = ?').get(show.id);
      assert.equal(row.source, 'spreadsheet');
      assert.equal(row.created_by, null);
      assert.equal(row.name, 'Hadestown');
      assert.equal(row.composer, 'Anaïs Mitchell');
      assert.equal(count(db, `SELECT count(*) AS n FROM songs WHERE show_id = ${show.id} AND source = 'spreadsheet'`), 7);
      const mine = db.prepare('SELECT source, created_by FROM songs WHERE id = ?').get(own.id);
      assert.deepEqual({ ...mine }, { source: 'community', created_by: kid.user.id }, "the student's own song stays theirs");
      assert.equal(db.prepare('SELECT source FROM songs WHERE id = ?').get(flowers.id).source, 'spreadsheet', 'the colliding song became the official row');
      assert.equal((await kid.put(`/api/shows/${show.id}`, { description: 'mine again' })).status, 403, 'only admins edit it now');
    } finally {
      e.cleanup();
    }
  });
});

describe('corrections that collide with website songs', () => {
  test('a new title correction that clashes with a community song leaves both rows alone (no aborted import)', async () => {
    const e = setup();
    try {
      await e.run();
      const { db } = e.t;
      const lesMis = db.prepare("SELECT id FROM shows WHERE name = 'Les Miserables'").get().id;
      const whoId = songId(db, 'Who am I');
      const kid = await signup(e.t.app);
      const theirs = (await kid.post('/api/songs', soloBody({ title: 'Who Am I? (Reprise)', showId: lesMis, showName: undefined }))).body;
      fs.writeFileSync(path.join(e.seedDir, 'corrections.json'), JSON.stringify({ titles: { 'Les Miserables|Who am I': 'Who Am I? (Reprise)' } }));
      const s = await e.run();
      assert.ok(s.warnings.some((w) => w.includes(`song #${theirs.id} (community) already has that title`)), s.warnings.join('\n'));
      assert.equal(db.prepare('SELECT title FROM songs WHERE id = ?').get(whoId).title, 'Who am I');
      assert.equal(db.prepare('SELECT source FROM songs WHERE id = ?').get(theirs.id).source, 'community');
      assert.equal(s.songs.deleted, 0);
    } finally {
      e.cleanup();
    }
  });
});

describe('the seed spreadsheet is published with the repository', () => {
  test('its document properties name no person (Excel records who saved it)', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(XLSX);
    const props = { creator: wb.creator, lastModifiedBy: wb.lastModifiedBy, company: wb.company, manager: wb.manager };
    const named = Object.entries(props).filter(([, v]) => typeof v === 'string' && v.trim());
    assert.deepEqual(named, [], 'server/seed/star_spreadsheet.xlsx names someone in its properties. Clear them before committing '
      + '(Excel: File → Info → Check for Issues → Inspect Document → Document Properties and Personal Information → Remove All).');
  });
});

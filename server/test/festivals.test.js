// Selectable festivals (SPEC §7b): migration v3, startup seeding, import upsert, /api/meta,
// /api/festivals, admin CRUD, and the user's festivalSlug.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import request from 'supertest';
import { openDb, MIGRATIONS } from '../src/db.js';
import { hashPassword } from '../src/lib/auth.js';
import {
  festivalSlugFromName, isCalendarDate, readFestivalSeed, DEFAULT_FESTIVALS_SEED, deleteFestival,
} from '../src/lib/festivals.js';
import { importSpreadsheet } from '../scripts/import-xlsx.js';
import {
  makeTestApp, client, signup, signupAdmin, seedFixture, soloBody, PASSWORD, CSRF,
} from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const XLSX = path.join(here, '..', 'seed', 'star_spreadsheet.xlsx');
const SCHEMA_SQL = fs.readFileSync(path.join(here, '..', 'src', 'schema.sql'), 'utf8');
// A frozen copy of the seed list, so these tests don't depend on edits to seed/festivals.json.
const FIXTURE_SEED = path.join(here, 'fixtures', 'festivals.json');
const SEED = JSON.parse(fs.readFileSync(FIXTURE_SEED, 'utf8')).festivals;
const makeApp = (opts = {}) => makeTestApp({ festivalsSeedPath: FIXTURE_SEED, ...opts });

const FESTIVAL_KEYS = ['active', 'city', 'dateLabel', 'endDate', 'id', 'infoUrl', 'kind', 'name', 'province', 'slug', 'sortOrder', 'startDate', 'venue'];

/** A logger that records warnings. */
function recordingLogger() {
  const warnings = [];
  const infos = [];
  return { warnings, infos, info: (m) => infos.push(String(m)), warn: (m) => warnings.push(String(m)), error: (m) => warnings.push(String(m)) };
}

const tmp = (prefix = 'star-fest-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const festival = (overrides = {}) => ({
  name: 'Kelowna Regional STAR Fest', kind: 'regional', province: 'BC', city: 'Kelowna',
  startDate: '2027-02-05', endDate: null, dateLabel: null, venue: 'Kelowna Community Theatre',
  infoUrl: 'https://taeacanada.ca/regional-star-fest/', sortOrder: 55, ...overrides,
});

describe('lib', () => {
  test('festivalSlugFromName drops "Regional STAR Fest" and parentheses (matches the seed slugs)', () => {
    for (const f of SEED) assert.equal(festivalSlugFromName(f.name), f.slug, f.name);
    assert.equal(festivalSlugFromName('Kelowna STAR Festival'), 'kelowna');
    assert.equal(festivalSlugFromName('Île-Bizard Regional STAR Fest'), 'ile-bizard');
    assert.equal(festivalSlugFromName('STAR Fest'), 'star-fest');
    assert.equal(festivalSlugFromName('!!!'), 'festival');
    assert.ok(festivalSlugFromName('x'.repeat(80)).length <= 60);
  });

  test('isCalendarDate: real days only', () => {
    for (const d of ['2026-12-11', '2028-02-29', '2027-05-23']) assert.equal(isCalendarDate(d), true, d);
    for (const d of ['2027-02-29', '2027-02-30', '2026-13-01', '2026-00-10', '2026-1-5', '26-12-11', '2026-12-11T00:00', '1999-12-31', '']) {
      assert.equal(isCalendarDate(d), false, d);
    }
  });

  test('the committed seed/festivals.json is valid (every entry kept, no warnings)', () => {
    const real = JSON.parse(fs.readFileSync(DEFAULT_FESTIVALS_SEED, 'utf8')).festivals;
    const seed = readFestivalSeed(DEFAULT_FESTIVALS_SEED);
    assert.deepEqual(seed.warnings, []);
    assert.equal(seed.entries.length, real.length);
    assert.ok(seed.entries.some((f) => f.kind === 'regional'));
    assert.ok(seed.entries.some((f) => f.kind === 'online'));
  });
});

describe('migration v3 + startup seeding', () => {
  test('a v2 database gets the festivals table, users.festival_id and the seed list; users are kept', async () => {
    const dir = tmp();
    const file = path.join(dir, 'v2.db');
    try {
      // Build a database exactly as the previous version left it (schema.sql + migrations ≤ 2).
      const old = new Database(file);
      old.pragma('journal_mode = WAL');
      old.pragma('foreign_keys = ON');
      old.exec(SCHEMA_SQL);
      for (const m of MIGRATIONS.filter((x) => x.version <= 2)) m.up(old);
      old.pragma('user_version = 2');
      const hash = await hashPassword(PASSWORD);
      old.prepare("INSERT INTO users (email, display_name, password_hash, role) VALUES ('old@example.com', 'Old Timer', ?, 'admin')").run(hash);
      assert.equal(old.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'festivals'").get().n, 0);
      old.close();

      const log = recordingLogger();
      const t = makeApp({ dbFile: file, logger: log });
      try {
        assert.equal(t.db.pragma('user_version', { simple: true }), Math.max(...MIGRATIONS.map((m) => m.version)));
        assert.equal(t.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'festival_tombstones'").get().n, 1);
        const cols = t.db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
        assert.ok(cols.includes('festival_id'));
        const fk = t.db.prepare('PRAGMA foreign_key_list(users)').all().find((f) => f.from === 'festival_id');
        assert.equal(fk.table, 'festivals');
        assert.equal(fk.on_delete, 'SET NULL');
        assert.equal(t.db.prepare('SELECT count(*) AS n FROM festivals').get().n, SEED.length);
        assert.ok(log.infos.some((m) => m.includes(`Added ${SEED.length} STAR festival`)), log.infos.join('\n'));
        // the old account still works and has no festival yet
        const c = client(t.app);
        const login = await c.post('/api/auth/login', { email: 'old@example.com', password: PASSWORD });
        assert.equal(login.status, 200);
        assert.equal(login.body.user.displayName, 'Old Timer');
        assert.equal(login.body.user.role, 'admin');
        assert.equal(login.body.user.festivalSlug, null);
        const set = await c.put('/api/auth/me', { festivalSlug: 'vancouver' });
        assert.equal(set.body.user.festivalSlug, 'vancouver');
      } finally {
        t.app.locals.close();
        t.db.close();
        fs.rmSync(t.dir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('seeding happens only while the table is empty (restarts keep admin changes)', async () => {
    const dir = tmp();
    const file = path.join(dir, 'star.db');
    try {
      const a = makeApp({ dbFile: file });
      const admin = await signupAdmin(a.app, a.db);
      const surrey = a.db.prepare("SELECT id FROM festivals WHERE slug = 'surrey'").get().id;
      assert.equal((await admin.put(`/api/admin/festivals/${surrey}`, { venue: 'A New Theatre' })).status, 200);
      assert.equal((await admin.del(`/api/admin/festivals/${a.db.prepare("SELECT id FROM festivals WHERE slug = 'nanaimo'").get().id}`)).status, 204);
      a.app.locals.close();
      a.db.close();
      fs.rmSync(a.dir, { recursive: true, force: true });

      const b = makeApp({ dbFile: file });
      try {
        assert.equal(b.db.prepare('SELECT count(*) AS n FROM festivals').get().n, SEED.length - 1, 'deleted one stays deleted');
        assert.equal(b.db.prepare("SELECT venue FROM festivals WHERE slug = 'surrey'").get().venue, 'A New Theatre');
      } finally {
        b.app.locals.close();
        b.db.close();
        fs.rmSync(b.dir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing or broken seed file is logged, never fatal', async () => {
    const dir = tmp();
    try {
      const missingLog = recordingLogger();
      const m = makeApp({ festivalsSeedPath: path.join(dir, 'nope.json'), logger: missingLog });
      try {
        assert.equal(m.db.prepare('SELECT count(*) AS n FROM festivals').get().n, 0);
        assert.ok(missingLog.warnings.some((w) => /nope\.json was not found/.test(w)));
        const meta = await request(m.app).get('/api/meta');
        assert.equal(meta.status, 200);
        assert.deepEqual(meta.body.festivals, []);
        assert.equal(meta.body.defaultFestivalSlug, null);
      } finally {
        m.cleanup();
      }

      const broken = path.join(dir, 'broken.json');
      fs.writeFileSync(broken, '{ "festivals": [ oops');
      const brokenLog = recordingLogger();
      const b = makeApp({ festivalsSeedPath: broken, logger: brokenLog });
      try {
        assert.equal(b.db.prepare('SELECT count(*) AS n FROM festivals').get().n, 0);
        assert.ok(brokenLog.warnings.some((w) => /Couldn't load the STAR festivals/.test(w)));
      } finally {
        b.cleanup();
      }

      // invalid entries are skipped, the rest are loaded
      const partial = path.join(dir, 'partial.json');
      fs.writeFileSync(partial, JSON.stringify({
        festivals: [
          { slug: 'good', name: 'Good Regional STAR Fest', kind: 'regional', startDate: '2027-01-01' },
          { slug: 'bad-date', name: 'Bad Date Fest', kind: 'regional', startDate: '2027-02-30' },
          { slug: 'Bad Slug', name: 'Bad Slug Fest', kind: 'regional' },
          { slug: 'good', name: 'Duplicate Fest', kind: 'online' },
          { name: 'Nameless kind' },
        ],
      }));
      const pLog = recordingLogger();
      const p = makeApp({ festivalsSeedPath: partial, logger: pLog });
      try {
        assert.deepEqual(p.db.prepare('SELECT slug FROM festivals').all().map((r) => r.slug), ['good']);
        assert.equal(pLog.warnings.length, 4, pLog.warnings.join('\n'));
      } finally {
        p.cleanup();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('import upserts festivals by slug', () => {
  let t;
  let seedDir;
  let admin;
  const writeSeed = (list) => fs.writeFileSync(path.join(seedDir, 'festivals.json'), JSON.stringify({ festivals: list }, null, 2));
  const run = (opts = {}) => importSpreadsheet({ db: t.db, xlsxPath: XLSX, seedDir, mediaDir: t.mediaDir, uploadsDir: t.uploadsDir, ...opts });
  const row = (slug) => t.db.prepare('SELECT * FROM festivals WHERE slug = ?').get(slug);

  before(async () => {
    t = makeApp({ festivalsSeedPath: null });
    seedDir = tmp('star-seed-');
    admin = await signupAdmin(t.app, t.db);
  });
  after(() => {
    t.cleanup();
    fs.rmSync(seedDir, { recursive: true, force: true });
  });

  test('no festivals.json → festivals left alone', async () => {
    const s = await run();
    assert.equal(s.festivals, null);
    assert.equal(s.seedFiles.festivals, false);
    assert.equal(t.db.prepare('SELECT count(*) AS n FROM festivals').get().n, 0);
  });

  test('first import creates them; a second one changes nothing', async () => {
    fs.copyFileSync(FIXTURE_SEED, path.join(seedDir, 'festivals.json'));
    const s1 = await run();
    assert.deepEqual(s1.festivals, { created: SEED.length, updated: 0, unchanged: 0, skippedEdited: 0, skippedDeleted: 0, notInSeed: 0 });
    assert.equal(s1.seedFiles.festivals, true);
    const v = row('vancouver');
    assert.equal(v.start_date, '2026-12-11');
    assert.equal(v.created_at, v.updated_at);
    assert.equal(v.edited_at, null);
    const s2 = await run();
    assert.deepEqual(s2.festivals, { created: 0, updated: 0, unchanged: SEED.length, skippedEdited: 0, skippedDeleted: 0, notInSeed: 0 });
  });

  test('changed seed values reach unedited rows; website edits are kept unless --overwrite-edits', async () => {
    // an admin edits Surrey and adds a festival of their own
    const surrey = row('surrey');
    const edit = await admin.put(`/api/admin/festivals/${surrey.id}`, { venue: 'Bell Performing Arts Centre', active: false });
    assert.equal(edit.status, 200);
    const created = await admin.post('/api/admin/festivals', festival());
    assert.equal(created.status, 201);
    assert.equal(created.body.slug, 'kelowna');

    const next = SEED.map((f) => (f.slug === 'burnaby' ? { ...f, venue: 'Shadbolt Centre' }
      : f.slug === 'surrey' ? { ...f, startDate: '2027-01-30' } : f));
    next.push({ ...festival({ name: 'Kelowna Regional STAR Fest', venue: 'Seed Venue' }), slug: 'kelowna' });
    next.push({ slug: 'kamloops', name: 'Kamloops Regional STAR Fest', kind: 'regional', province: 'BC', city: 'Kamloops', startDate: null, dateLabel: 'TBA', sortOrder: 65 });
    writeSeed(next);
    const s = await run();
    assert.deepEqual(s.festivals, { created: 1, updated: 1, unchanged: SEED.length - 2, skippedEdited: 2, skippedDeleted: 0, notInSeed: 0 });
    assert.ok(s.warnings.some((w) => /2 festival\(s\) were added or changed on the website/.test(w)));
    assert.equal(row('burnaby').venue, 'Shadbolt Centre');
    assert.equal(row('burnaby').edited_at, null);
    assert.equal(row('surrey').venue, 'Bell Performing Arts Centre', 'admin edit kept');
    assert.equal(row('surrey').active, 0);
    assert.equal(row('surrey').start_date, '2027-01-29');
    assert.equal(row('kelowna').venue, 'Kelowna Community Theatre', 'festival added on the website kept');
    assert.equal(row('kamloops').date_label, 'TBA');

    const o = await run({ overwriteEdits: true });
    assert.equal(o.festivals.skippedEdited, 0);
    assert.equal(o.festivals.updated, 2);
    assert.equal(row('surrey').venue, SEED.find((f) => f.slug === 'surrey').venue);
    assert.equal(row('surrey').start_date, '2027-01-30');
    assert.equal(row('surrey').active, 1);
    assert.equal(row('surrey').edited_at, null);
    assert.equal(row('kelowna').venue, 'Seed Venue');
  });

  test('festivals missing from the file are kept (people may have chosen them)', async () => {
    const student = await signup(t.app);
    await student.put('/api/auth/me', { festivalSlug: 'kamloops' });
    writeSeed(SEED);
    const s = await run();
    assert.equal(s.festivals.notInSeed, 2);
    assert.ok(row('kamloops'));
    assert.equal((await student.get('/api/auth/me')).body.user.festivalSlug, 'kamloops');
  });

  test('invalid entries are reported as warnings and skipped; a broken file stops the import', async () => {
    writeSeed([...SEED, { slug: 'nope', name: 'No', kind: 'regional' }]);
    const s = await run();
    assert.ok(s.warnings.some((w) => /festivals\.json entry 10 "No": skipped — name: Name must be at least 3 characters/.test(w)), s.warnings.join('\n'));
    assert.equal(row('nope'), undefined);
    fs.writeFileSync(path.join(seedDir, 'festivals.json'), '{ nope');
    await assert.rejects(run(), /Could not parse .*festivals\.json/);
  });
});

describe('festivals deleted on the website stay deleted', () => {
  let t;
  let seedDir;
  let admin;
  const run = (opts = {}) => importSpreadsheet({ db: t.db, xlsxPath: XLSX, seedDir, mediaDir: t.mediaDir, uploadsDir: t.uploadsDir, ...opts });
  const row = (slug) => t.db.prepare('SELECT * FROM festivals WHERE slug = ?').get(slug);
  const tombstoned = (slug) => Boolean(t.db.prepare('SELECT 1 FROM festival_tombstones WHERE slug = ?').get(slug));

  before(async () => {
    t = makeApp();
    seedDir = tmp('star-seed-');
    fs.copyFileSync(FIXTURE_SEED, path.join(seedDir, 'festivals.json'));
    admin = await signupAdmin(t.app, t.db);
  });
  after(() => {
    t.cleanup();
    fs.rmSync(seedDir, { recursive: true, force: true });
  });

  test('npm run import does not re-create a festival an admin deleted (it says so); --overwrite-edits restores it', async () => {
    assert.equal((await admin.del(`/api/admin/festivals/${row('victoria').id}`)).status, 204);
    assert.ok(tombstoned('victoria'));
    const logged = [];
    const s = await run({ log: (m) => logged.push(String(m)) });
    assert.deepEqual(s.festivals, { created: 0, updated: 0, unchanged: SEED.length - 1, skippedEdited: 0, skippedDeleted: 1, notInSeed: 0 });
    assert.equal(row('victoria'), undefined, 'still deleted');
    assert.ok(s.warnings.some((w) => /1 festival\(s\) were deleted on the website and were not re-created \(use --overwrite-edits/.test(w)), s.warnings.join('\n'));
    assert.ok(logged.some((m) => /📍 Festivals: .*1 not re-created \(deleted on the website\)/.test(m)), logged.join('\n'));
    assert.ok(!(await request(t.app).get('/api/festivals')).body.festivals.some((f) => f.slug === 'victoria'));

    const o = await run({ overwriteEdits: true });
    assert.equal(o.festivals.created, 1);
    assert.equal(o.festivals.skippedDeleted, 0);
    assert.equal(row('victoria').active, 1);
    assert.equal(row('victoria').edited_at, null);
    assert.ok(!tombstoned('victoria'), 'restored → no longer remembered as deleted');
    assert.equal((await run()).festivals.skippedDeleted, 0);
  });

  test('re-creating a deleted festival on the website clears the record (the import then treats it as a website one)', async () => {
    const id = row('surrey').id;
    assert.equal((await admin.del(`/api/admin/festivals/${id}`)).status, 204);
    assert.ok(tombstoned('surrey'));
    const again = await admin.post('/api/admin/festivals', festival({ name: 'Surrey Regional STAR Fest', city: 'Surrey', venue: 'A Brand New Hall' }));
    assert.equal(again.status, 201);
    assert.equal(again.body.slug, 'surrey');
    assert.ok(!tombstoned('surrey'));
    const s = await run();
    assert.equal(s.festivals.skippedDeleted, 0);
    assert.equal(s.festivals.skippedEdited, 1);
    assert.equal(row('surrey').venue, 'A Brand New Hall', 'kept as the admin made it');
  });

  test('startup seeding skips deleted festivals too (deleting every festival keeps the list empty)', async () => {
    const dir = tmp();
    const file = path.join(dir, 'star.db');
    try {
      const a = makeApp({ dbFile: file });
      const boss = await signupAdmin(a.app, a.db);
      for (const { id } of a.db.prepare('SELECT id FROM festivals').all()) assert.equal((await boss.del(`/api/admin/festivals/${id}`)).status, 204);
      a.app.locals.close();
      a.db.close();
      fs.rmSync(a.dir, { recursive: true, force: true });

      const log = recordingLogger();
      const b = makeApp({ dbFile: file, logger: log });
      try {
        assert.equal(b.db.prepare('SELECT count(*) AS n FROM festivals').get().n, 0);
        assert.ok(log.infos.some((m) => m.includes(`${SEED.length} festival(s) in festivals.json were deleted on the website`)), log.infos.join('\n'));
      } finally {
        b.app.locals.close();
        b.db.close();
        fs.rmSync(b.dir, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a v3 database (before festival_tombstones) gets the table on upgrade', () => {
    const dir = tmp();
    try {
      const file = path.join(dir, 'v3.db');
      const old = new Database(file);
      old.exec(SCHEMA_SQL);
      for (const m of MIGRATIONS.filter((x) => x.version <= 3)) m.up(old);
      old.pragma('user_version = 3');
      assert.equal(old.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'festival_tombstones'").get().n, 0);
      old.close();
      const db = openDb(file);
      try {
        assert.equal(db.pragma('user_version', { simple: true }), 4);
        assert.deepEqual(db.prepare('PRAGMA table_info(festival_tombstones)').all().map((c) => c.name), ['slug', 'deleted_at']);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('--reset import brings the festivals too', () => {
  test('import-xlsx.js --reset → festivals from seed/festivals.json', async () => {
    const dir = tmp();
    try {
      const db = openDb(path.join(dir, 'fresh.db'));
      try {
        // default --seed-dir = server/seed
        const real = readFestivalSeed(DEFAULT_FESTIVALS_SEED).entries;
        const s = await importSpreadsheet({ db, xlsxPath: XLSX, mediaDir: path.join(dir, 'media'), uploadsDir: path.join(dir, 'uploads') });
        assert.equal(s.festivals.created, real.length);
        assert.deepEqual(db.prepare('SELECT slug FROM festivals ORDER BY slug').all().map((r) => r.slug), real.map((f) => f.slug).sort());
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('/api/meta and /api/festivals', () => {
  test('meta: festivals (active) + defaultFestivalSlug, no old "festival" object', async () => {
    const t = makeApp({ env: { STAR_DEFAULT_FESTIVAL: ' Surrey ' } });
    try {
      const m = (await request(t.app).get('/api/meta')).body;
      assert.equal('festival' in m, false);
      assert.equal(m.defaultFestivalSlug, 'surrey');
      assert.deepEqual(m.festivals.map((f) => f.slug), SEED.map((f) => f.slug));
      for (const f of m.festivals) assert.deepEqual(Object.keys(f).sort(), FESTIVAL_KEYS);
      const v = m.festivals.find((f) => f.slug === 'vancouver');
      assert.deepEqual({ ...v, id: 0 }, {
        id: 0, slug: 'vancouver', name: 'Vancouver Regional STAR Fest', kind: 'regional', province: 'BC', city: 'Vancouver',
        startDate: '2026-12-11', endDate: null, dateLabel: null, venue: 'SFU School for the Contemporary Arts (SFU SCA)',
        infoUrl: 'https://taeacanada.ca/regional-star-fest/', sortOrder: 40, active: true,
      });
      // hiding the default festival → null (checked per request)
      t.db.prepare("UPDATE festivals SET active = 0 WHERE slug = 'surrey'").run();
      const hidden = (await request(t.app).get('/api/meta')).body;
      assert.equal(hidden.defaultFestivalSlug, null);
      assert.ok(!hidden.festivals.some((f) => f.slug === 'surrey'));
    } finally {
      t.cleanup();
    }
  });

  test('an invalid STAR_DEFAULT_FESTIVAL is ignored with one warning (startup), never a crash', async () => {
    for (const value of ['atlantis', 'star-fest-west', '../../etc']) {
      const log = recordingLogger();
      const t = makeApp({ env: { STAR_DEFAULT_FESTIVAL: value }, logger: log });
      try {
        for (let i = 0; i < 3; i++) {
          const res = await request(t.app).get('/api/meta');
          assert.equal(res.status, 200);
          assert.equal(res.body.defaultFestivalSlug, null, value);
        }
        const warns = log.warnings.filter((w) => w.includes('STAR_DEFAULT_FESTIVAL'));
        assert.equal(warns.length, 1, value);
        assert.match(warns[0], /Choices: prince-george, fraser-valley/);
      } finally {
        t.cleanup();
      }
    }
  });

  test('GET /api/festivals: ordered, hidden ones only for admins with ?all=1', async () => {
    const t = makeApp();
    try {
      const admin = await signupAdmin(t.app, t.db);
      const student = await signup(t.app);
      t.db.prepare("UPDATE festivals SET active = 0 WHERE slug = 'victoria'").run();
      // same sort_order: dated before undated ("to be announced"), then by date, then name
      t.db.prepare("UPDATE festivals SET sort_order = 5 WHERE slug IN ('surrey', 'nanaimo', 'burnaby')").run();
      const expected = ['burnaby', 'surrey', 'nanaimo', 'prince-george', 'fraser-valley', 'vancouver', 'online', 'star-fest-west'];
      const anon = await request(t.app).get('/api/festivals');
      assert.equal(anon.status, 200);
      assert.deepEqual(anon.body.festivals.map((f) => f.slug), expected);
      assert.deepEqual((await request(t.app).get('/api/festivals?all=1')).body.festivals.map((f) => f.slug), expected, 'anonymous ?all=1 ignored');
      assert.deepEqual((await student.get('/api/festivals?all=1')).body.festivals.map((f) => f.slug), expected, 'non-admin ?all=1 ignored');
      const all = await admin.get('/api/festivals?all=1');
      assert.equal(all.body.festivals.length, SEED.length);
      assert.equal(all.body.festivals.find((f) => f.slug === 'victoria').active, false);
      assert.equal((await admin.get('/api/festivals')).body.festivals.length, SEED.length - 1, 'admins see active ones without ?all=1');
      assert.equal((await admin.get('/api/admin/festivals')).body.festivals.length, SEED.length);
      assert.equal((await student.get('/api/admin/festivals')).status, 403);
    } finally {
      t.cleanup();
    }
  });
});

describe('admin festival CRUD', () => {
  let t;
  let admin;
  let student;
  before(async () => {
    t = makeApp();
    admin = await signupAdmin(t.app, t.db);
    student = await signup(t.app);
  });
  after(() => t.cleanup());
  const idOf = (slug) => t.db.prepare('SELECT id FROM festivals WHERE slug = ?').get(slug)?.id;

  test('permissions: anonymous 401, students 403, no CSRF header 403, wrong content type 415', async () => {
    const id = idOf('burnaby');
    const anon = client(t.app);
    assert.equal((await anon.post('/api/admin/festivals', festival())).status, 401);
    for (const res of [
      await student.post('/api/admin/festivals', festival()),
      await student.put(`/api/admin/festivals/${id}`, { venue: 'Hacked' }),
      await student.del(`/api/admin/festivals/${id}`),
    ]) {
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'Admins only');
    }
    const noCsrf = await admin.agent.post('/api/admin/festivals').send(festival());
    assert.equal(noCsrf.status, 403);
    assert.match(noCsrf.body.error, /X-Requested-With/);
    const noCsrfDelete = await admin.agent.delete(`/api/admin/festivals/${id}`);
    assert.equal(noCsrfDelete.status, 403);
    const form = await admin.agent.post('/api/admin/festivals').set(CSRF).type('form').send({ name: 'Form Fest', kind: 'regional' });
    assert.equal(form.status, 415);
    assert.ok(idOf('burnaby'), 'nothing was deleted');
    assert.equal(t.db.prepare("SELECT venue FROM festivals WHERE slug = 'burnaby'").get().venue, 'Burnaby Mountain Secondary School');
  });

  test('POST creates (201) with a slug from the name; a clash is 409', async () => {
    const res = await admin.post('/api/admin/festivals', festival({ name: '  Kelowna   Regional STAR Fest ', endDate: '2027-02-06', dateLabel: 'Two days!', active: false }));
    assert.equal(res.status, 201);
    assert.deepEqual(Object.keys(res.body).sort(), FESTIVAL_KEYS);
    assert.equal(res.body.slug, 'kelowna');
    assert.equal(res.body.name, 'Kelowna Regional STAR Fest');
    assert.equal(res.body.endDate, '2027-02-06');
    assert.equal(res.body.active, false);
    const row = t.db.prepare('SELECT * FROM festivals WHERE id = ?').get(res.body.id);
    assert.ok(row.edited_at, 'marked as a website row (the import keeps it)');
    // minimal body: optional fields default
    const min = await admin.post('/api/admin/festivals', { name: 'Online Summer Showcase', kind: 'online' });
    assert.equal(min.status, 201);
    assert.deepEqual({ ...min.body, id: 0 }, {
      id: 0, slug: 'online-summer-showcase', name: 'Online Summer Showcase', kind: 'online', province: null, city: null,
      startDate: null, endDate: null, dateLabel: null, venue: null, infoUrl: null, sortOrder: 0, active: true,
    });
    for (const name of ['Surrey Regional STAR Fest', 'Kelowna STAR Festival', 'kelowna']) {
      const clash = await admin.post('/api/admin/festivals', festival({ name }));
      assert.equal(clash.status, 409, name);
      assert.match(clash.body.error, /already uses the link name/);
      assert.ok(clash.body.details.name);
      assert.ok(Number.isInteger(clash.body.existingId));
    }
  });

  test('POST validation → 400 with details per field', async () => {
    const cases = [
      [{ name: undefined }, 'name', /Name is required/],
      [{ name: 'AB' }, 'name', /at least 3/],
      [{ name: 'x'.repeat(81) }, 'name', /at most 80/],
      [{ kind: 'provincial' }, 'kind', /regional, online, national/],
      [{ kind: undefined }, 'kind', /Kind is required/],
      [{ startDate: '2027-02-30' }, 'startDate', /real date/],
      [{ startDate: '2027-2-5' }, 'startDate', /real date/],
      [{ startDate: 20270205 }, 'startDate', /date like/],
      [{ endDate: '2027-13-01' }, 'endDate', /real date/],
      [{ startDate: '2027-02-05', endDate: '2027-02-04' }, 'endDate', /before the start date/],
      [{ infoUrl: 'http://taeacanada.ca/' }, 'infoUrl', /https/],
      [{ infoUrl: `https://example.com/${'a'.repeat(500)}` }, 'infoUrl', /too long/],
      [{ infoUrl: 'javascript:alert(1)' }, 'infoUrl', /https/],
      [{ province: 'x'.repeat(41) }, 'province', /at most 40/],
      [{ city: 'x'.repeat(121) }, 'city', /at most 120/],
      [{ venue: 'x'.repeat(121) }, 'venue', /at most 120/],
      [{ dateLabel: 'x'.repeat(121) }, 'dateLabel', /at most 120/],
      [{ sortOrder: 1.5 }, 'sortOrder', /whole number/],
      [{ sortOrder: 'ten' }, 'sortOrder', /whole number/],
      [{ active: 'yes' }, 'active', /true or false/],
      [{ name: { $gt: '' } }, 'name', /must be text/],
    ];
    for (const [patch, field, message] of cases) {
      const res = await admin.post('/api/admin/festivals', festival({ name: 'Validation Fest', ...patch }));
      assert.equal(res.status, 400, JSON.stringify(patch));
      assert.equal(res.body.error, 'Please fix the highlighted fields');
      assert.match(res.body.details[field] ?? '', message, `${JSON.stringify(patch)} → ${JSON.stringify(res.body.details)}`);
    }
    assert.equal((await admin.post('/api/admin/festivals', [festival()])).status, 400);
    assert.equal(idOf('validation'), undefined, 'nothing created');
    // online festivals may have only a deadline (endDate)
    const online = await admin.post('/api/admin/festivals', { name: 'Winter Online Showcase', kind: 'online', endDate: '2027-03-01', sortOrder: '90' });
    assert.equal(online.status, 201);
    assert.equal(online.body.sortOrder, 90);
  });

  test('PUT is a partial update; updated_at moves only on a real change; the slug never changes', async () => {
    const id = idOf('fraser-valley');
    const before = t.db.prepare('SELECT * FROM festivals WHERE id = ?').get(id);
    const noop = await admin.put(`/api/admin/festivals/${id}`, { venue: before.venue });
    assert.equal(noop.status, 200);
    const afterNoop = t.db.prepare('SELECT * FROM festivals WHERE id = ?').get(id);
    assert.equal(afterNoop.updated_at, before.updated_at);
    assert.equal(afterNoop.edited_at, null);

    const res = await admin.put(`/api/admin/festivals/${id}`, { name: 'Fraser Valley (Mission) Regional STAR Fest', venue: '  Clarke Foundation Theatre ', endDate: '2026-12-05' });
    assert.equal(res.status, 200);
    assert.equal(res.body.slug, 'fraser-valley');
    assert.equal(res.body.name, 'Fraser Valley (Mission) Regional STAR Fest');
    assert.equal(res.body.venue, 'Clarke Foundation Theatre');
    assert.equal(res.body.startDate, '2026-12-04', 'untouched');
    assert.equal(res.body.endDate, '2026-12-05');
    assert.equal(res.body.city, 'Mission', 'untouched');
    const row = t.db.prepare('SELECT * FROM festivals WHERE id = ?').get(id);
    assert.ok(row.updated_at > row.created_at);
    assert.ok(row.edited_at);

    // cross-field check uses the stored start date
    const bad = await admin.put(`/api/admin/festivals/${id}`, { endDate: '2026-12-01' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.details.endDate, /before the start date/);
    const bad2 = await admin.put(`/api/admin/festivals/${id}`, { startDate: '2026-12-06' });
    assert.equal(bad2.status, 400);
    assert.ok(bad2.body.details.endDate);
    // clearing: null / '' → null; required fields can't be cleared
    const cleared = await admin.put(`/api/admin/festivals/${id}`, { endDate: null, dateLabel: '', infoUrl: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.endDate, null);
    assert.equal(cleared.body.infoUrl, null);
    for (const body of [{ name: null }, { name: '' }, { kind: null }, { kind: 'national ' + 'x' }, { active: null }, { startDate: 'soon' }]) {
      assert.equal((await admin.put(`/api/admin/festivals/${id}`, body)).status, 400, JSON.stringify(body));
    }
    // hide / show
    assert.equal((await admin.put(`/api/admin/festivals/${id}`, { active: false })).body.active, false);
    assert.ok(!(await request(t.app).get('/api/festivals')).body.festivals.some((f) => f.id === id));
    assert.equal((await admin.put(`/api/admin/festivals/${id}`, { active: true })).body.active, true);
    // unknown ids
    assert.equal((await admin.put('/api/admin/festivals/999999', { venue: 'x' })).status, 404);
    assert.equal((await admin.put('/api/admin/festivals/abc', { venue: 'x' })).status, 404);
    assert.equal((await admin.put('/api/admin/festivals/999999', { venue: 'x' })).body.error, 'Festival not found');
  });

  test('DELETE → 204; people who chose it now have no festival', async () => {
    const id = idOf('prince-george');
    await student.put('/api/auth/me', { festivalSlug: 'prince-george' });
    assert.equal((await student.get('/api/auth/me')).body.user.festivalSlug, 'prince-george');
    const res = await admin.del(`/api/admin/festivals/${id}`);
    assert.equal(res.status, 204);
    assert.equal((await student.get('/api/auth/me')).body.user.festivalSlug, null);
    assert.equal(t.db.prepare('SELECT festival_id FROM users WHERE id = ?').get(student.user.id).festival_id, null);
    assert.equal((await admin.del(`/api/admin/festivals/${id}`)).status, 404);
    assert.ok(!(await request(t.app).get('/api/meta')).body.festivals.some((f) => f.slug === 'prince-george'));
  });
});

describe('admin festival writes are rate limited like other writes', () => {
  test('STAR_WRITE_LIMIT applies', async () => {
    const t = makeApp({ env: { STAR_WRITE_LIMIT: '3' } });
    try {
      const admin = await signupAdmin(t.app, t.db); // counted per IP; the rest per account
      const id = t.db.prepare("SELECT id FROM festivals WHERE slug = 'surrey'").get().id;
      for (let i = 1; i <= 3; i++) assert.equal((await admin.put(`/api/admin/festivals/${id}`, { sortOrder: i })).status, 200);
      const limited = await admin.post('/api/admin/festivals', festival());
      assert.equal(limited.status, 429);
      assert.match(limited.body.error, /lot of changes/);
    } finally {
      t.cleanup();
    }
  });
});

describe("a user's festival", () => {
  let t;
  let admin;
  before(async () => {
    t = makeApp();
    seedFixture(t.db);
    admin = await signupAdmin(t.app, t.db, { email: 'teacher@example.com', displayName: 'Teacher' });
  });
  after(() => t.cleanup());

  test('PUT /api/auth/me sets, normalizes and clears festivalSlug', async () => {
    const c = await signup(t.app);
    assert.equal(c.user.festivalSlug, null);
    const set = await c.put('/api/auth/me', { festivalSlug: ' Surrey ' });
    assert.equal(set.status, 200);
    assert.equal(set.body.user.festivalSlug, 'surrey');
    assert.equal((await c.get('/api/auth/me')).body.user.festivalSlug, 'surrey');
    // login returns it too
    const again = client(t.app);
    const login = await again.post('/api/auth/login', { email: c.user.email, password: PASSWORD });
    assert.equal(login.body.user.festivalSlug, 'surrey');
    // other fields at the same time; festivalSlug left out = unchanged
    const both = await c.put('/api/auth/me', { displayName: 'Renamed Kid', festivalSlug: 'online' });
    assert.equal(both.body.user.displayName, 'Renamed Kid');
    assert.equal(both.body.user.festivalSlug, 'online');
    assert.equal((await c.put('/api/auth/me', { displayName: 'Renamed Again' })).body.user.festivalSlug, 'online');
    // null and '' clear it
    assert.equal((await c.put('/api/auth/me', { festivalSlug: null })).body.user.festivalSlug, null);
    await c.put('/api/auth/me', { festivalSlug: 'victoria' });
    assert.equal((await c.put('/api/auth/me', { festivalSlug: '' })).body.user.festivalSlug, null);
  });

  test('only active regional/online festivals can be chosen → else 400 details.festivalSlug', async () => {
    const c = await signup(t.app);
    await c.put('/api/auth/me', { festivalSlug: 'vancouver' });
    t.db.prepare("UPDATE festivals SET active = 0 WHERE slug = 'burnaby'").run();
    try {
      const cases = [
        ['atlantis', /isn't available/],
        ['burnaby', /isn't available/],
        ['star-fest-west', /regional festival/],
        [42, /Choose a festival/],
        [['surrey'], /Choose a festival/],
        [{ slug: 'surrey' }, /Choose a festival/],
        ['x'.repeat(500), /isn't available/],
      ];
      for (const [value, message] of cases) {
        const res = await c.put('/api/auth/me', { festivalSlug: value, displayName: 'Should Not Save' });
        assert.equal(res.status, 400, JSON.stringify(value));
        assert.equal(res.body.error, 'Please fix the highlighted fields');
        assert.match(res.body.details.festivalSlug, message);
      }
      const me = (await c.get('/api/auth/me')).body.user;
      assert.equal(me.festivalSlug, 'vancouver', 'unchanged');
      assert.notEqual(me.displayName, 'Should Not Save', 'nothing saved');
    } finally {
      t.db.prepare("UPDATE festivals SET active = 1 WHERE slug = 'burnaby'").run();
    }
  });

  test('hiding a chosen festival keeps the choice (the client ignores it); showing it again restores it', async () => {
    const c = await signup(t.app);
    await c.put('/api/auth/me', { festivalSlug: 'nanaimo' });
    const id = t.db.prepare("SELECT id FROM festivals WHERE slug = 'nanaimo'").get().id;
    assert.equal((await admin.put(`/api/admin/festivals/${id}`, { active: false })).status, 200);
    assert.equal((await c.get('/api/auth/me')).body.user.festivalSlug, 'nanaimo');
    assert.ok(!(await c.get('/api/meta')).body.festivals.some((f) => f.slug === 'nanaimo'));
    // …but it can't be chosen again while hidden
    assert.equal((await c.put('/api/auth/me', { festivalSlug: 'nanaimo' })).status, 400);
    assert.equal((await admin.put(`/api/admin/festivals/${id}`, { active: true })).status, 200);
    assert.equal((await c.get('/api/auth/me')).body.user.festivalSlug, 'nanaimo');
  });

  test('with a temporary password the festival can be set like the display name', async () => {
    const c = await signup(t.app, { email: 'forgetful@example.com' });
    const reset = await admin.post(`/api/admin/users/${c.user.id}/reset-password`);
    const fresh = client(t.app);
    await fresh.post('/api/auth/login', { email: 'forgetful@example.com', password: reset.body.temporaryPassword });
    const res = await fresh.put('/api/auth/me', { festivalSlug: 'surrey' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.mustChangePassword, true);
    assert.equal(res.body.user.festivalSlug, 'surrey');
  });

  test('signup may carry the festival chosen in the browser (same rules)', async () => {
    const c = client(t.app);
    const ok = await c.post('/api/auth/signup', { email: 'fest@example.com', password: PASSWORD, displayName: 'Fest Kid', festivalSlug: 'Fraser-Valley' });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.festivalSlug, 'fraser-valley');
    assert.equal((await c.get('/api/auth/me')).body.user.festivalSlug, 'fraser-valley');
    const none = await client(t.app).post('/api/auth/signup', { email: 'nofest@example.com', password: PASSWORD, displayName: 'No Fest', festivalSlug: null });
    assert.equal(none.status, 201);
    assert.equal(none.body.user.festivalSlug, null);
    for (const slug of ['atlantis', 'star-fest-west', 7]) {
      const bad = await client(t.app).post('/api/auth/signup', { email: `bad-${slug}@example.com`, password: PASSWORD, displayName: 'Bad Fest', festivalSlug: slug });
      assert.equal(bad.status, 400, String(slug));
      assert.ok(bad.body.details.festivalSlug);
      assert.equal(t.db.prepare('SELECT count(*) AS n FROM users WHERE email = ?').get(`bad-${slug}@example.com`).n, 0, 'no account made');
    }
  });

  test("admins see each user's festival; nobody else sees anyone's", async () => {
    const alice = await signup(t.app, { displayName: 'Alice Fest' });
    const bob = await signup(t.app, { displayName: 'Bob Fest' });
    await alice.put('/api/auth/me', { festivalSlug: 'victoria' });
    await bob.put('/api/auth/me', { festivalSlug: 'online' });
    const song = (await alice.post('/api/songs', soloBody({ title: 'Festival Privacy', showName: 'Privacy Show' }))).body;
    await alice.post(`/api/songs/${song.id}/comments`, { body: 'See you at Victoria' });

    const users = (await admin.get('/api/admin/users')).body.users;
    assert.equal(users.find((u) => u.id === alice.user.id).festivalSlug, 'victoria');
    assert.equal(users.find((u) => u.id === bob.user.id).festivalSlug, 'online');
    assert.equal((await admin.patch(`/api/admin/users/${alice.user.id}`, { disabled: false })).body.festivalSlug, 'victoria');

    assert.equal((await bob.get('/api/auth/me')).body.user.festivalSlug, 'online');
    assert.equal((await bob.get('/api/admin/users')).status, 403);
    for (const url of ['/api/songs', `/api/songs/${song.id}`, `/api/songs/${song.id}/comments`, '/api/shows/privacy-show', '/api/meta', '/api/festivals']) {
      for (const agent of [request(t.app), bob.agent]) {
        const json = JSON.stringify((await agent.get(url)).body);
        assert.ok(!json.includes('festivalSlug') && !json.includes('festival_id'), `${url} exposes users' festivals`);
      }
    }
    const mine = JSON.stringify((await alice.get('/api/me/contributions')).body);
    assert.ok(!mine.includes('festivalSlug'));
  });
});

describe('a festival hidden or deleted while a signup / password change is being processed', () => {
  let t;
  let admin;
  let n = 0;
  before(async () => {
    t = makeApp();
    admin = await signupAdmin(t.app, t.db);
  });
  after(() => t.cleanup());

  /** A fresh choosable festival for one case. */
  const freshFestival = async () => {
    n++;
    const res = await admin.post('/api/admin/festivals', festival({ name: `Race ${'abcdefgh'[n]} Regional STAR Fest` }));
    assert.equal(res.status, 201);
    return t.db.prepare('SELECT * FROM festivals WHERE id = ?').get(res.body.id);
  };

  /**
   * The next time SQL matching `re` is prepared, run `fn` — straight away (so it happens before
   * that statement runs), or with `later` on the next turn of the event loop (while the route is
   * waiting for scrypt; its result can only arrive in a later turn).
   */
  const onNextPrepare = (re, fn, { later = false } = {}) => {
    const db = t.db;
    const original = Object.getPrototypeOf(db).prepare;
    db.prepare = function prepare(sql, ...rest) {
      if (re.test(sql)) {
        delete db.prepare;
        if (later) setImmediate(fn);
        else fn();
      }
      return original.call(db, sql, ...rest);
    };
    return () => delete db.prepare;
  };
  const LOOKUP = /FROM festivals WHERE slug = \?/;

  test('signup: deleted while the password is hashed → 400 festivalSlug (not "email exists"); the email stays free', async () => {
    const f = await freshFestival();
    const restore = onNextPrepare(LOOKUP, () => deleteFestival(t.db, f), { later: true });
    try {
      const res = await client(t.app).post('/api/auth/signup', { email: 'racer1@example.com', password: PASSWORD, displayName: 'Racer One', festivalSlug: f.slug });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.match(res.body.details.festivalSlug, /isn't available/);
      assert.equal(res.body.details.email, undefined);
    } finally {
      restore();
    }
    assert.equal(t.db.prepare('SELECT count(*) AS n FROM users WHERE email = ?').get('racer1@example.com').n, 0);
    assert.equal((await client(t.app).post('/api/auth/signup', { email: 'racer1@example.com', password: PASSWORD, displayName: 'Racer One' })).status, 201);
  });

  test('signup: hidden while the password is hashed → 400 (an inactive festival is never stored)', async () => {
    const f = await freshFestival();
    const restore = onNextPrepare(LOOKUP, () => t.db.prepare('UPDATE festivals SET active = 0 WHERE id = ?').run(f.id), { later: true });
    try {
      const res = await client(t.app).post('/api/auth/signup', { email: 'racer2@example.com', password: PASSWORD, displayName: 'Racer Two', festivalSlug: f.slug });
      assert.equal(res.status, 400);
      assert.ok(res.body.details.festivalSlug);
    } finally {
      restore();
    }
  });

  test('signup: a foreign-key failure at the write is a 400 on festivalSlug, never the email 409', async () => {
    const f = await freshFestival();
    // deleted after the re-check, just before the INSERT runs
    const restore = onNextPrepare(/INSERT INTO users/, () => deleteFestival(t.db, f));
    try {
      const res = await client(t.app).post('/api/auth/signup', { email: 'racer3@example.com', password: PASSWORD, displayName: 'Racer Three', festivalSlug: f.slug });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.match(res.body.details.festivalSlug, /isn't available/);
    } finally {
      restore();
    }
    assert.equal(t.db.prepare('SELECT count(*) AS n FROM users WHERE email = ?').get('racer3@example.com').n, 0);
    // a real duplicate is still a 409
    const dup = await client(t.app).post('/api/auth/signup', { email: admin.user.email, password: PASSWORD, displayName: 'Copycat' });
    assert.equal(dup.status, 409);
    assert.ok(dup.body.details.email);
  });

  test('PUT /auth/me with a password change: deleted during the password checks → 400, nothing saved (not a 500)', async () => {
    const f = await freshFestival();
    const c = await signup(t.app, { email: 'racer4@example.com' });
    const restore = onNextPrepare(LOOKUP, () => deleteFestival(t.db, f), { later: true });
    try {
      const res = await c.put('/api/auth/me', { festivalSlug: f.slug, currentPassword: PASSWORD, newPassword: 'a whole new password 7' });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.match(res.body.details.festivalSlug, /isn't available/);
    } finally {
      restore();
    }
    assert.equal((await client(t.app).post('/api/auth/login', { email: 'racer4@example.com', password: PASSWORD })).status, 200, 'password unchanged');
    assert.equal((await c.get('/api/auth/me')).body.user.festivalSlug, null);
  });

  test('PUT /auth/me with a password change: hidden during the password checks → 400 (never stored while hidden)', async () => {
    const f = await freshFestival();
    const c = await signup(t.app, { email: 'racer6@example.com' });
    const restore = onNextPrepare(LOOKUP, () => t.db.prepare('UPDATE festivals SET active = 0 WHERE id = ?').run(f.id), { later: true });
    try {
      const res = await c.put('/api/auth/me', { festivalSlug: f.slug, currentPassword: PASSWORD, newPassword: 'a whole new password 8' });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.ok(res.body.details.festivalSlug);
    } finally {
      restore();
    }
    assert.equal(t.db.prepare('SELECT festival_id FROM users WHERE id = ?').get(c.user.id).festival_id, null);
  });

  test('PUT /auth/me: a foreign-key failure at the write is a 400, not a 500', async () => {
    const f = await freshFestival();
    const c = await signup(t.app, { email: 'racer5@example.com' });
    const restore = onNextPrepare(/UPDATE users SET festival_id/, () => deleteFestival(t.db, f));
    try {
      const res = await c.put('/api/auth/me', { festivalSlug: f.slug, displayName: 'Racer Five' });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.ok(res.body.details.festivalSlug);
    } finally {
      restore();
    }
    const me = (await c.get('/api/auth/me')).body.user;
    assert.equal(me.festivalSlug, null);
    assert.notEqual(me.displayName, 'Racer Five', 'the transaction was rolled back');
  });
});

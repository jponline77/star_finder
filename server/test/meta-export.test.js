import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { makeTestApp, signup, seedFixture, soloBody, binaryParser } from './helpers.js';

describe('meta, stats, export', () => {
  let t;
  before(async () => {
    t = makeTestApp();
    seedFixture(t.db);
    const u = await signup(t.app, { displayName: 'Contributor' });
    await u.post('/api/songs', soloBody({ title: 'Community Solo', showName: 'Community Show', genre: 'Drama', subGenre: 'Hopeful', length: '2:05' }));
  });
  after(() => t.cleanup());

  test('GET /api/health', async () => {
    const res = await request(t.app).get('/api/health');
    assert.deepEqual(res.body, { ok: true });
  });

  test('GET /api/meta', async () => {
    const res = await request(t.app).get('/api/meta');
    assert.equal(res.status, 200);
    const m = res.body;
    assert.deepEqual(m.vocalRanges, ['Soprano', 'Mezzo-soprano', 'Alto', 'Tenor', 'Baritone', 'Bass']);
    assert.deepEqual(m.genres, ['Comedy', 'Drama', 'Romantic']);
    assert.ok(m.subGenres.find((s) => s.name === 'Longing' && s.genre === 'Drama' && s.count === 2));
    assert.ok(m.subGenres.find((s) => s.name === 'Tongue-in-Cheek' && s.genre === 'Comedy'));
    assert.deepEqual(Object.keys(m.shows[0]).sort(), ['id', 'name', 'slug']);
    assert.deepEqual(m.counts, { songs: 8, solos: 5, duets: 3, shows: 5 });
    assert.equal(m.timeLimitSeconds, 360);
    assert.equal(m.warnSeconds, 330);
    // SPEC §7b: no single hardcoded festival any more — the active list + the site's default
    assert.equal('festival' in m, false);
    assert.ok(Array.isArray(m.festivals) && m.festivals.length > 0);
    assert.ok(m.festivals.every((f) => f.active === true));
    assert.equal(m.defaultFestivalSlug, null);
  });

  test('GET /api/stats', async () => {
    const res = await request(t.app).get('/api/stats');
    assert.equal(res.status, 200);
    const s = res.body;
    for (const k of ['byGenre', 'bySubGenre', 'byRange', 'byShow', 'byKind', 'lengthBuckets']) {
      assert.ok(Array.isArray(s[k]), k);
      for (const item of s[k]) assert.ok(typeof item.label === 'string' && Number.isInteger(item.count), k);
    }
    assert.deepEqual(s.byGenre[0], { label: 'Drama', count: 5 });
    assert.deepEqual(s.byKind, [{ label: 'solo', count: 5 }, { label: 'duet', count: 3 }]);
    assert.deepEqual(s.byRange.map((r) => r.label), ['Soprano', 'Mezzo-soprano', 'Alto', 'Tenor', 'Baritone', 'Bass']);
    assert.equal(s.byRange.find((r) => r.label === 'Baritone').count, 5);
    assert.deepEqual(s.mature, { yes: 2, no: 6 });
    assert.equal(s.overLimit, 1);
    assert.equal(s.withPreview, 1);
    assert.equal(s.lengthBuckets.reduce((a, b) => a + b.count, 0), 8);
    assert.equal(s.lengthBuckets.find((b) => b.label === 'Over 6:00').count, 1);
    assert.equal(s.byShow[0].label, 'Les Misérables');
  });

  test('GET /api/export.xlsx parses back with exceljs', async () => {
    const res = await request(t.app).get('/api/export.xlsx').buffer(true).parse(binaryParser);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /spreadsheetml/);
    assert.match(res.headers['content-disposition'], /attachment; filename="star-songs\.xlsx"/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const solos = wb.getWorksheet('Solos');
    const duets = wb.getWorksheet('Duets');
    assert.ok(solos && duets);
    assert.deepEqual(solos.getRow(1).values.slice(1), ['Song', 'Character', 'Show', 'Genre', 'Sub-Genre', 'Vocal Range', 'Length', 'Mature Content?', 'Added by']);
    assert.deepEqual(duets.getRow(1).values.slice(1), ['Song', 'Show', 'Character 1', 'Character 2', 'Genre', 'Sub-Genre', 'Vocal Range 1', 'Vocal Range 2', 'Length', 'Mature Content?', 'Added by']);
    assert.equal(solos.rowCount, 1 + 5);
    assert.equal(duets.rowCount, 1 + 3);
    const rows = [];
    solos.eachRow((row, n) => {
      if (n > 1) rows.push(row.values.slice(1));
    });
    const own = rows.find((r) => r[0] === 'On My Own');
    assert.deepEqual(own, ['On My Own', 'Eponine', 'Les Misérables', 'Drama', 'Longing', 'Soprano', '3:59', 'No', 'Spreadsheet']);
    const community = rows.find((r) => r[0] === 'Community Solo');
    assert.equal(community[6], '2:05');
    assert.equal(community[8], 'Community');
    const duetRows = [];
    duets.eachRow((row, n) => {
      if (n > 1) duetRows.push(row.values.slice(1));
    });
    const corn = duetRows.find((r) => r[0] === 'Corn');
    assert.deepEqual(corn, ['Corn', 'Shucked', 'Storyteller 1', 'Storyteller 2', 'Comedy', 'Tongue-in-Cheek', 'Baritone', 'Mezzo-soprano', '6:46', 'Yes', 'Spreadsheet']);
  });

  test('unknown /api route → JSON 404', async () => {
    const res = await request(t.app).get('/api/nope');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Not found' });
  });

  test('security headers', async () => {
    const res = await request(t.app).get('/api/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.ok(res.headers['content-security-policy']);
    assert.match(res.headers['content-security-policy'], /media-src[^;]*itunes\.apple\.com/);
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['cache-control'], 'no-store');
  });
});

describe('production client serving', () => {
  test('serves client/dist with SPA fallback for non-/api GETs', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { createApp } = await import('../src/app.js');
    const t = makeTestApp();
    try {
      const dist = path.join(t.dir, 'dist');
      fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>STAR</title><div id="root"></div>');
      fs.writeFileSync(path.join(dist, 'assets', 'app-123.js'), 'console.log(1)');
      const app = createApp({ db: t.db, uploadsDir: t.uploadsDir, mediaDir: t.mediaDir, clientDistDir: dist, env: {}, logger: { info() {}, warn() {}, error() {} } });
      try {
        const home = await request(app).get('/');
        assert.equal(home.status, 200);
        assert.match(home.text, /<title>STAR<\/title>/);
        const deep = await request(app).get('/songs/12?q=x');
        assert.equal(deep.status, 200);
        assert.match(deep.headers['content-type'], /html/);
        const asset = await request(app).get('/assets/app-123.js');
        assert.match(asset.headers['cache-control'], /immutable/);
        const api = await request(app).get('/api/nope');
        assert.equal(api.status, 404);
        assert.deepEqual(api.body, { error: 'Not found' });
        const media = await request(app).get('/media/nope.jpg');
        assert.equal(media.status, 404);
        assert.doesNotMatch(media.text, /<title>/);
        const csp = home.headers['content-security-policy'];
        assert.match(csp, /img-src[^;]*mzstatic/);
        assert.doesNotMatch(csp, /upgrade-insecure-requests/);
      } finally {
        app.locals.close();
      }
    } finally {
      t.cleanup();
    }
  });
});

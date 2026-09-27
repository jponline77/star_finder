// Regression tests for the security/ops review: proxy trust, error handling, CSP, SPA fallback,
// text cleaning, slugs, artwork paths, rate limits, daily caps and the cheap catalogue endpoints.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import Database from 'better-sqlite3';
import {
  makeTestApp, client, signup, signupAdmin, seedFixture, soloBody, insertShow, insertSong, silentLogger, PNG,
} from './helpers.js';
import { createApp, parseTrustProxy } from '../src/app.js';
import { openDb } from '../src/db.js';
import { fold } from '../src/lib/text.js';
import { listSongs } from '../src/repo.js';

describe('TRUST_PROXY', () => {
  test('"true" trusts only a proxy on this machine, never a direct client', () => {
    assert.equal(parseTrustProxy('true'), 'loopback');
    assert.equal(parseTrustProxy('2'), 2);
    assert.equal(parseTrustProxy(undefined), false);
    assert.equal(parseTrustProxy('10.0.0.0/8'), '10.0.0.0/8');
    const t = makeTestApp({ env: { TRUST_PROXY: 'true' } });
    try {
      const trusts = t.app.get('trust proxy fn');
      assert.equal(trusts('127.0.0.1', 0), true, 'local reverse proxy');
      assert.equal(trusts('::1', 0), true);
      assert.equal(trusts('203.0.113.7', 0), false, 'a client connecting to the Node port directly');
      assert.equal(trusts('10.1.2.3', 0), false);
    } finally {
      t.cleanup();
    }
  });

  test('behind a local proxy the forwarded client IP is used (login limit is per real client)', async () => {
    const t = makeTestApp({ env: { TRUST_PROXY: 'true', STAR_LOGIN_LIMIT: '2' } });
    try {
      await signup(t.app, { email: 'xff@example.com' });
      const attempt = (ip) => client(t.app).agent.post('/api/auth/login').set('X-Requested-With', 'star-song-finder')
        .set('X-Forwarded-For', ip).send({ email: 'xff@example.com', password: 'wrong-password' });
      assert.equal((await attempt('198.51.100.1')).status, 401);
      assert.equal((await attempt('198.51.100.1')).status, 401);
      assert.equal((await attempt('198.51.100.1')).status, 429);
      assert.equal((await attempt('198.51.100.2')).status, 401, 'another client behind the proxy');
    } finally {
      t.cleanup();
    }
  });
});

describe('error handling', () => {
  test('malformed %-escapes in an API path → 400, no stack trace in the log', async () => {
    const errors = [];
    const t = makeTestApp();
    const app = createApp({ db: t.db, uploadsDir: t.uploadsDir, mediaDir: t.mediaDir, env: {}, logger: { ...silentLogger, error: (...a) => errors.push(a) } });
    try {
      for (const url of ['/api/songs/%E0%A4%A', '/api/shows/%E0%A4%A/comments', '/api/shows/%E0%A4%A']) {
        const res = await request(app).get(url);
        assert.equal(res.status, 400, url);
        assert.equal(res.body.error, 'Bad Request');
      }
      assert.equal(errors.length, 0);
    } finally {
      app.locals.close();
      t.cleanup();
    }
  });

  test('a real 500 is logged with time, method, URL and user (not a bare stack)', async () => {
    const errors = [];
    const t = makeTestApp();
    const app = createApp({ db: t.db, uploadsDir: t.uploadsDir, mediaDir: t.mediaDir, env: {}, logger: { ...silentLogger, error: (...a) => errors.push(a.join(' ')) } });
    try {
      const u = await signup(app);
      const ids = seedFixture(t.db);
      t.db.exec('DROP TABLE comments'); // force an unexpected failure
      const res = await u.get(`/api/songs/${ids.stars}/comments`);
      assert.equal(res.status, 500);
      assert.doesNotMatch(JSON.stringify(res.body), /no such table|SqliteError/, 'no internals leak to the client');
      assert.equal(errors.length, 1);
      assert.match(errors[0], new RegExp(`^\\d{4}-\\d\\d-\\d\\dT\\S+ GET /api/songs/${ids.stars}/comments user=${u.user.id} failed:\\n.*SqliteError`, 's'));
    } finally {
      app.locals.close();
      t.cleanup();
    }
  });

  test('a write while another process holds the write lock → 503 + Retry-After (not a generic 500)', async () => {
    const t = makeTestApp();
    const other = new Database(path.join(t.dir, 'test.db'));
    try {
      const ids = seedFixture(t.db);
      const u = await signup(t.app);
      t.db.pragma('busy_timeout = 50');
      other.exec('BEGIN IMMEDIATE');
      const res = await u.post(`/api/songs/${ids.stars}/comments`, { body: 'hello' });
      assert.equal(res.status, 503);
      assert.equal(res.headers['retry-after'], '5');
      assert.match(res.body.error, /busy/);
      other.exec('ROLLBACK');
      assert.equal((await u.post(`/api/songs/${ids.stars}/comments`, { body: 'hello' })).status, 201);
    } finally {
      other.close();
      t.cleanup();
    }
  });

  test('STAR_ACCESS_LOG=1 logs one line per request', async () => {
    const lines = [];
    const t = makeTestApp();
    const app = createApp({ db: t.db, uploadsDir: t.uploadsDir, mediaDir: t.mediaDir, env: { STAR_ACCESS_LOG: '1' }, logger: { ...silentLogger, info: (m) => lines.push(m) } });
    try {
      await request(app).get('/api/health');
      assert.ok(lines.some((l) => / GET \/api\/health user=- 200 \d+\.\dms$/.test(l)), lines.join('\n'));
    } finally {
      app.locals.close();
      t.cleanup();
    }
  });
});

describe('content security policy', () => {
  test('no external stylesheets/fonts and no frames', async () => {
    const t = makeTestApp();
    try {
      const csp = (await request(t.app).get('/api/health')).headers['content-security-policy'];
      assert.match(csp, /font-src 'self' data:(;|$)/);
      assert.match(csp, /style-src 'self' 'unsafe-inline'(;|$)/);
      assert.match(csp, /frame-src 'none'/);
      assert.doesNotMatch(csp, /https:(;| )/, 'no blanket https: sources');
      assert.doesNotMatch(csp, /youtube|spotify/);
    } finally {
      t.cleanup();
    }
  });
});

describe('production SPA fallback', () => {
  test('app routes get index.html; missing files (old chunks, favicon, robots.txt) get a real 404', async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'star-dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>STAR</title>');
    fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
    const t = makeTestApp();
    const app = createApp({ db: t.db, uploadsDir: t.uploadsDir, mediaDir: t.mediaDir, clientDistDir: dist, env: {}, logger: silentLogger });
    try {
      for (const route of ['/', '/songs', '/songs/12', '/shows/mr-burns-a-post-electric-play', '/setlist']) {
        const res = await request(app).get(`${route}?ids=1,2`);
        assert.equal(res.status, 200, route);
        assert.match(res.headers['content-type'], /text\/html/);
      }
      assert.equal((await request(app).get('/assets/app-abc123.js')).status, 200);
      for (const missing of ['/assets/SongFormPage-oldhash.js', '/assets/', '/favicon.ico', '/robots.txt', '/nope.css']) {
        const res = await request(app).get(missing);
        assert.equal(res.status, 404, missing);
        assert.doesNotMatch(res.text, /<title>STAR/);
      }
    } finally {
      app.locals.close();
      t.cleanup();
      fs.rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe('user text: bidi controls and joiners', () => {
  const codepoints = (s) => [...s].map((c) => c.codePointAt(0).toString(16));

  test('bidi overrides/isolates/marks are stripped from names, titles and comments', async () => {
    const t = makeTestApp();
    try {
      const ids = seedFixture(t.db);
      const u = await signup(t.app);
      const me = await u.put('/api/auth/me', { displayName: '‮moc.live' });
      assert.equal(me.status, 200);
      assert.equal(me.body.user.displayName, 'moc.live', 'shown as typed, not reversed');
      for (const sneaky of ['evil‍.com', 'evil‌.com', 'evil‏.com', 'www⁦.evil']) {
        const res = await u.put('/api/auth/me', { displayName: sneaky });
        assert.equal(res.status, 400, JSON.stringify(sneaky));
      }
      const c = await u.post(`/api/songs/${ids.stars}/comments`, { body: 'a⁧b‮c‎d؜e' });
      assert.equal(c.body.body, 'abcde');
      const show = await u.post('/api/shows', { name: 'Show ‪Name‬' });
      assert.equal(show.body.name, 'Show Name');
    } finally {
      t.cleanup();
    }
  });

  test('ZWJ/ZWNJ survive, so emoji sequences and Persian names stay intact', async () => {
    const t = makeTestApp();
    try {
      const ids = seedFixture(t.db);
      const u = await signup(t.app);
      const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
      const rainbow = '\u{1F3F3}️‍\u{1F308}';
      const c = await u.post(`/api/songs/${ids.stars}/comments`, { body: `${family} ${rainbow}` });
      assert.equal(c.status, 201);
      assert.deepEqual(codepoints(c.body.body), ['1f468', '200d', '1f469', '200d', '1f467', '20', '1f3f3', 'fe0f', '200d', '1f308']);
      const me = await u.put('/api/auth/me', { displayName: `Pride ${rainbow}` });
      assert.equal(me.body.user.displayName, `Pride ${rainbow}`);
      const show = await u.post('/api/shows', { name: 'Show Mi‌na' });
      assert.equal(show.body.name, 'Show Mi‌na');
      // …but a stray/leading/repeated joiner is tidied away
      const tidy = await u.put('/api/auth/me', { displayName: '‍‍Sam‍' });
      assert.equal(tidy.body.user.displayName, 'Sam');
    } finally {
      t.cleanup();
    }
  });
});

describe('numeric show names', () => {
  test('a show called "13" gets a slug that can\'t be mistaken for show id 13', async () => {
    const t = makeTestApp();
    try {
      for (let i = 1; i <= 14; i++) insertShow(t.db, `Filler Show ${i}`);
      const u = await signup(t.app);
      const res = await u.post('/api/shows', { name: '13' });
      assert.equal(res.status, 201);
      assert.equal(res.body.slug, '13-show');
      await u.post('/api/songs', soloBody({ title: 'Opening Song', showId: res.body.id, showName: undefined }));
      const bySlug = await request(t.app).get('/api/shows/13-show');
      assert.equal(bySlug.body.id, res.body.id);
      assert.equal(bySlug.body.name, '13');
      assert.equal((await request(t.app).get('/api/shows/13')).body.name, 'Filler Show 13', 'id 13 is still id 13');
      const songs = await request(t.app).get('/api/songs?show=13-show');
      assert.deepEqual(songs.body.songs.map((s) => s.show.name), ['13']);
      const c = await u.post('/api/shows/13-show/comments', { body: 'Love this show' });
      assert.equal(c.body.target.id, res.body.id);
    } finally {
      t.cleanup();
    }
  });

  test('existing all-digit slugs are renamed by the migration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-mig-'));
    try {
      const file = path.join(dir, 'old.db');
      const db = openDb(file);
      db.prepare("INSERT INTO shows (name, slug) VALUES ('1776', '1776'), ('Cats', 'cats')").run();
      db.pragma('user_version = 1'); // pretend it's a database from before the fix
      db.close();
      const again = openDb(file);
      assert.deepEqual(again.prepare('SELECT name, slug FROM shows ORDER BY id').all().map((r) => ({ ...r })), [
        { name: '1776', slug: '1776-show' }, { name: 'Cats', slug: 'cats' },
      ]);
      again.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('song artwork paths', () => {
  test("preview.artworkUrl must be a real seed file or the song's own current art", async () => {
    const fetchImpl = async () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    const t = makeTestApp({ fetchImpl });
    try {
      fs.mkdirSync(path.join(t.mediaDir, 'art'), { recursive: true });
      fs.writeFileSync(path.join(t.mediaDir, 'art', 'seed123.jpg'), PNG);
      const u = await signup(t.app);
      const preview = (artworkUrl) => ({ preview: { previewUrl: 'https://audio-ssl.itunes.apple.com/a.m4a', artworkUrl } });
      const song = (await u.post('/api/songs', soloBody({ title: 'Art Song', ...preview('https://is1-ssl.mzstatic.com/a/600x600bb.jpg') }))).body;
      assert.match(song.media.artworkUrl, /^\/uploads\/art\//);
      for (const bad of ['/media/art/..', '/media/art/.', '/media/art/nonexistent.jpg', '/media/art/seed123', '/uploads/audio/x.mp3']) {
        const res = await u.put(`/api/songs/${song.id}`, soloBody({ title: 'Art Song', ...preview(bad) }));
        assert.equal(res.status, 400, bad);
        assert.ok(res.body.details['preview.artworkUrl'], bad);
      }
      // someone else's downloaded art can't be borrowed (its owner may delete it)
      const other = (await u.post('/api/songs', soloBody({ title: 'Other Song', ...preview('https://is1-ssl.mzstatic.com/b/600x600bb.jpg') }))).body;
      assert.equal((await u.put(`/api/songs/${song.id}`, soloBody({ title: 'Art Song', ...preview(other.media.artworkUrl) }))).status, 400);
      const keep = await u.put(`/api/songs/${song.id}`, soloBody({ title: 'Art Song', ...preview(song.media.artworkUrl) }));
      assert.equal(keep.status, 200);
      assert.equal(keep.body.media.artworkUrl, song.media.artworkUrl);
      const seed = await u.put(`/api/songs/${song.id}`, soloBody({ title: 'Art Song', ...preview('/media/art/seed123.jpg') }));
      assert.equal(seed.body.media.artworkUrl, '/media/art/seed123.jpg');
      assert.ok(!fs.existsSync(path.join(t.uploadsDir, 'art', path.basename(song.media.artworkUrl))), 'replaced download removed');
      assert.ok(fs.existsSync(path.join(t.mediaDir, 'art', 'seed123.jpg')), 'seed art is never deleted');
    } finally {
      t.cleanup();
    }
  });
});

describe('rate limits on reads, downloads and new content', () => {
  test('GET /api/* is rate limited per client (generously)', async () => {
    const t = makeTestApp({ env: { STAR_READ_LIMIT: '5' } });
    try {
      for (let i = 0; i < 5; i++) assert.equal((await request(t.app).get('/api/health')).status, 200);
      const blocked = await request(t.app).get('/api/songs');
      assert.equal(blocked.status, 429);
      assert.ok(blocked.body.error);
    } finally {
      t.cleanup();
    }
  });

  test('the spreadsheet download has its own small limit', async () => {
    const t = makeTestApp({ env: { STAR_EXPORT_LIMIT: '2' } });
    try {
      seedFixture(t.db);
      assert.equal((await request(t.app).get('/api/export.xlsx')).status, 200);
      assert.equal((await request(t.app).get('/api/export.xlsx')).status, 200);
      assert.equal((await request(t.app).get('/api/export.xlsx')).status, 429);
    } finally {
      t.cleanup();
    }
  });

  test('daily caps on new songs and shows per account (admins exempt)', async () => {
    const t = makeTestApp({ env: { STAR_DAILY_SONG_LIMIT: '2', STAR_DAILY_SHOW_LIMIT: '1' } });
    try {
      const u = await signup(t.app);
      assert.equal((await u.post('/api/songs', soloBody({ title: 'One', showName: 'Cap Show' }))).status, 201);
      assert.equal((await u.post('/api/songs', soloBody({ title: 'Two', showName: 'Cap Show' }))).status, 201);
      const third = await u.post('/api/songs', soloBody({ title: 'Three', showName: 'Cap Show' }));
      assert.equal(third.status, 429);
      assert.match(third.body.error, /2 songs today/);
      const show = await u.post('/api/shows', { name: 'Second Show' });
      assert.equal(show.status, 429, 'the implicit "Cap Show" used up the show cap');
      // rows older than a day don't count
      t.db.prepare("UPDATE songs SET created_at = '2020-01-01T00:00:00.000Z'").run();
      t.db.prepare("UPDATE shows SET created_at = '2020-01-01T00:00:00.000Z'").run();
      assert.equal((await u.post('/api/songs', soloBody({ title: 'Three', showName: 'Cap Show' }))).status, 201);
      assert.equal((await u.post('/api/shows', { name: 'Second Show' })).status, 201);
      const admin = await signupAdmin(t.app, t.db);
      for (let i = 0; i < 4; i++) assert.equal((await admin.post('/api/songs', soloBody({ title: `Admin ${i}`, showName: `Admin Show ${i}` }))).status, 201);
    } finally {
      t.cleanup();
    }
  });
});

/** Bulk-insert `n` community songs (fast, straight into the DB). */
function bulkSongs(db, showId, n, { subGenre = 'Longing', range = 'Soprano' } = {}) {
  const ins = db.prepare("INSERT INTO songs (kind, title, show_id, genre, sub_genre, length_seconds, source) VALUES ('solo', ?, ?, 'Drama', ?, 200, 'community')");
  const part = db.prepare("INSERT INTO song_parts (song_id, position, character, vocal_range) VALUES (?, 1, 'X', ?)");
  db.transaction(() => {
    for (let i = 0; i < n; i++) part.run(Number(ins.run(`Junk ${String(i).padStart(5, '0')}`, showId, subGenre).lastInsertRowid), range);
  })();
}

describe('catalogue endpoints stay cheap with many songs', () => {
  // The previous implementation (kept here as the reference): score every song in JS.
  function referenceSimilar(db, song, max = 6) {
    const { songs } = listSongs(db, {});
    const ranges = new Set(song.parts.map((p) => p.vocalRange).filter(Boolean));
    const sub = song.subGenre ? fold(song.subGenre) : null;
    const scored = [];
    for (const s of songs) {
      if (s.id === song.id) continue;
      const sameSub = sub !== null && s.subGenre !== null && fold(s.subGenre) === sub;
      const overlap = s.parts.some((p) => p.vocalRange && ranges.has(p.vocalRange));
      if (!sameSub && !overlap) continue;
      let score = 0;
      if (s.kind === song.kind) score += 4;
      if (sameSub) score += 3;
      if (overlap) score += 2;
      if (song.genre && s.genre && fold(song.genre) === fold(s.genre)) score += 1;
      if (s.show.id !== song.show.id) score += 0.5;
      scored.push({ s, score });
    }
    scored.sort((a, b) => b.score - a.score || fold(a.s.title).localeCompare(fold(b.s.title)) || a.s.id - b.s.id);
    return scored.slice(0, max).map((x) => x.s.id);
  }

  test('similar songs (scored in SQL) match the old in-memory ranking', async () => {
    const t = makeTestApp();
    try {
      const ids = seedFixture(t.db);
      const extra = insertShow(t.db, 'Extra Show');
      insertSong(t.db, { title: 'Alpha', showId: extra, genre: 'Drama', subGenre: 'Longing', parts: [['A', 'Tenor']] });
      insertSong(t.db, { kind: 'duet', title: 'Beta', showId: extra, genre: 'Comedy', subGenre: 'Slapstick', parts: [['B', 'Soprano'], ['C', 'Bass']] });
      insertSong(t.db, { title: 'Gamma', showId: extra, genre: null, subGenre: null, parts: [['D', 'Baritone']] });
      for (const id of Object.values(ids).filter((v) => typeof v === 'number')) {
        const res = await request(t.app).get(`/api/songs/${id}`);
        if (res.status !== 200) continue; // show ids share the object
        assert.deepEqual(res.body.similar.map((s) => s.id), referenceSimilar(t.db, res.body), res.body.title);
      }
    } finally {
      t.cleanup();
    }
  });

  test('stats (GROUP BY) match a count over every song, and follow changes — including other processes', async () => {
    const t = makeTestApp();
    try {
      const ids = seedFixture(t.db);
      bulkSongs(t.db, ids.shrek, 30, { subGenre: 'Hopeful', range: 'Alto' });
      const s1 = (await request(t.app).get('/api/stats')).body;
      const { songs } = listSongs(t.db, {});
      assert.equal(s1.total, songs.length);
      assert.equal(s1.byRange.find((r) => r.label === 'Alto').count, songs.filter((s) => s.parts.some((p) => p.vocalRange === 'Alto')).length);
      assert.equal(s1.bySubGenre.find((r) => r.label === 'Hopeful').count, 30);
      assert.equal(s1.byShow.find((r) => r.label === 'Shrek').count, 31);
      assert.equal(s1.withPreview, songs.filter((s) => s.media.previewUrl).length);
      assert.equal(s1.lengthBuckets.reduce((a, b) => a + b.count, 0), songs.length);
      // a change through the API invalidates the cache…
      const u = await signup(t.app);
      await u.post('/api/songs', soloBody({ title: 'Fresh', showName: 'Fresh Show' }));
      assert.equal((await request(t.app).get('/api/stats')).body.total, songs.length + 1);
      // …and so does a write by another process (e.g. npm run import)
      const other = new Database(path.join(t.dir, 'test.db'));
      other.prepare("DELETE FROM songs WHERE title LIKE 'Junk%'").run();
      other.close();
      assert.equal((await request(t.app).get('/api/stats')).body.total, songs.length + 1 - 30);
      const list = await request(t.app).get('/api/songs');
      assert.equal(list.body.total, songs.length + 1 - 30, 'the cached song list follows too');
      assert.equal(list.body.songs.length, list.body.total);
    } finally {
      t.cleanup();
    }
  });

  test('GET /api/songs returns at most 5000 songs per request (total still counts all)', async () => {
    const t = makeTestApp();
    try {
      const show = insertShow(t.db, 'Big Show');
      bulkSongs(t.db, show, 5003);
      const res = await request(t.app).get('/api/songs');
      assert.equal(res.body.total, 5003);
      assert.equal(res.body.songs.length, 5000);
      const page = await request(t.app).get('/api/songs?limit=10&offset=5000');
      assert.equal(page.body.songs.length, 3);
      assert.equal((await request(t.app).get('/api/songs?limit=5001')).status, 400);
    } finally {
      t.cleanup();
    }
  });

  test('with 20,000 junk songs, a song page and the stats still answer quickly', async () => {
    const t = makeTestApp();
    try {
      const ids = seedFixture(t.db);
      bulkSongs(t.db, ids.lesMis, 20_000);
      const timed = async (url) => {
        const t0 = performance.now();
        const res = await request(t.app).get(url);
        assert.equal(res.status, 200, url);
        return performance.now() - t0;
      };
      await timed(`/api/songs/${ids.onMyOwn}`); // warm up
      // The old code took 0.45–2.8 s for each of these (it loaded every song per request).
      assert.ok(await timed(`/api/songs/${ids.onMyOwn}`) < 400, 'song detail');
      await timed('/api/stats');
      assert.ok(await timed('/api/stats') < 50, 'stats come from the cache');
    } finally {
      t.cleanup();
    }
  });
});

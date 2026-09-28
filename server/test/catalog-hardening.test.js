// /api/catalog hardening regressions (review findings on SPEC §7c): cast-album saves need a login
// and can be undone by admins; one site-wide Apple budget; show pages never 429; search limits;
// same-named catalog shows (links, cast albums); duplicates by catalog song; link choices that stick.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import {
  makeTestApp, signup, signupAdmin, insertShow, insertSong, jsonResponse, soloBody, CSRF, noNetwork,
} from './helpers.js';
import { relinkSiteRows } from '../src/lib/catalog.js';
import { createRateBudget, budgetedFetch, AppleBusyError } from '../src/lib/apple-budget.js';
import { CAST_ALBUM_MAX_TRACKS } from '../src/lib/catalog-recordings.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const song = (title, singers = [], extra = {}) => ({ title, singers, singersRaw: singers.join(', '), ensemble: false, reprise: false, instrumental: false, ...extra });

/** A catalog built for these tests (written to a temp .json.gz). */
function writeTestCatalog() {
  const shows = [
    { key: 'Q-parade-1960', title: 'Parade', year: 1960, composer: 'Jerry Herman', songs: [song('Show Tune'), song('Your Hand in Mine')] },
    { key: 'Q-parade-1998', title: 'Parade', year: 1998, composer: 'Jason Robert Brown', songs: [song('This Is Not Over Yet', ['Leo Frank', 'Lucille Frank']), song('All the Wasted Time', ['Leo Frank', 'Lucille Frank'])] },
    { key: 'Q-phantom-1976', title: 'The Phantom of the Opera', year: 1976, composer: 'Ken Hill', songs: [song('Ah! Je veux vivre')] },
    { key: 'Q-phantom-1986', title: 'The Phantom of the Opera', year: 1986, composer: 'Andrew Lloyd Webber', songs: [song('Think of Me', ['Christine Daaé']), song('The Music of the Night', ['The Phantom'])] },
    { key: 'Q-monte-2009', title: 'The Count of Monte Cristo', year: 2009, composer: 'Frank Wildhorn', songs: [song('Hell to Your Doorstep', ['Edmond Dantès'])] },
    { key: 'Q-monte-2010', title: 'The Count of Monte Cristo', year: 2010, composer: 'James Behr', songs: [] },
    { key: 'Q-chaplin-1993', title: 'Chaplin', year: 1993, composer: 'Anthony Newley', songs: [] },
    { key: 'Q-chaplin-2006', title: 'Chaplin', altTitles: ['Chaplin: The Musical'], year: 2006, composer: 'Christopher Curtis', songs: [song('Look at All the People')] },
    { key: 'Q-hll-2006', title: 'Here Lies Love', year: 2006, composer: 'David Byrne with Norman Cook', songs: [] },
    { key: 'Q-hll-2013', title: 'Here Lies Love', year: 2013, composer: 'David Byrne, Fatboy Slim', songs: [song('American Troglodyte')] },
    {
      key: 'Q-lesmis', title: 'Les Misérables', year: 1980, songs: [
        song("Valjean's Soliloquy (What Have I Done?)", ['Jean Valjean']), song('The Sewers/Dog Eats Dog', ['Thénardier']), song('Stars', ['Javert']),
      ],
    },
    ...Array.from({ length: 12 }, (_, i) => ({ key: `Q-songless-${i}`, title: `Songless Show ${i}`, songs: [] })),
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-cat-hard-'));
  const file = path.join(dir, 'catalog.json.gz');
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ version: 'hardening.1', generatedAt: '2026-09-27T00:00:00Z', shows })));
  return { dir, file };
}

const PREVIEW = (id) => `https://audio-ssl.itunes.apple.com/itunes-assets/x/${id}.m4a`;
function track(trackId, trackName, collectionId, collectionName, extra = {}) {
  return {
    wrapperType: 'track', kind: 'song', trackId, trackName, collectionId, collectionName, artistName: extra.artistName ?? 'Original Cast',
    previewUrl: PREVIEW(trackId), artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/Music/${collectionId}/100x100bb.jpg`,
    trackViewUrl: `https://music.apple.com/ca/album/x/${collectionId}?i=${trackId}`, trackTimeMillis: 200_000, trackNumber: extra.n ?? 1, discNumber: 1, ...extra,
  };
}
const album = (collectionId, collectionName, extra = {}) => ({
  wrapperType: 'collection', collectionId, collectionName, artistName: 'Original Cast', trackCount: 20, releaseDate: '2017-03-10T08:00:00Z', ...extra,
});

/** Fake iTunes: albums/songs by search-term substring, tracks by collection id; counts calls. */
function fakeApple() {
  const state = { down: false, calls: [], albums: {}, songs: {}, tracks: {} };
  const impl = async (url) => {
    const u = new URL(String(url));
    if (u.hostname !== 'itunes.apple.com') throw new Error(`unexpected host ${u.hostname}`);
    state.calls.push(u.toString());
    if (state.down) return jsonResponse({ error: 'down' }, { status: 503 });
    const term = (u.searchParams.get('term') ?? '').toLowerCase();
    const pick = (table) => Object.entries(table).filter(([k]) => term.includes(k)).flatMap(([, v]) => v);
    if (u.pathname === '/search' && u.searchParams.get('entity') === 'album') return jsonResponse({ results: pick(state.albums) });
    if (u.pathname === '/search') return jsonResponse({ results: pick(state.songs) });
    if (u.pathname === '/lookup') return jsonResponse({ results: [{ wrapperType: 'collection' }, ...(state.tracks[u.searchParams.get('id')] ?? [])] });
    return jsonResponse({ results: [] });
  };
  return { state, impl };
}

describe('saving cast-album tracks needs a login, is capped and moderated', () => {
  let t;
  let cat;
  let apple;
  let alice;
  let admin;
  const url = (key) => `/api/catalog/shows/${cat.id(key)}/recording-tracks`;
  before(async () => {
    cat = writeTestCatalog();
    apple = fakeApple();
    const junk = Array.from({ length: 150 }, (_, i) => track(1000 + i, `Junk Track ${i} <b>x</b>`, 999, 'Songless Show 0 (Original Cast Recording)', { n: i + 1 }));
    apple.state.albums['songless show 0'] = [album(999, 'Songless Show 0 (Original Cast Recording)')];
    apple.state.tracks['999'] = junk;
    apple.state.albums['songless show 1'] = [album(801, 'Songless Show 1 (Original Cast Recording)', { collectionExplicitness: 'explicit' }),
      album(802, 'Songless Show 1 (Original Cast Recording) [Clean]', { collectionExplicitness: 'cleaned' })];
    apple.state.tracks['802'] = [track(1, 'Clean Song', 802, 'x'), track(2, 'Rude Song', 802, 'x', { trackExplicitness: 'explicit' })];
    apple.state.albums['songless show 2'] = [album(701, 'Songless Show 2 (Original Cast Recording)'), album(702, 'Songless Show 2 (Original London Cast Recording)')];
    apple.state.tracks['701'] = [track(11, 'Wrong Album Song', 701, 'x')];
    apple.state.tracks['702'] = [track(12, 'Right Album Song', 702, 'x')];
    t = makeTestApp({ catalogPath: cat.file, fetchImpl: apple.impl });
    cat.id = (key) => t.db.prepare('SELECT id FROM catalog_shows WHERE key = ?').get(key).id;
    alice = await signup(t.app, { displayName: 'Alice' });
    admin = await signupAdmin(t.app, t.db);
  });
  after(() => {
    t.cleanup();
    fs.rmSync(cat.dir, { recursive: true, force: true });
  });

  test('logged out, or a cross-site request: a preview that writes nothing; a logged-in POST saves (≤ 60 tracks), is logged and can be searched', async () => {
    const lines = [];
    t.app.locals.ctx.log.info = (m) => lines.push(m);
    const anon = await request(t.app).get(url('Q-songless-0')).set('Sec-Fetch-Site', 'cross-site').set('Origin', 'https://evil.example');
    assert.equal(anon.status, 200);
    assert.equal(anon.body.saved, false);
    assert.equal(anon.body.songs.length, CAST_ALBUM_MAX_TRACKS);
    assert.ok(anon.body.songs.every((s) => s.id === null));
    assert.equal(anon.body.songs[0].title, 'Junk Track 0 <b>x</b>', 'plain text (the client never renders it as HTML)');
    // a logged-in user's browser following a link / <img> from another site: still only a preview
    const crossSite = await alice.agent.get(url('Q-songless-0')).set('Sec-Fetch-Site', 'cross-site');
    assert.equal(crossSite.body.saved, false);
    const count = () => t.db.prepare("SELECT count(*) AS n FROM catalog_songs WHERE source = 'recording'").get().n;
    assert.equal(count(), 0);
    assert.equal(t.db.prepare('SELECT itunes_collection_id AS c FROM catalog_shows WHERE id = ?').get(cat.id('Q-songless-0')).c, null);
    assert.equal((await request(t.app).get('/api/catalog/search?q=junk%20track')).body.results.length, 0);
    // the song form's POST saves them for everyone
    const saved = await alice.post(url('Q-songless-0'));
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.added, CAST_ALBUM_MAX_TRACKS);
    assert.equal(count(), CAST_ALBUM_MAX_TRACKS);
    assert.match(lines.join('\n'), new RegExp(`user #${alice.user.id} saved 60 cast-album song\\(s\\) for catalog show #${cat.id('Q-songless-0')}`));
    assert.ok((await request(t.app).get('/api/catalog/search?q=junk%20track')).body.results.length > 0, 'search sees the new songs at once');
  });

  test('a same-site GET from a logged-in user still saves (compatibility with clients from before the POST)', async () => {
    const res = await alice.agent.get(url('Q-songless-2')).set('Sec-Fetch-Site', 'same-origin');
    assert.equal(res.body.saved, true);
    assert.equal(res.body.album.collectionId, 701);
  });

  test('explicit albums and explicit tracks are never saved', async () => {
    const res = await alice.post(url('Q-songless-1'));
    assert.equal(res.body.album.collectionId, 802, 'the clean edition');
    assert.deepEqual(res.body.songs.map((s) => s.title), ['Clean Song']);
  });

  test('admins list what was saved and remove it; the album is never picked for that show again', async () => {
    const list = await admin.get('/api/admin/catalog/recordings');
    assert.equal(list.status, 200);
    const row = list.body.shows.find((s) => s.id === cat.id('Q-songless-2'));
    assert.deepEqual({ ...row, savedAt: typeof row.savedAt }, {
      id: cat.id('Q-songless-2'), key: 'Q-songless-2', title: 'Songless Show 2', year: null,
      castAlbum: { collectionId: 701, collectionName: 'Songless Show 2 (Original Cast Recording)' },
      recordingSongs: 1, savedAt: 'string', savedBy: { id: alice.user.id, displayName: 'Alice' }, retired: false,
    });
    assert.equal((await alice.get('/api/admin/catalog/recordings')).status, 403);
    assert.equal((await alice.del(`/api/admin/catalog/shows/${cat.id('Q-songless-2')}/recording`)).status, 403);
    assert.equal((await admin.agent.delete(`/api/admin/catalog/shows/${cat.id('Q-songless-2')}/recording`)).status, 403, 'CSRF header required');
    const del = await admin.del(`/api/admin/catalog/shows/${cat.id('Q-songless-2')}/recording`);
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal(del.body.removedSongs, 1);
    assert.equal(del.body.rejectedCollectionId, 701);
    assert.equal(del.body.show.castAlbum, null);
    assert.equal((await request(t.app).get('/api/catalog/search?q=wrong%20album')).body.results.length, 0);
    assert.equal((await admin.del('/api/admin/catalog/shows/999999/recording')).status, 404);
    // next time the other album is used (also while the first one is still in the server's memory cache)
    const again = await alice.post(url('Q-songless-2'));
    assert.equal(again.body.album.collectionId, 702);
    assert.deepEqual(again.body.songs.map((s) => s.title), ['Right Album Song']);
  });

  test('npm run catalog:clear-recording does the same from the command line', () => {
    const dbFile = path.join(t.dir, 'cli.db');
    t.db.prepare('VACUUM INTO ?').run(dbFile);
    const run = (...args) => spawnSync(process.execPath, ['scripts/catalog-clear-recording.js', ...args], {
      cwd: SERVER_DIR, env: { ...process.env, STAR_DB_PATH: dbFile }, encoding: 'utf8',
    });
    const listed = run('--list');
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /Q-songless-0 “Songless Show 0”: 60 cast-album song\(s\), album 999/);
    const cleared = run('Q-songless-0');
    assert.equal(cleared.status, 0, cleared.stderr);
    assert.match(cleared.stdout, /removed 60 cast-album song\(s\) and album 999 \(never picked for this show again\)/);
    assert.equal(run('Q-nope').status, 1);
  });
});

describe('Apple: one budget for the whole site; show pages never answer 429', () => {
  test('budgetedFetch spends tokens only on Apple API calls and fails fast when they are gone', async () => {
    let now = 0;
    const budget = createRateBudget({ perMinute: 3, burst: 3, maxWaitMs: 0, now: () => now });
    const seen = [];
    const f = budgetedFetch(async (u) => { seen.push(String(u)); return jsonResponse({}); }, budget);
    for (let i = 0; i < 3; i++) await f('https://itunes.apple.com/search?term=x');
    await assert.rejects(f('https://itunes.apple.com/lookup?id=1'), (e) => e instanceof AppleBusyError && e.retryAfterSeconds >= 1);
    await f('https://is1-ssl.mzstatic.com/image/x.jpg'); // art/previews are a CDN, not the API
    now += 20_000; // one token back
    await f('https://itunes.apple.com/search?term=y');
    assert.equal(seen.length, 5);
  });

  test('many visitors opening songless show pages: Apple calls stay within the budget, pages answer 200 with "couldn\'t check"', async () => {
    const cat = writeTestCatalog();
    const apple = fakeApple();
    const t = makeTestApp({ catalogPath: cat.file, fetchImpl: apple.impl, env: { STAR_APPLE_LIMIT: '6', STAR_LOOKUP_LIMIT: '1000' } });
    try {
      const ids = t.db.prepare("SELECT id FROM catalog_shows WHERE key LIKE 'Q-songless-%' ORDER BY id").all().map((r) => r.id);
      const answers = [];
      for (const id of ids) {
        const res = await request(t.app).get(`/api/catalog/shows/${id}`);
        assert.equal(res.status, 200);
        answers.push(res.body.recordingTracksAvailable);
      }
      assert.ok(apple.state.calls.length <= 6, `${apple.state.calls.length} Apple calls`);
      assert.ok(apple.state.calls.every((u) => /country=CA/.test(u)), 'show pages ask the CA store only');
      assert.ok(answers.includes(false) && answers.includes(null), JSON.stringify(answers));
      // a miss is kept in the database: no more Apple calls for it, even after the memory cache is gone
      const checked = t.db.prepare('SELECT id FROM catalog_shows WHERE itunes_check_found = 0').all().map((r) => r.id);
      assert.ok(checked.length >= 1);
      t.app.locals.ctx.cache.map.clear();
      const before = apple.state.calls.length;
      assert.equal((await request(t.app).get(`/api/catalog/shows/${checked[0]}`)).body.recordingTracksAvailable, false);
      assert.equal(apple.state.calls.length, before);
      // the lookup endpoints answer 503 + Retry-After while the budget is spent
      const rec = await request(t.app).get(`/api/catalog/songs/${t.db.prepare("SELECT id FROM catalog_songs WHERE title = 'Stars'").get().id}/recordings`);
      assert.equal(rec.status, 503, JSON.stringify(rec.body));
      assert.ok(Number(rec.headers['retry-after']) >= 1);
      const lookup = await request(t.app).get('/api/lookup/itunes?title=Stars&show=Les%20Mis');
      assert.equal(lookup.status, 503);
      assert.match(lookup.body.error, /busy/);
    } finally {
      t.cleanup();
      fs.rmSync(cat.dir, { recursive: true, force: true });
    }
  });

  test('past the per-visitor lookup limit a show page is still 200 (recordingTracksAvailable: null); Apple failures are not retried at once', async () => {
    const cat = writeTestCatalog();
    const apple = fakeApple();
    const t = makeTestApp({ catalogPath: cat.file, fetchImpl: apple.impl, env: { STAR_LOOKUP_LIMIT: '2' } });
    try {
      const ids = t.db.prepare("SELECT id FROM catalog_shows WHERE key LIKE 'Q-songless-%' ORDER BY id").all().map((r) => r.id);
      const res = [];
      for (const id of ids.slice(0, 4)) res.push(await request(t.app).get(`/api/catalog/shows/${id}`));
      assert.deepEqual(res.map((r) => r.status), [200, 200, 200, 200]);
      assert.deepEqual(res.map((r) => r.body.recordingTracksAvailable), [false, false, null, null]);
      apple.state.down = true;
      const t2calls = apple.state.calls.length;
      const other = makeTestApp({ catalogPath: cat.file, fetchImpl: apple.impl });
      try {
        const id = other.db.prepare("SELECT id FROM catalog_shows WHERE key = 'Q-songless-5'").get().id;
        for (let i = 0; i < 5; i++) assert.equal((await request(other.app).get(`/api/catalog/shows/${id}`)).body.recordingTracksAvailable, null);
        const used = apple.state.calls.length - t2calls;
        assert.ok(used <= 2, `${used} Apple calls for 5 views of a show while Apple is down`);
      } finally {
        other.cleanup();
      }
    } finally {
      t.cleanup();
      fs.rmSync(cat.dir, { recursive: true, force: true });
    }
  });
});

describe('same-named catalog shows', () => {
  let t;
  let cat;
  let apple;
  let alice;
  let bob;
  let admin;
  before(async () => {
    cat = writeTestCatalog();
    apple = fakeApple();
    // Wildhorn's 2009 album (Vienna) must not become the 2010 Behr show's; "Chaplin: The Musical" is the 2006 show's
    apple.state.albums['count of monte cristo'] = [album(1339774654, 'The Count of Monte Cristo - Der Graf Von Monte Christo (Original Vienna Cast)', { releaseDate: '2009-11-06T08:00:00Z' })];
    apple.state.albums.chaplin = [album(555, 'Chaplin: The Musical (Original Broadway Cast Recording)', { releaseDate: '2012-12-04T08:00:00Z' })];
    apple.state.albums['here lies love'] = [album(843829390, 'Here Lies Love (Original Cast Recording)', { artistName: 'David Byrne & Fatboy Slim', releaseDate: '2014-04-01T07:00:00Z' })];
    t = makeTestApp({ catalogPath: cat.file, fetchImpl: apple.impl });
    cat.id = (key) => t.db.prepare('SELECT id FROM catalog_shows WHERE key = ?').get(key).id;
    cat.song = (title) => t.db.prepare('SELECT id FROM catalog_songs WHERE title = ?').get(title).id;
    alice = await signup(t.app);
    bob = await signup(t.app);
    admin = await signupAdmin(t.app, t.db);
  });
  after(() => {
    t.cleanup();
    fs.rmSync(cat.dir, { recursive: true, force: true });
  });

  test('another show\'s cast album is never offered or saved for a songless namesake', async () => {
    const behr = await request(t.app).get(`/api/catalog/shows/${cat.id('Q-monte-2010')}`);
    assert.equal(behr.body.recordingTracksAvailable, false);
    const saved = await alice.post(`/api/catalog/shows/${cat.id('Q-monte-2010')}/recording-tracks`);
    assert.deepEqual([saved.body.album, saved.body.added], [null, 0]);
    const chaplin = await alice.post(`/api/catalog/shows/${cat.id('Q-chaplin-1993')}/recording-tracks`);
    assert.equal(chaplin.body.album, null, '"Chaplin: The Musical" is the other Chaplin');
    assert.equal(t.db.prepare('SELECT itunes_collection_id AS c FROM catalog_shows WHERE id = ?').get(cat.id('Q-chaplin-1993')).c, null);
    // both "Here Lies Love"s are David Byrne's: his name can't tell them apart, the 2014 release date does
    assert.equal((await request(t.app).get(`/api/catalog/shows/${cat.id('Q-hll-2006')}`)).body.recordingTracksAvailable, false);
    assert.equal((await alice.post(`/api/catalog/shows/${cat.id('Q-hll-2006')}/recording-tracks`)).body.album, null);
  });

  test('a show made by name only isn\'t tied to the oldest namesake; a song from either one can be added; its owner\'s pick links it', async () => {
    const think = await alice.post('/api/songs', soloBody({ title: 'Think of Me', showName: 'The Phantom of the Opera', parts: [{ character: 'Christine', vocalRange: 'Soprano' }] }));
    assert.equal(think.status, 201, JSON.stringify(think.body));
    const show = (await request(t.app).get(`/api/shows/${think.body.show.slug}`)).body;
    assert.equal(show.catalogShowId, cat.id('Q-phantom-1986'), 'its song "Think of Me" is only in the 1986 list');
    const night = await bob.post('/api/songs', soloBody({
      title: 'The Music of the Night', showId: show.id, showName: undefined, catalogSongId: cat.song('The Music of the Night'), parts: [{ character: 'The Phantom', vocalRange: 'Baritone' }],
    }));
    assert.equal(night.status, 201, JSON.stringify(night.body));
    // Parade: an unlinked show; Bob (not its owner) picking the 1960 song doesn't choose for everyone
    const parade = await alice.post('/api/shows', { name: 'Parade' });
    assert.equal(parade.body.catalogShowId, null, 'two Parades: no automatic link');
    const bobs = await bob.post('/api/songs', soloBody({
      title: 'Show Tune', showId: parade.body.id, showName: undefined, catalogSongId: cat.song('Show Tune'), parts: [{ character: 'Lead', vocalRange: 'Tenor' }],
    }));
    assert.equal(bobs.status, 201, JSON.stringify(bobs.body));
    assert.equal(bobs.body.catalogSongId, cat.song('Show Tune'), 'his song keeps its own link');
    const linkOf = (id) => ({ ...t.db.prepare('SELECT catalog_show_id AS c, catalog_link AS l FROM shows WHERE id = ?').get(id) });
    assert.equal(linkOf(parade.body.id).l, null, 'no "manual" link from someone who can\'t edit the show');
    // the owner picks from the 1998 Parade: her choice, it sticks
    const alices = await alice.post('/api/songs', soloBody({
      title: 'This Is Not Over Yet', kind: 'duet', showId: parade.body.id, showName: undefined, catalogSongId: cat.song('This Is Not Over Yet'),
      parts: [{ character: 'Leo', vocalRange: 'Tenor' }, { character: 'Lucille', vocalRange: 'Soprano' }],
    }));
    assert.equal(alices.status, 201, JSON.stringify(alices.body));
    assert.deepEqual(linkOf(parade.body.id), { c: cat.id('Q-parade-1998'), l: 'manual' });
    relinkSiteRows(t.db);
    assert.deepEqual(linkOf(parade.body.id), { c: cat.id('Q-parade-1998'), l: 'manual' });
    assert.equal(t.db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(bobs.body.id).c, cat.song('Show Tune'), 'a same-named catalog song picked on the form stays');
  });

  test('PUT /api/shows catalogShowId: owners pick a same-named show, admins any; null = not in the catalog; "auto" = back to matching', async () => {
    const show = await alice.post('/api/shows', { name: 'Parade Two', year: 1998 });
    const s = show.body;
    assert.equal((await alice.put(`/api/shows/${s.id}`, { catalogShowId: cat.id('Q-parade-1998') })).status, 400, 'names differ');
    assert.equal((await bob.put(`/api/shows/${s.id}`, { catalogShowId: null })).status, 403);
    const byAdmin = await admin.put(`/api/shows/${s.id}`, { catalogShowId: cat.id('Q-parade-1998') });
    assert.equal(byAdmin.status, 200, JSON.stringify(byAdmin.body));
    assert.equal(byAdmin.body.catalogShowId, cat.id('Q-parade-1998'));
    assert.equal(byAdmin.body.updatedAt, s.updatedAt, 'the link is bookkeeping, not an edit');
    const none = await alice.put(`/api/shows/${s.id}`, { catalogShowId: null });
    assert.equal(none.body.catalogShowId, null);
    relinkSiteRows(t.db);
    assert.equal(t.db.prepare('SELECT catalog_show_id AS c FROM shows WHERE id = ?').get(s.id).c, null, '"not in the catalog" sticks');
    assert.equal((await alice.put(`/api/shows/${s.id}`, { catalogShowId: 424242 })).status, 400);
    const renamed = await alice.put(`/api/shows/${s.id}`, { name: 'Parade', catalogShowId: 'auto' });
    assert.equal(renamed.status, 409, 'a show called Parade exists');
    const auto = await alice.put(`/api/shows/${s.id}`, { name: 'Parade (1998 revival)', catalogShowId: 'auto' });
    assert.equal(auto.status, 200);
    assert.equal(auto.body.catalogShowId, null);
  });

  test('true duplicates are refused whatever the title says: the same catalog song, or the same title up to punctuation', async () => {
    const lesMis = insertShow(t.db, 'Les Misérables');
    const what = insertSong(t.db, { title: 'What Have I Done?', showId: lesMis, parts: [['Jean Valjean', 'Baritone']] });
    relinkSiteRows(t.db);
    const soliloquy = cat.song("Valjean's Soliloquy (What Have I Done?)");
    assert.equal(t.db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(what).c, soliloquy);
    const body = (over) => soloBody({ showId: lesMis, showName: undefined, parts: [{ character: 'Valjean', vocalRange: 'Baritone' }], ...over });
    const viaCatalog = await alice.post('/api/songs', body({ title: "Valjean's Soliloquy (What Have I Done?)", catalogSongId: soliloquy }));
    assert.equal(viaCatalog.status, 409, JSON.stringify(viaCatalog.body));
    assert.equal(viaCatalog.body.existingId, what);
    const punct = await alice.post('/api/songs', body({ title: 'What have I done' }));
    assert.equal(punct.status, 409);
    const duet = await alice.post('/api/songs', body({
      kind: 'duet', title: "Valjean's Soliloquy (What Have I Done?)", catalogSongId: soliloquy,
      parts: [{ character: 'Valjean', vocalRange: 'Baritone' }, { character: 'Bishop', vocalRange: 'Bass' }],
    }));
    assert.equal(duet.status, 201, 'another kind of the same song is fine');
    // "Dog Eats Dog" on the site is "The Sewers/Dog Eats Dog" in the catalog
    const dog = insertSong(t.db, { title: 'Dog Eats Dog', showId: lesMis, parts: [['Thénardier', 'Baritone']] });
    relinkSiteRows(t.db);
    const sewers = cat.song('The Sewers/Dog Eats Dog');
    assert.equal(t.db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(dog).c, sewers);
    const sug = (await request(t.app).get(`/api/catalog/songs/${sewers}/suggestions`)).body;
    assert.deepEqual(sug.existingSong, { id: dog, title: 'Dog Eats Dog', kind: 'solo' });
    assert.equal((await alice.post('/api/songs', body({ title: 'The Sewers/Dog Eats Dog', catalogSongId: sewers }))).status, 409);
  });

  test('moving a song to an unlinked show drops a link into another show; "not from the catalog" sticks; moving with null re-matches', async () => {
    const res = await alice.post('/api/songs', soloBody({ title: 'Stars', showName: 'Les Misérables', parts: [{ character: 'Javert', vocalRange: 'Baritone' }], kind: 'solo' }));
    // (Les Misérables exists from the test above; a solo "Stars" isn't there yet)
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.catalogSongId, cat.song('Stars'));
    const base = soloBody({ title: 'Stars', parts: [{ character: 'Javert', vocalRange: 'Baritone' }] });
    const moved = await alice.put(`/api/songs/${res.body.id}`, { ...base, showName: 'My Totally Original Show 77' });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.catalogSongId, null, 'no link into Les Misérables from an unrelated show');
    const back = await alice.put(`/api/songs/${res.body.id}`, { ...base, showName: 'Les Misérables', catalogSongId: null });
    assert.equal(back.body.catalogSongId, cat.song('Stars'), 'null while changing show only drops the old link: matched again by title');
    const unlinked = await alice.put(`/api/songs/${res.body.id}`, { ...base, showName: 'Les Misérables', catalogSongId: null });
    assert.equal(unlinked.body.catalogSongId, null, 'null without a move = "not from the catalog"');
    relinkSiteRows(t.db);
    assert.equal(t.db.prepare('SELECT catalog_song_id AS c FROM songs WHERE id = ?').get(res.body.id).c, null, '… also after a re-link (restart)');
  });
});

describe('catalog search has its own rate limit', () => {
  test('STAR_SEARCH_LIMIT per user/IP → 429; one-letter-only queries find nothing', async () => {
    const cat = writeTestCatalog();
    const t = makeTestApp({ catalogPath: cat.file, fetchImpl: noNetwork, env: { STAR_SEARCH_LIMIT: '3' } });
    try {
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await request(t.app).get('/api/catalog/search?q=parade')).status);
      assert.deepEqual(codes, [200, 200, 200, 429]);
      assert.equal((await request(t.app).get('/api/catalog')).status, 200, 'other catalog reads are not affected');
    } finally {
      t.cleanup();
    }
    const t2 = makeTestApp({ catalogPath: cat.file, fetchImpl: noNetwork });
    try {
      for (const q of ['s t', 'a a', 'a e i o u s t m']) assert.deepEqual((await request(t2.app).get(`/api/catalog/search?q=${encodeURIComponent(q)}`)).body, { results: [] });
      assert.equal((await request(t2.app).get('/api/catalog/search?q=parade%20s')).body.results[0].title, 'Show Tune', 'a one-letter word still filters');
      // a cached search still sees what's on the site now
      const first = (await request(t2.app).get('/api/catalog/search?q=show%20tune')).body.results[0];
      assert.equal(first.onSite, null);
      const site = insertShow(t2.db, 'Parade', { composer: 'Jerry Herman' });
      insertSong(t2.db, { title: 'Show Tune', showId: site });
      relinkSiteRows(t2.db);
      const again = (await request(t2.app).get('/api/catalog/search?q=show%20tune')).body.results[0];
      assert.ok(again.onSite?.songId);
    } finally {
      t2.cleanup();
      fs.rmSync(cat.dir, { recursive: true, force: true });
    }
  });
});

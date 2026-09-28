// /api/catalog (SPEC §7c): search, show detail, cast-album tracks, suggestions, recordings; and the
// song form's catalogSongId / catalogShowId. Apple is a fake fetch — tests never hit the network.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  makeTestApp, signup, signupAdmin, insertShow, insertSong, jsonResponse, soloBody, CATALOG_FIXTURE, CSRF,
} from './helpers.js';
import { relinkSiteRows } from '../src/lib/catalog.js';

// ---- fake iTunes Search / Lookup API ----
const PREVIEW = (id) => `https://audio-ssl.itunes.apple.com/itunes-assets/x/${id}.m4a`;
const ART = (id) => `https://is1-ssl.mzstatic.com/image/thumb/Music/${id}/100x100bb.jpg`;
function track(trackId, trackName, collectionId, collectionName, extra = {}) {
  return {
    wrapperType: 'track', kind: 'song', trackId, trackName, collectionId, collectionName, artistName: extra.artistName ?? 'Original Cast',
    previewUrl: PREVIEW(trackId), artworkUrl100: ART(collectionId), trackViewUrl: `https://music.apple.com/ca/album/x/${collectionId}?i=${trackId}`,
    trackTimeMillis: extra.ms ?? 201_000, trackNumber: extra.n ?? 1, discNumber: 1, ...extra,
  };
}
const album = (collectionId, collectionName, artistName = 'Original Cast') => ({
  wrapperType: 'collection', collectionId, collectionName, artistName, trackCount: 20, releaseDate: '2017-03-10T08:00:00Z',
});
const CFA = 'Come From Away (Original Broadway Cast Recording)';
const LESMIS_LONDON = 'Les Misérables (Original London Cast Recording)';
const HADES = 'Hadestown (Original Broadway Cast Recording)';

function fakeApple() {
  const state = {
    down: false,
    calls: [],
    albums: { 'come from away': [album(900, CFA), album(901, 'Come From Away (Karaoke Instrumentals)')] },
    songs: {
      'bring him home': [
        track(3, 'Bring Him Home (Karaoke Version)', 700, 'Musical Karaoke Hits', { artistName: 'Karaoke Stars' }),
        track(2, 'Bring Him Home', 501, LESMIS_LONDON),
        track(4, 'Bring Him Home', 502, 'Les Misérables (Original Motion Picture Soundtrack)', { artistName: 'Hugh Jackman' }),
      ],
      flowers: [track(10, 'Flowers', 600, HADES, { artistName: 'Eva Noblezada' })],
    },
    tracks: {
      900: [
        track(90, 'Welcome to the Rock', 900, CFA, { n: 1 }), track(91, '38 Planes', 900, CFA, { n: 2 }),
        track(92, 'Me and the Sky', 900, CFA, { n: 3 }), track(93, 'Prayer', 900, CFA, { n: 4 }),
        track(94, 'Screech In (Original Broadway Cast Recording)', 900, CFA, { n: 5 }), track(95, 'Entr\'acte', 900, CFA, { n: 6 }),
        track(96, 'Me and the Sky', 900, CFA, { n: 7 }), track(97, 'Finale - Live', 900, CFA, { n: 8 }),
      ],
      500: [track(1, 'Bring Him Home', 500, 'Les Misérables (Original Broadway Cast)', { n: 20 }), track(5, 'Stars', 500, 'Les Misérables (Original Broadway Cast)', { n: 8 })],
    },
  };
  const impl = async (url) => {
    const u = new URL(String(url));
    state.calls.push(u.toString());
    if (state.down) throw new Error('offline');
    if (u.hostname !== 'itunes.apple.com') throw new Error(`unexpected host ${u.hostname}`);
    const term = (u.searchParams.get('term') ?? '').toLowerCase();
    const pick = (table) => Object.entries(table).filter(([k]) => term.includes(k)).flatMap(([, v]) => v);
    if (u.pathname === '/search' && u.searchParams.get('entity') === 'album') return jsonResponse({ results: pick(state.albums) });
    if (u.pathname === '/search') return jsonResponse({ results: pick(state.songs) });
    if (u.pathname === '/lookup') {
      const id = u.searchParams.get('id');
      return jsonResponse({ results: [{ wrapperType: 'collection', collectionId: Number(id) }, ...(state.tracks[id] ?? [])] });
    }
    return jsonResponse({ results: [] });
  };
  return { state, impl };
}

describe('catalog API', () => {
  let t;
  let apple;
  let alice;
  let bob;
  let admin;
  const ids = {};
  const cat = {};
  const get = (url) => request(t.app).get(url);
  const catSong = (show, title, reprise = 0) => t.db.prepare(`SELECT s.id FROM catalog_songs s JOIN catalog_shows sh ON sh.id = s.show_id
    WHERE sh.title = ? AND s.title = ? AND s.reprise = ?`).get(show, title, reprise).id;

  before(async () => {
    apple = fakeApple();
    t = makeTestApp({ catalogPath: CATALOG_FIXTURE, fetchImpl: apple.impl });
    const db = t.db;
    ids.lesMis = insertShow(db, 'Les Misérables', { composer: 'Claude-Michel Schönberg' });
    ids.hades = insertShow(db, 'Hadestown');
    const s = (title, showId, genre, subGenre, parts, extra = {}) => insertSong(db, {
      title, showId, genre, subGenre, parts, kind: parts.length === 2 ? 'duet' : 'solo', ...extra,
    });
    ids.bring = s('Bring Him Home', ids.lesMis, 'Drama', 'Longing', [['Valjean', 'Tenor']]);
    ids.what = s('What Have I Done?', ids.lesMis, 'Drama', 'Frustration', [['Valjean', 'Baritone']]);
    ids.who = s('Who Am I?', ids.lesMis, 'Drama', 'Conflict', [['Valjean', 'Baritone']]);
    ids.stars = s('Stars', ids.lesMis, 'Drama', 'Intimidating / Angry', [['Javert', 'Baritone']]);
    ids.suicide = s("Javert's Suicide", ids.lesMis, 'Drama', 'Reflective', [['Javert', 'Baritone']]);
    ids.onMyOwn = s('On My Own', ids.lesMis, 'Drama', 'Longing', [['Éponine', 'Mezzo-soprano']]);
    ids.rain = s('A Little Fall of Rain', ids.lesMis, 'Romantic', 'Longing', [['Éponine', 'Mezzo-soprano'], ['Marius', 'Baritone']], { mature: true });
    ids.castle = s('Castle on a Cloud', ids.lesMis, 'Drama', 'Longing', [['Young Cosette', 'Soprano']]);
    ids.little = s('Little People', ids.lesMis, 'Comedy', 'Confident', [['Gavroche', null]]);
    ids.flowers = s('Flowers', ids.hades, 'Drama', 'Longing', [['Eurydice', 'Mezzo-soprano']]);
    relinkSiteRows(db);
    for (const [k, title] of [['bring', 'Bring Him Home'], ['rain', 'A Little Fall of Rain'], ['heart', 'A Heart Full of Love'], ['master', 'Master of the House'],
      ['entr', "Entr'acte"], ['turning', 'Turning'], ['soliloquy', "Valjean's Soliloquy (What Have I Done?)"], ['enjolras', 'Do You Hear the People Sing?'],
      ['epilogue', 'Epilogue'], ['stars', 'Stars']]) cat[k] = catSong('Les Misérables', title);
    cat.waitReprise = catSong('Hadestown', 'Wait for Me', 1);
    cat.flowers = catSong('Hadestown', 'Flowers');
    cat.popular = catSong('Wicked', 'Popular');
    cat.diva = catSong('Spamalot', "The Diva's Lament (Whatever Happened to My Part?)");
    cat.cathy = catSong('The Last Five Years', 'Still Hurting');
    cat.show = Object.fromEntries(db.prepare('SELECT key, id FROM catalog_shows').all().map((r) => [r.key, r.id]));
    alice = await signup(t.app, { email: 'alice-secret@example.com', displayName: 'Alice' });
    bob = await signup(t.app, { email: 'bob-secret@example.com', displayName: 'Bob' });
    admin = await signupAdmin(t.app, t.db, { email: 'admin-secret@example.com', displayName: 'Admin' });
  });
  after(() => t.cleanup());

  describe('GET /api/catalog and /search', () => {
    test('status says what is loaded (with the attribution)', async () => {
      const res = await get('/api/catalog');
      assert.equal(res.status, 200);
      assert.equal(res.body.available, true);
      assert.equal(res.body.version, 'fixture-2026-09-27.1');
      assert.equal(res.body.shows, 6);
      assert.match(res.body.attribution.text, /Wikipedia/);
    });

    test('accent-insensitive: "les miserables" → the show first (on the site), then its songs', async () => {
      const res = await get('/api/catalog/search?q=les%20miserables');
      assert.equal(res.status, 200);
      const [first, second] = res.body.results;
      assert.deepEqual(first, {
        type: 'show', id: cat.show.Q192111, title: 'Les Misérables', year: 1980, composer: 'Claude-Michel Schönberg', songCount: 27,
        onSite: { showId: ids.lesMis, slug: 'les-miserables' },
      });
      assert.equal(second.type, 'song');
      assert.equal(second.show.title, 'Les Misérables');
      assert.ok(res.body.results.every((h) => h.type === 'show' || h.show.id === cat.show.Q192111));
      assert.ok(!res.body.results.some((h) => h.title === "Entr'acte"), 'no instrumentals');
      // accents in the query, alt titles
      assert.equal((await get('/api/catalog/search?q=MISÉRABLES')).body.results[0].title, 'Les Misérables');
      assert.equal((await get('/api/catalog/search?q=les%20mis')).body.results[0].title, 'Les Misérables');
    });

    test('prefix on every word: "bring hi" → Bring Him Home, with singers, flags and onSite', async () => {
      const res = await get('/api/catalog/search?q=bring%20hi');
      assert.deepEqual(res.body.results[0], {
        type: 'song', id: cat.bring, title: 'Bring Him Home',
        show: { id: cat.show.Q192111, title: 'Les Misérables', year: 1980, onSite: { showId: ids.lesMis, slug: 'les-miserables' } },
        singers: ['Jean Valjean'], reprise: false, ensemble: false, kindGuess: 'solo', onSite: { songId: ids.bring },
      });
      assert.equal((await get('/api/catalog/search?q=brin%20hom')).body.results[0].title, 'Bring Him Home');
      assert.equal((await get('/api/catalog/search?q=bring%20h')).body.results[0].title, 'Bring Him Home', 'a one-letter last word filters');
    });

    test('ranking: exact title > title prefix > elsewhere; reprise after the main number; singers are searchable', async () => {
      const wait = (await get('/api/catalog/search?q=wait%20for%20me')).body.results;
      assert.deepEqual(wait.slice(0, 2).map((h) => [h.title, h.reprise]), [['Wait for Me', false], ['Wait for Me', true]]);
      const on = (await get('/api/catalog/search?q=on%20my')).body.results;
      assert.equal(on[0].title, 'On My Own');
      const hades = (await get('/api/catalog/search?q=hadestown')).body.results;
      assert.equal(hades[0].type, 'show');
      assert.equal(hades[1].title, 'Way Down Hadestown', 'the word in the song title beats the show name');
      const glinda = (await get('/api/catalog/search?q=glinda')).body.results;
      assert.ok(glinda.length >= 3 && glinda.every((h) => h.show.title === 'Wicked'));
      const schwartz = (await get('/api/catalog/search?q=schwartz')).body.results;
      assert.deepEqual(schwartz.map((h) => [h.type, h.title]), [['show', 'Wicked']], 'credits find the show');
      const zero = (await get('/api/catalog/search?q=come%20from')).body.results;
      assert.deepEqual(zero[0], {
        type: 'show', id: cat.show['wp:Come From Away'], title: 'Come From Away', year: 2015, composer: 'Irene Sankoff, David Hein', songCount: 0, onSite: null,
      });
    });

    test('short or empty queries → []; limit is capped at 50; bad limit → 400', async () => {
      for (const q of ['', 'a', ' b ', '%20']) assert.deepEqual((await get(`/api/catalog/search?q=${q}`)).body, { results: [] });
      assert.deepEqual((await get('/api/catalog/search')).body, { results: [] });
      assert.equal((await get('/api/catalog/search?q=the&limit=2')).body.results.length, 2);
      const many = await get('/api/catalog/search?q=les&limit=500');
      assert.equal(many.status, 200);
      assert.ok(many.body.results.length <= 50);
      assert.equal((await get('/api/catalog/search?q=les&limit=abc')).status, 400);
      assert.equal((await get('/api/catalog/search?q=les&limit=0')).status, 400);
    });

    test('FTS syntax in the query is just text (never a 500)', async () => {
      const nasty = ['foo" OR *', '-', 'NEAR(', 'NEAR(a b', '"', '""', '*', 'a*b', '^bring', 'song_title:bring', '{song_title}: x', 'AND', 'OR OR',
        'NOT stars', '(stars', 'stars)', "'; DROP TABLE songs; --", '\u0000\u0001', 'é', '🎭🎭', 'x'.repeat(5000), 'bring + home', 'bring - home'];
      for (const q of nasty) {
        const res = await get(`/api/catalog/search?q=${encodeURIComponent(q)}`);
        assert.equal(res.status, 200, `${JSON.stringify(q)} → ${res.status} ${JSON.stringify(res.body)}`);
        assert.ok(Array.isArray(res.body.results));
      }
      assert.equal((await get(`/api/catalog/search?q=${encodeURIComponent('NOT that')}`)).body.results[0].title, "I'm Not That Girl", 'NOT is a word');
      assert.equal((await get(`/api/catalog/search?q=${encodeURIComponent('for OR good')}`)).body.results.length, 0, 'OR is a word too (no song has it)');
      assert.equal((await get(`/api/catalog/search?q=${encodeURIComponent('bring - home')}`)).body.results[0].title, 'Bring Him Home');
      assert.equal((await get('/api/catalog/search?q[]=a&q[]=b')).status, 200);
    });
  });

  describe('GET /api/catalog/shows/:id', () => {
    test('details + songs in order (instrumentals only with ?all=1), onSite links', async () => {
      const res = await get(`/api/catalog/shows/${cat.show.Q192111}`);
      assert.equal(res.status, 200);
      const b = res.body;
      assert.equal(b.title, 'Les Misérables');
      assert.deepEqual(b.altTitles, ['Les Mis', 'Les Miz']);
      assert.equal(b.wikiUrl, 'https://en.wikipedia.org/wiki/Les_Mis%C3%A9rables_(musical)');
      assert.equal(b.lyricist, 'Herbert Kretzmer');
      assert.deepEqual(b.genres, ['sung-through', 'tragedy']);
      assert.deepEqual(b.characters[0], { name: 'Jean Valjean', voiceType: 'Baritone' });
      assert.deepEqual(b.onSite, { showId: ids.lesMis, slug: 'les-miserables' });
      assert.equal(b.instrumentalCount, 1);
      assert.equal(b.songs.length, 27);
      assert.ok(!b.songs.some((s) => s.instrumental));
      assert.equal(b.songs[0].title, 'Prologue: Work Song');
      assert.deepEqual(b.songs.find((s) => s.title === 'Bring Him Home'), {
        id: cat.bring, title: 'Bring Him Home', act: 2, position: 22, singers: ['Jean Valjean'], singersRaw: 'Valjean', ensemble: false,
        reprise: false, instrumental: false, source: 'wikipedia', kindGuess: 'solo', onSite: { songId: ids.bring },
      });
      assert.equal(b.songs.find((s) => s.title === 'A Heart Full of Love').kindGuess, null);
      assert.equal(b.recordingTracksAvailable, undefined, 'only for shows without songs');
      const all = (await get(`/api/catalog/shows/${cat.show.Q192111}?all=1`)).body;
      assert.equal(all.songs.length, 28);
      assert.equal(all.songs.find((s) => s.instrumental).title, "Entr'acte");
      for (const bad of ['0', 'abc', '99999', '1e3']) assert.equal((await get(`/api/catalog/shows/${bad}`)).status, 404, bad);
    });
  });

  describe('cast-album tracks (Come From Away has no song list)', () => {
    test('show page checks Apple once: recordingTracksAvailable; Apple down → null (and not asked again for a while)', async () => {
      apple.state.down = true;
      const down = (await get(`/api/catalog/shows/${cat.show['wp:Come From Away']}`)).body;
      assert.equal(down.recordingTracksAvailable, null);
      assert.deepEqual(down.songs, []);
      const afterFailure = apple.state.calls.length;
      assert.equal((await get(`/api/catalog/shows/${cat.show['wp:Come From Away']}`)).body.recordingTracksAvailable, null);
      assert.equal(apple.state.calls.length, afterFailure, 'a failure is remembered: no Apple call on the next view');
      apple.state.down = false;
      t.app.locals.ctx.cache.map.clear(); // … two minutes later
      const before = apple.state.calls.length;
      const res = (await get(`/api/catalog/shows/${cat.show['wp:Come From Away']}`)).body;
      assert.equal(res.recordingTracksAvailable, true);
      assert.equal(res.castAlbum, null, 'a page view never saves an album for the show');
      const calls = apple.state.calls.slice(before);
      assert.ok(calls.length >= 1 && calls.every((u) => /term=come\+from\+away/.test(u) && /country=CA/.test(u)), calls.join('\n'));
      const again = apple.state.calls.length;
      t.app.locals.ctx.cache.map.clear();
      assert.equal((await get(`/api/catalog/shows/${cat.show['wp:Come From Away']}`)).body.recordingTracksAvailable, true);
      assert.equal(apple.state.calls.length, again, 'the answer is kept in the database — no second call');
      const row = t.db.prepare('SELECT itunes_collection_id AS c, itunes_check_found AS f FROM catalog_shows WHERE id = ?').get(cat.show['wp:Come From Away']);
      assert.deepEqual({ ...row }, { c: null, f: 1 });
    });

    test('recording-tracks: a preview for visitors; a logged-in POST saves the tracks as catalog songs for everyone (then no Apple calls)', async () => {
      const url = `/api/catalog/shows/${cat.show['wp:Come From Away']}/recording-tracks`;
      // logged out: a preview that saves nothing (songs without ids)
      const preview = await get(url);
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.equal(preview.body.saved, false);
      assert.equal(preview.body.added, 0);
      assert.equal(preview.body.album.collectionId, 900);
      assert.deepEqual(preview.body.songs.map((s) => [s.id, s.title]), [[null, 'Welcome to the Rock'], [null, '38 Planes'], [null, 'Me and the Sky'],
        [null, 'Prayer'], [null, 'Screech In'], [null, 'Finale']]);
      assert.equal(t.db.prepare("SELECT count(*) AS n FROM catalog_songs WHERE source = 'recording'").get().n, 0, 'nothing saved');
      assert.equal(t.db.prepare('SELECT itunes_collection_id AS c FROM catalog_shows WHERE id = ?').get(cat.show['wp:Come From Away']).c, null);
      // saving is a POST for logged-in users (with the CSRF header like every write)
      assert.equal((await request(t.app).post(url).set(CSRF)).status, 401);
      assert.equal((await alice.agent.post(url)).status, 403, 'no CSRF header');
      const res = await alice.post(url);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.saved, true);
      assert.equal(res.body.added, 7, 'the repeated "Me and the Sky" is saved once');
      assert.equal(res.body.album.collectionId, 900);
      assert.equal(res.body.album.collectionName, CFA);
      assert.match(res.body.album.artworkUrl, /mzstatic\.com\/.*600x600bb\.jpg$/);
      assert.deepEqual(res.body.songs.map((s) => s.title), ['Welcome to the Rock', '38 Planes', 'Me and the Sky', 'Prayer', 'Screech In', 'Finale']);
      assert.ok(res.body.songs.every((s) => s.source === 'recording' && s.singers.length === 0 && s.kindGuess === null));
      const all = (await get(`${url}?all=1`)).body;
      assert.equal(all.songs.find((s) => s.instrumental).title, "Entr'acte");
      // persisted: searchable, counted, listed on the show page — without Apple
      const calls = apple.state.calls.length;
      assert.equal((await get('/api/catalog/search?q=screech')).body.results[0].title, 'Screech In');
      const show = (await get(`/api/catalog/shows/${cat.show['wp:Come From Away']}`)).body;
      assert.equal(show.songCount, 6);
      assert.equal(show.songs.length, 6);
      assert.equal(show.recordingTracksAvailable, undefined);
      const second = (await get(url)).body;
      assert.equal(second.added, 0);
      assert.equal(second.saved, true);
      assert.equal(second.songs.length, 6);
      assert.ok(second.songs.every((s) => Number.isInteger(s.id)));
      assert.equal((await alice.post(url)).body.added, 0, 'saved once only');
      assert.equal(apple.state.calls.length, calls, 'no Apple calls once saved');
      const saved = t.db.prepare('SELECT itunes_collection_id AS c, itunes_saved_by AS by, itunes_saved_at AS at FROM catalog_shows WHERE id = ?').get(cat.show['wp:Come From Away']);
      assert.equal(saved.c, 900);
      assert.equal(saved.by, alice.user.id, 'who saved it is kept (for admins)');
      assert.ok(saved.at);
      // suggestions for a cast-album song: medium title, no kind (singers unknown)
      const sug = (await get(`/api/catalog/songs/${second.songs[2].id}/suggestions`)).body;
      assert.equal(sug.title.value, 'Me and the Sky');
      assert.equal(sug.title.confidence, 'medium');
      assert.equal(sug.title.source, `from the “${CFA}” track list`);
      assert.equal(sug.kind, null);
      assert.match(sug.kindNote, /cast album/);
      assert.deepEqual(sug.parts.value, []);
      assert.equal(sug.parts.confidence, 'low');
    });

    test('an alt title never makes a same-named album by someone else count as the cast album', async () => {
      // Seen live: "Death Becomes Her" (alt title "Death Becomer Her") picked Angel-Ho's electronic album
      // "Death Becomes Her" and saved its tracks as the show's songs.
      const id = t.db.prepare(`INSERT INTO catalog_shows (key, title, alt_titles) VALUES ('Q24DBH', 'Death Becomes Her', '["Death Becomer Her"]') RETURNING id`).get().id;
      const OBC = 'Death Becomes Her (Original Broadway Cast Recording)';
      apple.state.albums['death becomes her'] = [album(910, 'Death Becomes Her', 'Angel-Ho')];
      apple.state.songs['death becomes her original cast'] = [track(920, 'For the Gaze', 911, OBC, { artistName: 'Megan Hilty' })];
      try {
        const res = (await get(`/api/catalog/shows/${id}`)).body;
        assert.equal(res.recordingTracksAvailable, true);
        const saved = await alice.post(`/api/catalog/shows/${id}/recording-tracks`);
        assert.deepEqual([saved.body.album.collectionId, saved.body.album.collectionName], [911, OBC]);
      } finally {
        delete apple.state.albums['death becomes her'];
        delete apple.state.songs['death becomes her original cast'];
      }
    });

    test('shows with a song list keep it (no Apple call); no cast album → album null; Apple down → 502', async () => {
      const calls = apple.state.calls.length;
      const listed = await get(`/api/catalog/shows/${cat.show.Q2533140}/recording-tracks`); // Last Five Years has a song list
      assert.equal(listed.status, 200);
      assert.deepEqual([listed.body.album, listed.body.added, listed.body.songs.length], [null, 0, 8]);
      assert.equal((await alice.post(`/api/catalog/shows/${cat.show.Q2533140}/recording-tracks`)).body.added, 0);
      assert.equal(apple.state.calls.length, calls, 'no Apple call');
      const empty = t.db.prepare("INSERT INTO catalog_shows (key, title) VALUES ('Q999', 'Obscure Show') RETURNING id").get().id;
      const none = await get(`/api/catalog/shows/${empty}/recording-tracks`);
      assert.equal(none.status, 200);
      assert.deepEqual(none.body, { album: null, added: 0, saved: false, songs: [] });
      const other = t.db.prepare("INSERT INTO catalog_shows (key, title) VALUES ('Q998', 'Another Show') RETURNING id").get().id;
      apple.state.down = true;
      try {
        const down = await alice.post(`/api/catalog/shows/${other}/recording-tracks`);
        assert.equal(down.status, 502);
        assert.match(down.body.error, /Apple Music/);
      } finally {
        apple.state.down = false;
      }
    });
  });

  describe('GET /api/catalog/songs/:id/suggestions', () => {
    test('a solo already on the site: title, kind, part with the site spelling and a majority range, genre/mood/mature from the show', async () => {
      const res = await get(`/api/catalog/songs/${cat.bring}/suggestions`);
      assert.equal(res.status, 200);
      const b = res.body;
      assert.deepEqual(b.catalogSong, {
        id: cat.bring, title: 'Bring Him Home', act: 2, position: 22, singers: ['Jean Valjean'], singersRaw: 'Valjean',
        ensemble: false, reprise: false, instrumental: false, source: 'wikipedia',
      });
      assert.deepEqual(b.existingSong, { id: ids.bring, title: 'Bring Him Home', kind: 'solo' });
      assert.deepEqual(b.existingSongs, [b.existingSong]);
      assert.deepEqual(b.show, {
        siteShow: { id: ids.lesMis, name: 'Les Misérables', slug: 'les-miserables' }, catalogShowId: cat.show.Q192111, name: 'Les Misérables',
        composer: 'Claude-Michel Schönberg', lyricist: 'Herbert Kretzmer', bookWriter: 'Alain Boublil, Claude-Michel Schönberg', year: 1980,
        wikiTitle: 'Les Misérables (musical)', wikiUrl: 'https://en.wikipedia.org/wiki/Les_Mis%C3%A9rables_(musical)',
      });
      assert.deepEqual(b.title, { value: 'Bring Him Home', source: 'from the Wikipedia song list', confidence: 'high' });
      assert.deepEqual(b.kind, { value: 'solo', source: 'from the Wikipedia song list (sung by Jean Valjean)', confidence: 'high' });
      assert.equal(b.kindNote, null);
      // the site's own "Bring Him Home" (Tenor) is this song: it doesn't vote, the 2 OTHER Valjean songs do
      assert.deepEqual(b.parts, {
        value: [{
          character: 'Valjean', catalogName: 'Jean Valjean', vocalRange: 'Baritone', rangeConfidence: 'medium',
          rangeSource: 'from 2 other Les Misérables songs on the site',
        }],
        source: 'from the Wikipedia song list',
        confidence: 'high',
      });
      assert.deepEqual(b.genre, {
        value: 'Drama', source: 'from 8 other Les Misérables songs on the site', confidence: 'medium', alternatives: ['Romantic', 'Comedy'], note: '6 of 8 say Drama',
      });
      assert.deepEqual(b.subGenre, {
        value: 'Longing', source: 'from 8 other Les Misérables songs on the site', confidence: 'medium',
        alternatives: ['Frustration', 'Conflict', 'Intimidating / Angry', 'Reflective', 'Confident'], note: '3 of 8 say Longing',
      });
      assert.deepEqual(b.mature, {
        value: false, source: 'from 8 other Les Misérables songs on the site', confidence: 'medium', alternatives: [true], note: '7 of 8 are marked not mature',
      });
      // a split vote reads "from N of M other … songs" (never counting this song)
      const sol = (await get(`/api/catalog/songs/${cat.soliloquy}/suggestions`)).body;
      assert.deepEqual(sol.parts.value, [{
        character: 'Valjean', catalogName: 'Jean Valjean', vocalRange: 'Tenor', rangeConfidence: 'medium', rangeAlternatives: ['Baritone'],
        rangeSource: 'from 1 of 2 other Les Misérables songs on the site — the rest say Baritone',
      }]);
    });

    test('a two-singer song not on the site as a duet also offers Solo (the second singer may only have a line)', async () => {
      const wiz = t.db.prepare(`SELECT s.id FROM catalog_songs s JOIN catalog_shows sh ON sh.id = s.show_id
        WHERE sh.title = 'Wicked' AND s.title = 'The Wizard and I'`).get().id;
      const b = (await get(`/api/catalog/songs/${wiz}/suggestions`)).body;
      assert.equal(b.kind.value, 'duet');
      assert.equal(b.kind.confidence, 'medium');
      assert.deepEqual(b.kind.alternatives, ['solo']);
      assert.match(b.kind.note, /line or two/);
    });

    test('a duet: unanimous site range is "high"; partial names ("Marius" ~ "Marius Pontmercy") are "medium"', async () => {
      const b = (await get(`/api/catalog/songs/${cat.rain}/suggestions`)).body;
      assert.deepEqual(b.kind, { value: 'duet', source: 'from the Wikipedia song list (sung by Éponine and Marius Pontmercy)', confidence: 'medium' },
        'a second listed singer may only have a few lines');
      assert.deepEqual(b.parts.value, [
        { character: 'Éponine', vocalRange: 'Mezzo-soprano', rangeSource: 'from another Les Misérables song on the site', rangeConfidence: 'high' },
        // the site's only Marius part is in this very song → the Wikipedia character list
        { character: 'Marius Pontmercy', vocalRange: 'Tenor', rangeSource: 'from the Wikipedia character list (Marius Pontmercy: Tenor)', rangeConfidence: 'medium' },
      ]);
      assert.equal(b.parts.confidence, 'high');
      assert.deepEqual(b.existingSong, { id: ids.rain, title: 'A Little Fall of Rain', kind: 'duet' });
      const heart = (await get(`/api/catalog/songs/${cat.heart}/suggestions`)).body;
      assert.deepEqual(heart.parts.value[0], {
        character: 'Marius', catalogName: 'Marius Pontmercy', vocalRange: 'Baritone', rangeSource: 'from another Les Misérables song on the site', rangeConfidence: 'medium',
      });
      const stars = (await get(`/api/catalog/songs/${cat.stars}/suggestions`)).body;
      // "Stars" is on the site already: only Javert's OTHER song counts
      assert.deepEqual(stars.parts.value, [{ character: 'Javert', vocalRange: 'Baritone', rangeSource: 'from another Les Misérables song on the site', rangeConfidence: 'high' }]);
      assert.equal(stars.genre.source, 'from 8 other Les Misérables songs on the site');
    });

    test('3 singers → no kind, a note, parts for each; ranges fall back to the Wikipedia character list', async () => {
      const b = (await get(`/api/catalog/songs/${cat.heart}/suggestions`)).body;
      assert.equal(b.kind, null);
      assert.equal(b.kindNote, "3 characters sing this (Marius Pontmercy, Cosette and Éponine) — pick Solo or Duet for the part you'll sing.");
      assert.equal(b.parts.confidence, 'medium');
      assert.match(b.parts.note, /first character for a solo/);
      assert.deepEqual(b.parts.value[1], {
        character: 'Cosette', vocalRange: 'Soprano', rangeSource: 'from the Wikipedia character list (Cosette: Soprano)', rangeConfidence: 'medium',
      }, 'not "Young Cosette" from the site');
      assert.equal(b.existingSong, null);
      const epi = (await get(`/api/catalog/songs/${cat.epilogue}/suggestions`)).body;
      assert.equal(epi.parts.value.length, 5);
    });

    test('ensemble numbers, songs without named singers, instrumentals', async () => {
      const master = (await get(`/api/catalog/songs/${cat.master}/suggestions`)).body;
      assert.equal(master.kind, null);
      assert.equal(master.kindNote, "An ensemble number led by Thénardier and Madame Thénardier — pick Solo or Duet for the part you'll sing.");
      assert.deepEqual(master.parts.value.map((p) => [p.character, p.vocalRange]), [['Thénardier', 'Baritone'], ['Madame Thénardier', 'Mezzo-soprano']]);
      const people = (await get(`/api/catalog/songs/${cat.enjolras}/suggestions`)).body;
      assert.match(people.kindNote, /ensemble number led by Enjolras/);
      assert.deepEqual(people.parts.value, [{
        character: 'Enjolras', vocalRange: 'Tenor', rangeSource: 'from the Wikipedia character list (Enjolras: Tenor)', rangeConfidence: 'medium',
      }]);
      const turning = (await get(`/api/catalog/songs/${cat.turning}/suggestions`)).body;
      assert.equal(turning.kind, null);
      assert.equal(turning.kindNote, "An ensemble number — pick Solo or Duet for the part you'll sing.");
      assert.deepEqual(turning.parts, { value: [], source: 'no singers are listed for this song', confidence: 'low' });
      const entr = (await get(`/api/catalog/songs/${cat.entr}/suggestions`)).body;
      assert.match(entr.kindNote, /instrumental/);
    });

    test('titles: a subtitle offers alternatives; a reprise flag shows in the title; the site song is found by title too', async () => {
      const sol = (await get(`/api/catalog/songs/${cat.soliloquy}/suggestions`)).body;
      assert.equal(sol.title.value, "Valjean's Soliloquy (What Have I Done?)");
      assert.deepEqual(sol.title.alternatives, ['What Have I Done?', "Valjean's Soliloquy"]);
      assert.deepEqual(sol.existingSong, { id: ids.what, title: 'What Have I Done?', kind: 'solo' });
      const wait = (await get(`/api/catalog/songs/${cat.waitReprise}/suggestions`)).body;
      assert.equal(wait.title.value, 'Wait for Me (Reprise)');
      assert.equal(wait.catalogSong.reprise, true);
      assert.equal(wait.existingSong, null);
      assert.deepEqual(wait.show.siteShow, { id: ids.hades, name: 'Hadestown', slug: 'hadestown' });
      assert.deepEqual(wait.parts.value, [{ character: 'Hermes', vocalRange: 'Baritone', rangeSource: 'from the Wikipedia character list (Hermes: Baritone)', rangeConfidence: 'medium' }]);
    });

    test('genre from the catalog show when the site has none of its songs ("low"); none at all → null', async () => {
      const diva = (await get(`/api/catalog/songs/${cat.diva}/suggestions`)).body;
      assert.equal(diva.show.siteShow, null);
      assert.deepEqual(diva.genre, { value: 'Comedy', source: 'from the show\'s genre (“musical comedy”)', confidence: 'low' });
      assert.equal(diva.subGenre, null);
      assert.equal(diva.mature, null);
      const l5y = (await get(`/api/catalog/songs/${cat.cathy}/suggestions`)).body;
      assert.deepEqual(l5y.genre, { value: 'Romantic', source: 'from the show\'s genre (“romance” and “drama”)', confidence: 'low', alternatives: ['Drama'] });
      assert.deepEqual(l5y.parts.value, [{
        character: 'Cathy', vocalRange: 'Mezzo-soprano', rangeSource: 'from the Wikipedia character list (Cathy Hiatt: Mezzo-soprano)', rangeConfidence: 'medium',
      }]);
      const pop = (await get(`/api/catalog/songs/${cat.popular}/suggestions`)).body;
      assert.equal(pop.genre, null, '"fantasy" maps to nothing');
      assert.equal((await get('/api/catalog/songs/999999/suggestions')).status, 404);
      assert.equal((await get('/api/catalog/songs/x/suggestions')).status, 404);
    });
  });

  describe('GET /api/catalog/songs/:id/recordings', () => {
    test('cached cast album first, then cast recordings from the song search; karaoke dropped', async () => {
      t.db.prepare("UPDATE catalog_shows SET itunes_collection_id = 500, itunes_collection_name = 'Les Misérables (Original Broadway Cast)' WHERE id = ?").run(cat.show.Q192111);
      const res = await get(`/api/catalog/songs/${cat.bring}/recordings`);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const c = res.body.candidates;
      assert.deepEqual(c.map((x) => x.trackId), [1, 2, 4]);
      assert.deepEqual(c[0], {
        trackId: 1, trackName: 'Bring Him Home', collectionId: 500, collectionName: 'Les Misérables (Original Broadway Cast)', artistName: 'Original Cast',
        previewUrl: PREVIEW(1), artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music/500/600x600bb.jpg',
        appleMusicUrl: 'https://music.apple.com/ca/album/x/500?i=1', durationSeconds: 201, score: 100, castAlbum: true, albumLabel: 'cast recording',
      });
      assert.equal(c[1].castAlbum, true);
      assert.equal(c[1].albumLabel, 'original cast recording');
      assert.equal(c[2].castAlbum, false, 'film soundtrack is only an alternative');
    });

    test('no cached album: a clearly matching ORIGINAL cast album is remembered for the show (logged-in lookups only)', async () => {
      const albumOf = () => ({ ...t.db.prepare('SELECT itunes_collection_id AS c, itunes_collection_name AS n, itunes_saved_by AS by FROM catalog_shows WHERE id = ?').get(cat.show.Q5636956) });
      const res = await get(`/api/catalog/songs/${cat.flowers}/recordings`);
      assert.equal(res.status, 200);
      assert.equal(res.body.candidates[0].trackId, 10);
      assert.equal(res.body.candidates[0].castAlbum, true);
      assert.deepEqual(albumOf(), { c: null, n: null, by: null }, 'an anonymous lookup saves nothing');
      assert.equal((await alice.agent.get(`/api/catalog/songs/${cat.flowers}/recordings`)).status, 200);
      assert.deepEqual(albumOf(), { c: 600, n: HADES, by: alice.user.id });
    });

    test('a revival album is never remembered for the show — only the original cast album', async () => {
      // Seen live: opening "I Guess This Is Goodbye" first saved "Into The Woods (2022 Broadway Cast Recording)".
      const show = t.db.prepare("INSERT INTO catalog_shows (key, title, year) VALUES ('Q-itw', 'Into the Woods', 1987) RETURNING id").get().id;
      const song = t.db.prepare("INSERT INTO catalog_songs (show_id, title, position) VALUES (?, 'I Guess This Is Goodbye', 1) RETURNING id").get(show).id;
      apple.state.songs['i guess this is goodbye'] = [track(930, 'I Guess This Is Goodbye', 931, 'Into The Woods (2022 Broadway Cast Recording)')];
      try {
        const res = await alice.agent.get(`/api/catalog/songs/${song}/recordings`);
        assert.equal(res.body.candidates[0].trackId, 930, 'still offered as a recording');
        assert.equal(t.db.prepare('SELECT itunes_collection_id AS c FROM catalog_shows WHERE id = ?').get(show).c, null);
      } finally {
        delete apple.state.songs['i guess this is goodbye'];
      }
    });

    test('weak hits (not on a recognised recording of the show) need a fair match and are never foreign casts, karaoke or covers', async () => {
      const show = t.db.prepare("INSERT INTO catalog_shows (key, title, year) VALUES ('Q-batboy', 'Bat Boy', 1997) RETURNING id").get().id;
      const song = t.db.prepare("INSERT INTO catalog_songs (show_id, title, position) VALUES (?, 'Hold Me, Bat Boy', 1) RETURNING id").get(show).id;
      apple.state.songs['hold me, bat boy'] = [
        track(951, 'Hold Me, Bat Boy', 961, 'Bat Boy: The Musical (Original Cast Recording)'),
        // names the show, but a German-language cast / a cover: never offered, not even as a possible match
        track(952, 'Hold Me, Bat Boy', 962, 'Bat Boy (Wiener Besetzung)'),
        track(953, 'Hold Me, Bat Boy', 963, 'Bat Boy Songs in the Style of the Original', { artistName: 'The Cover Band' }),
        track(956, 'Hold Me, Bat Boy', 966, 'Bat Boy (Elenco Argentina)'),
        // no word of the show in the album: too weak to offer
        track(954, 'Hold Me', 964, 'Late Night Songs', { artistName: 'Jane Doe' }),
        // a fair match on another album that names the show: offered, but not as a cast recording
        track(955, 'Hold Me, Bat Boy', 965, 'Songs from Bat Boy and Other Stories', { artistName: 'Jane Doe' }),
      ];
      try {
        const res = await get(`/api/catalog/songs/${song}/recordings`);
        assert.equal(res.status, 200);
        const c = res.body.candidates;
        assert.deepEqual(c.map((x) => x.trackId), [951, 955]);
        assert.equal(c[0].castAlbum, true);
        assert.equal(c[1].castAlbum, false);
        assert.ok(c[1].score >= 60);
      } finally {
        delete apple.state.songs['hold me, bat boy'];
      }
    });

    test('nothing found → []; Apple down → 502; unknown song → 404', async () => {
      assert.deepEqual((await get(`/api/catalog/songs/${cat.popular}/recordings`)).body, { candidates: [] });
      apple.state.down = true;
      try {
        const res = await get(`/api/catalog/songs/${cat.diva}/recordings`);
        assert.equal(res.status, 502);
      } finally {
        apple.state.down = false;
      }
      assert.equal((await get('/api/catalog/songs/424242/recordings')).status, 404);
    });

    test('the lookup rate limit applies to endpoints that call Apple', async () => {
      const t2 = makeTestApp({ catalogPath: CATALOG_FIXTURE, fetchImpl: fakeApple().impl, env: { STAR_LOOKUP_LIMIT: '2' } });
      try {
        const song = t2.db.prepare("SELECT id FROM catalog_songs WHERE title = 'Popular'").get().id;
        const codes = [];
        for (let i = 0; i < 3; i++) codes.push((await request(t2.app).get(`/api/catalog/songs/${song}/recordings`)).status);
        assert.deepEqual(codes, [200, 200, 429]);
        // search and show pages with songs don't count
        assert.equal((await request(t2.app).get('/api/catalog/search?q=popular')).status, 200);
        assert.equal((await request(t2.app).get(`/api/catalog/songs/${song}/suggestions`)).status, 200);
      } finally {
        t2.cleanup();
      }
    });
  });

  describe('song form: catalogSongId / catalogShowId', () => {
    test('POST with a catalog song into an existing show links it; Song JSON has catalogSongId', async () => {
      const res = await alice.post('/api/songs', soloBody({
        title: 'Master of the House', showId: ids.lesMis, showName: undefined, catalogSongId: cat.master, parts: [{ character: 'Thénardier', vocalRange: 'Baritone' }],
      }));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.catalogSongId, cat.master);
      assert.deepEqual((await get(`/api/catalog/songs/${cat.master}/suggestions`)).body.existingSong, { id: res.body.id, title: 'Master of the House', kind: 'solo' });
      const hit = (await get('/api/catalog/search?q=master%20of%20the%20house')).body.results[0];
      assert.deepEqual(hit.onSite, { songId: res.body.id });
    });

    test('invalid ids → 400 with details.catalogSongId; a song from another show → 400', async () => {
      for (const bad of [999999, 'abc', -1, 1.5, { id: 1 }]) {
        const res = await alice.post('/api/songs', soloBody({ title: `Bad ${JSON.stringify(bad)}`, catalogSongId: bad }));
        assert.equal(res.status, 400, JSON.stringify(bad));
        assert.ok(res.body.details.catalogSongId, JSON.stringify(res.body));
      }
      const wrong = await alice.post('/api/songs', soloBody({ title: 'Popular', showId: ids.hades, showName: undefined, catalogSongId: cat.popular }));
      assert.equal(wrong.status, 400);
      assert.equal(wrong.body.details.catalogSongId, 'That\'s from “Wicked” in the catalog, not “Hadestown” — pick that show, or enter the song without the catalog');
      const badShow = await alice.post('/api/songs', soloBody({ title: 'X', catalogShowId: 424242 }));
      assert.equal(badShow.status, 400);
      assert.ok(badShow.body.details.catalogShowId);
      const mismatch = await alice.post('/api/songs', soloBody({ title: 'Popular', showName: 'Wicked', catalogSongId: cat.popular, catalogShowId: cat.show.Q5636956 }));
      assert.equal(mismatch.status, 400);
      assert.ok(mismatch.body.details.catalogShowId);
    });

    test('a new show made from the catalog gets the link and the catalog credits/year', async () => {
      const res = await alice.post('/api/songs', soloBody({ title: 'Popular', showName: 'Wicked', catalogSongId: cat.popular, parts: [{ character: 'Glinda', vocalRange: 'Soprano' }] }));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const show = (await get(`/api/shows/${res.body.show.slug}`)).body;
      assert.equal(show.catalogShowId, cat.show.Q156396);
      assert.equal(show.composer, 'Stephen Schwartz');
      assert.equal(show.bookWriter, 'Winnie Holzman');
      assert.equal(show.year, 2003);
      assert.equal(show.wikiUrl, 'https://en.wikipedia.org/wiki/Wicked_(musical)');
      assert.equal(show.source, 'community');
      // now the whole Wicked catalog show counts as on the site
      const hit = (await get('/api/catalog/search?q=wicked')).body.results[0];
      assert.deepEqual(hit.onSite, { showId: show.id, slug: show.slug });
      // "My song isn't listed": catalogShowId only
      const other = await alice.post('/api/songs', soloBody({ title: 'Dancing Through Life', showId: show.id, showName: undefined, catalogShowId: cat.show.Q156396 }));
      assert.equal(other.status, 201, JSON.stringify(other.body));
      assert.equal(other.body.catalogSongId, null);
    });

    test('without catalogSongId a song is linked by title; PUT keeps / changes / clears the link', async () => {
      const res = await alice.post('/api/songs', soloBody({ title: 'Doubt Comes In', showId: ids.hades, showName: undefined }));
      assert.equal(res.status, 201);
      const doubt = t.db.prepare("SELECT id FROM catalog_songs WHERE title = 'Doubt Comes In'").get().id;
      assert.equal(res.body.catalogSongId, doubt, 'linked by title');
      const body = soloBody({ title: 'Doubt Comes In', showId: ids.hades, showName: undefined, notes: 'edited' });
      const kept = await alice.put(`/api/songs/${res.body.id}`, body);
      assert.equal(kept.body.catalogSongId, doubt);
      const cleared = await alice.put(`/api/songs/${res.body.id}`, { ...body, catalogSongId: null });
      assert.equal(cleared.body.catalogSongId, null, 'an explicit null is not re-linked by title');
      const updatedAt = cleared.body.updatedAt;
      // the site's solo "Flowers" already is catalog Flowers: pointing another solo at it is a duplicate
      const dup = await alice.put(`/api/songs/${res.body.id}`, { ...body, catalogSongId: cat.flowers });
      assert.equal(dup.status, 409);
      assert.equal(dup.body.existingId, ids.flowers);
      const epic = t.db.prepare("SELECT id FROM catalog_songs WHERE title = 'Epic III'").get().id;
      const set = await alice.put(`/api/songs/${res.body.id}`, { ...body, catalogSongId: epic });
      assert.equal(set.status, 200, JSON.stringify(set.body));
      assert.equal(set.body.catalogSongId, epic);
      assert.equal(set.body.updatedAt, updatedAt, 'changing only the link is not an edit');
      const bad = await alice.put(`/api/songs/${res.body.id}`, { ...body, catalogSongId: cat.popular });
      assert.equal(bad.status, 400);
      // moving it to another show re-links (or unlinks) it
      const moved = await alice.put(`/api/songs/${res.body.id}`, { ...body, showId: ids.lesMis, title: 'Stars (Doubt version)' });
      assert.equal(moved.status, 200);
      assert.equal(moved.body.catalogSongId, cat.stars, 'a "(… version)" of Stars is Stars');
      const renamed = await alice.put(`/api/songs/${res.body.id}`, { ...body, showId: ids.hades, title: 'Not In Any Song List' });
      assert.equal(renamed.body.catalogSongId, null);
      assert.equal((await bob.put(`/api/songs/${res.body.id}`, { ...body, catalogSongId: epic })).status, 403);
    });

    test('POST /api/shows with catalogShowId: link + prefilled credits (body values win); name must match', async () => {
      const res = await alice.post('/api/shows', { name: 'The Last Five Years', catalogShowId: cat.show.Q2533140, year: 2002 });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.catalogShowId, cat.show.Q2533140);
      assert.equal(res.body.composer, 'Jason Robert Brown');
      assert.equal(res.body.year, 2002);
      const wrong = await alice.post('/api/shows', { name: 'Totally Different', catalogShowId: cat.show.Q2533140 });
      assert.equal(wrong.status, 400);
      assert.equal(wrong.body.details.catalogShowId, 'The catalog show is “The Last Five Years”, not “Totally Different”');
      assert.equal((await alice.post('/api/shows', { name: 'Nope', catalogShowId: 'x' })).status, 400);
      assert.equal((await alice.post('/api/shows', { name: 'Nope', catalogShowId: 777777 })).status, 400);
      // a show whose name is in the catalog is linked even without catalogShowId
      const plain = await alice.post('/api/shows', { name: 'Spamalot' });
      assert.equal(plain.body.catalogShowId, cat.show.Q1392416);
      assert.equal(plain.body.composer, null, 'credits are only filled when created from the catalog');
      const unknown = await admin.post('/api/shows', { name: 'Brand New Unknown Musical' });
      assert.equal(unknown.body.catalogShowId, null);
    });
  });

  test('public catalog GETs never contain emails or user data', async () => {
    const urls = ['/api/catalog', '/api/catalog/search?q=les', '/api/catalog/search?q=wicked', `/api/catalog/shows/${cat.show.Q192111}`,
      `/api/catalog/shows/${cat.show.Q156396}`, `/api/catalog/songs/${cat.bring}/suggestions`, `/api/catalog/songs/${cat.popular}/suggestions`,
      `/api/catalog/songs/${cat.master}/suggestions`];
    for (const url of urls) {
      for (const agent of [request(t.app), alice.agent, admin.agent]) {
        const res = await agent.get(url);
        assert.equal(res.status, 200, url);
        const json = JSON.stringify(res.body);
        assert.ok(!json.includes('@'), `${url} contains '@'`);
        assert.ok(!/secret|scrypt|password|Alice|displayName|createdBy/i.test(json), `${url} leaks user data`);
      }
    }
  });
});

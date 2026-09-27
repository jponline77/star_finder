import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { makeTestApp, client, signup, seedFixture, soloBody } from './helpers.js';

const titles = (res) => res.body.songs.map((s) => s.title);

describe('GET /api/songs filters', () => {
  let t;
  let ids;
  before(() => {
    t = makeTestApp();
    ids = seedFixture(t.db);
  });
  after(() => t.cleanup());

  const get = (qs) => request(t.app).get(`/api/songs${qs}`);

  test('returns all songs with total, sorted by title by default, with full Song shape', async () => {
    const res = await get('');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 7);
    assert.equal(res.body.songs.length, 7);
    assert.deepEqual(titles(res), ['A Little Fall of Rain', 'Corn', "Don't Let Me Go", 'Hell to Your Doorstep', 'On My Own', 'Stars', 'When Love is True']);
    const s = res.body.songs.find((x) => x.title === 'On My Own');
    assert.deepEqual(Object.keys(s).sort(), [
      'commentCount', 'createdAt', 'createdBy', 'genre', 'id', 'kind', 'lengthSeconds', 'mature', 'media', 'notes', 'parts', 'show', 'source', 'subGenre', 'title', 'updatedAt',
    ]);
    assert.deepEqual(s.show, { id: ids.lesMis, name: 'Les Misérables', slug: 'les-miserables', imageUrl: null });
    assert.deepEqual(s.parts, [{ position: 1, character: 'Eponine', vocalRange: 'Soprano' }]);
    assert.deepEqual(Object.keys(s.media).sort(), ['appleMusicUrl', 'artworkUrl', 'audioLink', 'audioUrl', 'previewUrl', 'recordingArtist', 'recordingName']);
    assert.equal(s.source, 'spreadsheet');
    assert.equal(s.createdBy, null);
    assert.equal(s.commentCount, 0);
    assert.equal(s.mature, false);
    const duet = res.body.songs.find((x) => x.title === 'A Little Fall of Rain');
    assert.deepEqual(duet.parts.map((p) => p.position), [1, 2]);
  });

  test('q is accent- and case-insensitive ("les miserables", "dantes", "EPONINE")', async () => {
    assert.deepEqual(titles(await get('?q=les%20miserables')), ['A Little Fall of Rain', 'On My Own', 'Stars']);
    assert.deepEqual(titles(await get('?q=dantes')), ['Hell to Your Doorstep', 'When Love is True']);
    assert.deepEqual(titles(await get('?q=EPONINE')), ['A Little Fall of Rain', 'On My Own']);
    assert.deepEqual(titles(await get('?q=mercedes')), ['When Love is True']);
    assert.deepEqual(titles(await get('?q=tongue')), ['Corn'], 'matches sub-genre');
    assert.deepEqual(titles(await get('?q=romantic')), ['When Love is True'], 'matches genre');
    assert.deepEqual(titles(await get('?q=don%E2%80%99t')), ["Don't Let Me Go"], 'curly apostrophe matches straight');
    assert.equal((await get('?q=zzzz')).body.total, 0);
    assert.equal((await get('?q=100%25')).body.total, 0, 'LIKE wildcards escaped');
  });

  test('kind', async () => {
    assert.deepEqual(titles(await get('?kind=duet')), ['A Little Fall of Rain', 'Corn', 'When Love is True']);
    assert.equal((await get('?kind=solo')).body.total, 4);
    assert.equal((await get('?kind=solo,duet')).body.total, 7);
    assert.equal((await get('?kind=trio')).status, 400);
  });

  test('range: a duet matches if either part has the range; aliases normalized', async () => {
    assert.deepEqual(titles(await get('?range=Soprano')), ['A Little Fall of Rain', 'On My Own', 'When Love is True']);
    assert.deepEqual(titles(await get('?range=mezzo')), ['Corn']);
    assert.deepEqual(titles(await get('?range=Tenor,Mezzo-soprano')), ['Corn', "Don't Let Me Go"]);
    assert.equal((await get('?range=Countertenor')).status, 400);
  });

  test('maxSeconds / minSeconds', async () => {
    assert.deepEqual(titles(await get('?maxSeconds=180')), ["Don't Let Me Go", 'Hell to Your Doorstep']);
    assert.deepEqual(titles(await get('?minSeconds=361')), ['Corn']);
    assert.equal((await get('?maxSeconds=abc')).status, 400);
  });

  test('hideMature, hasAudio', async () => {
    const res = await get('?hideMature=1');
    assert.equal(res.body.total, 5);
    assert.ok(res.body.songs.every((s) => !s.mature));
    assert.deepEqual(titles(await get('?hasAudio=1')), ["Don't Let Me Go", 'On My Own']);
  });

  test('show (slug or id), genre, subGenre (case-insensitive, comma = OR)', async () => {
    assert.equal((await get('?show=les-miserables')).body.total, 3);
    assert.equal((await get(`?show=${ids.shucked}`)).body.total, 1);
    assert.equal((await get(`?show=shrek,${ids.shucked}`)).body.total, 2);
    assert.equal((await get('?genre=comedy')).body.total, 2);
    assert.equal((await get('?subGenre=intimidating%20%2F%20angry')).body.total, 2);
    assert.equal((await get('?genre=Drama&kind=duet&hideMature=1')).body.total, 0);
  });

  test('sort', async () => {
    assert.equal((await get('?sort=-length')).body.songs[0].title, 'Corn');
    assert.equal((await get('?sort=length')).body.songs[0].title, "Don't Let Me Go");
    const byShow = await get('?sort=show');
    assert.equal(byShow.body.songs[0].show.name, 'Les Misérables');
    assert.equal(byShow.body.songs.at(-1).show.name, 'The Count of Monte Cristo');
    assert.equal((await get('?sort=newest')).status, 200);
    assert.equal((await get('?sort=random')).status, 400);
  });

  test('limit / offset keep total', async () => {
    const res = await get('?limit=2&offset=1');
    assert.equal(res.body.total, 7);
    assert.deepEqual(titles(res), ['Corn', "Don't Let Me Go"]);
  });

  test('GET /api/songs/:id → Song + similar (≤ 6, excluding itself); 404', async () => {
    const res = await get(`/${ids.stars}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.title, 'Stars');
    assert.ok(Array.isArray(res.body.similar));
    assert.ok(res.body.similar.length > 0 && res.body.similar.length <= 6);
    assert.ok(!res.body.similar.some((s) => s.id === ids.stars));
    // same sub-genre solo ranks first
    assert.equal(res.body.similar[0].title, 'Hell to Your Doorstep');
    assert.equal((await get('/99999')).status, 404);
    assert.equal((await get('/abc')).status, 404);
  });
});

describe('songs CRUD + validation', () => {
  let t;
  let ids;
  let alice;
  before(async () => {
    t = makeTestApp();
    ids = seedFixture(t.db);
    alice = await signup(t.app, { displayName: 'Alice' });
  });
  after(() => t.cleanup());

  test('POST creates a community song (and a new community show via showName)', async () => {
    const res = await alice.post('/api/songs', soloBody());
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const s = res.body;
    assert.equal(s.source, 'community');
    assert.deepEqual(s.createdBy, { id: alice.user.id, displayName: 'Alice' });
    assert.equal(s.lengthSeconds, 205);
    assert.equal(s.show.name, 'Brand New Musical');
    assert.equal(s.show.slug, 'brand-new-musical');
    assert.deepEqual(s.parts, [{ position: 1, character: 'Lead', vocalRange: 'Tenor' }]);
    const show = await request(t.app).get('/api/shows/brand-new-musical');
    assert.equal(show.body.source, 'community');
    assert.deepEqual(show.body.createdBy, { id: alice.user.id, displayName: 'Alice' });
  });

  test('showName matches an existing show accent/case-insensitively', async () => {
    const res = await alice.post('/api/songs', soloBody({ title: 'Master of the House', showName: 'les miserables', parts: [{ character: 'Thénardier', vocalRange: 'bari' }] }));
    assert.equal(res.status, 201);
    assert.equal(res.body.show.id, ids.lesMis);
    assert.equal(res.body.parts[0].vocalRange, 'Baritone');
  });

  test('normalizes genre/sub-genre/vocal range; lengthSeconds wins; mature boolean', async () => {
    const res = await alice.post('/api/songs', {
      kind: 'duet', title: '  Tiny   Duet ', showId: ids.shrek, genre: 'comedy', subGenre: 'tongue & cheek', lengthSeconds: 99, length: '9:99', mature: true,
      parts: [{ character: 'Shrek', vocalRange: 'mezzo soprano' }, { character: 'Fiona', vocalRange: null }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.title, 'Tiny Duet');
    assert.equal(res.body.genre, 'Comedy');
    assert.equal(res.body.subGenre, 'Tongue-in-Cheek');
    assert.equal(res.body.lengthSeconds, 99);
    assert.equal(res.body.mature, true);
    assert.deepEqual(res.body.parts.map((p) => p.vocalRange), ['Mezzo-soprano', null]);
  });

  test('validation errors → 400 with details', async () => {
    const cases = [
      [{ title: '' }, 'title'],
      [{ title: 'x'.repeat(121) }, 'title'],
      [{ kind: 'trio' }, 'kind'],
      [{ kind: 'duet' }, 'parts'],
      [{ parts: [] }, 'parts'],
      [{ parts: [{ character: '' }] }, 'parts.0.character'],
      [{ parts: [{ character: 'x'.repeat(81) }] }, 'parts.0.character'],
      [{ parts: [{ character: 'A', vocalRange: 'Squeaky' }] }, 'parts.0.vocalRange'],
      [{ length: 'abc' }, 'length'],
      [{ length: '3:75' }, 'length'],
      [{ length: undefined, lengthSeconds: 4000 }, 'lengthSeconds'],
      [{ showName: undefined }, 'showName'],
      [{ showName: undefined, showId: 999999 }, 'showId'],
      [{ audioLink: 'http://example.com/a.mp3' }, 'audioLink'],
      [{ audioLink: 'javascript:alert(1)' }, 'audioLink'],
      [{ genre: 'x'.repeat(41) }, 'genre'],
      [{ preview: { previewUrl: 'https://evil.example.com/a.m4a' } }, 'preview.previewUrl'],
      [{ preview: { previewUrl: 'https://audio-ssl.itunes.apple.com/a.m4a', artworkUrl: 'https://upload.wikimedia.org/x.jpg' } }, 'preview.artworkUrl'],
    ];
    for (const [override, field] of cases) {
      const res = await alice.post('/api/songs', soloBody({ title: `Validation ${field}`, ...override }));
      assert.equal(res.status, 400, `${field}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.error);
      assert.ok(res.body.details?.[field], `expected details.${field}, got ${JSON.stringify(res.body.details)}`);
    }
  });

  test('duplicate (kind, show, title) → 409 with details.existingId (case/accent-insensitive)', async () => {
    const res = await alice.post('/api/songs', soloBody({ title: 'on my own', showId: ids.lesMis, showName: undefined }));
    assert.equal(res.status, 409);
    assert.equal(res.body.details.existingId, String(ids.onMyOwn));
    assert.equal(res.body.existingId, ids.onMyOwn);
    // same title as a duet is fine
    const duet = await alice.post('/api/songs', soloBody({ kind: 'duet', title: 'On My Own', showId: ids.lesMis, showName: undefined, parts: [{ character: 'A' }, { character: 'B' }] }));
    assert.equal(duet.status, 201);
  });

  test('POST with iTunes preview downloads artwork into /uploads/art (not the seed media folder)', async () => {
    const png = (await import('./helpers.js')).PNG;
    let calls = 0;
    const fetchImpl = async (url) => {
      calls++;
      assert.match(url, /^https:\/\/is1-ssl\.mzstatic\.com\//);
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    };
    const t2 = makeTestApp({ fetchImpl });
    try {
      const u = await signup(t2.app);
      const res = await u.post('/api/songs', soloBody({
        preview: {
          previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/x.m4a',
          artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/abc/600x600bb.jpg',
          appleMusicUrl: 'https://music.apple.com/ca/album/x/1?i=2',
          recordingName: 'Brand New Musical (Original Cast Recording)',
          recordingArtist: 'Original Cast',
          itunesTrackId: 12345,
        },
      }));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.match(res.body.media.artworkUrl, /^\/uploads\/art\/[0-9a-f-]{36}\.png$/);
      assert.ok(fs.existsSync(path.join(t2.uploadsDir, 'art', path.basename(res.body.media.artworkUrl))));
      assert.deepEqual(fs.readdirSync(path.join(t2.mediaDir)).filter((f) => f !== '.gitkeep'), [], 'nothing written to server/media');
      assert.equal(res.body.media.previewUrl, 'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/x.m4a');
      assert.equal(res.body.media.recordingName, 'Brand New Musical (Original Cast Recording)');
      const art = await request(t2.app).get(res.body.media.artworkUrl);
      assert.equal(art.status, 200);
      assert.equal(calls, 1);
      // PUT round-trips the local artwork path and keeps the preview
      const put = await u.put(`/api/songs/${res.body.id}`, soloBody({
        title: 'Renamed', preview: { ...res.body.media, itunesTrackId: 12345, artworkUrl: res.body.media.artworkUrl },
      }));
      assert.equal(put.status, 200, JSON.stringify(put.body));
      assert.equal(put.body.media.artworkUrl, res.body.media.artworkUrl);
      assert.equal(calls, 1);
    } finally {
      t2.cleanup();
    }
  });

  test('PUT replaces fields and parts; preview absent keeps media, null clears it', async () => {
    const created = await alice.post('/api/songs', soloBody({ title: 'Edit Me', audioLink: 'https://www.youtube.com/watch?v=abc' }));
    assert.equal(created.status, 201);
    const id = created.body.id;
    t.db.prepare("UPDATE songs SET preview_url = 'https://audio-ssl.itunes.apple.com/p.m4a' WHERE id = ?").run(id);
    const put = await alice.put(`/api/songs/${id}`, {
      kind: 'duet', title: 'Edited', showId: ids.shrek, genre: 'Drama', length: '2:00',
      parts: [{ character: 'One', vocalRange: 'Alto' }, { character: 'Two', vocalRange: 'Bass' }],
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.kind, 'duet');
    assert.equal(put.body.title, 'Edited');
    assert.equal(put.body.show.id, ids.shrek);
    assert.equal(put.body.subGenre, null);
    assert.equal(put.body.lengthSeconds, 120);
    assert.equal(put.body.media.audioLink, null, 'full replace clears omitted audioLink');
    assert.equal(put.body.media.previewUrl, 'https://audio-ssl.itunes.apple.com/p.m4a', 'preview kept when omitted');
    assert.equal(put.body.parts.length, 2);
    assert.ok(put.body.updatedAt >= put.body.createdAt);
    const cleared = await alice.put(`/api/songs/${id}`, { ...soloBody({ title: 'Edited' }), preview: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.media.previewUrl, null);
    assert.equal(cleared.body.source, 'community');
  });

  test('very long Apple recording credits are shortened, not rejected', async () => {
    const cast = Array.from({ length: 40 }, (_, i) => `Cast Member Number ${i + 1}`).join(', ');
    assert.ok(cast.length > 300);
    const res = await alice.post('/api/songs', {
      ...soloBody({ title: 'Big Cast Song' }),
      preview: { previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/x.m4a', recordingName: 'Big Album', recordingArtist: cast },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.media.recordingArtist.length, 300);
    assert.ok(res.body.media.recordingArtist.endsWith('…'));
  });

  test('PUT duplicate of another song → 409; 404 for missing song', async () => {
    const res = await alice.post('/api/songs', soloBody({ title: 'Unique One' }));
    const res2 = await alice.post('/api/songs', soloBody({ title: 'Unique Two' }));
    const put = await alice.put(`/api/songs/${res2.body.id}`, soloBody({ title: 'UNIQUE ONE' }));
    assert.equal(put.status, 409);
    assert.equal(put.body.details.existingId, String(res.body.id));
    assert.equal((await alice.put('/api/songs/999999', soloBody())).status, 404);
  });

  test('owner can delete own song → 204, then 404', async () => {
    const res = await alice.post('/api/songs', soloBody({ title: 'Delete Me' }));
    const del = await alice.del(`/api/songs/${res.body.id}`);
    assert.equal(del.status, 204);
    assert.equal((await request(t.app).get(`/api/songs/${res.body.id}`)).status, 404);
  });

  test('parts count must match kind', async () => {
    const res = await alice.post('/api/songs', soloBody({ kind: 'solo', title: 'Two parts', parts: [{ character: 'A' }, { character: 'B' }] }));
    assert.equal(res.status, 400);
    assert.ok(res.body.details.parts);
  });
});

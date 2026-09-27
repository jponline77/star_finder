import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { makeTestApp, signup, seedFixture, soloBody, PNG, HTML, binaryResponse } from './helpers.js';

describe('shows', () => {
  let t;
  let ids;
  let alice;
  before(async () => {
    t = makeTestApp();
    ids = seedFixture(t.db);
    alice = await signup(t.app, { displayName: 'Alice' });
  });
  after(() => t.cleanup());

  test('GET /api/shows → sorted by name with counts and the Show shape', async () => {
    const res = await request(t.app).get('/api/shows');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.shows.map((s) => s.name), ['Les Misérables', 'Shrek', 'Shucked', 'The Count of Monte Cristo']);
    const lm = res.body.shows[0];
    for (const k of ['id', 'name', 'slug', 'composer', 'lyricist', 'bookWriter', 'year', 'licensor', 'licensingNote', 'description', 'wikiUrl', 'imageUrl', 'imageCredit', 'source', 'createdBy', 'commentCount', 'songCount', 'soloCount', 'duetCount']) {
      assert.ok(k in lm, `missing ${k}`);
    }
    assert.equal(lm.songCount, 3);
    assert.equal(lm.soloCount, 2);
    assert.equal(lm.duetCount, 1);
    assert.equal(lm.composer, 'Claude-Michel Schönberg');
    assert.equal(lm.createdBy, null);
    assert.equal(lm.songs, undefined, 'songs only on detail');
  });

  test('GET /api/shows/:slug and /:id → detail with songs and characters', async () => {
    const res = await request(t.app).get('/api/shows/the-count-of-monte-cristo');
    assert.equal(res.status, 200);
    assert.equal(res.body.id, ids.monte);
    assert.deepEqual(res.body.songs.map((s) => s.title), ['Hell to Your Doorstep', 'When Love is True']);
    const dantes = res.body.characters.find((c) => c.name === 'Dantès');
    assert.deepEqual(dantes.vocalRanges, ['Baritone']);
    assert.deepEqual(dantes.songIds.sort(), [ids.doorstep, ids.loveTrue].sort());
    assert.ok(res.body.characters.find((c) => c.name === 'Mercédès'));
    const byId = await request(t.app).get(`/api/shows/${ids.monte}`);
    assert.equal(byId.body.slug, 'the-count-of-monte-cristo');
    assert.equal((await request(t.app).get('/api/shows/nope-nope')).status, 404);
  });

  test('POST /api/shows → 201 community show; duplicate name (accent-insensitive) → 409', async () => {
    const res = await alice.post('/api/shows', { name: '  Come From Away ', composer: 'Irene Sankoff', year: 2017, wikiUrl: 'https://en.wikipedia.org/wiki/Come_from_Away' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.name, 'Come From Away');
    assert.equal(res.body.slug, 'come-from-away');
    assert.equal(res.body.source, 'community');
    assert.equal(res.body.year, 2017);
    assert.equal(res.body.songCount, 0);
    assert.deepEqual(res.body.createdBy, { id: alice.user.id, displayName: 'Alice' });
    const dup = await alice.post('/api/shows', { name: 'LES MISERABLES' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.details.existingId, String(ids.lesMis));
  });

  test('POST /api/shows validation', async () => {
    assert.equal((await alice.post('/api/shows', { name: '' })).status, 400);
    assert.equal((await alice.post('/api/shows', { name: 'X', year: 'soon' })).status, 400);
    const badWiki = await alice.post('/api/shows', { name: 'Y Show', wikiUrl: 'https://evil.example.com/' });
    assert.equal(badWiki.status, 400);
    assert.ok(badWiki.body.details.wikiUrl);
    const badImg = await alice.post('/api/shows', { name: 'Z Show', imageUrl: 'https://evil.example.com/a.png' });
    assert.equal(badImg.status, 400);
    assert.ok(badImg.body.details.imageUrl);
  });

  test('slug collisions get -2', async () => {
    const a = await alice.post('/api/shows', { name: 'Slug Test!' });
    const b = await alice.post('/api/shows', { name: 'Slug Test?' });
    assert.equal(a.body.slug, 'slug-test');
    assert.equal(b.body.slug, 'slug-test-2');
  });

  test('PUT is a partial update; renaming changes the slug', async () => {
    const created = (await alice.post('/api/shows', { name: 'Old Name', composer: 'Someone' })).body;
    const res = await alice.put(`/api/shows/${created.id}`, { name: 'New Name', description: 'A fun show.' });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'New Name');
    assert.equal(res.body.slug, 'new-name');
    assert.equal(res.body.composer, 'Someone', 'untouched field kept');
    assert.equal(res.body.description, 'A fun show.');
    const dup = await alice.put(`/api/shows/${created.id}`, { name: 'Shrek' });
    assert.equal(dup.status, 409);
  });

  test('DELETE with songs → 409; empty show → 204', async () => {
    const res = await alice.post('/api/songs', soloBody({ title: 'Keeps show alive', showName: 'Show With Song' }));
    const del = await alice.del(`/api/shows/${res.body.show.id}`);
    assert.equal(del.status, 409);
    const empty = (await alice.post('/api/shows', { name: 'Empty Show' })).body;
    assert.equal((await alice.del(`/api/shows/${empty.id}`)).status, 204);
    assert.equal((await request(t.app).get(`/api/shows/${empty.id}`)).status, 404);
  });
});

describe('show images from remote URLs', () => {
  test('imageUrl on upload.wikimedia.org is downloaded to /uploads/shows (not the committed media folder)', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, redirect: opts?.redirect });
      return binaryResponse(PNG, 'image/png');
    };
    const t = makeTestApp({ fetchImpl });
    try {
      const u = await signup(t.app);
      const res = await u.post('/api/shows', { name: 'Poster Show', imageUrl: 'https://upload.wikimedia.org/wikipedia/en/a/ab/Poster.png' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.match(res.body.imageUrl, /^\/uploads\/shows\/poster-show-[0-9a-f-]{36}\.png$/);
      assert.ok(res.body.imageCredit);
      assert.equal(calls[0].redirect, 'manual');
      const file = path.join(t.uploadsDir, 'shows', path.basename(res.body.imageUrl));
      assert.ok(fs.existsSync(file));
      const img = await request(t.app).get(res.body.imageUrl);
      assert.equal(img.status, 200);
      assert.equal(img.headers['content-type'], 'image/png');
      assert.equal(img.headers['x-content-type-options'], 'nosniff');
      // removing the image
      const cleared = await u.put(`/api/shows/${res.body.id}`, { imageUrl: null });
      assert.equal(cleared.body.imageUrl, null);
      assert.ok(!fs.existsSync(file), 'the downloaded poster is deleted with it');
    } finally {
      t.cleanup();
    }
  });

  test('cross-host redirects, non-images and HTML are rejected', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('redirect')) return new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x.png' } });
      if (url.includes('html')) return binaryResponse(HTML, 'image/png');
      if (url.includes('svg')) return binaryResponse(Buffer.from('<svg/>'), 'image/svg+xml');
      if (url.includes('big')) return binaryResponse(PNG, 'image/png', { headers: { 'content-length': String(6 * 1024 * 1024) } });
      return binaryResponse(PNG, 'text/html');
    };
    const t = makeTestApp({ fetchImpl });
    try {
      const u = await signup(t.app);
      for (const name of ['redirect', 'html', 'svg', 'big', 'texthtml']) {
        const res = await u.post('/api/shows', { name: `Bad ${name}`, imageUrl: `https://upload.wikimedia.org/${name}.png` });
        assert.equal(res.status, 400, `${name}: ${JSON.stringify(res.body)}`);
        assert.ok(res.body.details.imageUrl);
      }
      assert.equal((await request(t.app).get('/api/shows')).body.shows.length, 0, 'nothing created');
    } finally {
      t.cleanup();
    }
  });

  test('same-host redirect is followed', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/a.png')) return new Response(null, { status: 301, headers: { location: '/b.png' } });
      return binaryResponse(PNG, 'image/png');
    };
    const t = makeTestApp({ fetchImpl });
    try {
      const u = await signup(t.app);
      const res = await u.post('/api/shows', { name: 'Redirected', imageUrl: 'https://upload.wikimedia.org/a.png' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
    } finally {
      t.cleanup();
    }
  });
});

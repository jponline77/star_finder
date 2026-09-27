import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeTestApp, jsonResponse } from './helpers.js';
import {
  scoreCandidate, normalizeForMatch, searchItunes, lookupCollectionTracks, showSignificantWords, buildSearchTerm,
} from '../src/lib/itunes.js';
import { lookupWikipedia } from '../src/lib/wikipedia.js';

const track = (trackId, trackName, collectionName, artistName = 'Original Broadway Cast', extra = {}) => ({
  wrapperType: 'track',
  kind: 'song',
  trackId,
  trackName,
  collectionName,
  collectionId: 1000 + trackId,
  artistName,
  previewUrl: `https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/${trackId}.m4a`,
  artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/Music/${trackId}/100x100bb.jpg`,
  trackViewUrl: `https://music.apple.com/ca/album/x/${trackId}`,
  trackTimeMillis: 211_000,
  trackNumber: trackId % 20,
  discNumber: 1,
  ...extra,
});

const HADESTOWN = 'Hadestown (Original Broadway Cast Recording)';

describe('itunes scoring', () => {
  const q = { title: 'Flowers', show: 'Hadestown' };

  test('normalizeForMatch', () => {
    assert.equal(normalizeForMatch('Don’t Stop!  Believin’'), 'dont stop believin');
    assert.equal(normalizeForMatch('Les Misérables'), 'les miserables');
    assert.equal(normalizeForMatch('Rock & Roll'), 'rock and roll');
    assert.equal(normalizeForMatch(null), '');
    assert.deepEqual(showSignificantWords('The Book of Mormon'), ['book', 'mormon']);
    assert.deepEqual(showSignificantWords('Smash!'), ['smash']);
    assert.equal(buildSearchTerm('Feed Me (Git It!)', 'The Little Shop'), 'Feed Me Little Shop');
  });

  test('exact title from the cast recording scores high', () => {
    const s = scoreCandidate({ trackName: 'Flowers', collectionName: HADESTOWN, artistName: 'Eva Noblezada' }, q);
    assert.ok(s >= 85, `got ${s}`);
    assert.ok(s <= 100);
  });

  test('same title from a different artist/show is capped low', () => {
    const s = scoreCandidate({ trackName: 'Flowers', collectionName: 'Endless Summer Vacation', artistName: 'Miley Cyrus' }, q);
    assert.ok(s <= 40, `got ${s}`);
  });

  test('karaoke / instrumental / tribute / piano versions are heavily penalized', () => {
    for (const [trackName, collectionName, artistName] of [
      ['Flowers (Karaoke Version)', 'Hadestown Karaoke', 'Broadway Karaoke'],
      ['Flowers (Instrumental)', 'Hadestown Backing Tracks', 'Stage Tracks'],
      ['Flowers', 'A Tribute to Hadestown', 'The Tribute Players'],
      ['Flowers', 'Hadestown on Piano', 'Piano Dreamers'],
      ['Flowers (Originally Performed by Eva Noblezada)', 'Hadestown Hits', 'Sing Along Stars'],
      ['Flowers (In the Style of Hadestown)', 'Karaoke Hits', 'Ameritz'],
      ['Talking Flowers', 'Talking Hadestown: Commentary & Songs', 'Hadestown Original Broadway Company'],
    ]) {
      const s = scoreCandidate({ trackName, collectionName, artistName }, q);
      assert.ok(s < 40, `${trackName} / ${collectionName}: ${s}`);
    }
  });

  test('a reprise only matches a reprise', () => {
    const intoTheWoods = 'Into the Woods (Original Broadway Cast Recording)';
    const agony = { title: 'Agony', show: 'Into The Woods' };
    const reprise = { title: 'Agony (Reprise)', show: 'Into The Woods' };
    const plainTrack = { trackName: 'Agony', collectionName: intoTheWoods, artistName: 'Robert Westenberg' };
    const repriseTrack = { trackName: 'Agony (Reprise)', collectionName: intoTheWoods, artistName: 'Robert Westenberg' };
    assert.ok(scoreCandidate(plainTrack, agony) >= 85);
    assert.ok(scoreCandidate(repriseTrack, reprise) >= 85);
    assert.ok(scoreCandidate(repriseTrack, agony) < 60);
    assert.ok(scoreCandidate(plainTrack, reprise) < 60);
  });

  test('slash medleys and prefixes', () => {
    const q2 = { title: 'I Know Those Eyes/This Man Is Dead', show: 'The Count of Monte Cristo' };
    const both = scoreCandidate({ trackName: 'I Know Those Eyes / This Man Is Dead', collectionName: 'The Count of Monte Cristo (Original Cast Recording)', artistName: 'x' }, q2);
    assert.ok(both >= 85, `both: ${both}`);
    const one = scoreCandidate({ trackName: 'This Man Is Dead', collectionName: 'The Count of Monte Cristo (Original Cast Recording)', artistName: 'x' }, q2);
    assert.ok(one >= 60 && one < both, `one: ${one}`);
    const prologue = scoreCandidate({ trackName: 'What Have I Done?', collectionName: 'Les Misérables (Original London Cast Recording)', artistName: 'Colm Wilkinson' }, { title: 'Prologue: What Have I Done', show: 'Les Miserables' });
    assert.ok(prologue >= 70, `prologue: ${prologue}`);
  });

  test('parentheticals, accents and "From …" suffixes are ignored', () => {
    const s = scoreCandidate({ trackName: 'Feed Me (Git It)', collectionName: 'Little Shop of Horrors (Original Off-Broadway Cast)', artistName: 'Ron Taylor' }, { title: 'Feed Me (Git it!)', show: 'Little Shop of Horrors' });
    assert.ok(s >= 85, `feed me: ${s}`);
    const s2 = scoreCandidate({ trackName: 'Stars (From "Les Misérables")', collectionName: 'Les Misérables: The Complete Symphonic Recording', artistName: 'Philip Quast' }, { title: 'Stars', show: 'Les Miserables' });
    assert.ok(s2 >= 80, `stars: ${s2}`);
    const s3 = scoreCandidate({ trackName: 'Diva’s Lament (Whatever Happened to My Part?)', collectionName: "Monty Python's Spamalot (Original Broadway Cast Recording)", artistName: 'Sara Ramirez' }, { title: "Diva's Lament", show: 'SPAMalot' });
    assert.ok(s3 >= 80, `diva: ${s3}`);
  });

  test('a karaoke word inside the requested title is not penalized', () => {
    const s = scoreCandidate({ trackName: 'Piano Man', collectionName: 'Piano Man (Original Cast Recording)', artistName: 'x' }, { title: 'Piano Man', show: 'Piano Man' });
    assert.ok(s >= 85, `got ${s}`);
  });
});

describe('itunes + wikipedia fetch helpers', () => {
  test('searchItunes builds the request, maps and sorts candidates', async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({
        resultCount: 3,
        results: [
          track(1, 'Flowers (Karaoke Version)', 'Hadestown Karaoke', 'Karaoke Kings'),
          track(2, 'Flowers', HADESTOWN, 'Eva Noblezada'),
          { wrapperType: 'collection', collectionId: 5 },
        ],
      }), { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' } });
    };
    const res = await searchItunes({ title: 'Flowers', show: 'Hadestown', country: 'US' }, fetchImpl);
    const u = new URL(urls[0]);
    assert.equal(u.origin + u.pathname, 'https://itunes.apple.com/search');
    assert.equal(u.searchParams.get('entity'), 'song');
    assert.equal(u.searchParams.get('country'), 'US');
    assert.equal(u.searchParams.get('limit'), '25');
    assert.equal(u.searchParams.get('term'), 'Flowers Hadestown');
    assert.equal(res.length, 2);
    assert.equal(res[0].trackId, 2);
    assert.equal(res[0].artworkUrl, 'https://is1-ssl.mzstatic.com/image/thumb/Music/2/600x600bb.jpg');
    assert.equal(res[0].durationSeconds, 211);
    assert.equal(res[0].appleMusicUrl, 'https://music.apple.com/ca/album/x/2');
    assert.ok(res[0].score > res[1].score);
  });

  test('lookupCollectionTracks returns album tracks in order', async () => {
    const fetchImpl = async (url) => {
      const u = new URL(url);
      assert.equal(u.pathname, '/lookup');
      assert.equal(u.searchParams.get('id'), '777');
      return jsonResponse({ results: [{ wrapperType: 'collection', collectionId: 777 }, track(3, 'Three', 'Album', 'x', { trackNumber: 3 }), track(1, 'One', 'Album', 'x', { trackNumber: 1 })] });
    };
    const tracks = await lookupCollectionTracks(777, fetchImpl);
    assert.deepEqual(tracks.map((x) => x.trackName), ['One', 'Three']);
  });

  test('lookupWikipedia tries "(musical)" first and rejects non-theatre pages', async () => {
    const urls = [];
    const fetchImpl = async (url, opts) => {
      urls.push(url);
      assert.match(opts.headers['User-Agent'], /STARSongFinder/);
      if (url.includes('Hadestown_(musical)')) return jsonResponse({ title: 'x' }, { status: 404 });
      if (url.includes('/Hadestown?')) {
        return jsonResponse({
          type: 'standard', title: 'Hadestown', description: '2019 musical by Anaïs Mitchell', extract: 'Hadestown is a musical…',
          originalimage: { source: 'https://upload.wikimedia.org/wikipedia/en/x/Hadestown.jpg' },
          content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Hadestown' } },
        });
      }
      if (url.includes('Flowers')) return jsonResponse({ type: 'standard', title: 'Flowers', description: 'Plant reproductive structure', extract: 'A flower is…' });
      return jsonResponse({}, { status: 404 });
    };
    const r = await lookupWikipedia('Hadestown', fetchImpl);
    assert.equal(r.found, true);
    assert.equal(r.title, 'Hadestown');
    assert.equal(r.imageUrl, 'https://upload.wikimedia.org/wikipedia/en/x/Hadestown.jpg');
    assert.equal(r.wikiUrl, 'https://en.wikipedia.org/wiki/Hadestown');
    assert.match(urls[0], /Hadestown_\(musical\)|Hadestown_%28musical%29/);
    assert.deepEqual(await lookupWikipedia('Flowers', fetchImpl), { found: false });
  });
});

describe('lookup endpoints', () => {
  test('GET /api/lookup/itunes → top candidates, CA then US fallback, cached 1 h', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      const u = new URL(url);
      calls.push(u.searchParams.get('country'));
      if (u.searchParams.get('country') === 'CA') return jsonResponse({ resultCount: 0, results: [] });
      const results = [track(9, 'Flowers (Karaoke)', 'Karaoke Hits', 'Karaoke')];
      for (let i = 10; i < 22; i++) results.push(track(i, i === 10 ? 'Flowers' : `Other ${i}`, HADESTOWN));
      results.push(track(99, 'Flowers', HADESTOWN, 'x', { previewUrl: 'http://insecure.example.com/x.m4a' }));
      return jsonResponse({ resultCount: results.length, results });
    };
    const t = makeTestApp({ fetchImpl });
    try {
      const res = await request(t.app).get('/api/lookup/itunes?title=Flowers&show=Hadestown');
      assert.equal(res.status, 200);
      assert.deepEqual(calls, ['CA', 'US']);
      const c = res.body.candidates;
      assert.equal(c.length, 8, 'top 8');
      assert.deepEqual(Object.keys(c[0]).sort(), ['appleMusicUrl', 'artistName', 'artworkUrl', 'collectionName', 'durationSeconds', 'previewUrl', 'score', 'trackId', 'trackName']);
      assert.equal(c[0].trackId, 10);
      assert.ok(!c.some((x) => x.trackId === 99), 'non-https preview filtered');
      for (let i = 1; i < c.length; i++) assert.ok(c[i - 1].score >= c[i].score);
      const again = await request(t.app).get('/api/lookup/itunes?title=flowers&show=HADESTOWN');
      assert.equal(again.status, 200);
      assert.equal(calls.length, 2, 'served from cache');
      assert.equal((await request(t.app).get('/api/lookup/itunes?title=Flowers')).status, 400);
    } finally {
      t.cleanup();
    }
  });

  test('GET /api/lookup/itunes → 502 when Apple is unreachable', async () => {
    const t = makeTestApp({ fetchImpl: async () => { throw new Error('offline'); } });
    try {
      const res = await request(t.app).get('/api/lookup/itunes?title=Flowers&show=Hadestown');
      assert.equal(res.status, 502);
      assert.ok(res.body.error);
    } finally {
      t.cleanup();
    }
  });

  test('GET /api/lookup/wikipedia', async () => {
    let n = 0;
    const fetchImpl = async (url) => {
      n++;
      if (url.includes('Shucked_(musical)') || url.includes('Shucked_%28musical%29')) {
        return jsonResponse({ type: 'standard', title: 'Shucked (musical)', description: 'Musical comedy', extract: 'Shucked is a musical with music by Brandy Clark and Shane McAnally.', thumbnail: { source: 'https://evil.example.com/x.jpg' } });
      }
      return jsonResponse({}, { status: 404 });
    };
    const t = makeTestApp({ fetchImpl });
    try {
      const res = await request(t.app).get('/api/lookup/wikipedia?name=Shucked');
      assert.equal(res.status, 200);
      assert.equal(res.body.found, true);
      assert.equal(res.body.title, 'Shucked (musical)');
      assert.equal(res.body.imageUrl, null, 'non-wikimedia image dropped');
      assert.ok(res.body.wikiUrl.startsWith('https://en.wikipedia.org/wiki/'));
      await request(t.app).get('/api/lookup/wikipedia?name=shucked');
      assert.equal(n, 1, 'cached');
      const missing = await request(t.app).get('/api/lookup/wikipedia?name=Zzzz%20Not%20A%20Show');
      assert.deepEqual(missing.body, { found: false });
      assert.equal((await request(t.app).get('/api/lookup/wikipedia')).status, 400);
    } finally {
      t.cleanup();
    }
  });

  test('lookups are rate limited (30/min)', async () => {
    const t = makeTestApp({ env: { STAR_LOOKUP_LIMIT: '3' }, fetchImpl: async () => jsonResponse({}, { status: 404 }) });
    try {
      for (let i = 0; i < 3; i++) assert.equal((await request(t.app).get(`/api/lookup/wikipedia?name=Show${i}`)).status, 200);
      assert.equal((await request(t.app).get('/api/lookup/wikipedia?name=Show9')).status, 429);
    } finally {
      t.cleanup();
    }
  });
});

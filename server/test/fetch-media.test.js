// scripts/fetch-media.js: downloads the seed posters/album art (not in the repository) from their
// sources into a media folder. Offline: a fake fetch stands in for Wikipedia and Apple.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchMedia, main, collectJobs } from '../scripts/fetch-media.js';
import { WIKI_USER_AGENT } from '../src/lib/wikipedia.js';
import { fetchRemoteImage, RemoteImageError } from '../src/lib/remote-image.js';
import { PNG, JPEG } from './helpers.js';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const WIKI = 'https://upload.wikimedia.org/wikipedia/en';
const ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4';

/** A temp seed dir (shows.json + media.json) and an empty media dir path. */
function setup({ shows, media } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'star-fetch-media-'));
  tmpDirs.push(dir);
  const seedDir = path.join(dir, 'seed');
  const mediaDir = path.join(dir, 'media');
  fs.mkdirSync(seedDir);
  fs.writeFileSync(path.join(seedDir, 'shows.json'), JSON.stringify(shows ?? [
    { name: 'Hadestown', imageFile: 'hadestown.png', imageSourceUrl: `${WIKI}/7/75/Hadestown.png` },
    { name: 'Cabaret', imageFile: 'cabaret.jpg', imageSourceUrl: `${WIKI}/7/7f/Cabaret.jpg` },
    { name: 'No Poster' },
  ]));
  fs.writeFileSync(path.join(seedDir, 'media.json'), JSON.stringify(media ?? {
    _about: 'test',
    'solo|Hadestown|Flowers': { artworkFile: 'aaaa.jpg', artworkUrl: `${ART}/hadestown/600x600bb.jpg` },
    'duet|Hadestown|Wedding Song': { artworkFile: 'aaaa.jpg', artworkUrl: `${ART}/hadestown/600x600bb.jpg` },
    'solo|Cabaret|Maybe This Time': { artworkFile: 'bbbb.jpg', artworkUrl: `${ART}/cabaret/600x600bb.jpg` },
    'solo|Cabaret|No Match': null,
  }));
  return { dir, seedDir, mediaDir };
}

/** Fake image server: url → Response factory (default: a png for .png URLs, a jpeg otherwise). */
function fakeFetch(routes = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ua: init?.headers?.['User-Agent'] });
    const route = routes[url];
    if (route) return route(calls.filter((c) => c.url === url).length);
    const png = url.endsWith('.png');
    return new Response(png ? PNG : JPEG, { status: 200, headers: { 'content-type': png ? 'image/png' : 'image/jpeg' } });
  };
  return { fetchImpl, calls };
}

const quiet = { log: () => {}, pause: async () => {} };

/** What Node's fetch throws with no network: TypeError('fetch failed') with the DNS error as its cause. */
const netError = (code = 'EAI_AGAIN') => new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ${code} upload.wikimedia.org`), { code }) });
const read = (t, rel) => fs.readFileSync(path.join(t.mediaDir, rel));

describe('fetch-media', () => {
  test('collectJobs: one job per target file; shared art is listed once', () => {
    const t = setup();
    const { jobs } = collectJobs(t.seedDir);
    assert.deepEqual(jobs.map((j) => `${j.subdir}/${j.file}`), ['shows/hadestown.png', 'shows/cabaret.jpg', 'art/aaaa.jpg', 'art/bbbb.jpg']);
    assert.deepEqual(jobs[2].labels, ['solo|Hadestown|Flowers', 'duet|Hadestown|Wedding Song']);
  });

  test('downloads missing images (each URL once, Wikipedia User-Agent), then skips them when they are valid', async () => {
    const t = setup();
    const f = fakeFetch();
    const s = await fetchMedia({ seedDir: t.seedDir, mediaDir: t.mediaDir, fetchImpl: f.fetchImpl, ...quiet });
    assert.equal(s.total, 4);
    assert.equal(s.downloaded, 4);
    assert.equal(s.failed.length, 0);
    assert.equal(f.calls.length, 4, 'the shared album cover is downloaded once');
    assert.ok(f.calls.every((c) => c.ua === WIKI_USER_AGENT));
    assert.deepEqual(read(t, 'shows/hadestown.png'), PNG);
    assert.deepEqual(read(t, 'shows/cabaret.jpg'), JPEG);
    assert.deepEqual(read(t, 'art/aaaa.jpg'), JPEG);
    assert.deepEqual(fs.readdirSync(path.join(t.mediaDir, 'art')).sort(), ['aaaa.jpg', 'bbbb.jpg'], 'no temp files left behind');

    const again = await fetchMedia({ seedDir: t.seedDir, mediaDir: t.mediaDir, fetchImpl: f.fetchImpl, ...quiet });
    assert.equal(again.present, 4);
    assert.equal(again.downloaded, 0);
    assert.equal(f.calls.length, 4, 'nothing downloaded again');
  });

  test('an invalid file on disk is replaced; --force downloads valid ones again too', async () => {
    const t = setup();
    fs.mkdirSync(path.join(t.mediaDir, 'shows'), { recursive: true });
    fs.mkdirSync(path.join(t.mediaDir, 'art'), { recursive: true });
    fs.writeFileSync(path.join(t.mediaDir, 'shows', 'hadestown.png'), '<html>captive portal</html>');
    fs.writeFileSync(path.join(t.mediaDir, 'shows', 'cabaret.jpg'), PNG); // an image, but not the type its name says
    fs.writeFileSync(path.join(t.mediaDir, 'art', 'aaaa.jpg'), JPEG);
    fs.writeFileSync(path.join(t.mediaDir, 'art', 'bbbb.jpg'), JPEG.subarray(0, 40)); // truncated
    const f = fakeFetch();
    const s = await fetchMedia({ seedDir: t.seedDir, mediaDir: t.mediaDir, fetchImpl: f.fetchImpl, ...quiet });
    assert.equal(s.present, 1);
    assert.equal(s.downloaded, 3);
    assert.deepEqual(f.calls.map((c) => c.url).sort(), [`${ART}/cabaret/600x600bb.jpg`, `${WIKI}/7/75/Hadestown.png`, `${WIKI}/7/7f/Cabaret.jpg`].sort());
    assert.deepEqual(read(t, 'shows/hadestown.png'), PNG);
    assert.deepEqual(read(t, 'shows/cabaret.jpg'), JPEG);
    assert.deepEqual(read(t, 'art/bbbb.jpg'), JPEG);

    const forced = await fetchMedia({ seedDir: t.seedDir, mediaDir: t.mediaDir, fetchImpl: f.fetchImpl, force: true, ...quiet });
    assert.equal(forced.downloaded, 4);
    assert.equal(forced.present, 0);
    assert.equal(f.calls.length, 7);
  });

  test('rejects hosts off the allowlist, http and non-images, and keeps going after a failure', async () => {
    const t = setup({
      shows: [
        { name: 'Evil', imageFile: 'evil.jpg', imageSourceUrl: 'https://evil.example.com/x.jpg' },
        { name: 'Plain http', imageFile: 'http.jpg', imageSourceUrl: 'http://upload.wikimedia.org/x.jpg' },
        { name: 'HTML page', imageFile: 'page.jpg', imageSourceUrl: `${WIKI}/page.jpg` },
        { name: 'Lying type', imageFile: 'lying.jpg', imageSourceUrl: `${WIKI}/lying.jpg` },
        { name: 'Gone', imageFile: 'gone.jpg', imageSourceUrl: `${WIKI}/gone.jpg` },
        { name: 'PNG named jpg', imageFile: 'wrong-ext.jpg', imageSourceUrl: `${WIKI}/really.png` },
        { name: 'Sneaky', imageFile: '../../escape.jpg', imageSourceUrl: `${WIKI}/ok.jpg` },
        { name: 'Unsourced', imageFile: 'unsourced.jpg' },
        { name: 'Good', imageFile: 'good.jpg', imageSourceUrl: `${WIKI}/good.jpg` },
      ],
      media: {},
    });
    const f = fakeFetch({
      [`${WIKI}/page.jpg`]: () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      [`${WIKI}/lying.jpg`]: () => new Response('not really a jpeg at all', { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      [`${WIKI}/gone.jpg`]: () => new Response('nope', { status: 404 }),
    });
    const s = await fetchMedia({ seedDir: t.seedDir, mediaDir: t.mediaDir, fetchImpl: f.fetchImpl, ...quiet });
    const reasons = Object.fromEntries(s.failed.map((x) => [x.file, x.reason]));
    assert.deepEqual(Object.keys(reasons).sort(), [
      'shows/../../escape.jpg', 'shows/evil.jpg', 'shows/gone.jpg', 'shows/http.jpg', 'shows/lying.jpg', 'shows/page.jpg', 'shows/unsourced.jpg', 'shows/wrong-ext.jpg',
    ]);
    assert.match(reasons['shows/evil.jpg'], /https on upload\.wikimedia\.org/);
    assert.match(reasons['shows/http.jpg'], /https/);
    assert.match(reasons['shows/page.jpg'], /not an image/);
    assert.match(reasons['shows/lying.jpg'], /not a supported image/);
    assert.match(reasons['shows/gone.jpg'], /HTTP 404/);
    assert.match(reasons['shows/wrong-ext.jpg'], /png/);
    assert.match(reasons['shows/../../escape.jpg'], /plain image file name/);
    assert.match(reasons['shows/unsourced.jpg'], /no source URL/);
    assert.ok(!f.calls.some((c) => /evil|http:|ok\.jpg/.test(c.url)), 'rejected URLs are never requested');
    assert.equal(f.calls.filter((c) => c.url.endsWith('/gone.jpg')).length, 1, 'a 404 is not retried');
    assert.equal(s.downloaded, 1, 'the good one still arrives');
    assert.deepEqual(fs.readdirSync(path.join(t.mediaDir, 'shows')), ['good.jpg']);
    assert.equal(fs.existsSync(path.join(t.dir, 'escape.jpg')), false);
  });

  test('network errors and 429/5xx are retried with backoff (honouring Retry-After)', async () => {
    const t = setup({ shows: [{ name: 'Flaky', imageFile: 'flaky.jpg', imageSourceUrl: `${WIKI}/flaky.jpg` }], media: {} });
    const f = fakeFetch({
      [`${WIKI}/flaky.jpg`]: (n) => {
        if (n === 1) throw new TypeError('fetch failed');
        if (n === 2) return new Response('slow down', { status: 429, headers: { 'retry-after': '5' } });
        if (n === 3) return new Response('oops', { status: 503 });
        return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
      },
    });
    const waits = [];
    const s = await fetchMedia({
      seedDir: t.seedDir, mediaDir: t.mediaDir, fetchImpl: f.fetchImpl, log: () => {}, pause: async (ms) => waits.push(ms), delayMs: 7, backoffMs: 100,
    });
    assert.equal(s.downloaded, 1);
    assert.equal(f.calls.length, 4);
    assert.deepEqual(waits, [100, 5000, 400, 7], 'backoff 100, Retry-After 5 s, backoff 400, then the polite delay');

    const t2 = setup({ shows: [{ name: 'Down', imageFile: 'down.jpg', imageSourceUrl: `${WIKI}/down.jpg` }], media: {} });
    const down = fakeFetch({ [`${WIKI}/down.jpg`]: () => new Response('down', { status: 502 }) });
    const s2 = await fetchMedia({ seedDir: t2.seedDir, mediaDir: t2.mediaDir, fetchImpl: down.fetchImpl, ...quiet, retries: 2 });
    assert.equal(down.calls.length, 3, 'gives up after the retries');
    assert.match(s2.failed[0].reason, /HTTP 502/);
  });

  test('fetchRemoteImage reports the code behind a network error (and none for an HTTP error)', async () => {
    const url = `${WIKI}/x.jpg`;
    const codeOf = async (fetchImpl) => {
      const err = await fetchRemoteImage(url, { fetchImpl }).then(() => null, (e) => e);
      assert.ok(err instanceof RemoteImageError);
      return { code: err.code, retryable: err.retryable, status: err.status };
    };
    assert.deepEqual(await codeOf(async () => { throw netError('EAI_AGAIN'); }), { code: 'EAI_AGAIN', retryable: true, status: null });
    assert.deepEqual(await codeOf(async () => { throw netError('ECONNREFUSED'); }), { code: 'ECONNREFUSED', retryable: true, status: null });
    const aggregate = new TypeError('fetch failed', { cause: new AggregateError([Object.assign(new Error('x'), { code: 'ENETUNREACH' })]) });
    assert.equal((await codeOf(async () => { throw aggregate; })).code, 'ENETUNREACH');
    assert.equal((await codeOf(async () => { throw new DOMException('timed out', 'TimeoutError'); })).code, 'TIMEOUT');
    assert.equal((await codeOf(async () => { throw new TypeError('fetch failed'); })).code, null);
    assert.deepEqual(await codeOf(async () => new Response('down', { status: 503 })), { code: null, retryable: true, status: 503 });
  });

  test('offline: a site that fails to answer 3 times in a row is given up on, and its other images are skipped without a request', async () => {
    const t = setup({
      shows: ['one', 'two', 'three', 'four', 'five'].map((n) => ({ name: n, imageFile: `${n}.jpg`, imageSourceUrl: `${WIKI}/${n}.jpg` })),
    });
    const wiki = [];
    const f = fakeFetch(Object.fromEntries(['one', 'two', 'three', 'four', 'five'].map((n) => [`${WIKI}/${n}.jpg`, () => {
      wiki.push(n);
      throw netError('EAI_AGAIN');
    }])));
    const lines = [];
    const waits = [];
    const s = await fetchMedia({
      seedDir: t.seedDir, mediaDir: t.mediaDir, fetchImpl: f.fetchImpl, log: (m) => lines.push(m), pause: async (ms) => waits.push(ms),
      concurrency: 1, backoffMs: 100, delayMs: 7,
    });
    assert.deepEqual(wiki, ['one', 'one', 'one'], 'three tries of the first poster, then nothing more from that site');
    assert.deepEqual(waits, [100, 200, 7, 7, 7], 'backoff twice, then only the polite delay after each real request (none for skipped ones)');
    assert.equal(s.downloaded, 2, 'the album art (a different site) still downloads');
    assert.equal(s.failed.length, 5);
    assert.equal(s.skipped, 4);
    assert.equal(s.requests, 3, 'one poster URL and two album-art URLs were requested');
    const reasons = Object.fromEntries(s.failed.map((x) => [x.file, x.reason]));
    assert.equal(reasons['shows/one.jpg'], "Couldn't download image: network error (EAI_AGAIN)");
    for (const n of ['two', 'three', 'four', 'five']) assert.equal(reasons[`shows/${n}.jpg`], "skipped — couldn't reach upload.wikimedia.org (EAI_AGAIN)");
    assert.equal(lines.filter((l) => /Couldn't reach upload\.wikimedia\.org 3 times in a row \(EAI_AGAIN\)/.test(l)).length, 1);
    assert.equal(lines.filter((l) => l.includes('✗')).length, 1, 'skipped images are counted, not listed one by one');
    assert.match(lines.at(-2), /5 of 7 image\(s\) couldn't be downloaded \(0 already here, 2 downloaded, 4 skipped because their site couldn't be reached\)/);
    assert.match(lines.at(-1), /npm run fetch-media/);

    // the default two-at-a-time run with no network at all: a handful of requests, not 4 tries of every image
    const t2 = setup({
      shows: Array.from({ length: 10 }, (_, i) => ({ name: `s${i}`, imageFile: `s${i}.jpg`, imageSourceUrl: `${WIKI}/s${i}.jpg` })),
      media: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`solo|S${i}|Song`, { artworkFile: `a${i}.jpg`, artworkUrl: `${ART}/a${i}/600x600bb.jpg` }])),
    });
    let calls = 0;
    const offline = async () => {
      calls++;
      throw netError('EAI_AGAIN');
    };
    const s2 = await fetchMedia({ seedDir: t2.seedDir, mediaDir: t2.mediaDir, fetchImpl: offline, ...quiet });
    assert.equal(s2.failed.length, 20);
    assert.ok(calls <= 8, `${calls} requests: at most 3 (+1 already under way) per site`);
    assert.ok(s2.skipped >= 16);
  });

  test('timeouts count as no answer too; any answer (even an error status) resets the count', async () => {
    const names = ['one', 'two', 'three', 'four'];
    const t = setup({ shows: names.map((n) => ({ name: n, imageFile: `${n}.jpg`, imageSourceUrl: `${WIKI}/${n}.jpg` })), media: {} });
    const slow = fakeFetch(Object.fromEntries(names.map((n) => [`${WIKI}/${n}.jpg`, () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }])));
    const s = await fetchMedia({ seedDir: t.seedDir, mediaDir: t.mediaDir, fetchImpl: slow.fetchImpl, ...quiet, concurrency: 1 });
    assert.equal(slow.calls.length, 3);
    assert.match(s.failed[0].reason, /timed out$/);
    assert.equal(s.failed[1].reason, "skipped — couldn't reach upload.wikimedia.org (timed out)");

    // each poster fails once with no answer, then works: never 3 in a row, so nothing is skipped
    const t2 = setup({ shows: names.map((n) => ({ name: n, imageFile: `${n}.jpg`, imageSourceUrl: `${WIKI}/${n}.jpg` })), media: {} });
    const flaky = fakeFetch(Object.fromEntries(names.map((n) => [`${WIKI}/${n}.jpg`, (count) => {
      if (count === 1) throw netError('ECONNRESET');
      return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }])));
    const s2 = await fetchMedia({ seedDir: t2.seedDir, mediaDir: t2.mediaDir, fetchImpl: flaky.fetchImpl, ...quiet, concurrency: 1 });
    assert.equal(s2.downloaded, 4);
    assert.equal(s2.skipped, 0);

    // a site that answers with errors is up: 5xx is retried per image but never trips the breaker
    const t3 = setup({ shows: names.map((n) => ({ name: n, imageFile: `${n}.jpg`, imageSourceUrl: `${WIKI}/${n}.jpg` })), media: {} });
    const broken = fakeFetch(Object.fromEntries(names.map((n) => [`${WIKI}/${n}.jpg`, () => new Response('oops', { status: 500 })])));
    const s3 = await fetchMedia({ seedDir: t3.seedDir, mediaDir: t3.mediaDir, fetchImpl: broken.fetchImpl, ...quiet, concurrency: 1, retries: 1 });
    assert.equal(broken.calls.length, 8, 'two tries of each of the four posters');
    assert.equal(s3.skipped, 0);
  });

  test('--dry-run makes no requests and writes nothing', async () => {
    const t = setup();
    const f = fakeFetch();
    const lines = [];
    const code = await main(['--dry-run', '--seed-dir', t.seedDir, '--media-dir', t.mediaDir], { fetchImpl: f.fetchImpl, log: (m) => lines.push(m), pause: async () => {} });
    assert.equal(code, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(fs.existsSync(t.mediaDir), false);
    assert.equal(lines.filter((l) => l.includes('would download')).length, 4);
    assert.match(lines.at(-1), /4 to download \(dry run/);
  });

  test('exit status: 0 with a warning when downloads fail (offline setup), 1 with --strict or bad usage', async () => {
    const t = setup();
    const offline = async () => {
      throw new TypeError('fetch failed');
    };
    const lines = [];
    const errors = [];
    const deps = { fetchImpl: offline, log: (m) => lines.push(m), error: (m) => errors.push(m), pause: async () => {} };
    assert.equal(await main(['--seed-dir', t.seedDir, '--media-dir', t.mediaDir], deps), 0);
    assert.ok(lines.some((l) => /4 of 4 image\(s\) couldn't be downloaded/.test(l)));
    assert.ok(lines.some((l) => /npm run fetch-media/.test(l)));
    assert.equal(await main(['--strict', '--seed-dir', t.seedDir, '--media-dir', t.mediaDir], deps), 1);
    assert.ok(errors.some((e) => /--strict: 4 image/.test(e)));
    assert.equal(await main(['--bogus'], deps), 1);
    assert.equal(await main(['--media-dir'], deps), 1);

    // --strict with everything downloaded is fine
    const good = fakeFetch();
    assert.equal(await main(['--strict', '--seed-dir', t.seedDir, '--media-dir', t.mediaDir], { ...deps, fetchImpl: good.fetchImpl }), 0);

    // relative paths resolve from where the command was run (INIT_CWD under npm)
    const t2 = setup();
    const code = await main(['--seed-dir', 'seed', '--media-dir', 'out'], { ...deps, fetchImpl: good.fetchImpl, env: { INIT_CWD: t2.dir } });
    assert.equal(code, 0);
    assert.ok(fs.existsSync(path.join(t2.dir, 'out', 'art', 'aaaa.jpg')));
  });

  test('a missing seed dir is nothing to do; a broken seed file is an error', async () => {
    const t = setup();
    const empty = await fetchMedia({ seedDir: path.join(t.dir, 'nope'), mediaDir: t.mediaDir, fetchImpl: fakeFetch().fetchImpl, ...quiet });
    assert.equal(empty.total, 0);
    fs.writeFileSync(path.join(t.seedDir, 'media.json'), '[]');
    const errors = [];
    assert.equal(await main(['--seed-dir', t.seedDir, '--media-dir', t.mediaDir], { log: () => {}, error: (m) => errors.push(m) }), 1);
    assert.match(errors[0], /media\.json must be an object/);
  });
});

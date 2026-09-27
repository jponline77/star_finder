import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import {
  makeTestApp, signup, signupAdmin, soloBody, CSRF, MP3, MP3_FRAME, M4A, WAV, PNG, JPEG, SVG, HTML, FIXTURES, fixture,
} from './helpers.js';
import {
  sniffAudio, sniffImage, createUploadGuard, sweepIncoming, findOrphanUploads,
} from '../src/lib/uploads.js';

const onDisk = (t, publicPath) => path.join(t.uploadsDir, publicPath.replace(/^\/uploads\//, ''));

describe('magic-byte sniffing', () => {
  test('audio', () => {
    assert.equal(sniffAudio(MP3).ext, 'mp3');
    assert.equal(sniffAudio(MP3_FRAME).ext, 'mp3');
    assert.equal(sniffAudio(M4A).ext, 'm4a');
    assert.equal(sniffAudio(WAV).ext, 'wav');
    assert.equal(sniffAudio(fixture('tone.aiff')).ext, 'aiff');
    assert.equal(sniffAudio(fixture('tone.ogg')).ext, 'ogg');
    assert.equal(sniffAudio(fixture('tone.aac')).ext, 'aac');
    assert.equal(sniffAudio(path.join(FIXTURES, 'tone.m4a')).ext, 'm4a', 'reads files on disk too');
    assert.equal(sniffAudio(HTML), null);
    assert.equal(sniffAudio(PNG), null);
  });
  test('mp3: the ID3 tags (titles, names, cover art) are left out of the stored range', () => {
    const k = sniffAudio(MP3);
    assert.deepEqual([k.start, k.end], [94, MP3.length - 128]);
    assert.doesNotMatch(MP3.subarray(k.start, k.end).toString('latin1'), /Student Name|Fixture Title/);
    assert.match(MP3.toString('latin1'), /Student Name/, 'the fixture really has tags');
  });
  test('audio-looking prefixes on something else are rejected', () => {
    const id3 = MP3.subarray(0, 94);
    assert.equal(sniffAudio(Buffer.concat([id3, HTML, HTML, HTML])), null, 'ID3 + HTML');
    assert.equal(sniffAudio(Buffer.concat([id3, Buffer.alloc(8000, 0x55)])), null, 'ID3 + filler');
    assert.equal(sniffAudio(Buffer.concat([MP3_FRAME.subarray(0, 50), Buffer.alloc(3000, 0x41)])), null, 'one frame header + junk');
    assert.equal(sniffAudio(fixture('video.mp4')), null, 'MP4 with a video track');
    assert.equal(sniffAudio(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypisom\0\0\0\0isom'), crypto.randomBytes(4000)])), null, 'ftyp + random bytes');
    assert.equal(sniffAudio(fixture('video.ogv')), null, 'Ogg Theora video');
    assert.equal(sniffAudio(Buffer.concat([Buffer.from('FORM\0\0\0\0AIFF'), Buffer.alloc(16)])), null, 'AIFF without COMM/SSND');
    assert.equal(sniffAudio(Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE'), HTML])), null, 'WAVE without fmt/data');
    assert.equal(sniffAudio(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(40)])), null, 'OggS + zeros');
  });
  test('images', () => {
    assert.equal(sniffImage(PNG).ext, 'png');
    assert.equal(sniffImage(JPEG).ext, 'jpg');
    assert.equal(sniffImage(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)])).ext, 'gif');
    assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), Buffer.alloc(16)])).ext, 'webp');
    assert.equal(sniffImage(SVG), null);
    assert.equal(sniffImage(HTML), null);
  });
});

describe('uploads', () => {
  let t;
  let alice;
  let song;
  let show;
  before(async () => {
    t = makeTestApp();
    alice = await signup(t.app);
    song = (await alice.post('/api/songs', soloBody({ title: 'Upload Target' }))).body;
    show = (await alice.post('/api/shows', { name: 'Poster Target' })).body;
  });
  after(() => t.cleanup());

  test('valid mp3 accepted, served with audio type + nosniff; replacing deletes the old file', async () => {
    const res = await alice.upload(`/api/songs/${song.id}/audio`, MP3, 'my track.mp3', 'audio/mpeg');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const url = res.body.media.audioUrl;
    assert.match(url, /^\/uploads\/audio\/[0-9a-f-]{36}\.mp3$/);
    assert.ok(fs.existsSync(onDisk(t, url)));
    const served = await request(t.app).get(url);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'audio/mpeg');
    assert.equal(served.headers['x-content-type-options'], 'nosniff');

    // file type decided by bytes, not by name/claimed type
    const m4a = await alice.upload(`/api/songs/${song.id}/audio`, M4A, 'song.mp3', 'audio/mpeg');
    assert.equal(m4a.status, 200);
    assert.match(m4a.body.media.audioUrl, /\.m4a$/);
    assert.ok(!fs.existsSync(onDisk(t, url)), 'old upload removed');

    const wav = await alice.upload(`/api/songs/${song.id}/audio`, WAV, 'x.wav', 'audio/wav');
    assert.equal(wav.status, 200);
    assert.match(wav.body.media.audioUrl, /\.wav$/);
  });

  test('non-audio rejected (HTML named .mp3, PNG)', async () => {
    const html = await alice.upload(`/api/songs/${song.id}/audio`, HTML, 'evil.mp3', 'audio/mpeg');
    assert.equal(html.status, 400);
    assert.ok(html.body.details.file);
    assert.equal((await alice.upload(`/api/songs/${song.id}/audio`, PNG, 'x.mp3', 'audio/mpeg')).status, 400);
    const none = await alice.agent.post(`/api/songs/${song.id}/audio`).set(CSRF).field('other', 'x');
    assert.equal(none.status, 400);
  });

  test('DELETE /api/songs/:id/audio removes the file', async () => {
    const res = await alice.upload(`/api/songs/${song.id}/audio`, MP3, 'a.mp3', 'audio/mpeg');
    const file = onDisk(t, res.body.media.audioUrl);
    assert.ok(fs.existsSync(file));
    const del = await alice.del(`/api/songs/${song.id}/audio`);
    assert.equal(del.status, 200);
    assert.equal(del.body.media.audioUrl, null);
    assert.ok(!fs.existsSync(file));
  });

  test('deleting a song removes its uploaded file', async () => {
    const s = (await alice.post('/api/songs', soloBody({ title: 'Doomed Song' }))).body;
    const res = await alice.upload(`/api/songs/${s.id}/audio`, MP3_FRAME, 'a.mp3', 'audio/mpeg');
    const file = onDisk(t, res.body.media.audioUrl);
    assert.ok(fs.existsSync(file));
    assert.equal((await alice.del(`/api/songs/${s.id}`)).status, 204);
    assert.ok(!fs.existsSync(file));
  });

  test('show image: png accepted; svg and html-disguised-as-png rejected; removed on delete', async () => {
    const ok = await alice.upload(`/api/shows/${show.id}/image`, PNG, 'poster.png', 'image/png');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.imageUrl, /^\/uploads\/images\/[0-9a-f-]{36}\.png$/);
    assert.ok(ok.body.imageCredit.startsWith('Uploaded by'));
    const file = onDisk(t, ok.body.imageUrl);
    assert.ok(fs.existsSync(file));

    const svg = await alice.upload(`/api/shows/${show.id}/image`, SVG, 'poster.svg', 'image/svg+xml');
    assert.equal(svg.status, 400);
    const html = await alice.upload(`/api/shows/${show.id}/image`, HTML, 'poster.png', 'image/png');
    assert.equal(html.status, 400);

    const jpg = await alice.upload(`/api/shows/${show.id}/image`, JPEG, 'poster.jpg', 'image/jpeg');
    assert.equal(jpg.status, 200);
    assert.ok(!fs.existsSync(file), 'replaced image removed');
    const file2 = onDisk(t, jpg.body.imageUrl);
    assert.equal((await alice.del(`/api/shows/${show.id}`)).status, 204);
    assert.ok(!fs.existsSync(file2), 'image removed with show');
  });

  test('image over 5 MB → 413', async () => {
    const s2 = (await alice.post('/api/shows', { name: 'Big Poster' })).body;
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await alice.upload(`/api/shows/${s2.id}/image`, big, 'big.png', 'image/png');
    assert.equal(res.status, 413);
  });

  test('upload routes need multipart + CSRF header', async () => {
    const json = await alice.agent.post(`/api/songs/${song.id}/audio`).set(CSRF).send({ file: 'x' });
    assert.equal(json.status, 415);
    const noCsrf = await alice.agent.post(`/api/songs/${song.id}/audio`).attach('file', MP3, 'a.mp3');
    assert.equal(noCsrf.status, 403);
  });

  test('path traversal in /uploads is not served', async () => {
    const res = await request(t.app).get('/uploads/../test.db');
    assert.notEqual(res.status, 200);
    const res2 = await request(t.app).get('/uploads/%2e%2e/test.db');
    assert.notEqual(res2.status, 200);
  });
});

describe('uploaded files: metadata is removed before publishing', () => {
  const SECRETS = /SERIAL-12345|PhoneMaker|COMMENT-SECRET|GIF-COMMENT-SECRET|Student Name|GPS 49|Location|Fixture Title/;

  test('a phone photo keeps its orientation but loses GPS, camera and comment data', async () => {
    const t = makeTestApp();
    try {
      const u = await signup(t.app);
      const show = (await u.post('/api/shows', { name: 'Photo Show' })).body;
      const photo = fixture('photo-exif.jpg');
      assert.match(photo.toString('latin1'), /SERIAL-12345/, 'fixture has EXIF');
      const res = await u.upload(`/api/shows/${show.id}/image`, photo, 'poster.jpg', 'image/jpeg');
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const served = (await request(t.app).get(res.body.imageUrl).buffer(true).parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })).body;
      assert.doesNotMatch(served.toString('latin1'), SECRETS);
      assert.equal(served[0], 0xff);
      assert.equal(served[1], 0xd8);
      // orientation 6 survives in a minimal Exif block (so the poster isn't shown sideways)
      const exif = served.indexOf(Buffer.from('Exif\0\0MM', 'latin1'));
      assert.ok(exif > 0);
      assert.equal(served.readUInt16BE(exif + 6 + 10), 0x0112);
      assert.equal(served.readUInt16BE(exif + 6 + 18), 6);
    } finally {
      t.cleanup();
    }
  });

  test('PNG text chunks, GIF comments and WebP EXIF are dropped; damaged images are rejected', async () => {
    const t = makeTestApp();
    try {
      const u = await signup(t.app);
      const show = (await u.post('/api/shows', { name: 'Meta Show' })).body;
      for (const [file, type] of [['meta.png', 'image/png'], ['meta.gif', 'image/gif'], ['meta.webp', 'image/webp']]) {
        const res = await u.upload(`/api/shows/${show.id}/image`, fixture(file), file, type);
        assert.equal(res.status, 200, `${file}: ${JSON.stringify(res.body)}`);
        const stored = fs.readFileSync(onDisk(t, res.body.imageUrl));
        assert.doesNotMatch(stored.toString('latin1'), SECRETS, file);
        assert.doesNotMatch(stored.toString('latin1'), /tEXt|iTXt|EXIF/, file);
      }
      const truncatedPng = fixture('plain.png').subarray(0, 40);
      const bad = await u.upload(`/api/shows/${show.id}/image`, truncatedPng, 'x.png', 'image/png');
      assert.equal(bad.status, 400);
    } finally {
      t.cleanup();
    }
  });

  test('mp3 uploads are stored without their ID3 tags', async () => {
    const t = makeTestApp();
    try {
      const u = await signup(t.app);
      const song = (await u.post('/api/songs', soloBody({ title: 'Tagged' }))).body;
      const res = await u.upload(`/api/songs/${song.id}/audio`, MP3, 'song.mp3', 'audio/mpeg');
      assert.equal(res.status, 200);
      const stored = fs.readFileSync(onDisk(t, res.body.media.audioUrl));
      assert.deepEqual(stored, MP3_FRAME);
      assert.doesNotMatch(stored.toString('latin1'), SECRETS);
    } finally {
      t.cleanup();
    }
  });
});

describe('upload resource limits', () => {
  const incoming = (t) => fs.readdirSync(path.join(t.uploadsDir, '.incoming'));

  test('uploads stream to a temp file on disk, which is always removed afterwards', async () => {
    const t = makeTestApp();
    try {
      const u = await signup(t.app);
      const song = (await u.post('/api/songs', soloBody({ title: 'Temp Files' }))).body;
      assert.equal((await u.upload(`/api/songs/${song.id}/audio`, MP3, 'a.mp3')).status, 200);
      assert.equal((await u.upload(`/api/songs/${song.id}/audio`, HTML, 'a.mp3')).status, 400);
      assert.deepEqual(incoming(t), []);
    } finally {
      t.cleanup();
    }
  });

  test('audio over 25 MB → 413 (and nothing left on disk)', async () => {
    const t = makeTestApp();
    try {
      const u = await signup(t.app);
      const song = (await u.post('/api/songs', soloBody({ title: 'Too Big' }))).body;
      const big = Buffer.concat([MP3, Buffer.alloc(25 * 1024 * 1024)]);
      const res = await u.upload(`/api/songs/${song.id}/audio`, big, 'big.mp3', 'audio/mpeg');
      assert.equal(res.status, 413);
      assert.deepEqual(fs.readdirSync(path.join(t.uploadsDir, 'audio')), []);
      assert.deepEqual(incoming(t), []);
    } finally {
      t.cleanup();
    }
  });

  test('per-user upload quota (admins exempt)', async () => {
    const quotaMb = (MP3_FRAME.length * 1.5) / (1024 * 1024); // room for one track
    const t = makeTestApp({ env: { STAR_UPLOAD_QUOTA_MB: String(quotaMb) } });
    try {
      const u = await signup(t.app);
      const a = (await u.post('/api/songs', soloBody({ title: 'Quota A' }))).body;
      const b = (await u.post('/api/songs', soloBody({ title: 'Quota B' }))).body;
      assert.equal((await u.upload(`/api/songs/${a.id}/audio`, MP3, 'a.mp3')).status, 200);
      assert.equal((await u.upload(`/api/songs/${a.id}/audio`, MP3, 'a.mp3')).status, 200, 'replacing your own file is fine');
      const over = await u.upload(`/api/songs/${b.id}/audio`, MP3, 'b.mp3');
      assert.equal(over.status, 413);
      assert.match(over.body.error, /upload space/);
      assert.equal((await u.del(`/api/songs/${a.id}/audio`)).status, 200);
      assert.equal((await u.upload(`/api/songs/${b.id}/audio`, MP3, 'b.mp3')).status, 200, 'space freed');
      const admin = await signupAdmin(t.app, t.db);
      const c = (await admin.post('/api/songs', soloBody({ title: 'Admin Q1' }))).body;
      const d = (await admin.post('/api/songs', soloBody({ title: 'Admin Q2' }))).body;
      assert.equal((await admin.upload(`/api/songs/${c.id}/audio`, MP3, 'c.mp3')).status, 200);
      assert.equal((await admin.upload(`/api/songs/${d.id}/audio`, MP3, 'd.mp3')).status, 200);
    } finally {
      t.cleanup();
    }
  });

  test('uploads pause when the disk is nearly full', async () => {
    const t = makeTestApp({ env: { STAR_MIN_FREE_MB: String(1024 * 1024 * 1024) } });
    try {
      const u = await signup(t.app);
      const song = (await u.post('/api/songs', soloBody({ title: 'Disk Full' }))).body;
      const res = await u.upload(`/api/songs/${song.id}/audio`, MP3, 'a.mp3');
      assert.equal(res.status, 507);
    } finally {
      t.cleanup();
    }
  });

  test('one account can only run a couple of uploads at once', () => {
    const t = makeTestApp({ env: { STAR_UPLOAD_CONCURRENCY: '2' } });
    try {
      const guard = createUploadGuard({ db: t.db, uploadsDir: t.uploadsDir, env: { STAR_UPLOAD_CONCURRENCY: '2', STAR_MIN_FREE_MB: '0' } });
      const req = { user: { id: 7, role: 'user' } };
      const results = [];
      const responses = [new EventEmitter(), new EventEmitter(), new EventEmitter()];
      for (const res of responses) guard.before(req, res, (err) => results.push(err?.status ?? 'ok'));
      assert.deepEqual(results, ['ok', 'ok', 429]);
      responses[0].emit('close');
      guard.before(req, new EventEmitter(), (err) => results.push(err?.status ?? 'ok'));
      assert.equal(results[3], 'ok', 'a slot frees up when an upload finishes');
      guard.before({ user: { id: 8, role: 'user' } }, new EventEmitter(), (err) => results.push(err?.status ?? 'ok'));
      assert.equal(results[4], 'ok', 'other accounts are unaffected');
      // …up to a site-wide cap on simultaneous uploads
      const site = createUploadGuard({ db: t.db, uploadsDir: t.uploadsDir, env: { STAR_UPLOAD_TOTAL_CONCURRENCY: '3', STAR_MIN_FREE_MB: '0' } });
      const statuses = [];
      for (let id = 1; id <= 4; id++) site.before({ user: { id, role: 'user' } }, new EventEmitter(), (err) => statuses.push(err?.status ?? 'ok'));
      assert.deepEqual(statuses, ['ok', 'ok', 'ok', 503]);
      assert.equal(site.totalActive(), 3);
    } finally {
      t.cleanup();
    }
  });

  test('overlapping uploads to one song leave exactly one file (no orphans)', async () => {
    const t = makeTestApp({ env: { STAR_UPLOAD_CONCURRENCY: '10' } });
    try {
      const u = await signup(t.app);
      const song = (await u.post('/api/songs', soloBody({ title: 'Race' }))).body;
      const results = await Promise.all(Array.from({ length: 6 }, () => u.upload(`/api/songs/${song.id}/audio`, MP3, 'a.mp3')));
      for (const r of results) assert.equal(r.status, 200);
      const files = fs.readdirSync(path.join(t.uploadsDir, 'audio'));
      const current = t.db.prepare('SELECT audio_path FROM songs WHERE id = ?').get(song.id).audio_path;
      assert.deepEqual(files, [path.basename(current)]);
      const show = (await u.post('/api/shows', { name: 'Race Show' })).body;
      const posters = await Promise.all(Array.from({ length: 5 }, () => u.upload(`/api/shows/${show.id}/image`, PNG, 'p.png', 'image/png')));
      for (const r of posters) assert.equal(r.status, 200);
      const images = fs.readdirSync(path.join(t.uploadsDir, 'images'));
      assert.deepEqual(images, [path.basename(t.db.prepare('SELECT image_path FROM shows WHERE id = ?').get(show.id).image_path)]);
    } finally {
      t.cleanup();
    }
  });

  test('stale temp files are swept; unused files are found for `npm run clean-uploads`', async () => {
    const t = makeTestApp();
    try {
      const u = await signup(t.app);
      const song = (await u.post('/api/songs', soloBody({ title: 'Keep Me' }))).body;
      const kept = (await u.upload(`/api/songs/${song.id}/audio`, MP3, 'a.mp3')).body.media.audioUrl;
      const old = Date.now() / 1000 - 2 * 3600;
      const tmp = path.join(t.uploadsDir, '.incoming', 'crashed.part');
      fs.writeFileSync(tmp, 'x');
      fs.utimesSync(tmp, old, old);
      const fresh = path.join(t.uploadsDir, '.incoming', 'in-progress.part');
      fs.writeFileSync(fresh, 'x');
      assert.equal(sweepIncoming(t.uploadsDir), 1);
      assert.ok(!fs.existsSync(tmp) && fs.existsSync(fresh));
      const orphan = path.join(t.uploadsDir, 'audio', 'orphan.mp3');
      fs.writeFileSync(orphan, MP3);
      fs.utimesSync(orphan, old, old);
      fs.utimesSync(onDisk(t, kept), old, old);
      assert.deepEqual(findOrphanUploads(t.db, t.uploadsDir).map((o) => o.publicPath), ['/uploads/audio/orphan.mp3']);
    } finally {
      t.cleanup();
    }
  });
});

describe('poster permissions and replacement', () => {
  test("only the show's creator or an admin can upload its poster", async () => {
    const t = makeTestApp();
    try {
      const alice = await signup(t.app);
      const bob = await signup(t.app);
      const admin = await signupAdmin(t.app, t.db);
      const show = (await alice.post('/api/shows', { name: 'Alice Poster' })).body;
      const res = await bob.upload(`/api/shows/${show.id}/image`, PNG, 'p.png', 'image/png');
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'You can only edit shows you added');
      assert.equal((await request(t.app).post(`/api/shows/${show.id}/image`).set(CSRF).attach('file', PNG, 'p.png')).status, 401);
      assert.equal((await admin.upload(`/api/shows/${show.id}/image`, PNG, 'p.png', 'image/png')).status, 200);
      assert.deepEqual(fs.readdirSync(path.join(t.uploadsDir, '.incoming')), []);
    } finally {
      t.cleanup();
    }
  });

  test('replacing an uploaded poster with an https image (or none) deletes the uploaded file', async () => {
    const fetchImpl = async () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    const t = makeTestApp({ fetchImpl });
    try {
      const u = await signup(t.app);
      const show = (await u.post('/api/shows', { name: 'Swap Poster' })).body;
      const up = await u.upload(`/api/shows/${show.id}/image`, PNG, 'p.png', 'image/png');
      const uploaded = onDisk(t, up.body.imageUrl);
      assert.ok(fs.existsSync(uploaded));
      const wiki = await u.put(`/api/shows/${show.id}`, { imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.png' });
      assert.equal(wiki.status, 200);
      assert.ok(!fs.existsSync(uploaded), 'uploaded poster removed');
      const downloaded = onDisk(t, wiki.body.imageUrl);
      assert.ok(fs.existsSync(downloaded));
      await u.put(`/api/shows/${show.id}`, { imageUrl: null });
      assert.ok(!fs.existsSync(downloaded));
    } finally {
      t.cleanup();
    }
  });
});

describe('images downloaded from Apple/Wikipedia', () => {
  test('are kept in uploads/, replaced files are deleted, the same link is not downloaded again, and deleting the row deletes them', async () => {
    let downloads = 0;
    const fetchImpl = async () => {
      downloads++;
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    };
    const t = makeTestApp({ fetchImpl });
    try {
      const u = await signup(t.app);
      const base = 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.png';
      const show = (await u.post('/api/shows', { name: 'Orphan Test Show', imageUrl: base })).body;
      assert.match(show.imageUrl, /^\/uploads\/shows\/orphan-test-show-/);
      for (let v = 1; v <= 3; v++) {
        const res = await u.put(`/api/shows/${show.id}`, { imageUrl: `${base}?v=${v}` });
        assert.equal(res.status, 200);
      }
      assert.equal(fs.readdirSync(path.join(t.uploadsDir, 'shows')).length, 1, 'old posters deleted');
      const n = downloads;
      const same = await u.put(`/api/shows/${show.id}`, { name: 'Orphan Test Show', imageUrl: `${base}?v=3` });
      assert.equal(same.status, 200);
      assert.equal(downloads, n, 'the poster we already have is not downloaded again');
      assert.equal((await u.del(`/api/shows/${show.id}`)).status, 204);
      assert.deepEqual(fs.readdirSync(path.join(t.uploadsDir, 'shows')), []);
      assert.deepEqual(fs.readdirSync(t.mediaDir).filter((f) => !f.startsWith('.')), [], 'nothing in the committed media folder');

      // song art: replaced → old deleted; song deleted → art deleted; failed save → download deleted
      const preview = (n2) => ({ preview: { previewUrl: 'https://audio-ssl.itunes.apple.com/a.m4a', artworkUrl: `https://is1-ssl.mzstatic.com/${n2}/600x600bb.jpg` } });
      const song = (await u.post('/api/songs', soloBody({ title: 'Art Swap', ...preview('a') }))).body;
      await u.put(`/api/songs/${song.id}`, soloBody({ title: 'Art Swap', ...preview('b') }));
      assert.equal(fs.readdirSync(path.join(t.uploadsDir, 'art')).length, 1);
      const dup = await u.post('/api/songs', soloBody({ title: 'Art Swap', ...preview('c') }));
      assert.equal(dup.status, 409);
      assert.equal(fs.readdirSync(path.join(t.uploadsDir, 'art')).length, 1, "a rejected song's download is removed");
      assert.equal((await u.del(`/api/songs/${song.id}`)).status, 204);
      assert.deepEqual(fs.readdirSync(path.join(t.uploadsDir, 'art')), []);
    } finally {
      t.cleanup();
    }
  });
});

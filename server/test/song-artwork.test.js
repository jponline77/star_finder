// Song album-art uploads (SPEC §7c): POST/DELETE /api/songs/:id/artwork, the recording-art fallback,
// permissions, CSRF, file checks, quotas and clean-up.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import {
  makeTestApp, signup, signupAdmin, soloBody, CSRF, PNG, JPEG, SVG, HTML, MP3, fixture, insertShow, insertSong,
} from './helpers.js';
import { findOrphanUploads, userUploadBytes, isFileReferenced } from '../src/lib/uploads.js';

const onDisk = (t, publicPath) => path.join(t.uploadsDir, publicPath.replace(/^\/uploads\//, ''));

describe('song artwork upload', () => {
  let t;
  let alice;
  let bob;
  let admin;
  let song;
  before(async () => {
    t = makeTestApp();
    alice = await signup(t.app);
    bob = await signup(t.app);
    admin = await signupAdmin(t.app, t.db);
    song = (await alice.post('/api/songs', soloBody({ title: 'Art Target' }))).body;
  });
  after(() => t.cleanup());

  test('a song without art: artworkUrl null, artworkSource null', () => {
    assert.equal(song.media.artworkUrl, null);
    assert.equal(song.media.artworkSource, null);
    assert.equal(song.media.recordingArtworkUrl, null);
  });

  test('upload → /uploads/art/…, served as an image; replacing deletes the old file; removing → no art', async () => {
    const res = await alice.upload(`/api/songs/${song.id}/artwork`, PNG, 'cover.png', 'image/png');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const url = res.body.media.artworkUrl;
    assert.match(url, /^\/uploads\/art\/[0-9a-f-]{36}\.png$/);
    assert.equal(res.body.media.artworkSource, 'upload');
    assert.equal(res.body.media.recordingArtworkUrl, null);
    assert.ok(fs.existsSync(onDisk(t, url)));
    const served = await request(t.app).get(url);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.equal(served.headers['x-content-type-options'], 'nosniff');
    // the song page and the list show it
    assert.equal((await request(t.app).get(`/api/songs/${song.id}`)).body.media.artworkUrl, url);
    const listed = (await request(t.app).get('/api/songs')).body.songs.find((s) => s.id === song.id);
    assert.equal(listed.media.artworkUrl, url);

    const jpg = await alice.upload(`/api/songs/${song.id}/artwork`, JPEG, 'cover.jpg', 'image/jpeg');
    assert.equal(jpg.status, 200);
    assert.match(jpg.body.media.artworkUrl, /\.jpg$/);
    assert.ok(!fs.existsSync(onDisk(t, url)), 'replaced upload deleted');

    const del = await alice.del(`/api/songs/${song.id}/artwork`);
    assert.equal(del.status, 200);
    assert.equal(del.body.media.artworkUrl, null);
    assert.equal(del.body.media.artworkSource, null);
    assert.ok(!fs.existsSync(onDisk(t, jpg.body.media.artworkUrl)), 'removed upload deleted');
    assert.equal((await alice.del(`/api/songs/${song.id}/artwork`)).status, 200, 'removing again is fine');
  });

  test('the recording art stays underneath: removing the upload falls back to it', async () => {
    const recArt = '/uploads/art/recording-art.jpg';
    fs.writeFileSync(onDisk(t, recArt), JPEG);
    t.db.prepare('UPDATE songs SET artwork_path = ? WHERE id = ?').run(recArt, song.id);
    const before = (await request(t.app).get(`/api/songs/${song.id}`)).body.media;
    assert.deepEqual([before.artworkUrl, before.artworkSource, before.recordingArtworkUrl], [recArt, 'recording', recArt]);
    const up = await alice.upload(`/api/songs/${song.id}/artwork`, PNG, 'mine.png', 'image/png');
    assert.equal(up.body.media.artworkSource, 'upload');
    assert.notEqual(up.body.media.artworkUrl, recArt);
    assert.equal(up.body.media.recordingArtworkUrl, recArt);
    // editing the song with the displayed (uploaded) art echoed back keeps both images
    const body = soloBody({
      title: 'Art Target', preview: {
        previewUrl: 'https://audio-ssl.itunes.apple.com/x/a.m4a', artworkUrl: up.body.media.artworkUrl, appleMusicUrl: null,
        recordingName: 'Cast Album', recordingArtist: 'Cast', itunesTrackId: 5,
      },
    });
    const put = await alice.put(`/api/songs/${song.id}`, body);
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.media.artworkUrl, up.body.media.artworkUrl);
    assert.equal(put.body.media.recordingArtworkUrl, recArt);
    assert.ok(fs.existsSync(onDisk(t, recArt)));
    const del = await alice.del(`/api/songs/${song.id}/artwork`);
    assert.deepEqual([del.body.media.artworkUrl, del.body.media.artworkSource], [recArt, 'recording']);
    assert.ok(fs.existsSync(onDisk(t, recArt)), 'recording art kept');
    assert.ok(!fs.existsSync(onDisk(t, up.body.media.artworkUrl)));
  });

  test('owner or admin only; logged out → 401; missing song → 404', async () => {
    assert.equal((await bob.upload(`/api/songs/${song.id}/artwork`, PNG, 'x.png', 'image/png')).status, 403);
    assert.equal((await bob.del(`/api/songs/${song.id}/artwork`)).status, 403);
    const anon = await request(t.app).post(`/api/songs/${song.id}/artwork`).set(CSRF).attach('file', PNG, 'x.png');
    assert.equal(anon.status, 401);
    assert.equal((await request(t.app).delete(`/api/songs/${song.id}/artwork`).set(CSRF)).status, 401);
    assert.equal((await alice.upload('/api/songs/999999/artwork', PNG, 'x.png', 'image/png')).status, 404);
    const byAdmin = await admin.upload(`/api/songs/${song.id}/artwork`, PNG, 'x.png', 'image/png');
    assert.equal(byAdmin.status, 200);
    // spreadsheet songs: admins only
    const sheetShow = insertShow(t.db, 'Sheet Show');
    const sheetSong = insertSong(t.db, { title: 'Sheet Song', showId: sheetShow });
    assert.equal((await alice.upload(`/api/songs/${sheetSong}/artwork`, PNG, 'x.png', 'image/png')).status, 403);
    assert.equal((await admin.upload(`/api/songs/${sheetSong}/artwork`, PNG, 'x.png', 'image/png')).status, 200);
    assert.equal((await admin.del(`/api/songs/${sheetSong}/artwork`)).status, 200);
  });

  test('CSRF header and multipart are required', async () => {
    const noCsrf = await alice.agent.post(`/api/songs/${song.id}/artwork`).attach('file', PNG, 'a.png');
    assert.equal(noCsrf.status, 403);
    const json = await alice.agent.post(`/api/songs/${song.id}/artwork`).set(CSRF).send({ file: 'x' });
    assert.equal(json.status, 415);
    const delNoCsrf = await alice.agent.delete(`/api/songs/${song.id}/artwork`);
    assert.equal(delNoCsrf.status, 403);
  });

  test('only real JPEG/PNG/WebP/GIF images ≤ 5 MB (the bytes decide, not the name); nothing left on disk', async () => {
    const count = () => fs.readdirSync(path.join(t.uploadsDir, 'art')).length;
    const n = count();
    for (const [buf, name, type] of [[SVG, 'x.svg', 'image/svg+xml'], [HTML, 'x.png', 'image/png'], [MP3, 'x.jpg', 'image/jpeg'], [Buffer.from('GIF89a'), 'x.gif', 'image/gif']]) {
      const res = await alice.upload(`/api/songs/${song.id}/artwork`, buf, name, type);
      assert.equal(res.status, 400, name);
      assert.ok(res.body.details.file, JSON.stringify(res.body));
    }
    const damaged = await alice.upload(`/api/songs/${song.id}/artwork`, PNG.subarray(0, 40), 'x.png', 'image/png');
    assert.equal(damaged.status, 400);
    const big = await alice.upload(`/api/songs/${song.id}/artwork`, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'big.png', 'image/png');
    assert.equal(big.status, 413);
    const wrongField = await alice.agent.post(`/api/songs/${song.id}/artwork`).set(CSRF).attach('image', PNG, 'x.png');
    assert.equal(wrongField.status, 400);
    const empty = await alice.agent.post(`/api/songs/${song.id}/artwork`).set(CSRF).field('x', 'y');
    assert.equal(empty.status, 400);
    assert.equal(count(), n, 'no files left behind');
    assert.equal(fs.readdirSync(path.join(t.uploadsDir, '.incoming')).length, 0, 'no temp files left behind');
  });

  test('photo metadata (GPS, camera, comments) is removed', async () => {
    const photo = fixture('photo-exif.jpg');
    const res = await alice.upload(`/api/songs/${song.id}/artwork`, photo, 'phone.jpg', 'image/jpeg');
    assert.equal(res.status, 200);
    const stored = fs.readFileSync(onDisk(t, res.body.media.artworkUrl));
    assert.doesNotMatch(stored.toString('latin1'), /SERIAL-12345|PhoneMaker|COMMENT-SECRET|GPS 49/);
    for (const file of ['meta.png', 'meta.gif', 'meta.webp']) {
      const r = await alice.upload(`/api/songs/${song.id}/artwork`, fixture(file), file, 'application/octet-stream');
      assert.equal(r.status, 200, file);
      assert.doesNotMatch(fs.readFileSync(onDisk(t, r.body.media.artworkUrl)).toString('latin1'), /tEXt|iTXt|EXIF|SECRET/, file);
    }
  });

  test('uploads count toward the quota, are never "orphans", and go when the song is deleted', async () => {
    const s = (await alice.post('/api/songs', soloBody({ title: 'Doomed Art' }))).body;
    const up = await alice.upload(`/api/songs/${s.id}/artwork`, PNG, 'a.png', 'image/png');
    const url = up.body.media.artworkUrl;
    assert.ok(isFileReferenced(t.db, url));
    assert.ok(userUploadBytes(t.db, t.uploadsDir, alice.user.id) >= PNG.length);
    const orphans = findOrphanUploads(t.db, t.uploadsDir, { minAgeMs: 0 }).map((o) => o.publicPath);
    assert.ok(!orphans.includes(url), 'clean-uploads leaves it alone');
    assert.equal((await alice.del(`/api/songs/${s.id}`)).status, 204);
    assert.ok(!fs.existsSync(onDisk(t, url)), 'deleted with the song');
  });
});

test('per-user quota applies to album art (admins exempt)', async () => {
  const t = makeTestApp({ env: { STAR_UPLOAD_QUOTA_MB: String((PNG.length * 1.5) / (1024 * 1024)) } });
  try {
    const u = await signup(t.app);
    const a = (await u.post('/api/songs', soloBody({ title: 'Q1' }))).body;
    const b = (await u.post('/api/songs', soloBody({ title: 'Q2' }))).body;
    assert.equal((await u.upload(`/api/songs/${a.id}/artwork`, PNG, 'a.png', 'image/png')).status, 200);
    assert.equal((await u.upload(`/api/songs/${a.id}/artwork`, PNG, 'a.png', 'image/png')).status, 200, 'replacing your own upload fits');
    const over = await u.upload(`/api/songs/${b.id}/artwork`, PNG, 'b.png', 'image/png');
    assert.equal(over.status, 413);
  } finally {
    t.cleanup();
  }
});

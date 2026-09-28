// Image uploads — hardening regressions (review findings on SPEC §7c): pixel-dimension limits
// (a 1 MB PNG can declare 20000×20000), metadata ALLOWLISTS (C2PA "content credentials" and private
// chunks can carry GPS and names), and no temp files left behind by empty uploads.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  makeTestApp, signup, soloBody, fixture, binaryResponse, CSRF,
} from './helpers.js';
import {
  imageDimensions, imageSizeProblem, stripImageMetadata, IMAGE_MAX_SIDE,
} from '../src/lib/image-meta.js';
import { downloadRemoteImage } from '../src/lib/remote-image.js';
import { INCOMING_DIR } from '../src/lib/uploads.js';

// ---- tiny image builders ----
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function pngChunk(type, data = Buffer.alloc(0)) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}
/** A PNG whose header says width×height (the pixel data is a small real zlib stream). */
function png(width, height, extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr), ...extra, pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(64 * 1024))), pngChunk('IEND'),
  ]);
}
/** A GIF with `frames` 1×1 frames on a width×height screen (+ optional extension blocks). */
function gif(width, height, frames, extensions = []) {
  const head = Buffer.from('GIF89a', 'latin1');
  const screen = Buffer.alloc(7);
  screen.writeUInt16LE(width, 0);
  screen.writeUInt16LE(height, 2);
  const parts = [head, screen, ...extensions];
  for (let i = 0; i < frames; i++) {
    const d = Buffer.alloc(10);
    d[0] = 0x2c;
    d.writeUInt16LE(1, 5);
    d.writeUInt16LE(1, 7);
    parts.push(d, Buffer.from([0x02, 0x02, 0x44, 0x01, 0x00]));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
const gifExt = (label, payload) => Buffer.concat([Buffer.from([0x21, label]), Buffer.from([payload.length]), payload, Buffer.from([0])]);
const gifApp = (id, data = Buffer.from([1, 0, 0])) => Buffer.concat([Buffer.from([0x21, 0xff, 11]), Buffer.from(id, 'latin1'), Buffer.from([data.length]), data, Buffer.from([0])]);
function riffChunk(fourcc, data) {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function webp(chunks) {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}
function vp8x(width, height, flags = 0) {
  const d = Buffer.alloc(10);
  d[0] = flags;
  d.writeUIntLE(width - 1, 4, 3);
  d.writeUIntLE(height - 1, 7, 3);
  return riffChunk('VP8X', d);
}
/** plain.jpg with its frame header (SOF0) saying width×height. */
function jpeg(width, height) {
  const buf = Buffer.from(fixture('plain.jpg'));
  const sof = buf.indexOf(Buffer.from([0xff, 0xc0]));
  buf.writeUInt16BE(height, sof + 5);
  buf.writeUInt16BE(width, sof + 7);
  return buf;
}

const SECRET = /GPSLatitude|Jane Student|42 Maple Street|c2pa-secret|private-note/;

describe('picture size limits', () => {
  test('dimensions are read from PNG, JPEG, GIF (every frame) and WebP headers', () => {
    assert.deepEqual(imageDimensions(png(20000, 20000), 'png'), { width: 20000, height: 20000, frames: 1, totalPixels: 400_000_000 });
    assert.deepEqual(imageDimensions(fixture('plain.png'), 'png').frames, 1);
    assert.equal(imageDimensions(jpeg(20000, 300), 'jpg').width, 20000);
    const g = imageDimensions(gif(10, 10, 301), 'gif');
    assert.equal(g.frames, 301);
    assert.equal(imageDimensions(webp([vp8x(20000, 20000)]), 'webp').width, 20000);
    assert.equal(imageDimensions(fixture('meta.webp'), 'webp').width > 0, true);
    assert.equal(imageDimensions(Buffer.from('nonsense'), 'png'), null);
  });

  test('imageSizeProblem: big pictures and long animations get a friendly message; a phone photo is fine', () => {
    assert.equal(imageSizeProblem({ width: 5712, height: 4284, frames: 1, totalPixels: 5712 * 4284 }), null, '24 MP phone photo');
    assert.equal(imageSizeProblem({ width: 1000, height: 1000, frames: 1, totalPixels: 1e6 }), null);
    assert.match(imageSizeProblem({ width: 20000, height: 20000, frames: 1, totalPixels: 4e8 }), /20000 × 20000 pixels — too large/);
    assert.match(imageSizeProblem({ width: IMAGE_MAX_SIDE + 1, height: 10, frames: 1, totalPixels: 1e5 }), /too large/);
    assert.match(imageSizeProblem({ width: 100, height: 100, frames: 301, totalPixels: 3_010_000 }), /too many frames/);
    assert.match(imageSizeProblem({ width: 2000, height: 2000, frames: 20, totalPixels: 80_000_000 }), /too many frames or pixels/);
    assert.match(imageSizeProblem(null), /couldn't read/);
  });

  describe('uploads and downloads refuse them', () => {
    let t;
    let u;
    let song;
    let show;
    before(async () => {
      t = makeTestApp();
      u = await signup(t.app);
      song = (await u.post('/api/songs', soloBody({ title: 'Pixel Flood' }))).body;
      show = (await u.post('/api/shows', { name: 'Poster Flood' })).body;
    });
    after(() => t.cleanup());

    test('album art and show posters: 400 with a message, nothing stored', async () => {
      const bomb = png(20000, 20000);
      assert.ok(bomb.length < 200_000);
      for (const [url, name] of [[`/api/songs/${song.id}/artwork`, 'art'], [`/api/shows/${show.id}/image`, 'images']]) {
        const res = await u.upload(url, bomb, 'huge.png', 'image/png');
        assert.equal(res.status, 400, `${url}: ${JSON.stringify(res.body)}`);
        assert.match(res.body.error, /20000 × 20000 pixels — too large/);
        assert.deepEqual(fs.readdirSync(path.join(t.uploadsDir, name)), [], 'nothing stored');
        const anim = await u.upload(url, gif(10, 10, 301), 'anim.gif', 'image/gif');
        assert.equal(anim.status, 400);
        assert.match(anim.body.error, /too many frames/);
        assert.equal((await u.upload(url, jpeg(30000, 100), 'wide.jpg', 'image/jpeg')).status, 400);
        assert.equal((await u.upload(url, webp([vp8x(20000, 20000), riffChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0]))]), 'x.webp', 'image/webp')).status, 400);
      }
      const ok = await u.upload(`/api/songs/${song.id}/artwork`, png(600, 600), 'ok.png', 'image/png');
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    });

    test('server-side downloads (recording art, posters from a link) too', async () => {
      const fetchImpl = async () => binaryResponse(png(20000, 20000), 'image/png');
      await assert.rejects(downloadRemoteImage('https://is1-ssl.mzstatic.com/image/x.png', { uploadsDir: t.uploadsDir, subdir: 'art', fetchImpl }), /too large/);
    });
  });
});

describe('metadata allowlists', () => {
  test('PNG: C2PA (caBX), private and text chunks go; the picture chunks stay', () => {
    const withMeta = png(2, 2, [
      pngChunk('caBX', Buffer.from('c2pa-secret exif:GPSLatitude 43.6532 dc:creator Jane Student')),
      pngChunk('prVt', Buffer.from('private-note 42 Maple Street')),
      pngChunk('tEXt', Buffer.from('Comment\0Jane Student')),
      pngChunk('gAMA', Buffer.from([0, 0, 0xb1, 0x8f])),
    ]);
    const clean = stripImageMetadata(withMeta, 'png');
    assert.doesNotMatch(clean.toString('latin1'), SECRET);
    const types = [];
    for (let p = 8; p < clean.length;) {
      const len = clean.readUInt32BE(p);
      types.push(clean.toString('latin1', p + 4, p + 8));
      p += 12 + len;
    }
    assert.deepEqual(types, ['IHDR', 'gAMA', 'IDAT', 'IEND']);
  });

  test('WebP: C2PA and unknown chunks go (also inside animation frames); image, alpha, animation and ICC stay', () => {
    const frame = Buffer.concat([Buffer.alloc(16), riffChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0])), riffChunk('XYZW', Buffer.from('private-note'))]);
    const withMeta = webp([
      vp8x(1, 1, 0x02 | 0x08 | 0x04), riffChunk('ICCP', Buffer.from('icc')), riffChunk('ANIM', Buffer.alloc(6)), riffChunk('ANMF', frame),
      riffChunk('C2PA', Buffer.from('c2pa-secret GPSLatitude')), riffChunk('EXIF', Buffer.from('Jane Student')), riffChunk('XMP ', Buffer.from('<x/>')),
    ]);
    const clean = stripImageMetadata(withMeta, 'webp');
    assert.ok(clean);
    assert.doesNotMatch(clean.toString('latin1'), SECRET);
    assert.doesNotMatch(clean.toString('latin1'), /C2PA|EXIF|XMP |XYZW/);
    assert.match(clean.toString('latin1'), /VP8X.*ICCP.*ANIM.*ANMF.*VP8L/s);
    assert.equal(clean.readUInt32LE(4), clean.length - 8, 'RIFF size matches');
    assert.equal(clean[20] & 0x0c, 0, 'EXIF/XMP flags cleared');
  });

  test('GIF: only looping (NETSCAPE2.0) application blocks and graphic-control blocks are kept', () => {
    const withMeta = gif(1, 1, 1, [
      gifApp('NETSCAPE2.0'), gifApp('XMP DataXMP', Buffer.from('Jane Student')), gifApp('C2PAXXXX1.0', Buffer.from('c2pa-secret')),
      gifExt(0xfe, Buffer.from('private-note')), gifExt(0x01, Buffer.concat([Buffer.alloc(12), Buffer.from('42 Maple Street')])),
      gifExt(0xf9, Buffer.from([0, 0, 0, 0])),
    ]);
    const clean = stripImageMetadata(withMeta, 'gif');
    assert.ok(clean);
    assert.doesNotMatch(clean.toString('latin1'), SECRET);
    assert.match(clean.toString('latin1'), /NETSCAPE2\.0/);
    assert.ok(clean.includes(Buffer.from([0x21, 0xf9])), 'graphic control kept');
    assert.equal(imageDimensions(clean, 'gif').frames, 1);
  });

  test('JPEG: JFXX thumbnails are dropped and the JFIF thumbnail is emptied', () => {
    const plain = fixture('plain.jpg');
    const jfxx = Buffer.concat([Buffer.from([0xff, 0xe0, 0, 2 + 5 + 1 + 14]), Buffer.from('JFXX\0', 'latin1'), Buffer.from([0x10]), Buffer.from('private-note..')]);
    const withThumb = Buffer.concat([plain.subarray(0, 20), jfxx, plain.subarray(20)]);
    const clean = stripImageMetadata(withThumb, 'jpg');
    assert.ok(clean);
    assert.doesNotMatch(clean.toString('latin1'), /JFXX|private-note/);
    assert.match(clean.toString('latin1'), /JFIF/);
    const app0 = clean.indexOf(Buffer.from('JFIF\0', 'latin1'));
    assert.deepEqual([clean[app0 + 12], clean[app0 + 13]], [0, 0], 'no JFIF thumbnail');
    assert.equal(imageDimensions(clean, 'jpg').width, imageDimensions(plain, 'jpg').width);
  });

  test('an uploaded PNG with C2PA and private chunks is published without them', async () => {
    const t = makeTestApp();
    try {
      const u = await signup(t.app);
      const song = (await u.post('/api/songs', soloBody({ title: 'Credentials' }))).body;
      const file = png(2, 2, [pngChunk('caBX', Buffer.from('exif:GPSLatitude 43.6532 dc:creator Jane Student')), pngChunk('prVt', Buffer.from('42 Maple Street'))]);
      const res = await u.upload(`/api/songs/${song.id}/artwork`, file, 'cover.png', 'image/png');
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const stored = fs.readFileSync(path.join(t.uploadsDir, res.body.media.artworkUrl.replace(/^\/uploads\//, '')));
      assert.doesNotMatch(stored.toString('latin1'), SECRET);
    } finally {
      t.cleanup();
    }
  });
});

test('an empty file field leaves nothing in uploads/.incoming (audio, album art, posters)', async () => {
  const t = makeTestApp();
  try {
    const u = await signup(t.app);
    const song = (await u.post('/api/songs', soloBody({ title: 'Empty Upload' }))).body;
    const show = (await u.post('/api/shows', { name: 'Empty Poster' })).body;
    for (const url of [`/api/songs/${song.id}/audio`, `/api/songs/${song.id}/artwork`, `/api/shows/${show.id}/image`]) {
      const res = await u.agent.post(url).set(CSRF).attach('file', Buffer.alloc(0), { filename: 'empty.png', contentType: 'image/png' });
      assert.equal(res.status, 400, url);
      assert.match(res.body.error, /choose a file/);
    }
    assert.deepEqual(fs.readdirSync(path.join(t.uploadsDir, INCOMING_DIR)), []);
  } finally {
    t.cleanup();
  }
});

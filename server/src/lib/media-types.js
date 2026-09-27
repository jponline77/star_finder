// Decide what an uploaded file really is from its bytes (never from the name or the client's
// Content-Type). Audio checks go past the first few magic bytes: an "ID3" prefix must be followed
// by real MPEG frames, an MP4 container must hold a sound track and no video track, a WAV/AIFF
// must have its format chunk, an Ogg stream must carry an audio codec. That keeps videos and
// arbitrary files with an audio-looking prefix off the site.
import fs from 'node:fs';

const ascii = (buf, start, end) => buf.subarray(start, end).toString('latin1');

/**
 * Detect an image type from its first bytes.
 * @param {Buffer} buf
 * @returns {{ ext: string, mime: string } | null}
 */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  const gif = ascii(buf, 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return { ext: 'gif', mime: 'image/gif' };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

// ---- random access over a Buffer or a file (uploads are on disk; tests pass buffers) ----

function bufferReader(buf) {
  return { size: buf.length, read: (offset, length) => buf.subarray(offset, Math.min(buf.length, offset + length)) };
}

function fileReader(fd, size) {
  return {
    size,
    read(offset, length) {
      const n = Math.max(0, Math.min(length, size - offset));
      const out = Buffer.alloc(n);
      if (n > 0) fs.readSync(fd, out, 0, n, offset);
      return out;
    },
  };
}

// ---- MPEG audio (mp3) and ADTS (aac) frames ----

const MPEG_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const MPEG_BITRATES = {
  '3-3': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], // MPEG-1 layer I
  '3-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], // MPEG-1 layer II
  '3-1': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG-1 layer III
  '2-3': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], // MPEG-2/2.5 layer I
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG-2/2.5 layer II
  '2-1': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG-2/2.5 layer III
};

/** Length in bytes of the MPEG audio frame whose 4-byte header is `h`, or 0 if it isn't one. */
export function mpegFrameLength(h) {
  if (h.length < 4 || h[0] !== 0xff || (h[1] & 0xe0) !== 0xe0) return 0;
  const version = (h[1] >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5, 1 = reserved
  const layer = (h[1] >> 1) & 0x03; // 3 = I, 2 = II, 1 = III, 0 = reserved
  const bitrateIndex = h[2] >> 4;
  const rateIndex = (h[2] >> 2) & 0x03;
  const padding = (h[2] >> 1) & 0x01;
  if (version === 1 || layer === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return 0;
  const bitrate = MPEG_BITRATES[`${version === 3 ? 3 : 2}-${layer}`][bitrateIndex] * 1000;
  const rate = MPEG_RATES[version][rateIndex];
  if (layer === 3) return (Math.floor((12 * bitrate) / rate) + padding) * 4;
  if (layer === 1 && version !== 3) return Math.floor((72 * bitrate) / rate) + padding;
  return Math.floor((144 * bitrate) / rate) + padding;
}

/** Length of the ADTS (AAC) frame whose header starts `h`, or 0 if it isn't one. */
export function adtsFrameLength(h) {
  if (h.length < 7 || h[0] !== 0xff || (h[1] & 0xf6) !== 0xf0) return 0;
  if (((h[2] >> 2) & 0x0f) > 12) return 0; // sampling-frequency index
  const len = ((h[3] & 0x03) << 11) | (h[4] << 3) | (h[5] >> 5);
  return len >= 7 ? len : 0;
}

/** Size of the ID3v2 tag(s) at `offset` (0 if none). */
function id3v2Size(reader, offset) {
  let pos = offset;
  for (let i = 0; i < 4; i++) {
    const h = reader.read(pos, 10);
    if (h.length < 10 || ascii(h, 0, 3) !== 'ID3' || h[3] === 0xff || h[4] === 0xff) break;
    if ((h[6] | h[7] | h[8] | h[9]) & 0x80) return -1; // sizes are "synchsafe" (7 bits per byte)
    const size = (h[6] << 21) | (h[7] << 14) | (h[8] << 7) | h[9];
    pos += 10 + size + (h[5] & 0x10 ? 10 : 0); // footer flag
  }
  return pos - offset;
}

const FRAMES_REQUIRED = 3;

/**
 * Find a run of FRAMES_REQUIRED consecutive frames (MPEG audio or ADTS) starting within `window`
 * bytes of `from` (encoders may leave padding after the ID3 tag). Returns the start offset + type.
 */
function findFrames(reader, from, window = 4096) {
  // One read covers the search window plus a few frames; frames beyond it are read on demand.
  const buf = reader.read(from, window + 60_000);
  const at = (pos, len) => (pos - from + len <= buf.length ? buf.subarray(pos - from, pos - from + len) : reader.read(pos, len));
  for (let i = 0; i < window && i + 4 <= buf.length; i++) {
    if (buf[i] !== 0xff) continue;
    for (const [type, lengthOf] of [['aac', adtsFrameLength], ['mp3', mpegFrameLength]]) {
      let pos = from + i;
      let frames = 0;
      let first = null;
      while (frames < FRAMES_REQUIRED) {
        const h = at(pos, 8);
        const len = lengthOf(h);
        if (!len) break;
        // consecutive frames of one stream keep the same version/layer/sample-rate bits
        const sig = (h[1] << 8) | (h[2] & 0x0c);
        if (first === null) first = sig;
        else if (sig !== first) break;
        frames++;
        pos += len;
        if (pos >= reader.size) break; // a very short file may end on a frame boundary
      }
      if (frames >= FRAMES_REQUIRED || (frames >= 2 && pos >= reader.size)) return { start: from + i, type };
    }
  }
  return null;
}

function sniffMpegOrAdts(reader) {
  const tag = id3v2Size(reader, 0);
  if (tag < 0 || tag >= reader.size) return null;
  const found = findFrames(reader, tag);
  if (!found) return null;
  let end = reader.size;
  if (end - found.start > 128 && ascii(reader.read(end - 128, 3), 0, 3) === 'TAG') end -= 128; // ID3v1
  // `start`/`end`: the bytes worth keeping — ID3 tags (titles, names, cover photos) are dropped.
  return found.type === 'aac'
    ? { ext: 'aac', mime: 'audio/aac', start: found.start, end }
    : { ext: 'mp3', mime: 'audio/mpeg', start: found.start, end };
}

// ---- ISO-BMFF (m4a): must contain a sound track and no video track ----

function* boxes(reader, start, end) {
  let pos = start;
  for (let n = 0; pos + 8 <= end && n < 1000; n++) {
    const h = reader.read(pos, 16);
    if (h.length < 8) return;
    let size = h.readUInt32BE(0);
    const type = ascii(h, 4, 8);
    let headerSize = 8;
    if (size === 1) {
      if (h.length < 16) return;
      size = Number(h.readBigUInt64BE(8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < headerSize || pos + size > end) return;
    yield { type, start: pos + headerSize, end: pos + size };
    pos += size;
  }
}

function sniffMp4(reader) {
  const first = reader.read(0, 8);
  if (first.length < 8 || ascii(first, 4, 8) !== 'ftyp') return null;
  const handlers = new Set();
  for (const top of boxes(reader, 0, reader.size)) {
    if (top.type !== 'moov') continue;
    for (const trak of boxes(reader, top.start, top.end)) {
      if (trak.type !== 'trak') continue;
      for (const mdia of boxes(reader, trak.start, trak.end)) {
        if (mdia.type !== 'mdia') continue;
        for (const box of boxes(reader, mdia.start, mdia.end)) {
          if (box.type === 'hdlr') handlers.add(ascii(reader.read(box.start + 8, 4), 0, 4));
        }
      }
    }
  }
  if (!handlers.has('soun') || handlers.has('vide') || handlers.has('pict')) return null;
  return { ext: 'm4a', mime: 'audio/mp4', start: 0, end: reader.size };
}

// ---- RIFF WAVE / AIFF / Ogg ----

function sniffWav(reader) {
  const head = reader.read(0, 12);
  if (ascii(head, 0, 4) !== 'RIFF' || ascii(head, 8, 12) !== 'WAVE') return null;
  let pos = 12;
  let fmtOk = false;
  for (let n = 0; n < 64 && pos + 8 <= reader.size; n++) {
    const h = reader.read(pos, 8);
    const id = ascii(h, 0, 4);
    const size = h.readUInt32LE(4);
    if (id === 'fmt ') {
      const f = reader.read(pos + 8, 16);
      if (size < 16 || f.length < 16) return null;
      const channels = f.readUInt16LE(2);
      const rate = f.readUInt32LE(4);
      fmtOk = f.readUInt16LE(0) !== 0 && channels >= 1 && channels <= 32 && rate >= 1000 && rate <= 768000;
      if (!fmtOk) return null;
    } else if (id === 'data') {
      return fmtOk ? { ext: 'wav', mime: 'audio/wav', start: 0, end: reader.size } : null;
    }
    pos += 8 + size + (size % 2);
  }
  return null;
}

function sniffAiff(reader) {
  const head = reader.read(0, 12);
  if (ascii(head, 0, 4) !== 'FORM' || !['AIFF', 'AIFC'].includes(ascii(head, 8, 12))) return null;
  let pos = 12;
  let comm = false;
  for (let n = 0; n < 64 && pos + 8 <= reader.size; n++) {
    const h = reader.read(pos, 8);
    const id = ascii(h, 0, 4);
    const size = h.readUInt32BE(4);
    if (id === 'COMM') {
      const c = reader.read(pos + 8, 2);
      comm = size >= 18 && c.length === 2 && c.readUInt16BE(0) >= 1;
      if (!comm) return null;
    } else if (id === 'SSND') {
      return comm ? { ext: 'aiff', mime: 'audio/aiff', start: 0, end: reader.size } : null;
    }
    pos += 8 + size + (size % 2);
  }
  return null;
}

const OGG_AUDIO = [Buffer.from('\x01vorbis', 'latin1'), Buffer.from('OpusHead'), Buffer.from('\x7fFLAC', 'latin1'), Buffer.from('Speex   ')];

function sniffOgg(reader) {
  const h = reader.read(0, 27 + 255);
  if (h.length < 28 || ascii(h, 0, 4) !== 'OggS' || h[4] !== 0 || !(h[5] & 0x02)) return null; // version 0, first page
  const segments = h[26];
  const packet = reader.read(27 + segments, 8);
  return OGG_AUDIO.some((sig) => packet.subarray(0, sig.length).equals(sig))
    ? { ext: 'ogg', mime: 'audio/ogg', start: 0, end: reader.size }
    : null;
}

function sniffAudioIn(reader) {
  if (reader.size < 12) return null;
  const head = reader.read(0, 12);
  const magic = ascii(head, 0, 4);
  if (magic === 'RIFF') return sniffWav(reader);
  if (magic === 'FORM') return sniffAiff(reader);
  if (magic === 'OggS') return sniffOgg(reader);
  if (ascii(head, 4, 8) === 'ftyp') return sniffMp4(reader);
  if (ascii(head, 0, 3) === 'ID3' || head[0] === 0xff) return sniffMpegOrAdts(reader);
  return null;
}

/**
 * Detect (and structurally check) an audio file: mp3, aac (ADTS), m4a, wav, aiff or ogg.
 * `start`/`end` give the byte range worth keeping (mp3/aac without ID3 tags).
 * @param {Buffer|string} input the bytes, or a file path
 * @returns {{ ext: string, mime: string, start: number, end: number } | null}
 */
export function sniffAudio(input) {
  if (Buffer.isBuffer(input)) return sniffAudioIn(bufferReader(input));
  const fd = fs.openSync(input, 'r');
  try {
    return sniffAudioIn(fileReader(fd, fs.fstatSync(fd).size));
  } finally {
    fs.closeSync(fd);
  }
}

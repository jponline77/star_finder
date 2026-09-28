// Remove metadata from user-uploaded images before they are published. Phone photos carry EXIF
// (GPS position, camera serial numbers, timestamps), XMP and IPTC blocks; the site's users are
// minors, so none of that may be served back. No image library: the container formats are walked
// and only the parts needed to draw the picture are copied.
//
//   JPEG: drop APP1 (Exif/XMP) except a rebuilt orientation-only Exif, APP2 except ICC profiles,
//         APP3–APP13, APP15, COM, and anything after EOI (MPF "extra images" live there).
//         Keeps APP0 JFIF (without its embedded thumbnail; JFXX thumbnails are dropped) and APP14
//         (Adobe colour transform) so colours don't change.
//   PNG, WebP, GIF: an ALLOWLIST — only the chunks/blocks needed to draw the picture (and its
//         colours/animation) are copied; everything else goes: text/Exif/XMP, C2PA "content
//         credentials" (PNG caBX, WebP C2PA — they can carry GPS and the author's name), and any
//         private chunk. GIF keeps only NETSCAPE2.0/ANIMEXTS1.0 (looping) application blocks and
//         graphic-control blocks.
// Every function returns a new Buffer, or null when the file isn't a well-formed image of that type.
//
// imageDimensions() reads the picture size from the same headers, so uploads that would decode to
// gigapixels in every visitor's browser (a few MB of compressed zeros can declare 20000×20000) are
// refused before they're published (imageSizeProblem).

const ORIENTATION_TAG = 0x0112;

/** Orientation (1–8) from an Exif APP1 payload ("Exif\0\0" + TIFF), or null. */
function exifOrientation(payload) {
  if (payload.length < 14 || payload.toString('latin1', 0, 6) !== 'Exif\0\0') return null;
  const tiff = payload.subarray(6);
  const order = tiff.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (o) => (o + 2 <= tiff.length ? (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o)) : null);
  const u32 = (o) => (o + 4 <= tiff.length ? (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o)) : null);
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  const count = ifd === null ? null : u16(ifd);
  if (count === null) return null;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (u16(e) === ORIENTATION_TAG && u16(e + 2) === 3) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** A minimal APP1 Exif segment holding only the orientation tag (so phone photos stay upright). */
function orientationSegment(orientation) {
  const tiff = Buffer.alloc(26);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // IFD0 offset
  tiff.writeUInt16BE(1, 8); // one entry
  tiff.writeUInt16BE(ORIENTATION_TAG, 10);
  tiff.writeUInt16BE(3, 12); // SHORT
  tiff.writeUInt32BE(1, 14); // count
  tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt32BE(0, 22); // no next IFD
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** Index of the next marker (0xFF followed by a non-stuffing, non-RST byte) at or after `from`. */
function nextMarker(buf, from) {
  let i = buf.indexOf(0xff, from);
  while (i !== -1 && i + 1 < buf.length) {
    const b = buf[i + 1];
    if (b === 0xff) {
      i += 1; // fill byte — the marker is the last 0xFF of the run
      continue;
    }
    if (b !== 0x00 && !(b >= 0xd0 && b <= 0xd7)) return i;
    i = buf.indexOf(0xff, i + 2);
  }
  return -1;
}

export function stripJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out = [buf.subarray(0, 2)];
  let pos = 2;
  let sawScan = false;
  let orientation = null;
  let exifInsertAt = null;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) return null;
    while (buf[pos + 1] === 0xff) pos++; // fill bytes before a marker
    const marker = buf[pos + 1];
    if (marker === undefined) return null;
    if (marker === 0xd9) {
      out.push(Buffer.from([0xff, 0xd9]));
      break; // EOI — anything after it (MPF extra images, appended data) is dropped
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    if (pos + 4 > buf.length) return null;
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2 || pos + 2 + len > buf.length) return null;
    const seg = buf.subarray(pos, pos + 2 + len);
    const payload = buf.subarray(pos + 4, pos + 2 + len);
    pos += 2 + len;
    if (marker === 0xda) {
      // Start of scan: copy the entropy-coded data up to the next marker.
      sawScan = true;
      const end = nextMarker(buf, pos);
      out.push(seg, buf.subarray(pos, end === -1 ? buf.length : end));
      if (end === -1) {
        out.push(Buffer.from([0xff, 0xd9])); // truncated file: close it properly
        break;
      }
      pos = end;
      continue;
    }
    if (marker === 0xe0) {
      // JFIF: keep the header, drop its optional thumbnail. JFXX (a thumbnail extension) and other
      // APP0 data: dropped.
      if (payload.length >= 14 && payload.toString('latin1', 0, 5) === 'JFIF\0') {
        const jfif = Buffer.from(seg.subarray(0, 4 + 14)); // marker, length, 14-byte JFIF header
        jfif.writeUInt16BE(2 + 14, 2);
        jfif[4 + 12] = 0; // thumbnail width
        jfif[4 + 13] = 0; // thumbnail height
        out.push(jfif);
      }
      if (exifInsertAt === null) exifInsertAt = out.length;
    } else if (marker === 0xe1) {
      orientation ??= exifOrientation(payload); // Exif → keep only the orientation; XMP → dropped
      if (exifInsertAt === null) exifInsertAt = out.length;
    } else if (marker === 0xe2) {
      if (payload.toString('latin1', 0, 12) === 'ICC_PROFILE\0') out.push(seg);
    } else if (marker === 0xee) {
      if (payload.toString('latin1', 0, 5) === 'Adobe') out.push(seg);
    } else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) {
      // other APPn (IPTC/Photoshop, vendor data) and comments: dropped
    } else {
      out.push(seg); // DQT, DHT, SOFn, DRI, …
    }
  }
  if (!sawScan) return null;
  if (orientation && orientation !== 1) out.splice(exifInsertAt ?? 1, 0, orientationSegment(orientation));
  return Buffer.concat(out);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Pixels, palette/transparency, colour (gamma, chromaticities, sRGB, ICC, cICP), significant bits,
// background, pixel density, and APNG animation. Nothing that carries text or provenance.
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'cICP', 'sBIT', 'bKGD', 'pHYs',
  'acTL', 'fcTL', 'fdAT']);

export function stripPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const out = [PNG_SIG];
  let pos = 8;
  let first = true;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + len;
    if (end > buf.length || !/^[A-Za-z]{4}$/.test(type)) return null;
    if (first && type !== 'IHDR') return null;
    first = false;
    if (PNG_KEEP.has(type)) out.push(buf.subarray(pos, end));
    pos = end;
    if (type === 'IEND') return Buffer.concat(out);
  }
  return null; // no IEND
}

// Image data, alpha, animation and the colour profile.
const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
const WEBP_FRAME_KEEP = new Set(['VP8 ', 'VP8L', 'ALPH']);

/** The allowed chunks of a RIFF chunk list [start, end) (null if malformed). */
function webpChunks(buf, start, end, keep) {
  const chunks = [];
  let pos = start;
  while (pos + 8 <= end) {
    const fourcc = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const next = pos + 8 + size + (size % 2);
    if (pos + 8 + size > end) return null;
    if (keep.has(fourcc)) {
      let chunk = buf.subarray(pos, Math.min(next, end));
      if (fourcc === 'VP8X' && size >= 1) {
        chunk = Buffer.from(chunk);
        chunk[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
      } else if (fourcc === 'ANMF' && size >= 16) {
        // An animation frame: 16-byte frame header, then its own chunks (filtered the same way).
        const inner = webpChunks(buf, pos + 8 + 16, pos + 8 + size, WEBP_FRAME_KEEP);
        if (!inner) return null;
        const body = Buffer.concat([buf.subarray(pos + 8, pos + 8 + 16), ...inner]);
        const head = Buffer.alloc(8);
        head.write('ANMF', 0, 'latin1');
        head.writeUInt32LE(body.length, 4);
        chunk = Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
      }
      chunks.push(chunk);
    }
    pos = next;
  }
  return chunks;
}

export function stripWebp(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const riffEnd = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  const chunks = webpChunks(buf, 12, riffEnd, WEBP_KEEP);
  if (!chunks || !chunks.length || !/^VP8[ LX]$/.test(chunks[0].toString('latin1', 0, 4))) return null;
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

const GIF_APPS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0']);

export function stripGif(buf) {
  const sig = buf.toString('latin1', 0, 6);
  if (buf.length < 13 || (sig !== 'GIF87a' && sig !== 'GIF89a')) return null;
  const out = [];
  let pos = 13;
  if (buf[10] & 0x80) pos += 3 * 2 ** ((buf[10] & 0x07) + 1); // global colour table
  if (pos > buf.length) return null;
  out.push(buf.subarray(0, pos));
  /** End index of a run of data sub-blocks starting at `p` (after the 0 terminator), or -1. */
  const skipSubBlocks = (p) => {
    while (p < buf.length) {
      const n = buf[p];
      p += 1 + n;
      if (n === 0) return p <= buf.length ? p : -1;
    }
    return -1;
  };
  while (pos < buf.length) {
    const block = buf[pos];
    if (block === 0x3b) {
      out.push(buf.subarray(pos, pos + 1));
      return Buffer.concat(out);
    }
    if (block === 0x2c) {
      let p = pos + 10;
      if (p > buf.length) return null;
      if (buf[pos + 9] & 0x80) p += 3 * 2 ** ((buf[pos + 9] & 0x07) + 1); // local colour table
      const end = skipSubBlocks(p + 1); // +1: LZW minimum code size
      if (end === -1) return null;
      out.push(buf.subarray(pos, end));
      pos = end;
    } else if (block === 0x21) {
      const label = buf[pos + 1];
      const end = skipSubBlocks(pos + 2);
      if (end === -1) return null;
      // Keep graphic-control blocks (frame timing/transparency) and the looping application blocks
      // only; comments, plain-text blocks, XMP/ICC/any other application data go.
      const appId = label === 0xff && buf[pos + 2] === 11 ? buf.toString('latin1', pos + 3, pos + 14) : '';
      if (label === 0xf9 || GIF_APPS.has(appId)) out.push(buf.subarray(pos, end));
      pos = end;
    } else {
      return null;
    }
  }
  return null; // no trailer
}

const STRIPPERS = { jpg: stripJpeg, png: stripPng, webp: stripWebp, gif: stripGif };

// ---------------------------------------------------------------------------------------------
// Picture size
// ---------------------------------------------------------------------------------------------

/** Largest picture accepted (a 24-megapixel phone photo — 5712×4284 — fits). */
export const IMAGE_MAX_SIDE = 8192;
export const IMAGE_MAX_PIXELS = 25_000_000;
/** Animated GIF/WebP/PNG: at most this many frames and this many pixels over all frames. */
export const IMAGE_MAX_FRAMES = 300;
export const IMAGE_MAX_TOTAL_PIXELS = 50_000_000;

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegDimensions(buf) {
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) return null;
    const marker = buf[pos + 1];
    if (marker === 0xff) {
      pos++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // image data before any frame header
    const len = buf.readUInt16BE(pos + 2);
    if (SOF_MARKERS.has(marker)) {
      if (pos + 9 > buf.length) return null;
      return { width: buf.readUInt16BE(pos + 7), height: buf.readUInt16BE(pos + 5), frames: 1, totalPixels: buf.readUInt16BE(pos + 7) * buf.readUInt16BE(pos + 5) };
    }
    pos += 2 + len;
  }
  return null;
}

function pngDimensions(buf) {
  if (buf.length < 24) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  let frames = 1;
  // APNG: acTL holds the frame count.
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'acTL' && len >= 8) frames = Math.max(1, buf.readUInt32BE(pos + 8));
    if (type === 'IDAT' || type === 'IEND') break;
    pos += 12 + len;
  }
  return { width, height, frames, totalPixels: width * height * frames };
}

function gifDimensions(buf) {
  if (buf.length < 13) return null;
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  let frames = 0;
  let totalPixels = 0;
  let maxSide = Math.max(width, height);
  let pos = 13;
  if (buf[10] & 0x80) pos += 3 * 2 ** ((buf[10] & 0x07) + 1);
  const skipSubBlocks = (p) => {
    while (p < buf.length) {
      const n = buf[p];
      p += 1 + n;
      if (n === 0) return p;
    }
    return -1;
  };
  while (pos < buf.length) {
    const block = buf[pos];
    if (block === 0x3b) break;
    if (block === 0x2c) {
      if (pos + 10 > buf.length) return null;
      const w = buf.readUInt16LE(pos + 5);
      const h = buf.readUInt16LE(pos + 7);
      frames++;
      totalPixels += w * h;
      maxSide = Math.max(maxSide, w, h);
      let p = pos + 10;
      if (buf[pos + 9] & 0x80) p += 3 * 2 ** ((buf[pos + 9] & 0x07) + 1);
      const end = skipSubBlocks(p + 1);
      if (end === -1) return null;
      pos = end;
    } else if (block === 0x21) {
      const end = skipSubBlocks(pos + 2);
      if (end === -1) return null;
      pos = end;
    } else {
      return null;
    }
  }
  return { width, height, frames: Math.max(1, frames), totalPixels: Math.max(totalPixels, width * height), maxSide };
}

function webpDimensions(buf) {
  let pos = 12;
  const end = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  let frames = 0;
  let canvas = null;
  let still = null;
  while (pos + 8 <= end) {
    const fourcc = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const d = pos + 8;
    if (fourcc === 'VP8X' && size >= 10) {
      canvas = { width: 1 + buf.readUIntLE(d + 4, 3), height: 1 + buf.readUIntLE(d + 7, 3) };
    } else if (fourcc === 'ANMF') {
      frames++;
    } else if (fourcc === 'VP8 ' && size >= 10 && !still) {
      // frame tag (3 bytes), start code 9d 01 2a, then 14-bit width/height
      if (buf[d + 3] === 0x9d && buf[d + 4] === 0x01 && buf[d + 5] === 0x2a) {
        still = { width: buf.readUInt16LE(d + 6) & 0x3fff, height: buf.readUInt16LE(d + 8) & 0x3fff };
      }
    } else if (fourcc === 'VP8L' && size >= 5 && !still) {
      if (buf[d] === 0x2f) {
        const bits = buf.readUInt32LE(d + 1);
        still = { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      }
    }
    pos = d + size + (size % 2);
  }
  const dims = canvas ?? still;
  if (!dims) return null;
  const n = Math.max(1, frames);
  return { ...dims, frames: n, totalPixels: dims.width * dims.height * n };
}

const DIMENSIONS = { jpg: jpegDimensions, png: pngDimensions, gif: gifDimensions, webp: webpDimensions };

/**
 * Picture size from an image's headers: { width, height, frames, totalPixels } (totalPixels over
 * all animation frames), or null when it can't be read.
 * @param {Buffer} buf
 * @param {string} ext jpg/png/webp/gif
 */
export function imageDimensions(buf, ext) {
  const fn = DIMENSIONS[ext];
  try {
    return fn ? fn(buf) : null;
  } catch {
    return null;
  }
}

/** A message for the uploader when a picture is too large to publish, else null. */
export function imageSizeProblem(dims) {
  if (!dims || !dims.width || !dims.height) return "We couldn't read that image's size — try saving it again as a JPEG or PNG";
  const side = Math.max(dims.width, dims.height, dims.maxSide ?? 0);
  if (side > IMAGE_MAX_SIDE || dims.width * dims.height > IMAGE_MAX_PIXELS) {
    return `That image is ${dims.width} × ${dims.height} pixels — too large. Please use one up to ${IMAGE_MAX_SIDE} pixels on a side and ${IMAGE_MAX_PIXELS / 1_000_000} megapixels (a phone photo is fine; 1000 × 1000 is plenty for album art)`;
  }
  if (dims.frames > IMAGE_MAX_FRAMES || dims.totalPixels > IMAGE_MAX_TOTAL_PIXELS) {
    return `That animation has too many frames or pixels (${dims.frames} frames) — please use a still image or a shorter animation`;
  }
  return null;
}

/**
 * Metadata-free copy of an image whose type was already sniffed (`ext` = jpg/png/webp/gif).
 * @param {Buffer} buf
 * @param {string} ext
 * @returns {Buffer|null} null when the file is damaged / not really that format
 */
export function stripImageMetadata(buf, ext) {
  const fn = STRIPPERS[ext];
  return fn ? fn(buf) : null;
}

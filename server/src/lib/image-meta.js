// Remove metadata from user-uploaded images before they are published. Phone photos carry EXIF
// (GPS position, camera serial numbers, timestamps), XMP and IPTC blocks; the site's users are
// minors, so none of that may be served back. No image library: the container formats are walked
// and only the parts needed to draw the picture are copied.
//
//   JPEG: drop APP1 (Exif/XMP) except a rebuilt orientation-only Exif, APP2 except ICC profiles,
//         APP3–APP13, APP15, COM, and anything after EOI (MPF "extra images" live there).
//         Keeps APP0 (JFIF) and APP14 (Adobe colour transform) so colours don't change.
//   PNG:  drop tEXt/zTXt/iTXt/eXIf/tIME chunks and anything after IEND.
//   WebP: drop EXIF and XMP chunks (and their VP8X flags) and anything after the RIFF body.
//   GIF:  drop comment extensions and XMP application extensions.
// Every function returns a new Buffer, or null when the file isn't a well-formed image of that type.

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
      out.push(seg); // JFIF / JFXX
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
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

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
    if (!PNG_DROP.has(type)) out.push(buf.subarray(pos, end));
    pos = end;
    if (type === 'IEND') return Buffer.concat(out);
  }
  return null; // no IEND
}

export function stripWebp(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const riffEnd = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  const chunks = [];
  let pos = 12;
  while (pos + 8 <= riffEnd) {
    const fourcc = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const end = pos + 8 + size + (size % 2);
    if (pos + 8 + size > riffEnd) return null;
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
      let chunk = buf.subarray(pos, Math.min(end, riffEnd));
      if (fourcc === 'VP8X' && size >= 1) {
        chunk = Buffer.from(chunk);
        chunk[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
      }
      chunks.push(chunk);
    }
    pos = end;
  }
  if (!chunks.length || !/^VP8[ LX]$/.test(chunks[0].toString('latin1', 0, 4))) return null;
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

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
      const appId = label === 0xff ? buf.toString('latin1', pos + 3, pos + 14) : '';
      if (label !== 0xfe && appId !== 'XMP DataXMP') out.push(buf.subarray(pos, end));
      pos = end;
    } else {
      return null;
    }
  }
  return null; // no trailer
}

const STRIPPERS = { jpg: stripJpeg, png: stripPng, webp: stripWebp, gif: stripGif };

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

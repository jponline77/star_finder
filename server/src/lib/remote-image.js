// Download a remote image from an allowlisted host (https only, no cross-host redirects,
// 10 s timeout, ≤ 5 MB, image/* content-type AND matching magic bytes; never SVG).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isAllowedImageHost } from './validate.js';
import { sniffImage } from './media-types.js';
import { IMAGE_MAX_BYTES, saveBuffer } from './uploads.js';
import { stripImageMetadata, imageDimensions, imageSizeProblem } from './image-meta.js';

export const IMAGE_USER_AGENT = 'STARSongFinder/1.0 (school musical theatre song finder)';

export class RemoteImageError extends Error {
  /** @param {string} message @param {{ status?: number|null, retryable?: boolean, retryAfterMs?: number|null, code?: string|null }} [info] */
  constructor(message, { status = null, retryable = false, retryAfterMs = null, code = null } = {}) {
    super(message);
    this.status = status;
    /** true for network errors, timeouts, HTTP 408/429/5xx — worth trying again later */
    this.retryable = retryable;
    /** the server's Retry-After, in ms, when it sent one */
    this.retryAfterMs = retryAfterMs;
    /**
     * For a network error (no HTTP answer): the system error code behind it — 'EAI_AGAIN' / 'ENOTFOUND'
     * (DNS: usually offline), 'ECONNREFUSED', 'ECONNRESET', … — or 'TIMEOUT'. null otherwise.
     */
    this.code = code;
  }
}

/** The code behind a failed fetch: undici puts the system error in `cause` (sometimes an AggregateError). */
function networkErrorCode(err) {
  if (err?.name === 'TimeoutError') return 'TIMEOUT';
  for (const e of [err?.cause, err?.cause?.errors?.[0], err]) {
    if (typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(e.code)) return e.code;
  }
  return null;
}

/** A RemoteImageError for a request that got no (complete) HTTP answer. */
function networkError(err) {
  return new RemoteImageError(`Couldn't download image: ${err?.name === 'TimeoutError' ? 'timed out' : 'network error'}`, { retryable: true, code: networkErrorCode(err) });
}

/** Retry-After (seconds or an HTTP date) → ms, or null. */
function retryAfterMs(res) {
  const v = res.headers.get('retry-after');
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/**
 * @param {string} rawUrl
 * @param {{ fetchImpl?: typeof fetch, maxBytes?: number, timeoutMs?: number, isAllowedHost?: (host: string) => boolean, maxRedirects?: number,
 *   userAgent?: string }} [opts]
 * @returns {Promise<{ buffer: Buffer, ext: string, mime: string, url: string }>}
 */
export async function fetchRemoteImage(rawUrl, opts = {}) {
  const {
    fetchImpl = globalThis.fetch,
    maxBytes = IMAGE_MAX_BYTES,
    timeoutMs = 10_000,
    isAllowedHost = isAllowedImageHost,
    maxRedirects = 3,
    userAgent = IMAGE_USER_AGENT,
  } = opts;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteImageError('Invalid image URL');
  }
  if (url.protocol !== 'https:' || !isAllowedHost(url.hostname.toLowerCase())) {
    throw new RemoteImageError('Image URL must be https on an allowed host');
  }
  const originalHost = url.hostname.toLowerCase();
  const signal = AbortSignal.timeout(timeoutMs);

  let res;
  for (let hop = 0; ; hop++) {
    try {
      res = await fetchImpl(url.toString(), {
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': userAgent, Accept: 'image/*' },
      });
    } catch (err) {
      throw networkError(err);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc || hop >= maxRedirects) throw new RemoteImageError('Too many redirects');
      const next = new URL(loc, url);
      if (next.protocol !== 'https:' || next.hostname.toLowerCase() !== originalHost) {
        throw new RemoteImageError('Image redirected to a different website');
      }
      url = next;
      continue;
    }
    break;
  }
  if (!res.ok) {
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    throw new RemoteImageError(`Image download failed (HTTP ${res.status})`, { status: res.status, retryable, retryAfterMs: retryable ? retryAfterMs(res) : null });
  }
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('image/') || type.includes('svg')) throw new RemoteImageError('That link is not an image');
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RemoteImageError('Image is too large');

  const chunks = [];
  let total = 0;
  if (res.body) {
    try {
      for await (const chunk of res.body) {
        total += chunk.length;
        if (total > maxBytes) throw new RemoteImageError('Image is too large');
        chunks.push(Buffer.from(chunk));
      }
    } catch (err) {
      if (err instanceof RemoteImageError) throw err;
      // the connection dropped or the timeout fired while the body was arriving
      throw networkError(err);
    }
  }
  const buffer = Buffer.concat(chunks);
  const kind = sniffImage(buffer);
  if (!kind) throw new RemoteImageError('That file is not a supported image (jpeg, png, webp, gif)');
  return { buffer, ext: kind.ext, mime: kind.mime, url: url.toString() };
}

/**
 * Download a remote image for a website edit (a song's album art, a show's poster) into
 * `<uploadsDir>/<subdir>/<prefix><uuid>.<ext>`, metadata stripped, and return its public path
 * ('/uploads/art/….jpg'). Every download gets its own file, owned by the one row that points at
 * it, so it can be deleted when that row's image is replaced or the row is deleted. (Files under
 * server/media are the seed images downloaded by `npm run fetch-media`; the API never writes them.)
 * @param {string} rawUrl
 * @param {{ uploadsDir: string, subdir: 'art'|'shows', prefix?: string, fetchImpl?: typeof fetch }} opts
 */
export async function downloadRemoteImage(rawUrl, { uploadsDir, subdir, prefix = '', fetchImpl }) {
  const img = await fetchRemoteImage(rawUrl, { fetchImpl });
  const clean = stripImageMetadata(img.buffer, img.ext);
  if (!clean) throw new RemoteImageError('That image file is damaged or not a supported image');
  // Same size rule as uploads: never publish a picture that decodes to gigapixels.
  const tooBig = imageSizeProblem(imageDimensions(clean, img.ext));
  if (tooBig) throw new RemoteImageError('Image is too large');
  return saveBuffer(uploadsDir, subdir, clean, img.ext, '/uploads', prefix);
}

/**
 * Download and cache a remote image under `<mediaDir>/<subdir>/<prefix><sha256(url)[:16]>.<ext>`.
 * Content-addressed by URL, so re-using the same art is free and files are never overwritten.
 * Used by `npm run enrich` for the seed media only (the API uses downloadRemoteImage).
 * Returns the public path, e.g. '/media/art/3f2a….jpg'.
 * @param {string} rawUrl
 * @param {{ mediaDir: string, subdir: 'art'|'shows', prefix?: string, fetchImpl?: typeof fetch }} opts
 */
export async function cacheRemoteImage(rawUrl, { mediaDir, subdir, prefix = '', fetchImpl }) {
  const hash = crypto.createHash('sha256').update(rawUrl).digest('hex').slice(0, 16);
  const dir = path.join(mediaDir, subdir);
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    const name = `${prefix}${hash}.${ext}`;
    if (fs.existsSync(path.join(dir, name))) return `/media/${subdir}/${name}`;
  }
  const img = await fetchRemoteImage(rawUrl, { fetchImpl });
  await fs.promises.mkdir(dir, { recursive: true });
  const name = `${prefix}${hash}.${img.ext}`;
  const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
  await fs.promises.writeFile(tmp, img.buffer);
  await fs.promises.rename(tmp, path.join(dir, name));
  return `/media/${subdir}/${name}`;
}

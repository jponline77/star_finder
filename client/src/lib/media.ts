/**
 * Client-side checks for media uploads (the server sniffs the bytes and has the final say):
 *  - audio (POST /api/songs/:id/audio): mp3/m4a/aac/wav/aiff/ogg ≤ 25 MB — mirrors server/src/lib/uploads.js
 *  - album art (POST /api/songs/:id/artwork, SPEC §7c): jpeg/png/webp/gif ≤ 5 MB, never SVG
 * Unit-tested in media.test.ts.
 */
import { formatBytes } from './format';

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1]!.toLowerCase() : '';
}

interface FileLike {
  name: string;
  size: number;
  type: string;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'mp4', 'aac', 'wav', 'aif', 'aiff', 'aifc', 'ogg', 'oga'] as const;
/** Value for <input type="file" accept>. */
export const AUDIO_ACCEPT = '.mp3,.m4a,.aac,.wav,.aif,.aiff,.ogg,audio/*';
export const AUDIO_FORMATS_TEXT = 'MP3, M4A, AAC, WAV, AIFF or OGG';

/** A friendly error, or null when the file looks like audio we accept. */
export function validateAudioFile(file: FileLike): string | null {
  if (!file || file.size === 0) return 'That file is empty — pick another one.';
  const ext = fileExtension(file.name);
  const knownExt = (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
  const audioMime = /^audio\//i.test(file.type);
  if (!knownExt && !audioMime) return `That doesn’t look like an audio file. Use ${AUDIO_FORMATS_TEXT}.`;
  if (file.type && /^(video|image|text)\//i.test(file.type) && !knownExt) return `That doesn’t look like an audio file. Use ${AUDIO_FORMATS_TEXT}.`;
  if (file.size > AUDIO_MAX_BYTES) return `That file is too big (max 25 MB). Try an MP3 or M4A — they’re much smaller than WAV/AIFF.`;
  return null;
}

// ---------------------------------------------------------------------------
// Images (album art)
// ---------------------------------------------------------------------------

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;
/** Value for <input type="file" accept>. */
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';
export const IMAGE_FORMATS_TEXT = 'JPG, PNG, WebP or GIF';

/** A friendly error, or null when the file looks like an image the server accepts. */
export function validateImageFile(file: FileLike): string | null {
  if (!file || file.size === 0) return 'That image is empty — pick another one.';
  const ext = fileExtension(file.name);
  const type = (file.type || '').toLowerCase();
  if (type === 'image/svg+xml' || ext === 'svg') return `SVG drawings can’t be used as album art — pick a ${IMAGE_FORMATS_TEXT} image.`;
  if (type === 'image/heic' || type === 'image/heif' || ext === 'heic' || ext === 'heif') {
    return 'iPhone HEIC photos aren’t supported yet — share it as a JPG (or take a screenshot) and try again.';
  }
  const knownType = (IMAGE_TYPES as readonly string[]).includes(type);
  const knownExt = (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
  // Some browsers/OSes send no type (or a generic one) — fall back to the extension; the server checks the bytes.
  const genericType = type === '' || type === 'application/octet-stream';
  if (!knownType && !(genericType && knownExt)) return `That doesn’t look like a picture we can use. Pick a ${IMAGE_FORMATS_TEXT} image.`;
  if (file.size > IMAGE_MAX_BYTES) return `That image is ${formatBytes(file.size)} — the limit is 5 MB. Try a smaller JPG or a screenshot.`;
  return null;
}

/** `URL.createObjectURL` when the environment has it (jsdom doesn't), else null. */
export function objectUrlFor(file: Blob | null | undefined): string | null {
  if (!file || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

export function revokeObjectUrl(url: string | null | undefined): void {
  if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

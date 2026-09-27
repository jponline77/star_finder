// Upload handling: multer streams the file to a temp file on disk (never the whole body in memory)
// → the bytes are checked (media-types.js) → the file is moved/rewritten to a random name under
// uploads/<subdir>/. SVG/HTML are never accepted (the type is decided by the bytes, never by the
// client). Per-user limits: concurrent uploads, total bytes stored; plus a free-disk-space floor.
//
// Layout of the uploads directory (all gitignored, all part of the backup):
//   audio/   practice tracks uploaded by users            (songs.audio_path)
//   images/  show posters uploaded by users               (shows.image_path)
//   art/     album art downloaded from Apple for a song   (songs.artwork_path)
//   shows/   show posters downloaded from Wikipedia/Apple (shows.image_path)
//   .incoming/  temp files of uploads in progress (not served; swept when stale)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import multer from 'multer';
import { HttpError } from './errors.js';

export { sniffImage, sniffAudio } from './media-types.js';

export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_SUBDIRS = Object.freeze(['audio', 'images', 'art', 'shows']);
export const INCOMING_DIR = '.incoming';

/** Create uploads/<subdir> for every subdir we write to. */
export function ensureUploadDirs(uploadsDir) {
  for (const sub of [...UPLOAD_SUBDIRS, INCOMING_DIR]) fs.mkdirSync(path.join(uploadsDir, sub), { recursive: true });
}

/**
 * multer middleware that streams a single `file` field to `<uploadsDir>/.incoming/`, with a size
 * limit. The handler gets `req.file.path` and must remove it (see `removeTemp`).
 * @param {number} maxBytes
 * @param {string} uploadsDir
 */
export function singleFileUpload(maxBytes, uploadsDir) {
  const incoming = path.join(uploadsDir, INCOMING_DIR);
  const mw = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => fs.mkdir(incoming, { recursive: true }, (err) => cb(err, incoming)),
      filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.part`),
    }),
    limits: { fileSize: maxBytes, files: 1, fields: 5, parts: 6, fieldSize: 1024 },
  }).single('file');
  const mb = Math.round(maxBytes / (1024 * 1024));
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `That file is too big (max ${mb} MB)`, { file: `Max ${mb} MB` }));
        if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(new HttpError(400, 'Upload the file in a form field called "file"', { file: 'Unexpected field' }));
        return next(new HttpError(400, `Upload failed: ${err.message}`));
      }
      return next(new HttpError(400, 'Upload failed — the file could not be read'));
    });
  };
}

/** Throw a 400 unless a file was received. */
export function requireFile(req) {
  if (!req.file || !req.file.path || req.file.size === 0) {
    throw new HttpError(400, 'Please choose a file to upload', { file: 'No file received' });
  }
  return req.file;
}

/** Remove a temp upload (errors ignored). */
export async function removeTemp(file) {
  if (file?.path) await fs.promises.rm(file.path, { force: true }).catch(() => {});
}

const randomName = (prefix, ext) => `${prefix}${crypto.randomUUID()}.${ext}`;

/**
 * Write a buffer to `<rootDir>/<subdir>/<prefix><uuid>.<ext>` and return the public URL path.
 * @param {string} rootDir e.g. server/uploads
 * @param {string} subdir e.g. 'images'
 * @param {Buffer} buffer
 * @param {string} ext
 * @param {string} urlPrefix e.g. '/uploads'
 * @param {string} [prefix] file-name prefix (e.g. a show slug)
 */
export async function saveBuffer(rootDir, subdir, buffer, ext, urlPrefix, prefix = '') {
  const dir = path.join(rootDir, subdir);
  await fs.promises.mkdir(dir, { recursive: true });
  const name = randomName(prefix, ext);
  await fs.promises.writeFile(path.join(dir, name), buffer, { flag: 'wx' });
  return `${urlPrefix}/${subdir}/${name}`;
}

/**
 * Copy bytes [start, end) of a temp upload to `<uploadsDir>/<subdir>/<uuid>.<ext>` (streamed) and
 * return the public path. Used to drop ID3 tags from mp3/aac without loading the file into memory.
 */
export async function storeUploadRange(uploadsDir, subdir, tmpPath, ext, { start = 0, end } = {}) {
  const dir = path.join(uploadsDir, subdir);
  await fs.promises.mkdir(dir, { recursive: true });
  const name = randomName('', ext);
  const dest = path.join(dir, name);
  const size = (await fs.promises.stat(tmpPath)).size;
  const last = Math.min(end ?? size, size);
  if (start === 0 && last === size) {
    await fs.promises.rename(tmpPath, dest);
  } else {
    try {
      await pipeline(fs.createReadStream(tmpPath, { start, end: last - 1 }), fs.createWriteStream(dest, { flags: 'wx' }));
    } catch (err) {
      await fs.promises.rm(dest, { force: true });
      throw err;
    }
  }
  return `/uploads/${subdir}/${name}`;
}

/** Absolute path of a public '/uploads/...' path, or null if it isn't inside uploadsDir. */
export function uploadedFilePath(uploadsDir, publicPath) {
  if (typeof publicPath !== 'string' || !publicPath.startsWith('/uploads/')) return null;
  const root = path.resolve(uploadsDir);
  const full = path.resolve(root, publicPath.slice('/uploads/'.length));
  return full.startsWith(root + path.sep) ? full : null;
}

/**
 * Delete a previously uploaded file given its public path ('/uploads/...'). Only files inside
 * uploadsDir are ever deleted; seed media under /media is never touched. Errors are ignored.
 * @param {string} uploadsDir
 * @param {string|null|undefined} publicPath
 */
export async function deleteUploadedFile(uploadsDir, publicPath) {
  const full = uploadedFilePath(uploadsDir, publicPath);
  if (!full) return false;
  try {
    await fs.promises.unlink(full);
    return true;
  } catch {
    return false;
  }
}

/** true if any song or show still points at `publicPath`. */
export function isFileReferenced(db, publicPath) {
  return Boolean(db.prepare(`
    SELECT 1 FROM songs WHERE audio_path = @p OR artwork_path = @p
    UNION ALL SELECT 1 FROM shows WHERE image_path = @p LIMIT 1`).get({ p: publicPath }));
}

/** Delete an uploaded/downloaded file once no row references it any more. */
export async function deleteIfUnreferenced(db, uploadsDir, publicPath) {
  if (!uploadedFilePath(uploadsDir, publicPath) || isFileReferenced(db, publicPath)) return false;
  return deleteUploadedFile(uploadsDir, publicPath);
}

/** Every '/uploads/...' path referenced by the database. */
export function referencedUploads(db) {
  const rows = db.prepare(`
    SELECT audio_path AS p FROM songs WHERE audio_path LIKE '/uploads/%'
    UNION SELECT artwork_path FROM songs WHERE artwork_path LIKE '/uploads/%'
    UNION SELECT image_path FROM shows WHERE image_path LIKE '/uploads/%'`).all();
  return new Set(rows.map((r) => r.p));
}

/** Bytes stored for files referenced by rows the user created (their upload "usage"). */
export function userUploadBytes(db, uploadsDir, userId) {
  const rows = db.prepare(`
    SELECT audio_path AS p FROM songs WHERE created_by = @u AND audio_path LIKE '/uploads/%'
    UNION SELECT artwork_path FROM songs WHERE created_by = @u AND artwork_path LIKE '/uploads/%'
    UNION SELECT image_path FROM shows WHERE created_by = @u AND image_path LIKE '/uploads/%'`).all({ u: userId });
  let total = 0;
  for (const { p } of rows) {
    const full = uploadedFilePath(uploadsDir, p);
    try {
      if (full) total += fs.statSync(full).size;
    } catch {
      // missing file — counts as 0
    }
  }
  return total;
}

/** Size on disk of an uploaded file (0 if it isn't one / doesn't exist). */
export function uploadedFileSize(uploadsDir, publicPath) {
  const full = uploadedFilePath(uploadsDir, publicPath);
  try {
    return full ? fs.statSync(full).size : 0;
  } catch {
    return 0;
  }
}

/**
 * Delete temp files in uploads/.incoming older than `minAgeMs` (left behind by a crash or an
 * aborted request). Returns how many were removed.
 */
export function sweepIncoming(uploadsDir, { minAgeMs = 60 * 60 * 1000, now = Date.now() } = {}) {
  const dir = path.join(uploadsDir, INCOMING_DIR);
  let removed = 0;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (st.isFile() && now - st.mtimeMs >= minAgeMs) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch {
      // raced with the request that owns it
    }
  }
  return removed;
}

/**
 * Files under uploads/<subdir>/ that no song or show references (orphans), older than `minAgeMs`.
 * Used by `npm run clean-uploads` (never automatic: a misconfigured STAR_DB_PATH pointing at an
 * empty database would make every upload look orphaned).
 */
export function findOrphanUploads(db, uploadsDir, { minAgeMs = 60 * 60 * 1000, now = Date.now() } = {}) {
  const referenced = referencedUploads(db);
  const orphans = [];
  for (const sub of UPLOAD_SUBDIRS) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(uploadsDir, sub));
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const full = path.join(uploadsDir, sub, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile() || now - st.mtimeMs < minAgeMs) continue;
      const publicPath = `/uploads/${sub}/${name}`;
      if (!referenced.has(publicPath)) orphans.push({ publicPath, fullPath: full, bytes: st.size });
    }
  }
  return orphans;
}

/**
 * Guards that run BEFORE multer reads the request body: one user can't hold many uploads open at
 * once, can't store more than their quota, and nobody can upload when the disk is nearly full
 * (SQLite needs free space for its WAL — a full disk takes the whole site down).
 * Admins are exempt from the per-user quota (they upload practice tracks for spreadsheet songs).
 * Env: STAR_UPLOAD_CONCURRENCY (2 per user), STAR_UPLOAD_TOTAL_CONCURRENCY (16 for the whole site),
 * STAR_UPLOAD_QUOTA_MB (200 per user), STAR_MIN_FREE_MB (256 MB free disk space required).
 * @param {{ db: import('better-sqlite3').Database, uploadsDir: string, env: Record<string, string|undefined> }} ctx
 */
export function createUploadGuard({ db, uploadsDir, env = {} }) {
  const num = (name, dflt) => {
    const n = Number(env[name]);
    return env[name] !== undefined && env[name] !== '' && Number.isFinite(n) && n >= 0 ? n : dflt;
  };
  const maxConcurrent = Math.max(1, num('STAR_UPLOAD_CONCURRENCY', 2));
  const maxTotal = Math.max(maxConcurrent, num('STAR_UPLOAD_TOTAL_CONCURRENCY', 16));
  let total = 0;
  const quotaBytes = num('STAR_UPLOAD_QUOTA_MB', 200) * 1024 * 1024;
  const minFreeBytes = num('STAR_MIN_FREE_MB', 256) * 1024 * 1024;
  /** @type {Map<number, number>} */
  const active = new Map();

  const quotaError = () =>
    new HttpError(413, `You've used all your upload space (${Math.round(quotaBytes / 1048576)} MB) — remove an old upload first`, { file: 'Upload space used up' });

  function freeBytes() {
    try {
      const st = fs.statfsSync(uploadsDir);
      return st.bavail * st.bsize;
    } catch {
      return Infinity; // statfs unsupported → don't block uploads
    }
  }

  /** Express middleware: claim an upload slot for req.user (released when the response closes). */
  function before(req, res, next) {
    const id = req.user.id;
    const n = active.get(id) ?? 0;
    if (n >= maxConcurrent) {
      return next(new HttpError(429, "You're already uploading — wait for that upload to finish, then try again"));
    }
    if (total >= maxTotal) {
      res.setHeader?.('Retry-After', '10');
      return next(new HttpError(503, 'Lots of people are uploading right now — try again in a moment'));
    }
    if (freeBytes() < minFreeBytes) {
      return next(new HttpError(507, 'The server is almost out of storage space, so uploads are paused — please tell your teacher'));
    }
    if (req.user.role !== 'admin' && quotaBytes > 0 && userUploadBytes(db, uploadsDir, id) >= quotaBytes) {
      return next(quotaError());
    }
    active.set(id, n + 1);
    total++;
    let released = false;
    res.on('close', () => {
      if (released) return;
      released = true;
      total--;
      const left = (active.get(id) ?? 1) - 1;
      if (left > 0) active.set(id, left);
      else active.delete(id);
    });
    next();
  }

  /**
   * After the file is received and checked: would storing `newBytes` (replacing `replacedPath`,
   * if the user created it) take the user over quota? Throws 413.
   */
  function checkQuota(user, { newBytes, ownerId, replacedPath = null }) {
    if (user.role === 'admin' || quotaBytes <= 0 || ownerId !== user.id) return;
    const used = userUploadBytes(db, uploadsDir, user.id) - uploadedFileSize(uploadsDir, replacedPath);
    if (used + newBytes > quotaBytes) throw quotaError();
  }

  return { before, checkQuota, activeCount: (id) => active.get(id) ?? 0, totalActive: () => total };
}

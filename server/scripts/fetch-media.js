#!/usr/bin/env node
// Download the seed images that are NOT in the repository — show posters (Wikipedia) and album art
// (Apple) are third-party artwork — from their original sources into server/media/. Part of
// `npm run setup`; run it again any time with `npm run fetch-media` (files already here are kept,
// so it's cheap). No re-import is needed afterwards: the import stores the image paths anyway.
//
//   node scripts/fetch-media.js [--force] [--dry-run] [--strict] [--media-dir dir] [--seed-dir dir]
//
//   server/seed/shows.json  imageSourceUrl → server/media/shows/<imageFile>
//   server/seed/media.json  artworkUrl     → server/media/art/<artworkFile>  (the name is only a cache key)
//
//   --force      download again even when a good file is already there
//   --dry-run    list what would be downloaded (no network, nothing written)
//   --strict     exit with status 1 if any image couldn't be downloaded. Without it the script warns
//                and exits 0, so an offline setup still finishes (the site shows gradient placeholders).
//   --media-dir  where the images go (default: STAR_MEDIA_DIR, else server/media)
//   --seed-dir   where shows.json / media.json are (default: server/seed)
//   Relative paths resolve from the directory you run the command in.
//
// Downloads follow the website's own rules for remote images (src/lib/remote-image.js): https only,
// upload.wikimedia.org or *.mzstatic.com, no redirects to other hosts, ≤ 5 MB, 10 s timeout, and the
// bytes must be a real jpeg/png/webp/gif that matches the file name's extension. Two downloads at a
// time with a short pause between requests; network errors, 429 and 5xx are retried with backoff.
// When a site doesn't answer at all (DNS failure, refused, timed out) 3 times in a row, the rest of its
// images are skipped at once — offline, the whole run takes seconds, not minutes.
// A file that is already here but isn't a readable image of the right type is downloaded again.
// Several seed entries that share one file (or one URL) are downloaded once.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRemoteImage, RemoteImageError } from '../src/lib/remote-image.js';
import { stripImageMetadata } from '../src/lib/image-meta.js';
import { sniffImage } from '../src/lib/media-types.js';
import { isAllowedImageHost } from '../src/lib/validate.js';
import { WIKI_USER_AGENT } from '../src/lib/wikipedia.js';
import { isSeedImageName, seedImageKind } from '../src/lib/seed-media.js';
import { resolveUserPath } from '../src/lib/paths.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SEED_DIR = path.join(SERVER_ROOT, 'seed');
export const DEFAULT_MEDIA_DIR = path.join(SERVER_ROOT, 'media');

const CONCURRENCY = 2;
const DELAY_MS = 400; // pause after each request, per worker
const RETRIES = 3;
const BACKOFF_MS = 2000; // 2 s, 4 s, 8 s (or the server's Retry-After, up to MAX_WAIT_MS)
const MAX_WAIT_MS = 30_000;
const HOST_FAILURE_LIMIT = 3; // a site that fails to answer this many times in a row is treated as unreachable

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @typedef {{ subdir: 'shows'|'art', file: string, url: string|null, labels: string[], problem?: string }} Job
 */

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function urlProblem(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'not a valid URL';
  }
  if (u.protocol !== 'https:' || !isAllowedImageHost(u.hostname.toLowerCase())) return 'URL must be https on upload.wikimedia.org or *.mzstatic.com';
  return null;
}

/**
 * Every seed image (one job per target file) from shows.json + media.json.
 * @param {string} seedDir
 * @returns {{ jobs: Job[], notes: string[] }}
 */
export function collectJobs(seedDir) {
  /** @type {Map<string, Job>} */
  const byTarget = new Map();
  const notes = [];
  const add = (subdir, file, url, label) => {
    if (typeof file !== 'string' || !file.trim()) return;
    file = file.trim();
    url = typeof url === 'string' && url.trim() ? url.trim() : null;
    const key = `${subdir}/${file}`;
    const seen = byTarget.get(key);
    if (seen) {
      seen.labels.push(label);
      if (url && !seen.url) seen.url = url;
      else if (url && seen.url !== url) notes.push(`${key}: ${label} names a different URL than ${seen.labels[0]} — using the first one`);
      return;
    }
    const job = { subdir, file, url, labels: [label] };
    if (!isSeedImageName(file)) job.problem = 'not a plain image file name (letters, digits, - _ . and .jpg/.png/.webp/.gif)';
    byTarget.set(key, job);
  };

  const shows = readJson(path.join(seedDir, 'shows.json'));
  if (shows !== null && !Array.isArray(shows)) throw new Error('shows.json must be an array');
  for (const e of shows ?? []) {
    if (e && typeof e === 'object') add('shows', e.imageFile, e.imageSourceUrl, typeof e.name === 'string' ? e.name : 'a shows.json entry');
  }
  const media = readJson(path.join(seedDir, 'media.json'));
  if (media !== null && (typeof media !== 'object' || Array.isArray(media))) throw new Error('media.json must be an object');
  for (const [k, v] of Object.entries(media ?? {})) {
    if (!k.startsWith('_') && v && typeof v === 'object') add('art', v.artworkFile, v.artworkUrl, k);
  }
  for (const job of byTarget.values()) {
    if (job.problem) continue;
    if (!job.url) job.problem = `no source URL in the seed (${job.subdir === 'shows' ? 'imageSourceUrl' : 'artworkUrl'})`;
    else job.problem = urlProblem(job.url) ?? undefined;
  }
  return { jobs: [...byTarget.values()], notes };
}

/**
 * Is the file at `file` a readable image of the type its name promises?
 * @returns {{ state: 'missing' } | { state: 'valid', size: number } | { state: 'invalid', reason: string }}
 */
export function checkImageFile(file, expectedKind) {
  let buf;
  try {
    if (!fs.statSync(file).isFile()) return { state: 'invalid', reason: 'not a file' };
    buf = fs.readFileSync(file);
  } catch (err) {
    if (err?.code === 'ENOENT') return { state: 'missing' };
    return { state: 'invalid', reason: `unreadable (${err?.code ?? err?.message})` };
  }
  const kind = sniffImage(buf);
  if (!kind) return { state: 'invalid', reason: 'not an image' };
  if (kind.ext !== expectedKind) return { state: 'invalid', reason: `is a ${kind.ext}, the name says ${expectedKind}` };
  if (!stripImageMetadata(buf, kind.ext)) return { state: 'invalid', reason: 'damaged' };
  return { state: 'valid', size: buf.length };
}

/** Thrown instead of making a request to a site that has already failed to answer HOST_FAILURE_LIMIT times in a row. */
class HostUnreachableError extends Error {}

/**
 * Per-site circuit breaker. Every attempt that gets no HTTP answer (a DNS failure, which is what being
 * offline looks like; connection refused or reset; a timeout) counts against its host, and any answer
 * (even a 404 or 503) resets the count. At `limit` failures in a row the host is marked unreachable:
 * downloads waiting to retry it give up, and the rest of its images are skipped without a request.
 */
function hostTracker(limit, log) {
  /** @type {Map<string, { inARow: number, down: boolean, code: string|null }>} */
  const hosts = new Map();
  const get = (host) => {
    if (!hosts.has(host)) hosts.set(host, { inARow: 0, down: false, code: null });
    return hosts.get(host);
  };
  const why = (h) => (h.code === 'TIMEOUT' ? ' (timed out)' : h.code ? ` (${h.code})` : '');
  return {
    isDown: (host) => get(host).down,
    skipError: (host) => new HostUnreachableError(`skipped — couldn't reach ${host}${why(get(host))}`),
    answered: (host) => {
      const h = get(host);
      h.inARow = 0;
      h.down = false; // a request that was already under way got through after all
    },
    noAnswer: (host, code) => {
      const h = get(host);
      h.inARow++;
      h.code = code ?? h.code;
      if (!h.down && h.inARow >= limit) {
        h.down = true;
        log(`   ⚠️  Couldn't reach ${host} ${h.inARow} times in a row${why(h)} — skipping its other images. Offline?`);
      }
    },
  };
}

/** No HTTP answer at all: a network error or a timeout (not an HTTP error status, not a bad image). */
const isNoAnswer = (err) => err instanceof RemoteImageError && err.retryable && err.status == null;

/** A download failure as one short line, e.g. "Couldn't download image: network error (EAI_AGAIN)". */
function reasonFor(err) {
  const msg = err?.message ?? String(err);
  return err instanceof RemoteImageError && err.code && err.code !== 'TIMEOUT' ? `${msg} (${err.code})` : msg;
}

/** fetchRemoteImage with retries (network errors, timeouts, 408/429/5xx) and exponential backoff. */
async function downloadWithRetry(url, { fetchImpl, pause, retries, backoffMs, timeoutMs, hosts }) {
  const host = new URL(url).hostname.toLowerCase();
  for (let attempt = 0; ; attempt++) {
    if (hosts.isDown(host)) throw hosts.skipError(host);
    try {
      const img = await fetchRemoteImage(url, { fetchImpl, userAgent: WIKI_USER_AGENT, timeoutMs });
      hosts.answered(host);
      return img;
    } catch (err) {
      if (isNoAnswer(err)) hosts.noAnswer(host, err.code);
      else if (err instanceof RemoteImageError) hosts.answered(host);
      const retryable = err instanceof RemoteImageError ? err.retryable : true;
      if (!retryable || attempt >= retries || hosts.isDown(host)) throw err;
      await pause(Math.min(MAX_WAIT_MS, Math.max(err?.retryAfterMs ?? 0, backoffMs * 2 ** attempt)));
    }
  }
}

const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * @param {{ seedDir?: string, mediaDir?: string, force?: boolean, dryRun?: boolean, fetchImpl?: typeof fetch,
 *   log?: (m: string) => void, pause?: (ms: number) => Promise<void>, concurrency?: number, delayMs?: number,
 *   retries?: number, backoffMs?: number, timeoutMs?: number, hostFailureLimit?: number }} [opts]
 */
export async function fetchMedia({
  seedDir = DEFAULT_SEED_DIR, mediaDir = DEFAULT_MEDIA_DIR, force = false, dryRun = false, fetchImpl = globalThis.fetch,
  log = (m) => console.log(m), pause = sleep, concurrency = CONCURRENCY, delayMs = DELAY_MS, retries = RETRIES,
  backoffMs = BACKOFF_MS, timeoutMs = 10_000, hostFailureLimit = HOST_FAILURE_LIMIT,
} = {}) {
  const { jobs, notes } = collectJobs(seedDir);
  const summary = { mediaDir, total: jobs.length, present: 0, downloaded: 0, wouldDownload: 0, requests: 0, skipped: 0, failed: [], notes };
  const counts = { shows: jobs.filter((j) => j.subdir === 'shows').length, art: jobs.filter((j) => j.subdir === 'art').length };
  log(`🖼️  Seed images: ${counts.shows} show poster(s) (Wikipedia) and ${counts.art} album cover(s) (Apple) → ${mediaDir}${dryRun ? ' (dry run)' : ''}`);
  for (const n of notes) log(`   ⚠️  ${n}`);

  const fail = (job, reason, { quiet = false } = {}) => {
    summary.failed.push({ file: `${job.subdir}/${job.file}`, url: job.url, reason, labels: job.labels });
    if (!quiet) log(`   ✗ ${job.subdir}/${job.file} (${job.labels[0]}${job.labels.length > 1 ? ` +${job.labels.length - 1}` : ''}): ${reason}`);
  };

  const hosts = hostTracker(hostFailureLimit, log);
  // One download per URL, even when several files (or a retry of a file) need it.
  /** @type {Map<string, Promise<{ buffer: Buffer, ext: string }>>} */
  const downloads = new Map();
  const getImage = (url) => {
    if (!downloads.has(url)) {
      const host = new URL(url).hostname.toLowerCase();
      let p;
      if (hosts.isDown(host)) {
        p = Promise.reject(hosts.skipError(host)); // no request, no pause
      } else {
        summary.requests++;
        p = downloadWithRetry(url, { fetchImpl, pause, retries, backoffMs, timeoutMs, hosts }).finally(() => pause(delayMs));
      }
      downloads.set(url, p);
    }
    return downloads.get(url);
  };

  const handle = async (job) => {
    const target = path.join(mediaDir, job.subdir, job.file ?? '');
    const kind = job.file ? seedImageKind(job.file) : null;
    const existing = job.problem && !isSeedImageName(job.file) ? { state: 'missing' } : checkImageFile(target, kind);
    if (existing.state === 'valid' && !force) {
      summary.present++;
      return;
    }
    if (job.problem) {
      if (existing.state === 'valid') summary.present++; // --force, but nothing to download it from: keep it
      else fail(job, job.problem);
      return;
    }
    const why = existing.state === 'invalid' ? `replacing (${existing.reason})` : existing.state === 'valid' ? 'forced' : 'missing';
    if (dryRun) {
      summary.wouldDownload++;
      log(`   would download ${job.subdir}/${job.file} (${why}) ← ${job.url}`);
      return;
    }
    let img;
    try {
      img = await getImage(job.url);
    } catch (err) {
      if (err instanceof HostUnreachableError) {
        summary.skipped++;
        fail(job, err.message, { quiet: true }); // counted in the summary, not one ✗ line each
      } else {
        fail(job, reasonFor(err));
      }
      return;
    }
    if (img.ext !== kind) {
      fail(job, `the source is a ${img.ext}, but the file name says ${kind}`);
      return;
    }
    const tmp = path.join(path.dirname(target), `.${job.file}.${process.pid}.tmp`);
    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(tmp, img.buffer);
      await fs.promises.rename(tmp, target); // atomic: a half-written file is never left under the real name
    } catch (err) {
      await fs.promises.rm(tmp, { force: true }).catch(() => {});
      fail(job, `couldn't save it (${err?.code ?? err?.message})`);
      return;
    }
    summary.downloaded++;
    log(`   ✓ ${job.subdir}/${job.file} (${kb(img.buffer.length)}${existing.state === 'missing' ? '' : `, ${why}`})`);
  };

  const queue = [...jobs];
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
    while (queue.length) await handle(queue.shift());
  });
  await Promise.all(workers);

  const f = summary.failed.length;
  if (dryRun) {
    log(`📋 ${summary.total} image(s): ${summary.present} already here, ${summary.wouldDownload} to download${f ? `, ${f} can't be downloaded` : ''} (dry run — nothing written)`);
  } else if (!f) {
    log(`✅ ${summary.total} image(s): ${summary.present} already here, ${summary.downloaded} downloaded`);
  } else {
    const skipped = summary.skipped ? `, ${summary.skipped} skipped because their site couldn't be reached` : '';
    log(`⚠️  ${f} of ${summary.total} image(s) couldn't be downloaded (${summary.present} already here, ${summary.downloaded} downloaded${skipped}).`);
    log('   The website shows gradient placeholders for them. Run `npm run fetch-media` again when you are online — no re-import needed.');
  }
  return summary;
}

function parseArgs(argv) {
  const o = { force: false, dryRun: false, strict: false, mediaDir: null, seedDir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a folder`);
      return v;
    };
    if (a === '--force') o.force = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--media-dir') o.mediaDir = value();
    else if (a === '--seed-dir') o.seedDir = value();
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  return o;
}

const HELP = `Usage: node scripts/fetch-media.js [--force] [--dry-run] [--strict] [--media-dir dir] [--seed-dir dir]
Downloads the show posters (Wikipedia) and album art (Apple) named in the seed files into server/media/.
  --force     download again even when a good file is already there
  --dry-run   list what would be downloaded; no network, nothing written
  --strict    exit 1 if anything couldn't be downloaded (default: warn and exit 0)
  --media-dir where the images go (default: STAR_MEDIA_DIR, else server/media)
  --seed-dir  where shows.json / media.json are (default: server/seed)`;

/**
 * CLI entry point. Returns the exit status: 0 = done (possibly with download warnings), 1 = downloads
 * failed with --strict, bad usage, or an unreadable seed file.
 * @param {string[]} [argv]
 * @param {{ fetchImpl?: typeof fetch, log?: (m: string) => void, error?: (m: string) => void, pause?: (ms: number) => Promise<void>, env?: NodeJS.ProcessEnv }} [deps]
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? ((m) => console.log(m));
  const error = deps.error ?? ((m) => console.error(m));
  const env = deps.env ?? process.env;
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    error(`❌ ${err.message}\n${HELP}`);
    return 1;
  }
  if (opts.help) {
    log(HELP);
    return 0;
  }
  const seedDir = opts.seedDir ? resolveUserPath(opts.seedDir, env) : DEFAULT_SEED_DIR;
  const mediaDirArg = opts.mediaDir ?? env.STAR_MEDIA_DIR;
  const mediaDir = mediaDirArg ? resolveUserPath(mediaDirArg, env) : DEFAULT_MEDIA_DIR;
  let summary;
  try {
    summary = await fetchMedia({
      seedDir, mediaDir, force: opts.force, dryRun: opts.dryRun, log,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.pause ? { pause: deps.pause } : {}),
    });
  } catch (err) {
    // a broken seed file (not a network problem) — the import would fail on it too
    error(`❌ ${err.message}`);
    return 1;
  }
  if (summary.failed.length && opts.strict) {
    error(`❌ --strict: ${summary.failed.length} image(s) failed`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  });
}

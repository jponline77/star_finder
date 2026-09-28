// Polite HTTP for Wikimedia APIs: descriptive User-Agent, per-host minimum interval, retries that
// honour Retry-After (429/503/maxlag), and a gzip'd on-disk cache so rebuilds are cheap and
// deterministic. Nothing here knows about musicals.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const USER_AGENT = 'STARSongFinderCatalogBuilder/1.0 (https://github.com/jponline77/star_finder)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

/**
 * On-disk JSON cache: <dir>/<namespace>/<hh>/<sha1(key)>.json.gz.
 * refresh: ignore entries written before this run; offline: never hit the network (miss → error).
 */
export class DiskCache {
  constructor(dir, { refresh = false, offline = false } = {}) {
    this.dir = dir; this.refresh = refresh; this.offline = offline;
    this.written = new Set(); this.hits = 0; this.misses = 0;
  }
  file(ns, key) { const h = sha1(key); return path.join(this.dir, ns, h.slice(0, 2), `${h}.json.gz`); }
  get(ns, key) {
    const f = this.file(ns, key);
    if (this.refresh && !this.written.has(f)) return undefined;
    try {
      const v = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
      if (v.key !== key) return undefined; // (hash collision guard)
      this.hits++;
      return v.data;
    } catch { return undefined; }
  }
  set(ns, key, data) {
    const f = this.file(ns, key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify({ key, data })));
    fs.renameSync(tmp, f);
    this.written.add(f);
    this.misses++;
  }
}

/** Serialises calls so that consecutive requests start at least `ms` apart. */
export function createThrottle(ms) {
  let last = 0; let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(async () => {
      const wait = last + ms - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  };
}

function retryAfterMs(res, fallbackMs) {
  const h = res.headers.get('retry-after');
  if (!h) return fallbackMs;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(Math.max(secs, 1), 600) * 1000;
  const when = Date.parse(h);
  return Number.isFinite(when) ? Math.min(Math.max(when - Date.now(), 1000), 600000) : fallbackMs;
}

/**
 * POST a form and return the response text, retrying transient failures.
 * validate(text) may throw to force a retry (e.g. a truncated JSON body).
 */
export async function postForm(url, form, { throttle, retries = 6, log = () => {}, accept = 'application/json', validate } = {}) {
  let backoff = 2000;
  for (let attempt = 1; ; attempt++) {
    let res; let text;
    try {
      res = await throttle(() => fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT, Accept: accept, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Encoding': 'gzip' },
        body: new URLSearchParams(form),
        signal: AbortSignal.timeout(120000),
      }));
      text = await res.text();
    } catch (err) {
      if (attempt > retries) throw err;
      log(`network error (${err.message}); retry ${attempt}/${retries} in ${backoff / 1000}s`);
      await sleep(backoff); backoff = Math.min(backoff * 2, 60000); continue;
    }
    if (res.status === 429 || res.status === 503 || res.status === 502 || res.status === 504 || res.status === 500) {
      if (attempt > retries) throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`);
      const wait = retryAfterMs(res, backoff);
      log(`HTTP ${res.status}; retry ${attempt}/${retries} in ${Math.round(wait / 1000)}s`);
      await sleep(wait); backoff = Math.min(backoff * 2, 120000); continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 500)}`);
    if (validate) {
      try { validate(text, res); } catch (err) {
        if (attempt > retries || err.fatal) throw err;
        const wait = err.retryAfterMs ?? retryAfterMs(res, backoff);
        log(`${err.message}; retry ${attempt}/${retries} in ${Math.round(wait / 1000)}s`);
        await sleep(wait); backoff = Math.min(backoff * 2, 120000); continue;
      }
    }
    return text;
  }
}

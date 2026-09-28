// One site-wide budget for calls to Apple's iTunes Search/Lookup API. Apple documents about 20
// calls a minute per client, and the whole website is ONE client to Apple: without a shared cap,
// page views (show pages checking for a cast album, the recording picker, /api/lookup/itunes) from
// many visitors could make the server send far more, and Apple then throttles or blocks the
// server's address — every Apple feature breaks for everyone. The per-user/IP rate limits don't
// help with that: they multiply with every visitor.
//
// A token bucket: `perMinute` tokens a minute, up to `burst` saved up. A call that finds the bucket
// empty waits for the next token when that is at most `maxWaitMs` away (a small queue), else it
// fails at once with AppleBusyError (the routes answer 503 + Retry-After, or "couldn't check").
// Only requests to Apple's API hosts count; album art and previews on *.mzstatic.com are a CDN.

import { HttpError } from './errors.js';

export const APPLE_DOWN = "Couldn't reach Apple Music right now — try again in a bit";
export const APPLE_BUSY = 'Apple Music lookups are busy right now — try again in a minute';

export class AppleBusyError extends Error {
  /** @param {number} retryAfterSeconds */
  constructor(retryAfterSeconds) {
    super('Apple Music lookups are busy right now');
    this.code = 'APPLE_BUSY';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const isAppleBusy = (err) => err?.code === 'APPLE_BUSY';

/**
 * @param {{ perMinute?: number, burst?: number, maxWaitMs?: number, now?: () => number }} [opts]
 */
export function createRateBudget({ perMinute = 20, burst = perMinute, maxWaitMs = 3000, now = () => Date.now() } = {}) {
  const ratePerMs = perMinute / 60_000;
  let tokens = burst;
  let last = now();
  const refill = () => {
    const t = now();
    tokens = Math.min(burst, tokens + (t - last) * ratePerMs);
    last = t;
  };
  return {
    perMinute,
    /** ms to wait before the call may go (0 = now), or -1 when the budget is spent (nothing reserved). */
    reserve() {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return 0;
      }
      const wait = (1 - tokens) / ratePerMs;
      if (wait > maxWaitMs) return -1;
      tokens -= 1; // a queued call: the token it waits for is already spoken for
      return Math.ceil(wait);
    },
    /** Seconds until a call could go again. */
    retryAfterSeconds() {
      refill();
      return Math.max(1, Math.ceil((1 - tokens) / ratePerMs / 1000));
    },
  };
}

const APPLE_API_HOSTS = new Set(['itunes.apple.com']);

/** fetch() that spends the budget on Apple API requests (everything else passes straight through). */
export function budgetedFetch(fetchImpl, budget) {
  const wrapped = async (input, init) => {
    let host = '';
    try {
      host = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url).hostname.toLowerCase();
    } catch {
      host = '';
    }
    if (APPLE_API_HOSTS.has(host)) {
      const wait = budget.reserve();
      if (wait < 0) throw new AppleBusyError(budget.retryAfterSeconds());
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    return fetchImpl(input, init);
  };
  wrapped.budget = budget;
  return wrapped;
}

/** STAR_APPLE_LIMIT (Apple API calls per minute for the whole site, default 20). */
export function appleBudgetFromEnv(env = {}) {
  const n = Number(env.STAR_APPLE_LIMIT);
  const perMinute = Number.isFinite(n) && n > 0 ? n : 20;
  return createRateBudget({ perMinute, burst: perMinute, maxWaitMs: 3000 });
}

/**
 * The HTTP error for a failed Apple lookup: 503 + Retry-After when the site-wide budget is spent,
 * else 502 (Apple unreachable).
 * @param {unknown} err
 * @param {import('express').Response} res
 */
export function appleHttpError(err, res) {
  if (isAppleBusy(err)) {
    res.setHeader('Retry-After', String(err.retryAfterSeconds ?? 60));
    return new HttpError(503, APPLE_BUSY);
  }
  return new HttpError(502, APPLE_DOWN);
}

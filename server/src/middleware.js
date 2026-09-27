// Cross-cutting middleware: sessions, CSRF header, JSON content-type, auth guards, rate limits.
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { HttpError, unauthorized, forbidden } from './lib/errors.js';
import { parseCookies, hashToken, SESSION_COOKIE } from './lib/auth.js';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'star-song-finder';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Attach req.user (row) + req.sessionHash when the star_sid cookie maps to a live session.
 * Sessions of disabled accounts, and of accounts whose admin-issued temporary password has expired
 * without being changed, don't count.
 */
export function loadSession(db) {
  const stmt = db.prepare(`
    SELECT u.*, f.slug AS festival_slug FROM sessions s JOIN users u ON u.id = s.user_id
    LEFT JOIN festivals f ON f.id = u.festival_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0
      AND NOT (u.must_change_password = 1 AND u.temp_password_expires_at IS NOT NULL AND u.temp_password_expires_at <= ?)`);
  return (req, _res, next) => {
    req.user = null;
    req.sessionHash = null;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token && token.length <= 100) {
      const h = hashToken(token);
      const now = new Date().toISOString();
      const user = stmt.get(h, now, now);
      if (user) {
        req.user = user;
        req.sessionHash = h;
      }
    }
    next();
  };
}

/**
 * Every non-GET /api request must carry `X-Requested-With: star-song-finder`; bodies must be JSON
 * (or multipart/form-data on upload routes).
 */
export function csrfAndContentType({ isMultipartRoute }) {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.get(CSRF_HEADER) !== CSRF_VALUE) {
      return next(new HttpError(403, 'Missing or invalid X-Requested-With header'));
    }
    const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    if (isMultipartRoute(req)) {
      if (!req.is('multipart/form-data')) return next(new HttpError(415, 'Uploads must be sent as multipart/form-data'));
    } else if (hasBody && !req.is('application/json')) {
      return next(new HttpError(415, 'Content-Type must be application/json'));
    }
    next();
  };
}

// Requests a user with an admin-issued temporary password may still make (besides reading).
const ALLOWED_WHILE_MUST_CHANGE = [
  ['PUT', /^\/auth\/me\/?$/],
  ['POST', /^\/auth\/(logout|login|signup)\/?$/],
];

/**
 * After an admin password reset the account must choose a new password before it can change
 * anything: every other write answers 403 (GETs still work, so the site and /me load).
 */
export function requirePasswordChange(req, _res, next) {
  if (!req.user?.must_change_password || SAFE_METHODS.has(req.method)) return next();
  if (ALLOWED_WHILE_MUST_CHANGE.some(([method, re]) => req.method === method && re.test(req.path))) return next();
  next(new HttpError(403, 'Please choose a new password first', undefined, { code: 'MUST_CHANGE_PASSWORD' }));
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Admins only'));
  next();
}

/** true if `user` may edit a row with `created_by` (owner or admin). */
export function canEdit(user, row) {
  if (!user || !row) return false;
  if (user.role === 'admin') return true;
  return row.created_by !== null && row.created_by !== undefined && row.created_by === user.id;
}

const userOrIpKey = (req) => (req.user ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? '')}`);

function limiter({ windowMs, limit, message, keyGenerator = userOrIpKey, ...rest }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    handler: (_req, res) => res.status(429).json({ error: message }),
    validate: { trustProxy: false, xForwardedForHeader: false, keyGeneratorIpFallback: false },
    ...rest,
  });
}

/**
 * Build the app's rate limiters. Limits can be tuned with env vars (tests raise them):
 * STAR_WRITE_LIMIT (60/min), STAR_READ_LIMIT (1200 GETs/min), STAR_EXPORT_LIMIT (10 downloads/min),
 * STAR_LOOKUP_LIMIT (30/min), STAR_COMMENT_LIMIT (20/min),
 * STAR_LOGIN_LIMIT (10 failed / 15 min per IP+email, and per account for current-password checks),
 * STAR_SIGNUP_LIMIT (100/hour per IP), STAR_SIGNUP_CONFLICT_LIMIT (20 "already exists" / hour per IP).
 * Each is per logged-in user, or per IP when logged out, unless noted.
 */
export function createLimiters(env = {}) {
  const num = (name, dflt) => {
    const n = Number(env[name]);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  return {
    writes: limiter({
      windowMs: 60_000,
      limit: num('STAR_WRITE_LIMIT', 60),
      message: "Whoa, that's a lot of changes — take a breath and try again in a minute",
      skip: (req) => SAFE_METHODS.has(req.method),
    }),
    // Generous: a whole class often browses from one school IP.
    reads: limiter({
      windowMs: 60_000,
      limit: num('STAR_READ_LIMIT', 1200),
      message: 'Too many requests — slow down and try again in a minute',
      skip: (req) => !SAFE_METHODS.has(req.method),
    }),
    exports: limiter({
      windowMs: 60_000,
      limit: num('STAR_EXPORT_LIMIT', 10),
      message: 'Too many downloads — try again in a minute',
    }),
    lookups: limiter({
      windowMs: 60_000,
      limit: num('STAR_LOOKUP_LIMIT', 30),
      message: 'Too many lookups — try again in a minute',
    }),
    comments: limiter({
      windowMs: 60_000,
      limit: num('STAR_COMMENT_LIMIT', 20),
      message: "You're commenting very fast — try again in a minute",
    }),
    login: limiter({
      windowMs: 15 * 60_000,
      limit: num('STAR_LOGIN_LIMIT', 10),
      message: 'Too many login attempts — try again in 15 minutes',
      skipSuccessfulRequests: true,
      keyGenerator: (req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
        return `login:${ipKeyGenerator(req.ip ?? '')}:${email}`;
      },
    }),
    signup: limiter({
      windowMs: 60 * 60_000,
      limit: num('STAR_SIGNUP_LIMIT', 100),
      message: 'Too many sign-ups from this network — try again later',
      keyGenerator: (req) => `signup:${ipKeyGenerator(req.ip ?? '')}`,
    }),
    // Counts only 409 "An account with that email already exists" answers, which reveal that an
    // address has an account: guessing classmates' emails gets blocked quickly.
    signupConflicts: limiter({
      windowMs: 60 * 60_000,
      limit: num('STAR_SIGNUP_CONFLICT_LIMIT', 20),
      message: 'Too many sign-ups for emails that already have an account — try logging in instead, or try again later',
      keyGenerator: (req) => `signup409:${ipKeyGenerator(req.ip ?? '')}`,
      skipSuccessfulRequests: true,
      requestWasSuccessful: (_req, res) => res.statusCode !== 409,
    }),
    // Wrong current password on PUT /api/auth/me, per account.
    passwordCheck: limiter({
      windowMs: 15 * 60_000,
      limit: num('STAR_LOGIN_LIMIT', 10),
      message: 'Too many wrong passwords — try again in 15 minutes',
      keyGenerator: (req) => `pw:${req.user?.id ?? ipKeyGenerator(req.ip ?? '')}`,
      skipSuccessfulRequests: true,
      requestWasSuccessful: (_req, res) => !res.locals.failedPasswordCheck,
    }),
  };
}

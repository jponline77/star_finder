// Password hashing (node:crypto scrypt) and cookie sessions (sha256 token hashes in the DB).
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

export const SESSION_COOKIE = 'star_sid';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, saltBytes: 16 };

/**
 * Hash a password → 'scrypt$N$r$p$saltB64$hashB64'.
 * @param {string} password
 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT.saltBytes);
  const key = await scryptAsync(password.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Constant-time verify against a stored hash. Unknown/malformed hashes return false.
 * @param {string} password
 * @param {string} stored
 */
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length === 0) return false;
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(key, expected);
}

// A real hash of a random password, used to keep login timing similar for unknown emails.
let dummyHashPromise = null;
export function dummyHash() {
  dummyHashPromise ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHashPromise;
}

/** sha256 hex of a raw session token (only the hash is stored). */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a session row and return the raw token for the cookie.
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 */
export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expiresAt);
  return token;
}

/** Delete expired sessions; returns the number removed. */
export function purgeExpiredSessions(db) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString()).changes;
}

/** Parse a Cookie header into a plain object (first occurrence wins). */
export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    let val = part.slice(i + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    try {
      out[k] = decodeURIComponent(val);
    } catch {
      out[k] = val;
    }
  }
  return out;
}

/** Cookie options for the session cookie (Secure when the request came over HTTPS). */
export function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: Boolean(req.secure),
    maxAge: SESSION_MAX_AGE_MS,
  };
}

/** Set the session cookie on the response. */
export function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req));
}

/** Clear the session cookie. */
export function clearSessionCookie(req, res) {
  const { maxAge, ...opts } = sessionCookieOptions(req);
  res.clearCookie(SESSION_COOKIE, opts);
}

/** Parse STAR_ADMIN_EMAILS (comma-separated, case-insensitive) into a Set. */
export function parseAdminEmails(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Apply STAR_ADMIN_EMAILS at startup. Sign-up never proves that someone owns an email address, so
 * an email match alone must not make an account an admin: whoever registers the teacher's address
 * first would get it. Instead:
 *  - signup and login never grant admin;
 *  - at startup, a listed email's account is promoted only if it already existed when the email was
 *    FIRST listed (the operator is vouching for an account the teacher has already created);
 *  - an account created after the email was listed is left alone and reported, so the operator can
 *    check it's really the teacher's and then run `make-admin`.
 * Emails removed from the list are forgotten, so listing one again starts a new window.
 * @param {import('better-sqlite3').Database} db
 * @param {Set<string>} emails lowercased
 * @returns {{ promoted: object[], alreadyAdmin: object[], tooNew: (object & { first_listed_at: string })[], missing: string[] }}
 */
export function applyAdminEmails(db, emails, now = new Date().toISOString()) {
  const list = [...emails];
  const out = { promoted: [], alreadyAdmin: [], tooNew: [], missing: [] };
  db.transaction(() => {
    db.prepare('DELETE FROM admin_email_listings WHERE lower(email) NOT IN (SELECT value FROM json_each(?))').run(JSON.stringify(list));
    const remember = db.prepare('INSERT OR IGNORE INTO admin_email_listings (email, first_listed_at) VALUES (?, ?)');
    const listing = db.prepare('SELECT first_listed_at FROM admin_email_listings WHERE email = ?');
    const userByEmail = db.prepare('SELECT id, email, display_name, role, disabled, created_at FROM users WHERE email = ?');
    const promote = db.prepare("UPDATE users SET role = 'admin' WHERE id = ?");
    for (const email of list) {
      remember.run(email, now);
      const firstListedAt = listing.get(email).first_listed_at;
      const user = userByEmail.get(email);
      if (!user) out.missing.push(email);
      else if (user.role === 'admin') out.alreadyAdmin.push(user);
      else if (user.created_at <= firstListedAt) {
        promote.run(user.id);
        out.promoted.push(user);
      } else out.tooNew.push({ ...user, first_listed_at: firstListedAt });
    }
  })();
  return out;
}

/** How long an admin-issued temporary password (and sessions made with it) keeps working. */
export const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

// Readable temporary passwords: no 0/O/1/l/I.
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** e.g. "k7Qm-xR4p-9fTd" (12 random chars + 2 dashes). */
export function temporaryPassword() {
  const pick = () => TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join('');
  return `${group()}-${group()}-${group()}`;
}

/** true when the user still has an admin-issued temporary password that has run out. */
export function tempPasswordExpired(user, now = new Date().toISOString()) {
  return Boolean(user?.must_change_password) && Boolean(user.temp_password_expires_at) && user.temp_password_expires_at <= now;
}

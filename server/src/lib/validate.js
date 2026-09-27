// Input validation helpers. Collect field errors, then throw one 400 with `details`.
import { HttpError } from './errors.js';
import { cleanText, withoutJoiners } from './text.js';

export class Validator {
  constructor() {
    /** @type {Record<string, string>} */
    this.details = {};
  }

  /** Record an error for `field` (first error per field wins). */
  error(field, message) {
    if (!(field in this.details)) this.details[field] = message;
    return undefined;
  }

  get ok() {
    return Object.keys(this.details).length === 0;
  }

  /** Throw a 400 if any errors were recorded. */
  check(message = 'Please fix the highlighted fields') {
    if (!this.ok) throw new HttpError(400, message, this.details);
  }

  /**
   * Trimmed string (empty → null) with length limits.
   * @param {string} field
   * @param {unknown} value
   * @param {{ required?: boolean, min?: number, max?: number, multiline?: boolean, label?: string }} [opts]
   * @returns {string|null}
   */
  string(field, value, { required = false, min = 1, max = 200, multiline = false, label } = {}) {
    const name = label ?? field;
    if (value !== null && value !== undefined && typeof value !== 'string' && typeof value !== 'number') {
      this.error(field, `${name} must be text`);
      return null;
    }
    const s = cleanText(value, { multiline });
    if (s === null) {
      if (required) this.error(field, `${name} is required`);
      return null;
    }
    if ([...s].length < min) this.error(field, `${name} must be at least ${min} characters`);
    if ([...s].length > max) this.error(field, `${name} must be at most ${max} characters`);
    return s;
  }

  /**
   * Integer within [min, max] (accepts numeric strings). Empty → null.
   * @returns {number|null}
   */
  integer(field, value, { required = false, min = -Infinity, max = Infinity, label } = {}) {
    const name = label ?? field;
    if (value === null || value === undefined || value === '') {
      if (required) this.error(field, `${name} is required`);
      return null;
    }
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
    if (!Number.isInteger(n)) {
      this.error(field, `${name} must be a whole number`);
      return null;
    }
    if (n < min || n > max) {
      this.error(field, `${name} must be between ${min} and ${max}`);
      return null;
    }
    return n;
  }

  /** Boolean (true/false, 1/0, "true"/"false", "yes"/"no"). Empty → default. */
  boolean(field, value, { defaultValue = false, label } = {}) {
    if (value === null || value === undefined || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === 0) return value === 1;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(v)) return true;
      if (['false', '0', 'no', 'n'].includes(v)) return false;
    }
    this.error(field, `${label ?? field} must be true or false`);
    return defaultValue;
  }

  /**
   * https URL, optionally restricted to hosts. Empty → null.
   * @param {{ hosts?: (host: string) => boolean, hostMessage?: string, max?: number, required?: boolean, label?: string }} [opts]
   * @returns {string|null}
   */
  httpsUrl(field, value, { hosts, hostMessage, max = 1000, required = false, label } = {}) {
    const name = label ?? field;
    if (value === null || value === undefined || value === '') {
      if (required) this.error(field, `${name} is required`);
      return null;
    }
    if (typeof value !== 'string') return this.error(field, `${name} must be a link`) ?? null;
    const s = value.trim();
    if (s === '') {
      if (required) this.error(field, `${name} is required`);
      return null;
    }
    if (s.length > max) return this.error(field, `${name} is too long`) ?? null;
    let url;
    try {
      url = new URL(s);
    } catch {
      return this.error(field, `${name} must be a valid https:// link`) ?? null;
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      return this.error(field, `${name} must be a valid https:// link`) ?? null;
    }
    if (hosts && !hosts(url.hostname.toLowerCase())) {
      return this.error(field, hostMessage ?? `${name} isn't from an allowed website`) ?? null;
    }
    return url.toString();
  }

  /** One of `allowed`. Empty → default. */
  oneOf(field, value, allowed, { defaultValue = null, required = false, label } = {}) {
    if (value === null || value === undefined || value === '') {
      if (required) this.error(field, `${label ?? field} is required`);
      return defaultValue;
    }
    if (typeof value === 'string' && allowed.includes(value.trim().toLowerCase())) return value.trim().toLowerCase();
    this.error(field, `${label ?? field} must be one of: ${allowed.join(', ')}`);
    return defaultValue;
  }
}

/** Host matchers used by several validators. */
export const hostIs = (...names) => (host) => names.includes(host);
export const hostEndsWith = (...suffixes) => (host) =>
  suffixes.some((suf) => host === suf.replace(/^\./, '') || host.endsWith(suf.startsWith('.') ? suf : '.' + suf));

export const isItunesPreviewHost = hostEndsWith('.itunes.apple.com', '.mzstatic.com');
export const isMzstaticHost = hostEndsWith('.mzstatic.com');
export const isAppleHost = hostEndsWith('.apple.com');
export const isWikipediaHost = hostEndsWith('.wikipedia.org');
/** Remote images we will download server-side. */
export const isAllowedImageHost = (host) => host === 'upload.wikimedia.org' || hostEndsWith('.mzstatic.com')(host);

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Trim + lowercase an email and validate its format (≤ 254 chars). */
export function normalizeEmail(v, value, field = 'email') {
  if (typeof value !== 'string' || value.trim() === '') {
    v.error(field, 'Email is required');
    return null;
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    v.error(field, "That doesn't look like an email address");
    return null;
  }
  return email;
}

const URLISH_RE = /(:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ca|io|co|us|uk|edu|gov|info|biz|me|tv|ly|app|dev|xyz|gg|link|site|online)\b)/i;

/** Display name: 2–40 chars, no emails or URLs. */
export function validateDisplayName(v, value, field = 'displayName') {
  const s = v.string(field, value, { required: true, min: 2, max: 40, label: 'Display name' });
  if (s === null) return null;
  const plain = withoutJoiners(s); // an invisible joiner mustn't hide "evil.com"
  if (plain.includes('@')) v.error(field, "Don't put an email address in your display name");
  else if (URLISH_RE.test(plain)) v.error(field, "Don't put a website address in your display name");
  return s;
}

/** Password: 8–200 characters (not trimmed). */
export function validatePassword(v, value, field = 'password') {
  if (typeof value !== 'string' || value.length === 0) {
    v.error(field, 'Password is required');
    return null;
  }
  if (value.length < 8) v.error(field, 'Password must be at least 8 characters');
  else if (value.length > 200) v.error(field, 'Password must be at most 200 characters');
  return value;
}

/** Parse a positive integer id from a route param; null if invalid. */
export function parseId(value) {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

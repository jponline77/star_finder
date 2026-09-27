/**
 * Client-side form validation mirroring the server rules (SPEC §5a). The server is authoritative;
 * these give instant, friendly feedback. Each validator returns an error message or null.
 */

export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|ca|net|org|io|app|dev|co|me|ly|gg|tv|xyz)\b)/i;

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter your email address.';
  if (v.length > EMAIL_MAX) return 'That email is too long.';
  if (!EMAIL_RE.test(v)) return 'That doesn’t look like an email address (like name@example.com).';
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return 'Enter a password.';
  if (value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (value.length > PASSWORD_MAX) return `Keep it under ${PASSWORD_MAX} characters.`;
  return null;
}

export function validateDisplayName(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Pick a display name.';
  if (v.length < DISPLAY_NAME_MIN) return `Use at least ${DISPLAY_NAME_MIN} characters.`;
  if (v.length > DISPLAY_NAME_MAX) return `Keep it to ${DISPLAY_NAME_MAX} characters or fewer.`;
  if (v.includes('@')) return 'Please don’t put an email address in your display name.';
  if (URL_RE.test(v)) return 'Please don’t put a website link in your display name.';
  return null;
}

export interface PasswordStrength {
  /** 0 (empty/too short) … 4 (showstopper) */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

const LABELS = ['Too short', 'Okay', 'Good', 'Strong', 'Showstopper!'] as const;

/** Friendly strength hint (not a security guarantee). */
export function passwordStrength(pw: string): PasswordStrength {
  if (!pw || pw.length < PASSWORD_MIN) return { score: 0, label: LABELS[0] };
  let score = 1;
  if (pw.length >= 12) score++;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes >= 2) score++;
  if (classes >= 3 && pw.length >= 10) score++;
  if (/^(.)\1+$/.test(pw) || /^(password|12345678|qwertyui)/i.test(pw)) score = 1;
  const s = Math.min(4, score) as PasswordStrength['score'];
  return { score: s, label: LABELS[s] };
}

/**
 * Length as the server counts it: Unicode code points after NFC normalisation, not UTF-16 units
 * (so an emoji counts as 1, not 2).
 */
export function charCount(value: string): number {
  return [...value.normalize('NFC')].length;
}

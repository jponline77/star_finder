/**
 * Formatting helpers: song lengths (m:ss), STAR time status, relative times, countdowns.
 */
import { TIME_LIMIT_SECONDS, WARN_SECONDS } from './vocab';

export type TimeStatus = 'ok' | 'close' | 'over';

/** 153 → "2:33"; 3725 → "1:02:05"; null/invalid → fallback (default "—"). */
export function formatLength(seconds: number | null | undefined, fallback = '—'): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return fallback;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/** 153 → "2 minutes 33 seconds" (for aria-labels / screen readers). */
export function formatLengthLong(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return 'unknown length';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s || !m) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/**
 * Parse a user-typed "m:ss" length → seconds, or null if invalid.
 * Accepts "2:33", "02:33", " 2:33 ", "12:05". Seconds must be 2 digits 00–59.
 * Also accepts a bare whole number of seconds ("153") since people paste those.
 * Result must be > 0 and < 3600 (DB constraint).
 */
export function parseLength(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const text = String(input).trim();
  if (!text) return null;
  let total: number;
  const mss = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  if (mss) {
    total = Number(mss[1]) * 60 + Number(mss[2]);
  } else if (/^\d{1,4}$/.test(text)) {
    total = Number(text);
  } else {
    return null;
  }
  if (!Number.isFinite(total) || total <= 0 || total >= 3600) return null;
  return total;
}

/**
 * STAR time status: ok ≤ 5:30 (330s), close 5:31–6:00, over > 6:00 (360s).
 * Returns null when the length is unknown.
 */
export function timeStatus(
  seconds: number | null | undefined,
  limit: number = TIME_LIMIT_SECONDS,
  warn: number = WARN_SECONDS,
): TimeStatus | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  if (seconds > limit) return 'over';
  if (seconds > warn) return 'close';
  return 'ok';
}

export const TIME_STATUS_LABEL: Record<TimeStatus, string> = {
  ok: 'Fits the 6:00 limit',
  close: 'Close to the limit',
  over: "Over STAR's 6:00 limit — needs a cut",
};

/** Short badge text for a status. */
export const TIME_STATUS_SHORT: Record<TimeStatus, string> = {
  ok: 'Fits',
  close: 'Close',
  over: 'Over 6:00',
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mar 3, 2026" (local time). Invalid → ''. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", "2 weeks ago",
 * else "Mar 3, 2026". Future times (clock skew) read "just now".
 */
export function relativeTime(iso: string | null | undefined, now: number | Date = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const diff = nowMs - t;
  if (diff < 45_000) return 'just now';
  if (diff < HOUR) {
    const m = Math.max(1, Math.round(diff / MINUTE));
    if (m >= 60) return '1 hour ago';
    return `${m} min ago`;
  }
  if (diff < DAY) {
    const h = Math.round(diff / HOUR);
    if (h >= 24) return 'yesterday';
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(diff / DAY);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} week${w === 1 ? '' : 's'} ago`;
  }
  return formatDate(iso);
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** true once the target moment has passed */
  past: boolean;
  totalMs: number;
}

/**
 * Parse 'YYYY-MM-DD' as LOCAL midnight (festival day), or any ISO datetime as-is.
 */
export function parseLocalDate(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(date);
}

/** Time remaining until `target` (a 'YYYY-MM-DD' string = local midnight, or a Date). */
export function countdownParts(target: string | Date, now: number | Date = Date.now()): CountdownParts {
  const t = typeof target === 'string' ? parseLocalDate(target).getTime() : target.getTime();
  const n = typeof now === 'number' ? now : now.getTime();
  const totalMs = Math.max(0, t - n);
  const totalSec = Math.floor(totalMs / 1000);
  return {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
    past: t - n <= 0,
    totalMs,
  };
}

/** Whole calendar days from `now` until `date` ('YYYY-MM-DD'); 0 on the day, negative after. */
export function daysUntil(date: string, now: Date = new Date()): number {
  const target = parseLocalDate(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / DAY);
}

export type FestivalPhase = 'upcoming' | 'today' | 'over';

/** Before the festival day, on it, or after it (local calendar days). */
export function festivalPhase(date: string, now: Date = new Date()): FestivalPhase {
  const d = daysUntil(date, now);
  return d > 0 ? 'upcoming' : d === 0 ? 'today' : 'over';
}

/** "Friday, December 11, 2026" */
export function formatLongDate(date: string): string {
  const d = parseLocalDate(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

/** 1 → "1 song", 3 → "3 songs". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Format bytes as "3.2 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Initials-free "percent" helper: 0.237 → "24%". */
export function percent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0%';
  return `${Math.round(fraction * 100)}%`;
}

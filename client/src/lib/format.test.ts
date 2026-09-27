import { describe, expect, it } from 'vitest';
import {
  countdownParts,
  daysUntil,
  festivalPhase,
  formatBytes,
  formatDate,
  formatLength,
  formatLengthLong,
  parseLength,
  percent,
  plural,
  relativeTime,
  timeStatus,
} from './format';

describe('formatLength', () => {
  it.each([
    [153, '2:33'],
    [0, '0:00'],
    [5, '0:05'],
    [60, '1:00'],
    [359.6, '6:00'],
    [3599, '59:59'],
    [3725, '1:02:05'],
  ])('%d → %s', (s, expected) => {
    expect(formatLength(s)).toBe(expected);
  });
  it('uses the fallback for null/invalid', () => {
    expect(formatLength(null)).toBe('—');
    expect(formatLength(undefined, '?')).toBe('?');
    expect(formatLength(Number.NaN)).toBe('—');
    expect(formatLength(-3)).toBe('—');
  });
  it('long form for screen readers', () => {
    expect(formatLengthLong(153)).toBe('2 minutes 33 seconds');
    expect(formatLengthLong(60)).toBe('1 minute');
    expect(formatLengthLong(61)).toBe('1 minute 1 second');
    expect(formatLengthLong(0)).toBe('0 seconds');
    expect(formatLengthLong(null)).toBe('unknown length');
  });
});

describe('parseLength', () => {
  it.each([
    ['2:33', 153],
    ['02:33', 153],
    [' 2:33 ', 153],
    ['0:45', 45],
    ['12:05', 725],
    ['59:59', 3599],
    ['153', 153],
  ])('%j → %d', (input, expected) => {
    expect(parseLength(input)).toBe(expected);
  });
  it.each(['', '   ', '2:5', '2:60', '2:333', 'abc', '2.33', '-2:00', '0:00', '0', '60:00', '1:02:03', '3600', ':30', '2:'])(
    'rejects %j',
    (input) => {
      expect(parseLength(input)).toBeNull();
    },
  );
  it('handles null/undefined', () => {
    expect(parseLength(null)).toBeNull();
    expect(parseLength(undefined)).toBeNull();
  });
  it('round-trips with formatLength', () => {
    for (const s of [1, 59, 60, 153, 330, 360, 361, 3599]) {
      expect(parseLength(formatLength(s))).toBe(s);
    }
  });
});

describe('timeStatus', () => {
  it.each([
    [0, 'ok'],
    [153, 'ok'],
    [330, 'ok'],
    [331, 'close'],
    [360, 'close'],
    [361, 'over'],
    [600, 'over'],
  ] as const)('%d → %s', (s, expected) => {
    expect(timeStatus(s)).toBe(expected);
  });
  it('is null for unknown lengths', () => {
    expect(timeStatus(null)).toBeNull();
    expect(timeStatus(undefined)).toBeNull();
    expect(timeStatus(Number.NaN)).toBeNull();
  });
  it('accepts custom thresholds', () => {
    expect(timeStatus(100, 120, 90)).toBe('close');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-09-26T12:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it.each([
    [0, 'just now'],
    [30_000, 'just now'],
    [-60_000, 'just now'],
    [60_000, '1 min ago'],
    [5 * 60_000, '5 min ago'],
    [59 * 60_000, '59 min ago'],
    [60 * 60_000, '1 hour ago'],
    [3 * 3600_000, '3 hours ago'],
    [25 * 3600_000, 'yesterday'],
    [3 * 86400_000, '3 days ago'],
    [7 * 86400_000, '1 week ago'],
    [15 * 86400_000, '2 weeks ago'],
  ])('%d ms ago → %s', (ms, expected) => {
    expect(relativeTime(ago(ms), now)).toBe(expected);
  });
  it('falls back to a date for old items', () => {
    expect(relativeTime('2026-03-03T12:00:00.000Z', now)).toMatch(/^Mar 3, 2026$/);
  });
  it('handles empty / invalid', () => {
    expect(relativeTime('', now)).toBe('');
    expect(relativeTime('not a date', now)).toBe('');
    expect(relativeTime(null, now)).toBe('');
  });
  it('accepts a Date for now', () => {
    expect(relativeTime(ago(120_000), new Date(now))).toBe('2 min ago');
  });
});

describe('dates & countdown', () => {
  it('formats dates', () => {
    expect(formatDate('2026-12-11T12:00:00')).toBe('Dec 11, 2026');
    expect(formatDate('garbage')).toBe('');
    expect(formatDate(null)).toBe('');
  });
  it('computes countdown parts to local midnight', () => {
    const now = new Date(2026, 11, 9, 22, 30, 15); // Dec 9 22:30:15 local
    const p = countdownParts('2026-12-11', now);
    expect(p).toMatchObject({ days: 1, hours: 1, minutes: 29, seconds: 45, past: false });
  });
  it('clamps after the date', () => {
    const p = countdownParts('2026-12-11', new Date(2026, 11, 12));
    expect(p.past).toBe(true);
    expect(p.totalMs).toBe(0);
    expect(p.days).toBe(0);
  });
  it('counts whole days', () => {
    expect(daysUntil('2026-12-11', new Date(2026, 8, 26, 23, 59))).toBe(76);
    expect(daysUntil('2026-12-11', new Date(2026, 11, 11, 9))).toBe(0);
    expect(daysUntil('2026-12-11', new Date(2026, 11, 13))).toBe(-2);
  });
  it('knows before / on / after the festival day', () => {
    expect(festivalPhase('2026-12-11', new Date(2026, 11, 10, 23, 59))).toBe('upcoming');
    expect(festivalPhase('2026-12-11', new Date(2026, 11, 11, 18))).toBe('today');
    expect(festivalPhase('2026-12-11', new Date(2027, 0, 10))).toBe('over');
  });
});

describe('misc', () => {
  it('plural', () => {
    expect(plural(1, 'song')).toBe('1 song');
    expect(plural(0, 'song')).toBe('0 songs');
    expect(plural(2, 'mouse', 'mice')).toBe('2 mice');
  });
  it('formatBytes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB');
    expect(formatBytes(-1)).toBe('');
  });
  it('percent', () => {
    expect(percent(0.237)).toBe('24%');
    expect(percent(Number.NaN)).toBe('0%');
  });
});

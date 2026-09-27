import { describe, expect, it } from 'vitest';
import { makeSong } from '../test/fixtures';
import { dateKey, gradientFor, initials, pickDaily, pickIndex, seededRandom, stableHash } from './hash';

describe('stableHash', () => {
  it('is deterministic and spreads values', () => {
    expect(stableHash('Wicked')).toBe(stableHash('Wicked'));
    expect(stableHash('Wicked')).not.toBe(stableHash('wicked'));
    expect(stableHash('')).toBe(0x811c9dc5);
    expect(stableHash('abc')).toBeGreaterThanOrEqual(0);
  });
});

describe('gradientFor', () => {
  it('is stable per seed and returns CSS', () => {
    const a = gradientFor('Hadestown');
    expect(a).toEqual(gradientFor('Hadestown'));
    expect(a.css).toMatch(/^linear-gradient\(\d+deg, hsl\(/);
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThan(360);
  });
  it('handles empty seeds', () => {
    expect(gradientFor('').css).toContain('linear-gradient');
  });
});

describe('initials', () => {
  it.each([
    ['Les Misérables', 'LM'],
    ['The Phantom of the Opera', 'PO'],
    ['Wicked', 'W'],
    ['Mrs. Lovett', 'ML'],
    ['Dear Evan Hansen', 'DE'],
    ['The', 'T'],
    ['  ', '?'],
    ['!!!', '?'],
    ['élan vital', 'EV'],
    ['Jean-Paul', 'JP'],
  ])('%j → %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
  it('respects max and nullish', () => {
    expect(initials('A Gentleman’s Guide to Love and Murder', 3)).toBe('GGL');
    expect(initials(null)).toBe('?');
  });
});

describe('daily picks', () => {
  const songs = [makeSong({ id: 3 }), makeSong({ id: 1 }), makeSong({ id: 2 })];
  it('dateKey uses the local calendar date', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('is stable for a day regardless of list order', () => {
    const d = new Date(2026, 8, 26, 8);
    const later = new Date(2026, 8, 26, 22);
    expect(pickDaily(songs, d)?.id).toBe(pickDaily([...songs].reverse(), later)?.id);
  });
  it('varies across days', () => {
    const picks = new Set<number>();
    for (let i = 1; i <= 20; i++) picks.add(pickDaily(songs, new Date(2026, 0, i))!.id);
    expect(picks.size).toBeGreaterThan(1);
  });
  it('handles empty lists', () => {
    expect(pickDaily([], new Date())).toBeNull();
    expect(pickIndex('x', 0)).toBe(-1);
  });
  it('seededRandom is deterministic in [0,1)', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 5; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

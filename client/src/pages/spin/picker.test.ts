import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../lib/hash';
import { makeSong, part } from '../../test/fixtures';
import { buildReel, pickRandom, randomIndex, reelEase, reelPosition, spinPool } from './picker';

const songs = [
  makeSong({ id: 1, kind: 'solo', parts: [part('Glinda', 'Soprano')] }),
  makeSong({ id: 2, kind: 'solo', mature: true, parts: [part('Sweeney', 'Baritone')] }),
  makeSong({ id: 3, kind: 'duet', parts: [part('Cosette', 'Soprano', 1), part('Marius', 'Tenor', 2)] }),
  makeSong({ id: 4, kind: 'solo', parts: [part('Marius', 'Tenor')] }),
];

describe('spinPool', () => {
  it('filters by kind, range (any duet part) and mature themes', () => {
    expect(spinPool(songs, { kind: 'all', ranges: [], hideMature: false })).toHaveLength(4);
    expect(spinPool(songs, { kind: 'solo', ranges: [], hideMature: true }).map((s) => s.id)).toEqual([1, 4]);
    expect(spinPool(songs, { kind: 'all', ranges: ['Tenor'], hideMature: false }).map((s) => s.id)).toEqual([3, 4]);
    expect(spinPool(songs, { kind: 'duet', ranges: ['Bass'], hideMature: false })).toEqual([]);
  });
});

describe('randomIndex / pickRandom', () => {
  it('maps random() onto the pool, clamping out-of-range values', () => {
    expect(randomIndex(4, () => 0)).toBe(0);
    expect(randomIndex(4, () => 0.99)).toBe(3);
    expect(randomIndex(4, () => 1)).toBe(3);
    expect(randomIndex(4, () => NaN)).toBe(0);
    expect(randomIndex(0, () => 0.5)).toBe(-1);
  });

  it('is deterministic for an injected random function', () => {
    expect(pickRandom(songs, () => 0.5)?.id).toBe(3);
    expect(pickRandom([], () => 0.5)).toBeNull();
  });

  it('never repeats the previous pick when there is a choice', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) expect(pickRandom(songs, () => r, 1)?.id).not.toBe(1);
    expect(pickRandom([songs[0]!], () => 0.5, 1)?.id).toBe(1); // only one option
  });
});

describe('buildReel', () => {
  it('ends on the target with no back-to-back repeats', () => {
    const rand = seededRandom(42);
    const target = songs[2]!;
    const reel = buildReel(songs, target, 25, rand);
    expect(reel).toHaveLength(25);
    expect(reel[24]).toBe(target);
    expect(reel[23]?.id).not.toBe(target.id);
    for (let i = 1; i < reel.length; i++) expect(reel[i]?.id).not.toBe(reel[i - 1]?.id);
  });

  it('copes with a one-song pool', () => {
    const only = songs[0]!;
    expect(buildReel([only], only, 5, () => 0.4)).toEqual([only, only, only, only, only]);
  });
});

describe('reel easing', () => {
  it('starts at 0, ends exactly on the last item and never runs backwards', () => {
    expect(reelEase(0)).toBe(0);
    expect(reelEase(1)).toBe(1);
    expect(reelEase(2)).toBe(1);
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = reelPosition(t * 3000, 3000, 29);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(reelPosition(3000, 3000, 29)).toBe(29);
    expect(reelPosition(10, 0, 29)).toBe(29);
    // decelerates: the first half covers much more ground than the second
    expect(reelPosition(1500, 3000, 29)).toBeGreaterThan(29 * 0.9);
  });
});

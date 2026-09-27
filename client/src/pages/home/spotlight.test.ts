import { describe, expect, it } from 'vitest';
import { makeShow, makeSong } from '../../test/fixtures';
import { pickDaily } from '../../lib/hash';
import { spotlightPool } from './spotlight';

const media = makeSong().media;
const withPreview = (overrides: Parameters<typeof makeSong>[0]) =>
  makeSong({ ...overrides, media: { ...media, previewUrl: `https://p.mzstatic.com/${overrides?.id}.m4a` } });

const mti = makeShow({ id: 1, name: 'Into the Woods', licensor: 'Music Theatre International (MTI)' });
const mormon = makeShow({ id: 2, name: 'The Book of Mormon', licensor: null });
const showRef = (sh: typeof mti) => ({ id: sh.id, name: sh.name, slug: sh.slug, imageUrl: null });

const songs = [
  withPreview({ id: 1, show: showRef(mti) }),
  withPreview({ id: 2, show: showRef(mti) }),
  withPreview({ id: 3, show: showRef(mti), mature: true }),
  withPreview({ id: 4, show: showRef(mormon) }),
  withPreview({ id: 5, show: showRef(mormon), mature: true }),
  withPreview({ id: 6, show: showRef(mti) }),
];

describe('spotlightPool', () => {
  it('only features non-mature songs from shows with an approved licensor', () => {
    expect(spotlightPool(songs, [mti, mormon]).map((s) => s.id)).toEqual([1, 2, 6]);
  });
  it('never lands on a mature or unlicensable song, whatever the day', () => {
    const pool = spotlightPool(songs, [mti, mormon]);
    for (let d = 0; d < 365; d += 1) {
      const pick = pickDaily(pool, new Date(2026, 0, 1 + d));
      expect(pick?.mature).toBe(false);
      expect(pick?.show.id).toBe(1);
    }
  });
  it('still skips mature songs when licensing info is unavailable', () => {
    expect(spotlightPool(songs, null).map((s) => s.id)).toEqual([1, 2, 4, 6]);
  });
  it('falls back rather than showing nothing', () => {
    const onlyMature = [withPreview({ id: 9, show: showRef(mormon), mature: true })];
    expect(spotlightPool(onlyMature, [mti, mormon]).map((s) => s.id)).toEqual([9]);
  });
});

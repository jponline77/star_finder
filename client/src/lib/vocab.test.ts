import { describe, expect, it } from 'vitest';
import {
  COMMENT_TAG_EMOJI,
  COMMENT_TAG_LABEL,
  COMMENT_TAGS,
  compareRanges,
  genreEmoji,
  isCommentTag,
  isVocalRange,
  normalizeVocalRange,
  RANGE_COLORS,
  RANGE_SHORT,
  RANGE_TEXT_COLOR,
  rangeColorVar,
  rangeIndex,
  rangeShort,
  rangeSlug,
  subGenreEmoji,
  VOCAL_RANGES,
} from './vocab';
import { contrastRatio } from './color';

describe('vocal ranges', () => {
  it('are ordered high → low', () => {
    expect(VOCAL_RANGES).toEqual(['Soprano', 'Mezzo-soprano', 'Alto', 'Tenor', 'Baritone', 'Bass']);
  });
  it('have the spec short labels', () => {
    expect(VOCAL_RANGES.map((r) => RANGE_SHORT[r])).toEqual(['S', 'Mz', 'A', 'T', 'Bar', 'B']);
  });
  it.each([
    ['mezzo', 'Mezzo-soprano'],
    ['Mezzo Soprano', 'Mezzo-soprano'],
    ['mezzo-soprano', 'Mezzo-soprano'],
    ['MEZZO - SOPRANO', 'Mezzo-soprano'],
    ['sop', 'Soprano'],
    ['  soprano ', 'Soprano'],
    ['Baritone', 'Baritone'],
    ['bari', 'Baritone'],
    ['contralto', 'Alto'],
    ['bass', 'Bass'],
  ])('normalizes %j → %s', (input, expected) => {
    expect(normalizeVocalRange(input)).toBe(expected);
  });
  it('returns null for unknown values', () => {
    expect(normalizeVocalRange('countertenor')).toBeNull();
    expect(normalizeVocalRange('')).toBeNull();
    expect(normalizeVocalRange(null)).toBeNull();
  });
  it('guards and indexes', () => {
    expect(isVocalRange('Alto')).toBe(true);
    expect(isVocalRange('alto')).toBe(false);
    expect(rangeIndex('Soprano')).toBe(0);
    expect(rangeIndex('bass')).toBe(5);
    expect(rangeIndex('nope')).toBe(-1);
  });
  it('produces short labels, slugs and css vars', () => {
    expect(rangeShort('Mezzo-soprano')).toBe('Mz');
    expect(rangeShort('Weird')).toBe('Weird');
    expect(rangeShort(null)).toBe('?');
    expect(rangeSlug('Mezzo-soprano')).toBe('mezzo');
    expect(rangeSlug(null)).toBe('unknown');
    expect(rangeColorVar('Tenor')).toBe('var(--range-tenor)');
    expect(rangeColorVar('x')).toBe('var(--range-unknown)');
  });
  it('sorts by range order with unknowns last', () => {
    const list = ['Bass', null, 'Soprano', 'Tenor', 'nope'];
    expect([...list].sort(compareRanges)).toEqual(['Soprano', 'Tenor', 'Bass', null, 'nope']);
  });
  it('colours meet WCAG AA with the badge text colour', () => {
    for (const r of VOCAL_RANGES) {
      expect(contrastRatio(RANGE_COLORS[r], RANGE_TEXT_COLOR)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('emoji maps', () => {
  it('maps genres with fallback', () => {
    expect(genreEmoji('Comedy')).toBe('😂');
    expect(genreEmoji('drama')).toBe('🎭');
    expect(genreEmoji('Romantic')).toBe('💘');
    expect(genreEmoji('Jazz')).toBe('🎵');
    expect(genreEmoji(null)).toBe('🎵');
  });
  it('maps sub-genres loosely with fallback', () => {
    expect(subGenreEmoji('Satire')).toBe('🃏');
    expect(subGenreEmoji('tongue in cheek')).toBe('😏');
    expect(subGenreEmoji('Tongue-in-Cheek')).toBe('😏');
    expect(subGenreEmoji('Intimidating/Angry')).toBe('🔥');
    expect(subGenreEmoji('in love')).toBe('😍');
    expect(subGenreEmoji('Conflict')).toBe('⚔️');
    expect(subGenreEmoji('Brand new mood')).toBe('✨');
    expect(subGenreEmoji(undefined)).toBe('✨');
  });
});

describe('comment tags', () => {
  it('have labels and emoji for every tag', () => {
    expect(COMMENT_TAGS).toEqual(['general', 'tip', 'question', 'performed']);
    expect(COMMENT_TAG_LABEL.performed).toBe('I performed this!');
    expect(COMMENT_TAG_EMOJI).toEqual({ general: '💬', tip: '💡', question: '❓', performed: '🎤' });
    expect(isCommentTag('tip')).toBe(true);
    expect(isCommentTag('spam')).toBe(false);
  });
});

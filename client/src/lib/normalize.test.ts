import { describe, expect, it } from 'vitest';
import { compareText, equalsLoose, fold, foldWithMap, includesLoose, normalizeText, showSlug, slugify, stripLeadingArticle, tokenize } from './normalize';

describe('fold', () => {
  it('lowercases and strips accents', () => {
    expect(fold('Les Misérables')).toBe('les miserables');
    expect(fold('Dantès')).toBe('dantes');
    expect(fold('ÉLAN Über Façade naïve')).toBe('elan uber facade naive');
  });
  it('handles special letters and typographic punctuation', () => {
    expect(fold('Straße')).toBe('strasse');
    expect(fold('Œdipus Æon')).toBe('oedipus aeon');
    expect(fold('Something’s Afoot')).toBe("something's afoot");
    expect(fold('“Quoted” — dash')).toBe('"quoted" - dash');
  });
  it('handles empty / nullish', () => {
    expect(fold('')).toBe('');
    expect(fold(null)).toBe('');
    expect(fold(undefined)).toBe('');
  });
  it('handles decomposed input (combining marks already separate)', () => {
    expect(fold('Dantès')).toBe('dantes');
  });
});

describe('foldWithMap', () => {
  it('maps folded indices back to original indices', () => {
    const { folded, map } = foldWithMap('Aßb');
    expect(folded).toBe('assb');
    expect(map).toEqual([0, 1, 1, 2, 3]);
  });
  it('keeps index mapping through decomposed characters', () => {
    const text = 'Dantès';
    const { folded, map } = foldWithMap(text);
    expect(folded).toBe('dantes');
    // 's' is at original index 6 (after the combining mark)
    expect(map[folded.indexOf('s')]).toBe(6);
    expect(map[map.length - 1]).toBe(text.length);
  });
  it('handles astral characters (emoji) without breaking', () => {
    const { folded, map } = foldWithMap('🎭 Drama');
    expect(folded).toBe('🎭 drama');
    expect(map[folded.indexOf('d')]).toBe(3);
  });
});

describe('normalizeText / tokenize / loose compare', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeText('  Les   Misérables \n')).toBe('les miserables');
  });
  it('tokenizes', () => {
    expect(tokenize('  Wicked   POPULAR ')).toEqual(['wicked', 'popular']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
  it('compares loosely', () => {
    expect(equalsLoose('Les Misérables', 'les miserables')).toBe(true);
    expect(equalsLoose('Comedy', 'Drama')).toBe(false);
    expect(includesLoose('Les Misérables', 'MISER')).toBe(true);
    expect(includesLoose('anything', '')).toBe(true);
    expect(includesLoose(null, 'x')).toBe(false);
  });
});

describe('slugify (must match server + seed)', () => {
  it.each([
    ['Les Misérables', 'les-miserables'],
    ["Something's Afoot", 'somethings-afoot'],
    ['Something’s Afoot', 'somethings-afoot'],
    ["A Gentleman's Guide to Love and Murder", 'a-gentlemans-guide-to-love-and-murder'],
    ['  --Hello,   World!!-- ', 'hello-world'],
    ['Dear Evan Hansen', 'dear-evan-hansen'],
    ['9 to 5: The Musical', '9-to-5-the-musical'],
    ['Ça Ira', 'ca-ira'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe('showSlug (the server rules for a new show)', () => {
  it.each([
    ['Les Misérables', 'les-miserables'],
    ['13', '13-show'],
    ['1776', '1776-show'],
    ['9 to 5', '9-to-5'],
    ['!!!', 'show'],
  ])('%s → %s', (input, expected) => {
    expect(showSlug(input)).toBe(expected);
  });
});

describe('compareText', () => {
  it('sorts accent-insensitively and numerically', () => {
    const list = ['Zebra', 'éclair', 'Apple', 'Song 10', 'Song 2'];
    expect([...list].sort(compareText)).toEqual(['Apple', 'éclair', 'Song 2', 'Song 10', 'Zebra']);
  });
  it('treats null as empty', () => {
    expect(compareText(null, 'a')).toBeLessThan(0);
  });
  it('strips leading articles', () => {
    expect(stripLeadingArticle('The Phantom of the Opera')).toBe('Phantom of the Opera');
    expect(stripLeadingArticle('An American in Paris')).toBe('American in Paris');
    expect(stripLeadingArticle('Theatre')).toBe('Theatre');
  });
});

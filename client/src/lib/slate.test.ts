import { describe, expect, it } from 'vitest';
import { buildSlate, creditNames, joinNames, normalizeTroupe, SLATE_CLOSING, slateCredits } from './slate';

describe('slateCredits', () => {
  it('uses one name when composer === lyricist (case/accent-insensitive)', () => {
    expect(slateCredits('Stephen Schwartz', 'Stephen Schwartz')).toBe('Stephen Schwartz');
    expect(slateCredits('Anaïs Mitchell', 'anais mitchell')).toBe('Anaïs Mitchell');
  });
  it('joins music & lyrics when different', () => {
    expect(slateCredits('Richard Rodgers', 'Oscar Hammerstein II')).toBe('Richard Rodgers and Oscar Hammerstein II');
  });
  it('uses whichever is known and omits when neither', () => {
    expect(slateCredits(null, 'Lynn Ahrens')).toBe('Lynn Ahrens');
    expect(slateCredits('Alan Menken', '  ')).toBe('Alan Menken');
    expect(slateCredits(null, undefined)).toBe('');
  });
  // Real credit strings from the catalogue — each writer must be named exactly once.
  it.each([
    ['Spamalot', 'John Du Prez and Eric Idle', 'Eric Idle', 'John Du Prez and Eric Idle'],
    ['A Gentleman’s Guide', 'Steven Lutvak', 'Robert L. Freedman and Steven Lutvak', 'Steven Lutvak and Robert L. Freedman'],
    ['Smash', 'Marc Shaiman', 'Scott Wittman & Marc Shaiman', 'Marc Shaiman and Scott Wittman'],
    [
      'Something’s Afoot',
      'James McDonald, David Vos and Robert Gerlach (additional music by Ed Linderman)',
      'James McDonald, David Vos and Robert Gerlach',
      'James McDonald, David Vos and Robert Gerlach',
    ],
    ['Oh What a Lovely War', 'Various (First World War-era songs)', 'Various', ''],
    ['Curtains', 'John Kander', 'Fred Ebb (additional lyrics by John Kander and Rupert Holmes)', 'John Kander and Fred Ebb'],
    [
      'Operation Mincemeat',
      'David Cumming, Felix Hagan, Natasha Hodgson & Zoë Roberts (SpitLip)',
      'David Cumming, Felix Hagan, Natasha Hodgson & Zoë Roberts (SpitLip)',
      'David Cumming, Felix Hagan, Natasha Hodgson and Zoë Roberts',
    ],
    ['The Book of Mormon', 'Trey Parker, Robert Lopez & Matt Stone', 'Trey Parker, Robert Lopez & Matt Stone', 'Trey Parker, Robert Lopez and Matt Stone'],
    ['Shucked', 'Brandy Clark & Shane McAnally', 'Brandy Clark & Shane McAnally', 'Brandy Clark and Shane McAnally'],
  ])('%s → names each writer once', (_show, composer, lyricist, expected) => {
    expect(slateCredits(composer, lyricist)).toBe(expected);
  });
  it('splits a credit into names, keeping suffixes with their name', () => {
    expect(creditNames('Harry Connick, Jr. & Ann Hampton Callaway')).toEqual(['Harry Connick, Jr.', 'Ann Hampton Callaway']);
    expect(creditNames('Kristen Anderson-Lopez and Robert Lopez')).toEqual(['Kristen Anderson-Lopez', 'Robert Lopez']);
    expect(creditNames('  ')).toEqual([]);
    expect(creditNames(null)).toEqual([]);
  });
  it('omits the credit clause for "Various"', () => {
    const r = buildSlate({ kind: 'solo', names: ['Ana'], school: 'S', title: 'T', show: 'Oh What a Lovely War', composer: 'Various (First World War-era songs)', lyricist: 'Various' });
    expect(r.slate).toBe(`I am Ana from S, and I'll be performing "T" from Oh What a Lovely War.`);
  });
});

describe('helpers', () => {
  it.each([
    ['1000', '1000'],
    ['#1000', '1000'],
    ['Troupe #1000', '1000'],
    ['troupe 999', '999'],
    ['  # 42 ', '42'],
    ['', ''],
  ])('normalizeTroupe(%j) → %j', (input, expected) => {
    expect(normalizeTroupe(input)).toBe(expected);
  });
  it('normalizeTroupe handles numbers and nullish', () => {
    expect(normalizeTroupe(1000)).toBe('1000');
    expect(normalizeTroupe(null)).toBe('');
  });
  it('joins names naturally', () => {
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', ' ', 'B', 'C'])).toBe('A, B and C');
    expect(joinNames([])).toBe('');
  });
});

describe('buildSlate', () => {
  it('builds the official solo example', () => {
    const r = buildSlate({
      kind: 'solo',
      names: ['Heather Black'],
      school: 'Canada Junior High School',
      troupe: '1000',
      title: 'Popular',
      show: 'Wicked',
      composer: 'Stephen Schwartz',
      lyricist: 'Stephen Schwartz',
    });
    expect(r.slate).toBe(
      `I am Heather Black from Canada Junior High School, Troupe #1000, and I'll be performing "Popular" from Wicked by Stephen Schwartz.`,
    );
    expect(r.closing).toBe(SLATE_CLOSING);
    expect(r.closing).toBe('Thank you.');
    expect(r.text.startsWith(r.slate)).toBe(true);
    expect(r.text).toContain('Thank you.');
    expect(r.credits).toBe('Stephen Schwartz');
  });
  it('builds a duet slate with two credits', () => {
    const r = buildSlate({
      kind: 'duet',
      names: ['Lee Jones', 'Sam Becker'],
      school: 'True North High School',
      troupe: '#999',
      title: 'People Will Say We’re in Love',
      show: 'Oklahoma!',
      composer: 'Richard Rodgers',
      lyricist: 'Oscar Hammerstein II',
    });
    expect(r.slate).toBe(
      `Our names are Lee Jones and Sam Becker from True North High School, Troupe #999, and we'll be performing "People Will Say We’re in Love" from Oklahoma! by Richard Rodgers and Oscar Hammerstein II.`,
    );
  });
  it('omits the troupe and credits gracefully', () => {
    const r = buildSlate({ kind: 'solo', names: ['Ana'], school: 'Hillside Secondary', title: 'Stars', show: 'Les Misérables' });
    expect(r.slate).toBe(`I am Ana from Hillside Secondary, and I'll be performing "Stars" from Les Misérables.`);
  });
  it('uses placeholders for missing info by default', () => {
    const r = buildSlate({ kind: 'duet', names: ['Ana'], title: 'Song' });
    expect(r.slate).toBe(`Our names are Ana and [Name 2] from [Your school], and we'll be performing "Song" from [Show].`);
    const solo = buildSlate({ kind: 'solo', names: [] });
    expect(solo.slate).toBe(`I am [Your name] from [Your school], and I'll be performing "[Song title]" from [Show].`);
  });
  it('can skip placeholders', () => {
    const r = buildSlate({ kind: 'solo', names: ['Ana'], placeholders: false, title: 'Stars' });
    expect(r.slate).toBe(`I am Ana, and I'll be performing "Stars".`);
  });
  it('trims and collapses whitespace in inputs', () => {
    const r = buildSlate({ kind: 'solo', names: ['  Ana   Lee '], school: ' A  School ', troupe: ' ', title: ' Stars ', show: ' Les  Mis ' });
    expect(r.slate).toBe(`I am Ana Lee from A School, and I'll be performing "Stars" from Les Mis.`);
  });
  it('does not double the final period', () => {
    const r = buildSlate({ kind: 'solo', names: ['A'], school: 'S', title: 'T', show: 'X', composer: 'Harry Connick Jr.' });
    expect(r.slate.endsWith('Harry Connick Jr.')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { makeSong, part } from '../test/fixtures';
import {
  activeFilterPills,
  applyFilters,
  browseHref,
  clearFilters,
  countActiveFilters,
  defaultFilters,
  DEFAULT_FILTERS,
  facetCounts,
  filtersFromSearchParams,
  filtersToSearchParams,
  hasAnyAudio,
  hasPlayableAudio,
  highlightRanges,
  highlightSegments,
  isUnfiltered,
  rangeCounts,
  songMatchesQuery,
  songsIgnoring,
  sortSongs,
  sortSongsBy,
  toggleInList,
  type FilterState,
} from './filters';

const media = (m: Partial<ReturnType<typeof makeSong>['media']>) => ({ ...makeSong().media, ...m });

const popular = makeSong({
  id: 1,
  title: 'Popular',
  show: { id: 1, name: 'Wicked', slug: 'wicked', imageUrl: null },
  genre: 'Comedy',
  subGenre: 'Tongue-in-Cheek',
  lengthSeconds: 230,
  parts: [part('Glinda', 'Soprano')],
  media: media({ previewUrl: 'https://audio-ssl.itunes.apple.com/x.m4a' }),
  createdAt: '2026-01-01T00:00:00.000Z',
});
const stars = makeSong({
  id: 2,
  title: 'Stars',
  show: { id: 2, name: 'Les Misérables', slug: 'les-miserables', imageUrl: null },
  genre: 'Drama',
  subGenre: 'Power',
  lengthSeconds: 200,
  parts: [part('Javert', 'Baritone')],
  createdAt: '2026-02-01T00:00:00.000Z',
});
const dantes = makeSong({
  id: 3,
  kind: 'duet',
  title: 'A Heart Full of Love',
  show: { id: 2, name: 'Les Misérables', slug: 'les-miserables', imageUrl: null },
  genre: 'Romantic',
  subGenre: 'In Love',
  lengthSeconds: 340,
  mature: false,
  parts: [part('Cosette', 'Soprano', 1), part('Marius', 'Tenor', 2)],
  media: media({ audioLink: 'https://youtube.com/watch?v=1' }),
  createdAt: '2026-03-01T00:00:00.000Z',
});
const longOne = makeSong({
  id: 4,
  title: 'Épiphany',
  show: { id: 3, name: 'Sweeney Todd', slug: 'sweeney-todd', imageUrl: null },
  genre: 'Drama',
  subGenre: 'Intimidating / Angry',
  lengthSeconds: 400,
  mature: true,
  parts: [part('Edmond Dantès', 'Baritone')],
  media: media({ audioUrl: '/uploads/audio/a.mp3' }),
  createdAt: '2026-03-01T00:00:00.000Z',
});
const unknown = makeSong({
  id: 5,
  title: 'Mystery',
  show: { id: 4, name: 'Zzz', slug: 'zzz', imageUrl: null },
  genre: null,
  subGenre: null,
  lengthSeconds: null,
  parts: [part('Nobody', null)],
  createdAt: '2025-12-01T00:00:00.000Z',
});
const all = [popular, stars, dantes, longOne, unknown];
const ids = (list: { id: number }[]) => list.map((s) => s.id);
const f = (o: Partial<FilterState>) => defaultFilters(o);

describe('audio predicates', () => {
  it('distinguishes playable vs any audio', () => {
    expect(hasPlayableAudio(popular)).toBe(true);
    expect(hasPlayableAudio(dantes)).toBe(false);
    expect(hasAnyAudio(dantes)).toBe(true);
    expect(hasPlayableAudio(longOne)).toBe(true);
    expect(hasAnyAudio(stars)).toBe(false);
  });
});

describe('search', () => {
  it('is accent- and case-insensitive over title, show, characters, genre, sub-genre', () => {
    expect(songMatchesQuery(stars, 'les miserables')).toBe(true);
    expect(songMatchesQuery(stars, 'LES MISÉRABLES')).toBe(true);
    expect(songMatchesQuery(longOne, 'dantes')).toBe(true);
    expect(songMatchesQuery(longOne, 'epiphany')).toBe(true);
    expect(songMatchesQuery(popular, 'glinda')).toBe(true);
    expect(songMatchesQuery(popular, 'tongue')).toBe(true);
    expect(songMatchesQuery(popular, 'comedy')).toBe(true);
    expect(songMatchesQuery(popular, 'javert')).toBe(false);
  });
  it('matches multi-word queries across fields', () => {
    expect(songMatchesQuery(popular, 'wicked popular')).toBe(true);
    expect(songMatchesQuery(popular, 'popular glinda')).toBe(true);
    expect(songMatchesQuery(popular, 'wicked javert')).toBe(false);
  });
  it('empty/whitespace query matches everything', () => {
    expect(songMatchesQuery(popular, '')).toBe(true);
    expect(songMatchesQuery(popular, '   ')).toBe(true);
  });
});

describe('applyFilters', () => {
  it('returns everything (sorted by title) with defaults', () => {
    expect(ids(applyFilters(all, f({})))).toEqual([3, 4, 5, 1, 2]);
  });
  it('filters by kind', () => {
    expect(ids(applyFilters(all, f({ kind: 'duet' })))).toEqual([3]);
    expect(ids(applyFilters(all, f({ kind: 'solo' })))).not.toContain(3);
  });
  it('range matches ANY part of a duet; OR within ranges', () => {
    expect(ids(applyFilters(all, f({ ranges: ['Tenor'] })))).toEqual([3]);
    expect(ids(applyFilters(all, f({ ranges: ['Soprano'] })))).toEqual([3, 1]);
    expect(ids(applyFilters(all, f({ ranges: ['Soprano', 'Baritone'] })))).toEqual([3, 4, 1, 2]);
  });
  it('genre & sub-genre are case-insensitive, OR within field, AND across fields', () => {
    expect(ids(applyFilters(all, f({ genres: ['drama'] })))).toEqual([4, 2]);
    expect(ids(applyFilters(all, f({ genres: ['Drama', 'Comedy'] })))).toEqual([4, 1, 2]);
    expect(ids(applyFilters(all, f({ genres: ['Drama'], subGenres: ['power'] })))).toEqual([2]);
  });
  it('filters by show slug or id', () => {
    expect(ids(applyFilters(all, f({ show: 'les-miserables' })))).toEqual([3, 2]);
    expect(ids(applyFilters(all, f({ show: '3' })))).toEqual([4]);
  });
  it('length bounds exclude unknown lengths', () => {
    expect(ids(applyFilters(all, f({ maxSeconds: 230 })))).toEqual([1, 2]);
    expect(ids(applyFilters(all, f({ minSeconds: 330 })))).toEqual([3, 4]);
    expect(ids(applyFilters(all, f({ minSeconds: 210, maxSeconds: 360 })))).toEqual([3, 1]);
  });
  it('hides mature and requires audio', () => {
    expect(ids(applyFilters(all, f({ hideMature: true })))).not.toContain(4);
    expect(ids(applyFilters(all, f({ hasAudio: true })))).toEqual([3, 4, 1]);
  });
  it('combines search with filters', () => {
    expect(ids(applyFilters(all, f({ q: 'les mis', kind: 'solo' })))).toEqual([2]);
  });
  it('does not mutate the input', () => {
    const copy = [...all];
    applyFilters(all, f({ sort: '-length' }));
    expect(all).toEqual(copy);
  });
});

describe('sorting', () => {
  it('title / show', () => {
    expect(ids(sortSongs(all, 'title'))).toEqual([3, 4, 5, 1, 2]);
    expect(ids(sortSongs(all, 'show'))).toEqual([3, 2, 4, 1, 5]);
  });
  it('length puts unknowns last in both directions', () => {
    expect(ids(sortSongs(all, 'length'))).toEqual([2, 1, 3, 4, 5]);
    expect(ids(sortSongs(all, '-length'))).toEqual([4, 3, 1, 2, 5]);
  });
  it('newest first, ties broken by id desc', () => {
    expect(ids(sortSongs(all, 'newest'))).toEqual([4, 3, 2, 1, 5]);
  });
  it('table columns', () => {
    expect(ids(sortSongsBy(all, 'range', 'asc'))).toEqual([3, 1, 4, 2, 5]);
    expect(ids(sortSongsBy(all, 'range', 'desc'))).toEqual([4, 2, 3, 1, 5]);
    expect(ids(sortSongsBy(all, 'genre', 'asc'))).toEqual([1, 4, 2, 3, 5]);
    expect(ids(sortSongsBy(all, 'kind', 'asc')).at(0)).toBe(3);
    expect(ids(sortSongsBy(all, 'title', 'desc'))).toEqual([2, 1, 5, 4, 3]);
  });
});

describe('URL round-trip', () => {
  it('defaults serialise to an empty query', () => {
    expect(filtersToSearchParams(defaultFilters()).toString()).toBe('');
    expect(filtersFromSearchParams('')).toEqual(DEFAULT_FILTERS);
  });
  it('round-trips a full state', () => {
    const state = f({
      q: 'les mis',
      kind: 'duet',
      ranges: ['Tenor', 'Soprano'],
      genres: ['Comedy', 'Drama'],
      subGenres: ['Intimidating / Angry', 'Weird, with comma', '100% sure'],
      show: 'les-miserables',
      maxSeconds: 300,
      minSeconds: 60,
      hideMature: true,
      hasAudio: true,
      sort: '-length',
    });
    const params = filtersToSearchParams(state);
    const back = filtersFromSearchParams(params.toString());
    expect(back).toEqual({ ...state, ranges: ['Soprano', 'Tenor'] });
  });
  it('uses readable, API-compatible keys', () => {
    const qs = filtersToSearchParams(f({ kind: 'solo', ranges: ['Soprano', 'Alto'], hideMature: true })).toString();
    expect(qs).toBe('kind=solo&range=Soprano%2CAlto&hideMature=1');
  });
  it('preserves unrelated params like view', () => {
    const qs = filtersToSearchParams(f({ q: 'x' }), 'view=table&q=old&range=Bass').toString();
    expect(qs).toBe('view=table&q=x');
  });
  it('ignores junk and normalises values', () => {
    const s = filtersFromSearchParams('kind=trio&range=mezzo,sop,nope,Soprano&maxSeconds=abc&minSeconds=-5&sort=bogus&hideMature=0&hasAudio=true');
    expect(s.kind).toBe('all');
    expect(s.ranges).toEqual(['Soprano', 'Mezzo-soprano']);
    expect(s.maxSeconds).toBeNull();
    expect(s.minSeconds).toBeNull();
    expect(s.sort).toBe('title');
    expect(s.hideMature).toBe(false);
    expect(s.hasAudio).toBe(true);
  });
  it('keeps maxSeconds within what the length slider can show', () => {
    expect(filtersFromSearchParams('maxSeconds=1000').maxSeconds).toBeNull(); // past the top = any length
    expect(filtersFromSearchParams('maxSeconds=420').maxSeconds).toBeNull();
    expect(filtersFromSearchParams('maxSeconds=30').maxSeconds).toBe(60);
    expect(filtersFromSearchParams('maxSeconds=119').maxSeconds).toBe(119); // Stats histogram links stay exact
    expect(filtersFromSearchParams('maxSeconds=360').maxSeconds).toBe(360);
  });
  it('accepts repeated keys and comma lists, de-duplicating loosely', () => {
    const s = filtersFromSearchParams('genre=Comedy&genre=drama,comedy');
    expect(s.genres).toEqual(['Comedy', 'drama']);
  });
  it('accepts KIND in any case and trims q', () => {
    const s = filtersFromSearchParams('kind=DUET&q=%20%20hello%20');
    expect(s.kind).toBe('duet');
    expect(s.q).toBe('hello');
  });
  it('builds browse links', () => {
    expect(browseHref()).toBe('/songs');
    expect(browseHref({ kind: 'duet', genres: ['Comedy'] })).toBe('/songs?kind=duet&genre=Comedy');
    expect(browseHref({ maxSeconds: 180 })).toBe('/songs?maxSeconds=180');
  });
});

describe('pills & helpers', () => {
  it('lists one pill per active value, each removing only itself', () => {
    const state = f({ q: 'mis', kind: 'solo', ranges: ['Soprano', 'Alto'], show: 'wicked', hideMature: true, maxSeconds: 180 });
    const pills = activeFilterPills(state, [{ slug: 'wicked', name: 'Wicked', id: 1 }]);
    expect(pills.map((p) => p.id)).toEqual(['q', 'kind:solo', 'range:Soprano', 'range:Alto', 'show', 'maxSeconds', 'hideMature']);
    expect(pills.find((p) => p.id === 'show')?.label).toBe('Wicked');
    expect(pills.find((p) => p.id === 'maxSeconds')?.label).toBe('Up to 3:00');
    const removed = pills.find((p) => p.id === 'range:Soprano')!.next;
    expect(removed.ranges).toEqual(['Alto']);
    expect(removed.kind).toBe('solo');
  });
  it('falls back to the slug when the show is unknown', () => {
    expect(activeFilterPills(f({ show: 'mystery' }))[0]?.label).toBe('mystery');
  });
  it('counts and clears filters but keeps sort', () => {
    const state = f({ q: 'x', genres: ['Drama'], sort: 'newest' });
    expect(countActiveFilters(state)).toBe(2);
    expect(isUnfiltered(state)).toBe(false);
    const cleared = clearFilters(state);
    expect(isUnfiltered(cleared)).toBe(true);
    expect(cleared.sort).toBe('newest');
    expect(isUnfiltered(f({ sort: '-length' }))).toBe(true);
  });
  it('toggles list values loosely', () => {
    expect(toggleInList(['Comedy'], 'comedy')).toEqual([]);
    expect(toggleInList(['Comedy'], 'Drama')).toEqual(['Comedy', 'Drama']);
  });
  it('counts facets', () => {
    expect(rangeCounts(all)).toEqual({ Soprano: 2, 'Mezzo-soprano': 0, Alto: 0, Tenor: 1, Baritone: 2, Bass: 0 });
    const dup = makeSong({ kind: 'duet', parts: [part('A', 'Tenor', 1), part('B', 'tenor', 2)] });
    expect(rangeCounts([dup]).Tenor).toBe(1);
    expect(facetCounts(all, (s) => s.genre)).toEqual([
      { value: 'Drama', count: 2 },
      { value: 'Comedy', count: 1 },
      { value: 'Romantic', count: 1 },
    ]);
  });
});

describe('songsIgnoring', () => {
  it('relaxes exactly one filter', () => {
    const state = f({ kind: 'solo', ranges: ['Tenor'] });
    expect(ids(applyFilters(all, state))).toEqual([]);
    expect(ids(songsIgnoring(all, state, 'ranges')).sort()).toEqual([1, 2, 4, 5]);
    expect(ids(songsIgnoring(all, state, 'kind'))).toEqual([3]);
  });
});

describe('highlighting', () => {
  it('finds accent-insensitive matches in original indices', () => {
    expect(highlightRanges('Les Misérables', 'miserables')).toEqual([[4, 14]]);
    expect(highlightRanges('Edmond Dantès', 'dantes')).toEqual([[7, 13]]);
  });
  it('prefers whole-query matches over scattered tokens', () => {
    expect(highlightRanges('Empty Chairs at Empty Tables', 'les mis')).toEqual([]);
    expect(highlightRanges('Les Misérables', 'les mis')).toEqual([[0, 7]]);
  });
  it('highlights tokens only at word starts when the whole query is absent', () => {
    expect(highlightRanges('Tables and Lessons', 'les zzz')).toEqual([[11, 14]]);
  });
  it('highlights every token and merges overlaps', () => {
    expect(highlightRanges('Popular from Wicked', 'wicked pop')).toEqual([
      [0, 3],
      [13, 19],
    ]);
    expect(highlightRanges('aaaa', 'aa')).toEqual([[0, 4]]);
  });
  it('returns nothing for empty input or no match', () => {
    expect(highlightRanges('', 'x')).toEqual([]);
    expect(highlightRanges('abc', '')).toEqual([]);
    expect(highlightRanges('abc', '   ')).toEqual([]);
    expect(highlightRanges('abc', 'z')).toEqual([]);
  });
  it('maps through expanding folds (ß → ss)', () => {
    expect(highlightRanges('Straße', 'strasse')).toEqual([[0, 6]]);
  });
  it('keeps decomposed accents inside the highlight', () => {
    const text = 'Dantès';
    expect(highlightRanges(text, 'dantes')).toEqual([[0, 7]]);
  });
  it('splits into segments', () => {
    expect(highlightSegments('Les Misérables', 'mis')).toEqual([
      { text: 'Les ', match: false },
      { text: 'Mis', match: true },
      { text: 'érables', match: false },
    ]);
    expect(highlightSegments('abc', 'zz')).toEqual([{ text: 'abc', match: false }]);
    expect(highlightSegments('', 'zz')).toEqual([]);
  });
});

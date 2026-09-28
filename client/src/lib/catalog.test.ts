import { describe, expect, it } from 'vitest';
import type { CatalogSong, ItunesCandidate } from '../types';
import {
  addHref,
  addStepKey,
  bestCandidate,
  CONFIDENCE_WORD,
  isConfidentRecording,
  kindFitsSong,
  recordingBadge,
  filterCatalogSongs,
  formatSingers,
  groupByAct,
  guessKind,
  KIND_GUESS,
  kindForGuess,
  kindNoteFor,
  lengthText,
  parseAddStep,
  suggestionSentence,
  titleWithYear,
  wikipediaUrl,
} from './catalog';

const song = (o: Partial<CatalogSong> & { id: number; title: string }): CatalogSong => ({
  act: null,
  position: o.id,
  singers: [],
  ensemble: false,
  reprise: false,
  onSite: null,
  ...o,
});

describe('addHref / parseAddStep — the /add steps live in the URL', () => {
  it('builds stable URLs and drops empty values', () => {
    expect(addHref()).toBe('/add');
    expect(addHref({ q: '  ' })).toBe('/add');
    expect(addHref({ q: 'bring him' })).toBe('/add?q=bring+him');
    expect(addHref({ catalogSong: 12, fromShow: 3, q: 'les', kind: 'duet' })).toBe('/add?catalogSong=12&fromShow=3&kind=duet&q=les');
    expect(addHref({ manual: true, show: 'les-miserables' })).toBe('/add?manual=1&show=les-miserables');
  });

  it('round-trips every step', () => {
    const parse = (href: string) => parseAddStep(new URLSearchParams(href.split('?')[1] ?? ''));
    expect(parse(addHref({ q: 'stars' }))).toEqual({ step: 'find', q: 'stars', kind: null });
    expect(parse(addHref({ catalogShow: 4, q: 'les' }))).toEqual({ step: 'show', catalogShowId: 4, q: 'les', kind: null });
    expect(parse(addHref({ catalogSong: 9, fromShow: 4, kind: 'solo' }))).toEqual({ step: 'song', catalogSongId: 9, fromShow: 4, q: '', kind: 'solo' });
    expect(parse(addHref({ manual: true, catalogShow: 4 }))).toEqual({ step: 'manual', catalogShowId: 4, showSlug: null, fromShow: null, q: '', kind: null });
    expect(parse('/add?show=hadestown&kind=duet')).toEqual({ step: 'resolve-show', showSlug: 'hadestown', q: '', kind: 'duet' });
    expect(parse('/add?manual=1&show=hadestown')).toMatchObject({ step: 'manual', showSlug: 'hadestown' });
  });

  it('ignores junk ids and kinds', () => {
    expect(parseAddStep(new URLSearchParams('catalogSong=abc&catalogShow=-1&kind=trio'))).toEqual({ step: 'find', q: '', kind: null });
    expect(parseAddStep(new URLSearchParams('catalogSong=0'))).toMatchObject({ step: 'find' });
    expect(parseAddStep(new URLSearchParams('manual=0'))).toMatchObject({ step: 'find' });
  });
});

describe('Solo / Duet / Ensemble guesses', () => {
  it('guesses from who sings it', () => {
    expect(guessKind({ singers: ['Jean Valjean'], ensemble: false })).toBe('solo');
    expect(guessKind({ singers: ['Orpheus', 'Eurydice'], ensemble: false })).toBe('duet');
    expect(guessKind({ singers: ['Fantine'], ensemble: true })).toBe('solo-ensemble');
    expect(guessKind({ singers: ['A', 'B'], ensemble: true })).toBe('duet-ensemble');
    expect(guessKind({ singers: ['A', 'B', 'C'], ensemble: false })).toBe('group');
    expect(guessKind({ singers: [], ensemble: true })).toBe('ensemble');
    expect(guessKind({ singers: [], ensemble: false })).toBeNull();
  });

  it('maps guesses to a STAR kind and friendly labels', () => {
    expect(kindForGuess('solo-ensemble')).toBe('solo');
    expect(kindForGuess('duet')).toBe('duet');
    expect(kindForGuess('group')).toBeNull();
    expect(kindForGuess(null)).toBeNull();
    expect(KIND_GUESS['duet-ensemble'].label).toBe('Duet + ensemble');
  });

  it('explains group numbers and unknown singers', () => {
    expect(kindNoteFor({ singers: ['A', 'B', 'C'], ensemble: false })).toMatch(/group number/);
    expect(kindNoteFor({ singers: [], ensemble: false })).toMatch(/doesn’t say who sings/);
    expect(kindNoteFor({ singers: ['A'], ensemble: true })).toMatch(/solo part/);
    expect(kindNoteFor({ singers: ['A'], ensemble: false })).toBeNull();
  });
});

describe('display helpers', () => {
  it('formats singer lists', () => {
    expect(formatSingers([])).toBe('');
    expect(formatSingers(['Valjean'])).toBe('Valjean');
    expect(formatSingers(['Fantine', 'Valjean'])).toBe('Fantine & Valjean');
    expect(formatSingers(['A', 'B', 'C'])).toBe('A, B & C');
    expect(formatSingers(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C & 2 more');
  });

  it('adds the year and builds Wikipedia links', () => {
    expect(titleWithYear('Hadestown', 2016)).toBe('Hadestown (2016)');
    expect(titleWithYear('Hadestown', null)).toBe('Hadestown');
    expect(wikipediaUrl('Les Misérables (musical)')).toBe('https://en.wikipedia.org/wiki/Les_Mis%C3%A9rables_(musical)');
    expect(wikipediaUrl('  ')).toBeNull();
  });

  it('groups songs into acts in list order', () => {
    const groups = groupByAct([
      song({ id: 3, title: 'C', act: 2, position: 3 }),
      song({ id: 1, title: 'A', act: 1, position: 1 }),
      song({ id: 4, title: 'D', act: null, position: 9 }),
      song({ id: 2, title: 'B', act: 1, position: 2 }),
    ]);
    expect(groups.map((g) => [g.label, g.songs.map((s) => s.title)])).toEqual([
      ['Act 1', ['A', 'B']],
      ['Act 2', ['C']],
      ['More songs', ['D']],
    ]);
    expect(groupByAct([song({ id: 1, title: 'A' })])).toEqual([{ act: null, label: '', songs: [expect.objectContaining({ title: 'A' })] }]);
    expect(groupByAct([])).toEqual([]);
  });

  it('filters by title or singer, accent-insensitively', () => {
    const songs = [song({ id: 1, title: 'On My Own', singers: ['Éponine'] }), song({ id: 2, title: 'Stars', singers: ['Javert'] })];
    expect(filterCatalogSongs(songs, 'eponine').map((s) => s.id)).toEqual([1]);
    expect(filterCatalogSongs(songs, 'STARS').map((s) => s.id)).toEqual([2]);
    expect(filterCatalogSongs(songs, '')).toHaveLength(2);
  });
});

describe('suggestions + recordings', () => {
  it('writes a screen-reader sentence', () => {
    expect(suggestionSentence('from the Wikipedia song list', 'high')).toBe('Suggested from the Wikipedia song list, high confidence');
    expect(suggestionSentence('3 of 5 songs on the site')).toBe('Suggested (3 of 5 songs on the site)');
  });

  it('turns durations into m:ss and picks the best playable candidate', () => {
    expect(lengthText(201)).toBe('3:21');
    expect(lengthText(59.6)).toBe('1:00');
    expect(lengthText(0)).toBeNull();
    expect(lengthText(4000)).toBeNull();
    expect(lengthText(null)).toBeNull();
    const c = (trackId: number, previewUrl: string | null) => ({ trackId, previewUrl, score: 95, castAlbum: true, albumLabel: 'original cast recording' }) as ItunesCandidate;
    expect(bestCandidate([c(1, null), c(2, 'https://x/p.m4a')])?.trackId).toBe(2);
    expect(bestCandidate([])).toBeNull();
  });

  // "wrong audio is worse than no audio": only a recording that's clearly this song from this show is auto-picked
  describe('bestCandidate only trusts clear matches', () => {
    const cand = (o: Partial<ItunesCandidate> & { trackId: number }): ItunesCandidate => ({
      trackName: 'Prologue',
      collectionName: 'Beauty and the Beast (Original Broadway Cast Recording)',
      artistName: 'Cast',
      previewUrl: `https://x/${o.trackId}.m4a`,
      artworkUrl: null,
      appleMusicUrl: null,
      durationSeconds: 150,
      score: 95,
      ...o,
    });
    // Real shapes the server sends (group 2 = weak hits it keeps with castAlbum: false)
    const single = cand({ trackId: 1, collectionName: 'Prologue (From "Beauty and the Beast") - Single', artistName: 'Moisés Nieto', score: 81, castAlbum: false, albumLabel: null });
    const popSingle = cand({ trackId: 2, trackName: 'Tomorrow', collectionName: 'Tomorrow - Single', artistName: 'SR-71', score: 40, castAlbum: false, albumLabel: null });
    const highScoreCover = cand({ trackId: 3, collectionName: 'Disney Covers', score: 92, castAlbum: false, albumLabel: null });
    const cast = cand({ trackId: 4, score: 88, castAlbum: true, albumLabel: 'original cast recording' });
    const concert = cand({ trackId: 5, collectionName: 'Beauty and the Beast in Concert', score: 90, castAlbum: false, albumLabel: 'concert recording' });
    const weakConcert = cand({ trackId: 6, collectionName: 'Beauty and the Beast in Concert', score: 60, castAlbum: false, albumLabel: 'concert recording' });

    it('never auto-picks a single, a pop song or a cover — whatever the order or score', () => {
      expect(bestCandidate([single, popSingle, highScoreCover])).toBeNull();
      expect(isConfidentRecording(single)).toBe(false);
      expect(isConfidentRecording(popSingle)).toBe(false);
      expect(isConfidentRecording(highScoreCover)).toBe(false);
      expect(isConfidentRecording(weakConcert)).toBe(false);
    });

    it('picks the first cast recording (or a strong match on another recording of the show), skipping weak hits above it', () => {
      expect(bestCandidate([single, cast])?.trackId).toBe(4);
      expect(bestCandidate([single, concert, cast])?.trackId).toBe(5);
      expect(bestCandidate([{ ...cast, previewUrl: null }, single])).toBeNull();
    });

    it('answers without castAlbum (older servers) fall back to the score', () => {
      const legacy = (score: number) => cand({ trackId: score, score });
      expect(bestCandidate([legacy(70)])).toBeNull();
      expect(bestCandidate([legacy(70), legacy(90)])?.trackId).toBe(90);
    });

    it('badges say what each recording is, and "Listen first" for weak ones', () => {
      expect(recordingBadge(cast, true)).toEqual({ text: 'Best match', tone: 'success' });
      expect(recordingBadge(cast, false)).toEqual({ text: 'Original cast recording', tone: 'gold' });
      expect(recordingBadge(concert, false)).toEqual({ text: 'Concert recording', tone: 'outline' });
      expect(recordingBadge(single, false)).toEqual({ text: 'Listen first', tone: 'outline' });
      expect(recordingBadge(popSingle, false)).toEqual({ text: 'Listen first', tone: 'outline' });
      expect(recordingBadge(cand({ trackId: 9 }), false)).toBeNull(); // unclassified → the caller uses the score
    });
  });

  it('says how sure a suggestion is in plain words (not "high"/"medium", which read like a voice)', () => {
    expect(CONFIDENCE_WORD).toEqual({ high: 'sure', medium: 'pretty sure', low: 'a guess' });
  });
});

describe('kindFitsSong', () => {
  it('a one-character song is no duet and a two-character song no solo; group numbers and unknown singers can be either', () => {
    expect(kindFitsSong({ singers: ['Javert'] }, 'solo')).toBe(true);
    expect(kindFitsSong({ singers: ['Javert'] }, 'duet')).toBe(false);
    expect(kindFitsSong({ singers: ['Éponine', 'Marius'] }, 'duet')).toBe(true);
    expect(kindFitsSong({ singers: ['Éponine', 'Marius'] }, 'solo')).toBe(false);
    expect(kindFitsSong({ singers: ['A', 'B', 'C'] }, 'solo')).toBe(true);
    expect(kindFitsSong({ singers: ['A', 'B', 'C'] }, 'duet')).toBe(true);
    expect(kindFitsSong({ singers: [] }, 'duet')).toBe(true);
    expect(kindFitsSong({ singers: ['  '] }, 'duet')).toBe(true);
  });
});

describe('addStepKey', () => {
  it('tells the /add steps apart (they share a path) but ignores typing (?q=) and ?kind=', () => {
    const key = (search: string, pathname = '/add') => addStepKey({ pathname, search });
    expect(key('?q=les')).toBe(key(''));
    expect(key('?q=les&kind=duet')).toBe(key('?q=les+mis'));
    expect(key('?catalogShow=1&q=les')).not.toBe(key('?q=les'));
    expect(key('?catalogSong=22&fromShow=1&q=les')).not.toBe(key('?catalogShow=1&q=les'));
    expect(key('?manual=1')).not.toBe(key(''));
    expect(key('?manual=1&catalogShow=6')).not.toBe(key('?catalogShow=6'));
    expect(key('?q=pop', '/songs')).toBe('/songs');
  });
});

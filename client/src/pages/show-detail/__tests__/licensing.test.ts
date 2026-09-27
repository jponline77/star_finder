import { describe, expect, it } from 'vitest';
import { makeShow } from '../../../test/fixtures';
import { filterAndSortShows } from '../../shows/filter';
import { creditLines, licensingStatus } from '../licensing';

describe('licensingStatus', () => {
  it('recognises approved publishers and collects caveats', () => {
    const mti = licensingStatus('Music Theatre International (MTI)');
    expect(mti.kind).toBe('approved');
    const trw = licensingStatus('Theatrical Rights Worldwide (TRW)');
    expect(trw.kind === 'approved' && trw.notes[0]).toMatch(/free festival licence/);
    const sf = licensingStatus('Concord Theatricals (Samuel French)');
    expect(sf.kind === 'approved' && sf.publisher.name).toBe('Concord Theatricals');
    expect(sf.kind === 'approved' && sf.notes.join(' ')).toMatch(/exclusions/);
  });

  it('flags unknown and unlisted licensors', () => {
    expect(licensingStatus(null).kind).toBe('unknown');
    expect(licensingStatus('  ').kind).toBe('unknown');
    expect(licensingStatus('Some Random Company').kind).toBe('unlisted');
  });
});

describe('creditLines', () => {
  it('merges identical people', () => {
    expect(creditLines({ composer: 'Anaïs Mitchell', lyricist: 'Anaïs Mitchell', bookWriter: 'Anaïs Mitchell' })).toEqual([{ role: 'Music, lyrics & book', who: 'Anaïs Mitchell' }]);
    expect(creditLines({ composer: 'Stephen Schwartz', lyricist: 'Stephen Schwartz', bookWriter: 'Winnie Holzman' })).toEqual([
      { role: 'Music & lyrics', who: 'Stephen Schwartz' },
      { role: 'Book', who: 'Winnie Holzman' },
    ]);
    expect(creditLines({ composer: 'John Kander', lyricist: 'Fred Ebb', bookWriter: null })).toEqual([
      { role: 'Music', who: 'John Kander' },
      { role: 'Lyrics', who: 'Fred Ebb' },
    ]);
    expect(creditLines({ composer: 'Alan Menken', lyricist: 'Howard Ashman', bookWriter: 'Howard Ashman' })).toEqual([
      { role: 'Music', who: 'Alan Menken' },
      { role: 'Lyrics & book', who: 'Howard Ashman' },
    ]);
    expect(creditLines({ composer: null, lyricist: null, bookWriter: null })).toEqual([]);
  });
});

describe('filterAndSortShows', () => {
  const shows = [
    makeShow({ id: 1, name: 'The Book of Mormon', composer: 'Trey Parker', year: 2011, songCount: 4 }),
    makeShow({ id: 2, name: 'Les Misérables', composer: 'Claude-Michel Schönberg', year: 1985, songCount: 14 }),
    makeShow({ id: 3, name: 'A Gentleman’s Guide to Love and Murder', composer: 'Steven Lutvak', year: 2013, songCount: 9 }),
  ];
  it('sorts A–Z ignoring leading articles, by songs and by year', () => {
    expect(filterAndSortShows(shows, '', 'az').map((s) => s.id)).toEqual([1, 3, 2]);
    expect(filterAndSortShows(shows, '', 'songs').map((s) => s.id)).toEqual([2, 3, 1]);
    expect(filterAndSortShows(shows, '', 'year').map((s) => s.id)).toEqual([3, 1, 2]);
  });
  it('searches names and credits accent-insensitively', () => {
    expect(filterAndSortShows(shows, 'miserables', 'az').map((s) => s.id)).toEqual([2]);
    expect(filterAndSortShows(shows, 'schonberg', 'az').map((s) => s.id)).toEqual([2]);
    expect(filterAndSortShows(shows, '2011', 'az').map((s) => s.id)).toEqual([1]);
    expect(filterAndSortShows(shows, 'zzz', 'az')).toEqual([]);
  });
});

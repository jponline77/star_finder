/**
 * Catalog test data (SPEC §7c) shaped like the server's answers:
 *   catalogShowLesMis, catalogShowWicked, catalogShowEmpty, makeSuggestions(...), candidate(...)
 */
import type { CatalogShowDetail, CatalogSong, CatalogSuggestions, ItunesCandidate } from '../types';

export const catalogSong = (o: Partial<CatalogSong> & { id: number; title: string }): CatalogSong => ({
  act: null,
  position: o.id,
  singers: [],
  singersRaw: '',
  ensemble: false,
  reprise: false,
  instrumental: false,
  source: 'wikipedia',
  onSite: null,
  ...o,
});

export const catalogShowLesMis: CatalogShowDetail = {
  id: 1,
  key: 'Q192111',
  title: 'Les Misérables',
  altTitles: ['Les Mis'],
  wikiTitle: 'Les Misérables (musical)',
  composer: 'Claude-Michel Schönberg',
  lyricist: 'Herbert Kretzmer',
  bookWriter: 'Alain Boublil',
  year: 1980,
  genres: ['sung-through'],
  characters: [{ name: 'Jean Valjean', voiceType: 'Baritone' }],
  songCount: 5,
  onSite: { showId: 14, slug: 'les-miserables' },
  songs: [
    catalogSong({ id: 11, title: 'Valjean’s Soliloquy', act: 1, position: 2, singers: ['Jean Valjean'], onSite: { songId: 501 } }),
    catalogSong({ id: 12, title: 'I Dreamed a Dream', act: 1, position: 4, singers: ['Fantine'] }),
    catalogSong({ id: 13, title: 'One Day More', act: 1, position: 17, singers: ['Jean Valjean', 'Marius', 'Cosette', 'Éponine'], ensemble: true }),
    catalogSong({ id: 14, title: 'A Little Fall of Rain', act: 2, position: 21, singers: ['Éponine', 'Marius'] }),
    catalogSong({ id: 22, title: 'Bring Him Home', act: 2, position: 22, singers: ['Jean Valjean'] }),
  ],
};

export const catalogShowWicked: CatalogShowDetail = {
  id: 3,
  title: 'Wicked',
  wikiTitle: 'Wicked (musical)',
  composer: 'Stephen Schwartz',
  lyricist: 'Stephen Schwartz',
  bookWriter: 'Winnie Holzman',
  year: 2003,
  onSite: null,
  songs: [
    catalogSong({ id: 31, title: 'The Wizard and I', act: 1, position: 3, singers: ['Elphaba'] }),
    catalogSong({ id: 32, title: 'Popular', act: 1, position: 8, singers: ['Glinda'] }),
  ],
};

export const catalogShowEmpty: CatalogShowDetail = {
  id: 6,
  title: 'Come From Away',
  wikiTitle: 'Come from Away',
  composer: 'Irene Sankoff',
  lyricist: 'Irene Sankoff',
  bookWriter: null,
  year: 2013,
  onSite: null,
  songs: [],
  recordingTracksAvailable: true,
};

/** Suggestions for "Bring Him Home" (Les Mis is on the site, and so is the song as a solo). */
export function suggestionsBringHimHome(o: Partial<CatalogSuggestions> = {}): CatalogSuggestions {
  return {
    catalogSong: { id: 22, title: 'Bring Him Home', act: 2, singers: ['Jean Valjean'], singersRaw: 'Valjean', ensemble: false, reprise: false },
    existingSong: { id: 99, title: 'Bring Him Home', kind: 'solo' },
    show: {
      siteShow: { id: 14, name: 'Les Misérables', slug: 'les-miserables' },
      catalogShowId: 1,
      name: 'Les Misérables',
      composer: 'Claude-Michel Schönberg',
      lyricist: 'Herbert Kretzmer',
      bookWriter: 'Alain Boublil',
      year: 1980,
      wikiTitle: 'Les Misérables (musical)',
    },
    title: { value: 'Bring Him Home', source: 'from the Wikipedia song list', confidence: 'high' },
    kind: { value: 'solo', source: 'from the Wikipedia song list (sung by Jean Valjean)', confidence: 'high' },
    parts: {
      value: [{ character: 'Jean Valjean', vocalRange: 'Tenor', rangeSource: 'from 3 other Les Misérables songs on the site', rangeConfidence: 'high' }],
      source: 'from the Wikipedia song list',
      confidence: 'high',
    },
    genre: { value: 'Drama', source: 'from 3 other Les Misérables songs on the site', confidence: 'medium', alternatives: ['Romantic'] },
    subGenre: { value: 'Longing', source: 'from 3 other Les Misérables songs on the site', confidence: 'medium', alternatives: ['Hopeful'] },
    mature: { value: false, source: 'from 3 other Les Misérables songs on the site', confidence: 'medium' },
    ...o,
  };
}

/** "A Little Fall of Rain" — a duet; Marius's range comes from the catalog's character list. */
export function suggestionsLittleFallOfRain(): CatalogSuggestions {
  return {
    ...suggestionsBringHimHome(),
    catalogSong: { id: 14, title: 'A Little Fall of Rain', act: 2, singers: ['Éponine', 'Marius'], singersRaw: 'Éponine, Marius', ensemble: false, reprise: false },
    existingSong: null,
    title: { value: 'A Little Fall of Rain', source: 'from the Wikipedia song list', confidence: 'high' },
    kind: { value: 'duet', source: 'from the Wikipedia song list (sung by Éponine and Marius)', confidence: 'high' },
    parts: {
      value: [
        { character: 'Éponine', vocalRange: 'Mezzo-soprano', rangeSource: 'from 2 other Les Misérables songs on the site', rangeConfidence: 'high' },
        { character: 'Marius Pontmercy', catalogName: 'Marius', vocalRange: 'Tenor', rangeSource: 'from the Wikipedia character list (Marius: tenor)', rangeConfidence: 'medium' },
      ],
      source: 'from the Wikipedia song list',
      confidence: 'high',
    },
  };
}

/** "One Day More" — a group number: no kind, a note instead. */
export function suggestionsOneDayMore(): CatalogSuggestions {
  return {
    ...suggestionsBringHimHome(),
    catalogSong: { id: 13, title: 'One Day More', act: 1, singers: ['Jean Valjean', 'Marius', 'Cosette', 'Éponine'], singersRaw: '', ensemble: true, reprise: false },
    existingSong: null,
    title: { value: 'One Day More', source: 'from the Wikipedia song list', confidence: 'high' },
    kind: null,
    kindNote: 'An ensemble number led by Jean Valjean, Marius, Cosette and Éponine — pick Solo or Duet for the part you’ll sing.',
    parts: {
      value: [
        { character: 'Jean Valjean', vocalRange: 'Tenor' },
        { character: 'Marius', vocalRange: null },
        { character: 'Cosette', vocalRange: 'Soprano' },
      ],
      source: 'from the Wikipedia song list',
      confidence: 'medium',
      note: 'Use the first character for a solo, the first two for a duet — or pick the ones you’ll sing.',
    },
    genre: null,
    subGenre: null,
    mature: null,
  };
}

/** "The Wizard and I" — Wicked isn't on the site yet. */
export function suggestionsWizardAndI(): CatalogSuggestions {
  return {
    catalogSong: { id: 31, title: 'The Wizard and I', act: 1, singers: ['Elphaba'], singersRaw: 'Elphaba', ensemble: false, reprise: false },
    existingSong: null,
    show: {
      siteShow: null,
      catalogShowId: 3,
      name: 'Wicked',
      composer: 'Stephen Schwartz',
      lyricist: 'Stephen Schwartz',
      bookWriter: 'Winnie Holzman',
      year: 2003,
      wikiTitle: 'Wicked (musical)',
    },
    title: { value: 'The Wizard and I', source: 'from the Wikipedia song list', confidence: 'high' },
    kind: { value: 'solo', source: 'from the Wikipedia song list (sung by Elphaba)', confidence: 'high' },
    parts: { value: [{ character: 'Elphaba', vocalRange: null }], source: 'from the Wikipedia song list', confidence: 'high' },
    genre: { value: 'Tragicomedy', source: 'from the show’s genre (“musical comedy”)', confidence: 'low' },
    subGenre: null,
    mature: null,
  };
}

export function candidate(o: Partial<ItunesCandidate> & { trackId: number }): ItunesCandidate {
  return {
    trackName: 'Bring Him Home',
    collectionName: 'Les Misérables (Original Broadway Cast Recording)',
    artistName: 'Colm Wilkinson',
    previewUrl: `https://audio-ssl.itunes.apple.com/p-${o.trackId}.m4a`,
    artworkUrl: `https://is1-ssl.mzstatic.com/a-${o.trackId}/600x600bb.jpg`,
    appleMusicUrl: `https://music.apple.com/ca/album/x/${o.trackId}`,
    durationSeconds: 201,
    score: 95,
    // like the server's catalog recordings: a cast recording of the show (override for weak / non-cast hits)
    castAlbum: true,
    albumLabel: 'original cast recording',
    ...o,
  };
}

/**
 * Test factories — use in any *.test.ts(x):
 *   const s = makeSong({ title: 'Popular', parts: [part('Glinda', 'Soprano')] });
 */
import type { Comment, Meta, Show, Song, SongPart, User } from '../types';

let nextId = 1000;

export function part(character: string, vocalRange: string | null = null, position: 1 | 2 = 1): SongPart {
  return { position, character, vocalRange };
}

export function makeSong(overrides: Partial<Song> = {}): Song {
  const id = overrides.id ?? nextId++;
  const kind = overrides.kind ?? 'solo';
  return {
    id,
    kind,
    title: `Song ${id}`,
    show: { id: 1, name: 'Wicked', slug: 'wicked', imageUrl: null },
    genre: 'Drama',
    subGenre: 'Hopeful',
    lengthSeconds: 180,
    mature: false,
    notes: null,
    parts:
      kind === 'duet'
        ? [part('Elphaba', 'Mezzo-soprano', 1), part('Glinda', 'Soprano', 2)]
        : [part('Elphaba', 'Mezzo-soprano', 1)],
    media: {
      previewUrl: null,
      artworkUrl: null,
      appleMusicUrl: null,
      recordingName: null,
      recordingArtist: null,
      audioUrl: null,
      audioLink: null,
    },
    source: 'spreadsheet',
    createdBy: null,
    commentCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeShow(overrides: Partial<Show> = {}): Show {
  const id = overrides.id ?? nextId++;
  return {
    id,
    name: 'Wicked',
    slug: 'wicked',
    composer: 'Stephen Schwartz',
    lyricist: 'Stephen Schwartz',
    bookWriter: 'Winnie Holzman',
    year: 2003,
    licensor: 'Music Theatre International (MTI)',
    licensingNote: null,
    description: 'The untold story of the witches of Oz.',
    wikiUrl: 'https://en.wikipedia.org/wiki/Wicked_(musical)',
    imageUrl: null,
    imageCredit: null,
    source: 'spreadsheet',
    createdBy: null,
    commentCount: 0,
    songCount: 2,
    soloCount: 1,
    duetCount: 1,
    ...overrides,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
    email: 'kid@example.com',
    displayName: 'Stage Kid',
    role: 'user',
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  const id = overrides.id ?? nextId++;
  return {
    id,
    body: 'Great song for a strong belt!',
    tag: 'tip',
    author: { id: 7, displayName: 'Stage Kid', role: 'user' },
    target: { type: 'song', id: 1, title: 'Popular' },
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    edited: false,
    ...overrides,
  };
}

export function makeMeta(overrides: Partial<Meta> = {}): Meta {
  return {
    vocalRanges: ['Soprano', 'Mezzo-soprano', 'Alto', 'Tenor', 'Baritone', 'Bass'],
    genres: ['Comedy', 'Drama', 'Romantic'],
    subGenres: [
      { name: 'Hopeful', genre: 'Drama', count: 3 },
      { name: 'Satire', genre: 'Comedy', count: 2 },
      { name: 'In Love', genre: 'Romantic', count: 2 },
    ],
    shows: [{ id: 1, name: 'Wicked', slug: 'wicked' }],
    counts: { songs: 3, solos: 2, duets: 1, shows: 1 },
    timeLimitSeconds: 360,
    warnSeconds: 330,
    festival: {
      name: 'Vancouver Regional STAR Fest',
      date: '2026-12-11',
      venue: 'SFU School for the Contemporary Arts',
      url: 'https://taeacanada.ca/regional-star-fest/',
    },
    ...overrides,
  };
}

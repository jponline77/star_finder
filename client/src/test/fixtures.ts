/**
 * Test factories — use in any *.test.ts(x):
 *   const s = makeSong({ title: 'Popular', parts: [part('Glinda', 'Soprano')] });
 */
import type { Comment, Festival, Meta, Show, Song, SongPart, User } from '../types';

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
    festivalSlug: null,
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
    festivals: makeFestivals(),
    defaultFestivalSlug: null,
    ...overrides,
  };
}

export function makeFestival(overrides: Partial<Festival> = {}): Festival {
  const id = overrides.id ?? nextId++;
  return {
    id,
    slug: `festival-${id}`,
    name: `Festival ${id} Regional STAR Fest`,
    kind: 'regional',
    province: 'BC',
    city: `City ${id}`,
    startDate: '2026-12-11',
    endDate: null,
    dateLabel: null,
    venue: 'Main Stage Theatre',
    infoUrl: 'https://taeacanada.ca/regional-star-fest/',
    sortOrder: 0,
    active: true,
    ...overrides,
  };
}

/** The 2026–27 season as seeded (server/seed/festivals.json), in the server's order. */
export function makeFestivals(): Festival[] {
  const f = (id: number, slug: string, name: string, city: string | null, startDate: string | null, venue: string | null, sortOrder: number, o: Partial<Festival> = {}) =>
    makeFestival({ id, slug, name, city, startDate, venue, sortOrder, ...o });
  return [
    f(1, 'prince-george', 'Prince George Regional STAR Fest', 'Prince George', '2026-11-20', 'Prince George Secondary School', 10),
    f(2, 'fraser-valley', 'Fraser Valley Regional STAR Fest', 'Mission', '2026-12-04', 'Clarke Theatre', 20),
    f(3, 'victoria', 'Victoria Regional STAR Fest', 'Victoria', '2026-12-10', 'University of Victoria (UVic)', 30),
    f(4, 'vancouver', 'Vancouver Regional STAR Fest', 'Vancouver', '2026-12-11', 'SFU School for the Contemporary Arts (SFU SCA)', 40),
    f(5, 'burnaby', 'Burnaby Regional STAR Fest', 'Burnaby', '2027-01-22', 'Burnaby Mountain Secondary School', 50),
    f(6, 'surrey', 'Surrey Regional STAR Fest', 'Surrey', '2027-01-29', 'North Surrey Secondary School', 60),
    f(7, 'nanaimo', 'Nanaimo Regional STAR Fest', 'Nanaimo', null, null, 70, { dateLabel: 'Date to be announced' }),
    f(8, 'online', 'Online Regional STAR Fest', null, null, 'Online', 80, {
      kind: 'online',
      province: null,
      endDate: '2027-02-28',
      dateLabel: 'Online entries close February 28, 2027',
    }),
    f(9, 'star-fest-west', 'STAR Fest West (National)', 'Vancouver', '2027-05-20', 'University of British Columbia (UBC Vancouver)', 100, {
      kind: 'national',
      endDate: '2027-05-23',
    }),
  ];
}

/**
 * Shared API types — mirrors SPEC §5 / §5a / §5b / §5c exactly (camelCase JSON).
 * Do not add fields here that the server does not send; derive UI-only shapes elsewhere.
 */

export type Kind = 'solo' | 'duet';
export type Source = 'spreadsheet' | 'community';
export type Role = 'user' | 'admin';

/** The six controlled vocal ranges, ordered high → low (see lib/vocab.ts VOCAL_RANGES). */
export type VocalRange = 'Soprano' | 'Mezzo-soprano' | 'Alto' | 'Tenor' | 'Baritone' | 'Bass';

export interface SongPart {
  position: 1 | 2;
  character: string;
  /** One of the VOCAL_RANGES values, or null when unknown. Typed loosely as the server sends a string. */
  vocalRange: string | null;
}

export interface ShowRef {
  id: number;
  name: string;
  slug: string;
  imageUrl: string | null;
}

export interface SongMedia {
  /** 30-second preview (Apple / iTunes). */
  previewUrl: string | null;
  /**
   * Local album art: /media/art/abc.jpg (committed seed art) or /uploads/art/abc.jpg (fetched for
   * a song added or changed on the website).
   */
  artworkUrl: string | null;
  appleMusicUrl: string | null;
  recordingName: string | null;
  recordingArtist: string | null;
  /** Uploaded file URL (/uploads/audio/...) — playable. */
  audioUrl: string | null;
  /** External link (YouTube, Spotify…) — open in a new tab, not playable inline. */
  audioLink: string | null;
}

/** Minimal public identity of the person who added a row. */
export interface CreatedBy {
  id: number;
  displayName: string;
}

export interface Song {
  id: number;
  kind: Kind;
  title: string;
  show: ShowRef;
  genre: string | null;
  subGenre: string | null;
  lengthSeconds: number | null;
  mature: boolean;
  notes: string | null;
  /** Sorted by position. Solos have 1 part, duets 2. */
  parts: SongPart[];
  media: SongMedia;
  source: Source;
  /** null for spreadsheet rows / deleted users. */
  createdBy: CreatedBy | null;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/songs/:id */
export type SongDetail = Song & { similar: Song[] };

/** The logged-in user (own email visible only to self and admins). */
export interface User {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  createdAt: string;
}

export type CommentTag = 'general' | 'tip' | 'question' | 'performed';
export type CommentTargetType = 'song' | 'show';

export interface CommentAuthor {
  id: number;
  displayName: string;
  role: Role;
}

export interface Comment {
  id: number;
  body: string;
  tag: CommentTag;
  /** Never includes the email. */
  author: CommentAuthor;
  /** title = song title or show name. */
  target: { type: CommentTargetType; id: number; title: string };
  createdAt: string;
  updatedAt: string;
  /** updatedAt > createdAt */
  edited: boolean;
}

export interface ShowCharacter {
  name: string;
  vocalRanges: string[];
  songIds: number[];
}

export interface Show {
  id: number;
  name: string;
  slug: string;
  composer: string | null;
  lyricist: string | null;
  bookWriter: string | null;
  year: number | null;
  licensor: string | null;
  licensingNote: string | null;
  description: string | null;
  wikiUrl: string | null;
  imageUrl: string | null;
  imageCredit: string | null;
  source: Source;
  createdBy: CreatedBy | null;
  commentCount: number;
  songCount: number;
  soloCount: number;
  duetCount: number;
  /** Only on detail (GET /api/shows/:idOrSlug). */
  characters?: ShowCharacter[];
  /** Only on detail (GET /api/shows/:idOrSlug). */
  songs?: Song[];
}

/** GET /api/shows/:idOrSlug — detail always includes songs + characters. */
export type ShowDetail = Show & { characters: ShowCharacter[]; songs: Song[] };

// ---------------------------------------------------------------------------
// /api/meta
// ---------------------------------------------------------------------------

export interface SubGenreMeta {
  name: string;
  genre: string | null;
  count: number;
}

export interface MetaShow {
  id: number;
  name: string;
  slug: string;
}

export interface Festival {
  name: string;
  /** ISO date, e.g. '2026-12-11' */
  date: string;
  venue: string;
  url: string;
}

export interface Meta {
  vocalRanges: string[];
  genres: string[];
  subGenres: SubGenreMeta[];
  shows: MetaShow[];
  counts: { songs: number; solos: number; duets: number; shows: number };
  /** 360 */
  timeLimitSeconds: number;
  /** 330 */
  warnSeconds: number;
  festival: Festival;
}

// ---------------------------------------------------------------------------
// /api/stats
// ---------------------------------------------------------------------------

export interface StatBucket {
  label: string;
  count: number;
}

export interface Stats {
  byGenre: StatBucket[];
  bySubGenre: StatBucket[];
  byRange: StatBucket[];
  byShow: StatBucket[];
  byKind: StatBucket[];
  lengthBuckets: StatBucket[];
  mature: { yes: number; no: number };
  overLimit: number;
  withPreview: number;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** One candidate from GET /api/lookup/itunes */
export interface ItunesCandidate {
  trackId: number;
  trackName: string;
  collectionName: string;
  artistName: string;
  previewUrl: string | null;
  artworkUrl: string | null;
  appleMusicUrl: string | null;
  durationSeconds: number | null;
  score: number;
}

export interface ItunesLookupResult {
  candidates: ItunesCandidate[];
}

/** GET /api/lookup/wikipedia */
export interface WikipediaLookupResult {
  found: boolean;
  title?: string;
  description?: string;
  extract?: string;
  imageUrl?: string;
  wikiUrl?: string;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface SongPartInput {
  character: string;
  vocalRange?: string | null;
}

/** The iTunes preview chosen in the song form (from an ItunesCandidate). */
export interface SongPreviewInput {
  previewUrl: string | null;
  artworkUrl: string | null;
  appleMusicUrl: string | null;
  recordingName: string | null;
  recordingArtist: string | null;
  itunesTrackId: number | null;
}

/** Body of POST /api/songs and PUT /api/songs/:id */
export interface SongInput {
  kind: Kind;
  title: string;
  /** Existing show id — OR — */
  showId?: number;
  /** a show name (found case/accent-insensitively, else a community show is created). */
  showName?: string;
  genre?: string | null;
  subGenre?: string | null;
  lengthSeconds?: number | null;
  /** "m:ss" — alternative to lengthSeconds */
  length?: string | null;
  mature?: boolean;
  notes?: string | null;
  parts: SongPartInput[];
  /** https URL or null */
  audioLink?: string | null;
  /** null clears the preview */
  preview?: SongPreviewInput | null;
}

/** Body of POST /api/shows and PUT /api/shows/:id */
export interface ShowInput {
  name: string;
  composer?: string | null;
  lyricist?: string | null;
  bookWriter?: string | null;
  year?: number | null;
  licensor?: string | null;
  licensingNote?: string | null;
  description?: string | null;
  wikiUrl?: string | null;
  /** https on upload.wikimedia.org or *.mzstatic.com — server downloads it. */
  imageUrl?: string | null;
}

export type SongSort = 'title' | 'show' | 'length' | '-length' | 'newest';

/** Query for GET /api/songs (all optional; arrays are sent comma-separated = OR). */
export interface SongQuery {
  q?: string;
  kind?: Kind;
  show?: string | number;
  genre?: string | string[];
  subGenre?: string | string[];
  range?: string | string[];
  maxSeconds?: number;
  minSeconds?: number;
  hideMature?: boolean;
  hasAudio?: boolean;
  sort?: SongSort;
  limit?: number;
  offset?: number;
}

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ProfileUpdateInput {
  displayName?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface CommentInput {
  body: string;
  tag?: CommentTag;
}

export interface CommentPatch {
  body?: string;
  tag?: CommentTag;
}

/** Where a comment thread lives. For shows, id may be the numeric id or the slug. */
export interface CommentTarget {
  type: CommentTargetType;
  id: number | string;
}

// ---------------------------------------------------------------------------
// My stuff & admin
// ---------------------------------------------------------------------------

export interface Contributions {
  songs: Song[];
  shows: Show[];
  comments: Comment[];
}

export type AdminUser = User & {
  disabled: boolean;
  lastLoginAt: string | null;
  songCount: number;
  showCount: number;
  commentCount: number;
};

export interface AdminUserPatch {
  role?: Role;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Error body every API error returns. */
export interface ApiErrorBody {
  error: string;
  details?: Record<string, string>;
  /** Machine-readable reason, e.g. 'MUST_CHANGE_PASSWORD' on a 403. */
  code?: string;
}

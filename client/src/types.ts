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
   * Local album art: /media/art/abc.jpg (seed art from `npm run fetch-media`) or /uploads/art/abc.jpg (fetched for
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
  /**
   * Where `artworkUrl` comes from (SPEC §7c): the chosen recording's album art, an image the owner uploaded
   * (POST /api/songs/:id/artwork), or null when there's no art. Optional because responses cached from an older
   * server may not carry it — treat undefined as "unknown" (a `/uploads/art/` URL alone doesn't tell).
   */
  artworkSource?: ArtworkSource | null;
  /**
   * The chosen recording's album art, even while an uploaded image is shown in `artworkUrl` (SPEC §7c addition) —
   * what "Use recording art" goes back to. Optional: older cached responses don't carry it.
   */
  recordingArtworkUrl?: string | null;
}

/** SPEC §7c — `SongMedia.artworkSource` */
export type ArtworkSource = 'recording' | 'upload';

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
  /**
   * The catalog song this song is (SPEC §7c, `songs.catalog_song_id`; set from the form or matched by title).
   * The client resends it on PUT (null when the show changes = unlink) and the recording picker uses it.
   * Optional for older cached responses; absent/null → the picker searches Apple by title + show.
   */
  catalogSongId?: number | null;
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
  /** The user's chosen festival (SPEC §7b) — an active regional/online festival slug, or null. */
  festivalSlug: string | null;
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
  /** The catalog show this site show is linked to (SPEC §7c), when the server sends it. */
  catalogShowId?: number | null;
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

export type FestivalKind = 'regional' | 'online' | 'national';

/** A STAR festival (SPEC §7b) — GET /api/festivals, /api/meta.festivals. */
export interface Festival {
  id: number;
  /** e.g. 'surrey', 'online', 'star-fest-west' */
  slug: string;
  /** e.g. 'Surrey Regional STAR Fest' */
  name: string;
  kind: FestivalKind;
  /** 'BC' (null for online) */
  province: string | null;
  city: string | null;
  /** 'YYYY-MM-DD' (a local calendar day), or null when the date is still to be announced */
  startDate: string | null;
  /** Last day of a multi-day festival; for kind 'online' = the entry deadline. */
  endDate: string | null;
  /** Free text shown instead of / alongside the dates ('Date to be announced'). */
  dateLabel: string | null;
  venue: string | null;
  /** https only */
  infoUrl: string | null;
  sortOrder: number;
  /** Inactive = hidden from pickers (admins still see them with ?all=1). */
  active: boolean;
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
  /** Active festivals, ordered by sortOrder, startDate, name (SPEC §7b). */
  festivals: Festival[];
  /** Site-wide default (env STAR_DEFAULT_FESTIVAL) — an active regional/online slug, or null. */
  defaultFestivalSlug: string | null;
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
  /** The recording's album (catalog recordings only). */
  collectionId?: number | null;
  /**
   * Catalog recordings only (GET /api/catalog/songs/:id/recordings): true = a cast recording of this show that
   * clearly has this song. false = anything else (a single, a cover, a weak title match…). Absent on
   * /api/lookup/itunes answers.
   */
  castAlbum?: boolean;
  /** What kind of album it is ("original cast recording", "concert recording", "film soundtrack"…), or null. */
  albumLabel?: string | null;
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
  /** SPEC §7c — the catalog song the form came from (must exist). null clears the link (edit). */
  catalogSongId?: number | null;
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
  /**
   * POST: the catalog show a new show is made from (SPEC §7c). The server checks the name matches, links the
   * show and fills the credits/year/Wikipedia link the body leaves empty.
   * PUT: which catalog show this is — an id (an owner's pick must have the same name; admins may pick any), null =
   * "not in the catalog" (never linked automatically), 'auto' = back to matching by name.
   */
  catalogShowId?: number | null | 'auto';
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
  /** Optional: the festival already picked in this browser (an active regional/online slug). */
  festivalSlug?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ProfileUpdateInput {
  displayName?: string;
  currentPassword?: string;
  newPassword?: string;
  /** An ACTIVE regional/online festival slug; null clears it (SPEC §7b). */
  festivalSlug?: string | null;
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

/**
 * Body of POST /api/admin/festivals (and, all optional, PUT /api/admin/festivals/:id).
 * The slug is made from the name on create by the server (409 on a clash).
 */
export interface FestivalInput {
  name: string;
  kind: FestivalKind;
  province?: string | null;
  city?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  dateLabel?: string | null;
  venue?: string | null;
  infoUrl?: string | null;
  sortOrder?: number;
  active?: boolean;
}

/** PUT /api/admin/festivals/:id — partial update. */
export type FestivalPatch = Partial<FestivalInput>;

// ---------------------------------------------------------------------------
// Show & song catalog (SPEC §7c) — Wikidata (CC0) + Wikipedia song lists (CC BY-SA 4.0)
// ---------------------------------------------------------------------------

export type Confidence = 'high' | 'medium' | 'low';

/** The site song a catalog song already matches. */
export interface CatalogOnSiteSong {
  songId: number;
}

/** The site show a catalog show already matches. */
export interface CatalogOnSiteShow {
  showId: number;
  slug: string;
}

export interface CatalogSongHit {
  type: 'song';
  id: number;
  title: string;
  /** `onSite`: the site show it already is (when the server sends it). */
  show: { id: number; title: string; year: number | null; onSite?: CatalogOnSiteShow | null };
  /** Character names ([] when the source doesn't say). */
  singers: string[];
  reprise: boolean;
  /** Chorus / company / ensemble take part. */
  ensemble: boolean;
  onSite: CatalogOnSiteSong | null;
}

export interface CatalogShowHit {
  type: 'show';
  id: number;
  title: string;
  year: number | null;
  composer: string | null;
  songCount: number;
  onSite: CatalogOnSiteShow | null;
}

/** GET /api/catalog — whether a catalog is loaded (a server without the catalog file answers available: false). */
export interface CatalogStatus {
  available: boolean;
  version: string | null;
  generatedAt: string | null;
  loadedAt: string | null;
  shows: number;
  songs: number;
}

/** GET /api/catalog/search?q=&limit= → { results } (songs AND shows, best first). */
export type CatalogHit = CatalogSongHit | CatalogShowHit;

export interface CatalogSearchResult {
  results: CatalogHit[];
}

export interface CatalogCharacter {
  name: string;
  voiceType: string | null;
}

/** One song of a catalog show (GET /api/catalog/shows/:id, …/recording-tracks). */
export interface CatalogSong {
  id: number;
  title: string;
  act: number | null;
  /** 1-based order within the show's list. */
  position: number | null;
  singers: string[];
  /** As written in the source ('' / null when none). */
  singersRaw?: string | null;
  ensemble: boolean;
  reprise: boolean;
  /** Overture, entr'acte… (only listed with ?all=1). */
  instrumental?: boolean;
  /** 'recording' = a cast-album track (singers unknown). */
  source?: 'wikipedia' | 'recording';
  onSite: CatalogOnSiteSong | null;
}

/** GET /api/catalog/shows/:id — show details + its songs (instrumentals excluded unless ?all=1). */
export interface CatalogShowDetail {
  id: number;
  key?: string;
  title: string;
  altTitles?: string[];
  wikiTitle: string | null;
  wikidataId?: string | null;
  composer: string | null;
  lyricist: string | null;
  bookWriter: string | null;
  year: number | null;
  genres?: string[];
  description?: string | null;
  characters?: CatalogCharacter[];
  songCount?: number;
  onSite: CatalogOnSiteShow | null;
  songs: CatalogSong[];
  /**
   * Only when the show has no songs: true = a cast album was found on Apple, false = none, null = couldn't check.
   */
  recordingTracksAvailable?: boolean | null;
  /** The show's cast album once found (cached for everyone). */
  castAlbum?: { collectionId: number; collectionName: string | null } | null;
}

/**
 * POST /api/catalog/shows/:id/recording-tracks — the cast album's tracks as catalog songs (saved with
 * source 'recording' so the next person gets them instantly). The server sends `{ album, added, saved, songs }`;
 * api.ts normalises `album` → `recording` (and also accepts a bare array or `{ tracks }`).
 */
export interface CatalogRecordingTracks {
  songs: CatalogSong[];
  /** The cast album the tracks came from (server field `album`). */
  recording?: { collectionName: string | null; artistName?: string | null; artworkUrl?: string | null } | null;
  /** true when the tracks are saved in the catalog (they have ids); false = a preview that saved nothing. */
  saved?: boolean;
}

/** GET /api/admin/catalog/recordings — a catalog show with a cast album / cast-album songs saved from Apple. */
export interface AdminCatalogRecording {
  id: number;
  key: string;
  title: string;
  year: number | null;
  castAlbum: { collectionId: number; collectionName: string | null } | null;
  /** Songs saved from the album's track list (0 when only the album was remembered). */
  recordingSongs: number;
  savedAt: string | null;
  savedBy: { id: number; displayName: string | null } | null;
  /** No longer in the catalog file (kept because site data points at it). */
  retired: boolean;
}

/** A pre-fill value with where it came from and how sure we are. */
export interface Suggested<T> {
  value: T;
  /** Human-readable, e.g. "from the Wikipedia song list", "from 3 other Les Misérables songs on the site". */
  source: string;
  confidence: Confidence;
  note?: string;
  alternatives?: T[];
}

export interface SuggestedPart {
  character: string;
  vocalRange: string | null;
  /** Where the range came from, e.g. "from 2 other Hadestown songs on the site". */
  rangeSource?: string;
  /** How sure the range is ('high' when every site song agrees). */
  rangeConfidence?: Confidence;
  /** Other ranges site songs use for this character. */
  rangeAlternatives?: string[];
  /** The catalog's spelling, when `character` uses the site's spelling instead. */
  catalogName?: string;
}

/** GET /api/catalog/songs/:id/suggestions — pre-fill data for the song form (no Apple calls). */
export interface CatalogSuggestions {
  catalogSong: {
    id: number;
    title: string;
    act: number | null;
    /** 1-based order within the show's list. */
    position?: number | null;
    singers: string[];
    singersRaw: string | null;
    ensemble: boolean;
    reprise: boolean;
    instrumental?: boolean;
    /** Where the song came from: the Wikipedia song list, or a cast album's track list on Apple Music. */
    source?: 'wikipedia' | 'recording';
  };
  /** Already on the site (same catalog song). */
  existingSong: { id: number; title: string; kind: Kind } | null;
  /** Every site song that already is this song (e.g. a solo and a duet version). */
  existingSongs?: { id: number; title: string; kind: Kind }[];
  show: {
    siteShow: { id: number; name: string; slug: string } | null;
    catalogShowId: number;
    name: string;
    composer: string | null;
    lyricist: string | null;
    bookWriter: string | null;
    year: number | null;
    wikiTitle: string | null;
  };
  title: Suggested<string>;
  /**
   * 1 singer → solo, 2 → duet. null (or a null `value` — the client accepts both) with a `note` when 0 or 3+
   * singers / an ensemble number.
   */
  kind: Suggested<Kind | null> | null;
  /** Why there's no solo/duet guess (group / ensemble / instrumental / singers unknown). */
  kindNote?: string | null;
  parts: Suggested<SuggestedPart[]>;
  genre: Suggested<string> | null;
  subGenre: Suggested<string> | null;
  mature: Suggested<boolean> | null;
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

/**
 * Song form model (SPEC §7.5): values, client-side validation that mirrors the server rules in
 * server/src/routes/songs.js + shows.js, server-error mapping and the request-body builder.
 * Pure functions — unit-tested in __tests__/model.test.ts.
 */
import type { Kind, Song, SongInput, SongPreviewInput } from '../../types';
import { parseLength } from '../../lib/format';
import { isHttpsUrl } from '../../lib/links';
import { equalsLoose } from '../../lib/normalize';
import { VOCAL_RANGES } from '../../lib/vocab';

// ---------------------------------------------------------------- limits (server mirrors)
export const TITLE_MAX = 120;
export const SHOW_NAME_MAX = 120;
export const CHARACTER_MAX = 80;
export const GENRE_MAX = 40;
export const SUB_GENRE_MAX = 40;
export const NOTES_MAX = 2000;
export const AUDIO_LINK_MAX = 500;
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'aif', 'aiff', 'ogg', 'oga'] as const;
export const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.aif,.aiff,.ogg';
export const SHOW_CREDIT_MAX = 120;
export const SHOW_DESCRIPTION_MAX = 1200;
export const YEAR_MIN = 1600;
export const YEAR_MAX = 2100;

/** Sentinel value of the genre <select> for "Other…" (free text). */
export const OTHER_GENRE = '__other__';

// ---------------------------------------------------------------- values
export interface PartValues {
  character: string;
  /** '' = not sure / unknown */
  vocalRange: string;
}

export interface SongFormValues {
  kind: Kind;
  title: string;
  /** What's typed in the show combobox. */
  showText: string;
  /** Existing show picked from the list (null = none / a new show). */
  showId: number | null;
  /** '' | an existing genre | OTHER_GENRE */
  genreChoice: string;
  genreOther: string;
  subGenre: string;
  /** "m:ss" as typed */
  length: string;
  mature: boolean;
  notes: string;
  /** 1 part for a solo, 2 for a duet */
  parts: PartValues[];
  audioLink: string;
}

/** Optional extra details for a brand-new show (sent to POST /api/shows before the song). */
export interface NewShowDetails {
  composer: string;
  lyricist: string;
  year: string;
  description: string;
  wikiUrl: string | null;
  wikiTitle: string | null;
  /** Poster found on Wikipedia (upload.wikimedia.org). */
  imageUrl: string | null;
  useImage: boolean;
  /** The show name the Wikipedia lookup was made for (null = no lookup result). */
  wikiFor: string | null;
  /** The description text filled in from Wikipedia ('' if the user's own text was kept). */
  wikiDescription: string;
}

export const EMPTY_NEW_SHOW: NewShowDetails = {
  composer: '',
  lyricist: '',
  year: '',
  description: '',
  wikiUrl: null,
  wikiTitle: null,
  imageUrl: null,
  useImage: true,
  wikiFor: null,
  wikiDescription: '',
};

/** A chosen 30-second preview — lives in lib/recordings (shared with the RecordingPicker). */
export type { ChosenPreview } from '../../lib/recordings';

export const emptyPart = (): PartValues => ({ character: '', vocalRange: '' });

export function emptyValues(kind: Kind = 'solo'): SongFormValues {
  return {
    kind,
    title: '',
    showText: '',
    showId: null,
    genreChoice: '',
    genreOther: '',
    subGenre: '',
    length: '',
    mature: false,
    notes: '',
    parts: kind === 'duet' ? [emptyPart(), emptyPart()] : [emptyPart()],
    audioLink: '',
  };
}

/** Pre-fill the form from an existing song (edit mode). */
export function valuesFromSong(song: Song, genres: readonly string[]): SongFormValues {
  const genre = song.genre ?? '';
  const known = genre === '' || genres.some((g) => g === genre);
  const parts = song.parts.map((p) => ({ character: p.character, vocalRange: p.vocalRange ?? '' }));
  while (parts.length < (song.kind === 'duet' ? 2 : 1)) parts.push(emptyPart());
  return {
    kind: song.kind,
    title: song.title,
    showText: song.show.name,
    showId: song.show.id,
    genreChoice: known ? genre : OTHER_GENRE,
    genreOther: known ? '' : genre,
    subGenre: song.subGenre ?? '',
    length: song.lengthSeconds ? formatMss(song.lengthSeconds) : '',
    mature: song.mature,
    notes: song.notes ?? '',
    parts: parts.slice(0, song.kind === 'duet' ? 2 : 1),
    audioLink: song.media.audioLink ?? '',
  };
}

/** The song's current iTunes preview as a ChosenPreview (edit mode), or null. */
export { previewFromSong } from '../../lib/recordings';

function formatMss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Switch solo ↔ duet: keep part 1, add/restore part 2 (from `stash`) or drop it. */
export function withKind(values: SongFormValues, kind: Kind, stash?: PartValues | null): SongFormValues {
  if (values.kind === kind) return values;
  const first = values.parts[0] ?? emptyPart();
  const parts = kind === 'duet' ? [first, stash ?? values.parts[1] ?? emptyPart()] : [first];
  return { ...values, kind, parts };
}

export function effectiveGenre(values: Pick<SongFormValues, 'genreChoice' | 'genreOther'>): string {
  return (values.genreChoice === OTHER_GENRE ? values.genreOther : values.genreChoice).trim();
}

/** Find an existing show whose name matches `text` accent/case-insensitively. */
export function matchShow<T extends { id: number; name: string }>(text: string, shows: readonly T[]): T | null {
  const t = text.trim();
  if (!t) return null;
  return shows.find((s) => equalsLoose(s.name, t)) ?? null;
}

// ---------------------------------------------------------------- validation
export type FieldErrors = Record<string, string>;

/** Stable DOM ids (also the data-testids) for each error key, in on-screen order. */
export const FIELD_DOM_IDS: ReadonlyArray<[key: string, domId: string]> = [
  ['kind', 'song-kind-solo'],
  ['show', 'song-show'],
  ['newShow.composer', 'new-show-composer'],
  ['newShow.lyricist', 'new-show-lyricist'],
  ['newShow.year', 'new-show-year'],
  ['newShow.description', 'new-show-description'],
  ['newShow.imageUrl', 'fetch-wikipedia'],
  ['title', 'song-title'],
  ['catalogSongId', 'song-title'],
  ['parts', 'part-1-character'],
  ['parts.0.character', 'part-1-character'],
  ['parts.0.vocalRange', 'part-1-range'],
  ['parts.1.character', 'part-2-character'],
  ['parts.1.vocalRange', 'part-2-range'],
  ['genre', 'song-genre'],
  ['subGenre', 'song-subgenre'],
  ['preview', 'act-recording-title'],
  ['length', 'song-length'],
  ['notes', 'song-notes'],
  ['artwork', 'song-art-choose'],
  ['audioFile', 'song-audio-choose'],
  ['audioLink', 'song-audio-link'],
];

export function domIdFor(key: string): string | undefined {
  return FIELD_DOM_IDS.find(([k]) => k === key)?.[1];
}

/** Order errors the way the fields appear on screen (unknown keys last). */
export function orderedErrors(errors: FieldErrors): Array<[string, string]> {
  const order = FIELD_DOM_IDS.map(([k]) => k);
  return Object.entries(errors).sort(([a], [b]) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

const tooLong = (s: string, max: number) => [...s.trim()].length > max;

export function validateLength(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{1,2}:\d{2}$/.test(t)) return 'Use minutes:seconds, like 3:25.';
  const secs = parseLength(t);
  if (secs === null) return /:[6-9]\d$/.test(t) ? 'Seconds go up to 59 — try something like 3:25.' : 'That length doesn’t look right — use m:ss, like 3:25.';
  return null;
}

export function validateAudioFile(file: File | null | undefined): string | null {
  if (!file) return null;
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const typeOk = file.type.startsWith('audio/') || (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
  if (!typeOk) return 'Use an MP3, M4A, AAC, WAV, AIFF or OGG audio file.';
  if (file.size > AUDIO_MAX_BYTES) return 'That file is over 25 MB — try an MP3 or M4A version.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

export function validateYear(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{4}$/.test(t)) return 'Use a 4-digit year, like 1987.';
  const n = Number(t);
  if (n < YEAR_MIN || n > YEAR_MAX) return `Use a year between ${YEAR_MIN} and ${YEAR_MAX}.`;
  return null;
}

export interface ValidateOptions {
  audioFile?: File | null;
  /** Validate the new-show details too (only when a new show will be created). */
  newShow?: NewShowDetails | null;
}

/** Client-side validation (the server is authoritative). Returns {} when everything is fine. */
export function validateSongForm(values: SongFormValues, options: ValidateOptions = {}): FieldErrors {
  const e: FieldErrors = {};
  const title = values.title.trim();
  if (!title) e.title = 'Give the song a title.';
  else if (tooLong(title, TITLE_MAX)) e.title = `Keep the title to ${TITLE_MAX} characters or fewer.`;

  const showText = values.showText.trim();
  if (values.showId === null) {
    if (!showText) e.show = 'Pick a show from the list (or type the name of a new one).';
    else if (tooLong(showText, SHOW_NAME_MAX)) e.show = `Keep the show name to ${SHOW_NAME_MAX} characters or fewer.`;
  }

  const expected = values.kind === 'duet' ? 2 : 1;
  if (values.parts.length !== expected) e.parts = values.kind === 'duet' ? 'A duet needs 2 characters.' : 'A solo needs 1 character.';
  values.parts.slice(0, expected).forEach((p, i) => {
    const c = p.character.trim();
    const who = values.kind === 'duet' ? `character ${i + 1}` : 'the character';
    if (!c) e[`parts.${i}.character`] = `Who sings it? Add the name of ${who}.`;
    else if (tooLong(c, CHARACTER_MAX)) e[`parts.${i}.character`] = `Keep character names to ${CHARACTER_MAX} characters or fewer.`;
    if (p.vocalRange && !(VOCAL_RANGES as readonly string[]).includes(p.vocalRange)) e[`parts.${i}.vocalRange`] = 'Pick a vocal range from the list.';
  });
  if (values.kind === 'duet' && values.parts[0] && values.parts[1]) {
    const a = values.parts[0].character.trim();
    const b = values.parts[1].character.trim();
    if (a && b && equalsLoose(a, b)) e['parts.1.character'] = 'A duet needs two different characters.';
  }

  if (values.genreChoice === OTHER_GENRE && !values.genreOther.trim()) e.genre = 'Type the genre, or pick one from the list.';
  else if (tooLong(effectiveGenre(values), GENRE_MAX)) e.genre = `Keep the genre to ${GENRE_MAX} characters or fewer.`;
  if (tooLong(values.subGenre, SUB_GENRE_MAX)) e.subGenre = `Keep the mood to ${SUB_GENRE_MAX} characters or fewer.`;

  const lengthError = validateLength(values.length);
  if (lengthError) e.length = lengthError;

  if (tooLong(values.notes, NOTES_MAX)) e.notes = `Notes can be up to ${NOTES_MAX} characters.`;

  const link = values.audioLink.trim();
  if (link) {
    if (!isHttpsUrl(link)) e.audioLink = 'Links must start with https:// (like https://youtu.be/…).';
    else if (link.length > AUDIO_LINK_MAX) e.audioLink = 'That link is too long.';
  }

  const fileError = validateAudioFile(options.audioFile);
  if (fileError) e.audioFile = fileError;

  const ns = options.newShow;
  if (ns) {
    if (tooLong(ns.composer, SHOW_CREDIT_MAX)) e['newShow.composer'] = `Keep it to ${SHOW_CREDIT_MAX} characters or fewer.`;
    if (tooLong(ns.lyricist, SHOW_CREDIT_MAX)) e['newShow.lyricist'] = `Keep it to ${SHOW_CREDIT_MAX} characters or fewer.`;
    const y = validateYear(ns.year);
    if (y) e['newShow.year'] = y;
    if (tooLong(ns.description, SHOW_DESCRIPTION_MAX)) e['newShow.description'] = `Keep the description to ${SHOW_DESCRIPTION_MAX} characters or fewer.`;
  }
  return e;
}

/** Map a server 400 `details` object onto form error keys. Unknown keys go to `_form`. */
export function mapServerDetails(details: Record<string, string>, prefix: '' | 'newShow.' = ''): FieldErrors {
  const out: FieldErrors = {};
  const put = (key: string, msg: string) => {
    if (!(key in out)) out[key] = msg;
  };
  for (const [key, msg] of Object.entries(details)) {
    if (key === 'existingId' || key === 'songCount') continue;
    if (prefix === 'newShow.') {
      if (key === 'name') put('show', msg);
      else if (key === 'composer' || key === 'lyricist' || key === 'year' || key === 'description') put(`newShow.${key}`, msg);
      else if (key === 'imageUrl') put('newShow.imageUrl', msg);
      else put('_form', msg);
      continue;
    }
    if (key === 'showId' || key === 'showName') put('show', msg);
    else if (key === 'length' || key === 'lengthSeconds') put('length', msg);
    else if (key.startsWith('preview')) put('preview', msg);
    else if (key === 'file') put('audioFile', msg);
    else if (key === 'catalogSongId') put('catalogSongId', msg);
    else if (/^parts(\.\d+\.(character|vocalRange))?$/.test(key)) put(key, msg);
    else if (['title', 'kind', 'genre', 'subGenre', 'notes', 'audioLink'].includes(key)) put(key, msg);
    else put('_form', msg);
  }
  return out;
}

// ---------------------------------------------------------------- request bodies
export interface BuildOptions {
  /** Resolved existing show id (overrides values.showId), else showName is sent. */
  showId: number | null;
  /** undefined = omit (keep media on PUT / no preview on POST), null = clear, object = set */
  preview?: SongPreviewInput | null;
  /** SPEC §7c: undefined = omit, null = clear the link, number = the catalog song the form came from. */
  catalogSongId?: number | null;
}

export function toSongInput(values: SongFormValues, options: BuildOptions): SongInput {
  const lengthText = values.length.trim();
  const input: SongInput = {
    kind: values.kind,
    title: values.title.trim(),
    genre: effectiveGenre(values) || null,
    subGenre: values.subGenre.trim() || null,
    lengthSeconds: lengthText ? parseLength(lengthText) : null,
    mature: values.mature,
    notes: values.notes.trim() || null,
    parts: values.parts.slice(0, values.kind === 'duet' ? 2 : 1).map((p) => ({ character: p.character.trim(), vocalRange: p.vocalRange || null })),
    audioLink: values.audioLink.trim() || null,
  };
  if (options.showId !== null) input.showId = options.showId;
  else input.showName = values.showText.trim();
  if (options.preview !== undefined) input.preview = options.preview;
  if (options.catalogSongId !== undefined) input.catalogSongId = options.catalogSongId;
  return input;
}

/**
 * Wikipedia details belong to the name they were looked up for. When the show name changes to
 * something else, drop the Wikipedia link, poster and the auto-filled description (text the user
 * typed or edited themselves is kept), so one show's details never get saved onto another.
 */
export function newShowDetailsForName(ns: NewShowDetails, name: string): NewShowDetails {
  if (ns.wikiFor === null || equalsLoose(ns.wikiFor, name)) return ns;
  return {
    ...ns,
    description: ns.wikiDescription && ns.description === ns.wikiDescription ? '' : ns.description,
    wikiUrl: null,
    wikiTitle: null,
    imageUrl: null,
    useImage: true,
    wikiFor: null,
    wikiDescription: '',
  };
}

/** True when the user filled in anything worth creating the show first (POST /api/shows). */
export function hasNewShowDetails(ns: NewShowDetails): boolean {
  return Boolean(ns.composer.trim() || ns.lyricist.trim() || ns.year.trim() || ns.description.trim() || ns.wikiUrl || (ns.imageUrl && ns.useImage));
}

/** First ~3 sentences of a Wikipedia extract, capped at `max` characters. */
export function shortenExtract(extract: string | null | undefined, max = 600): string {
  const text = (extract ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  let out = '';
  for (const s of sentences.slice(0, 3)) {
    if ((out + s).length > max) break;
    out += s;
  }
  out = out.trim() || text.slice(0, max);
  if (out.length > max) out = `${out.slice(0, max - 1).trimEnd()}…`;
  return out;
}

/** Stable JSON snapshot for dirty-checking. */
export function snapshot(values: SongFormValues): string {
  return JSON.stringify(values);
}

/**
 * A full PUT body for an existing song with a few media fields changed — used by the song page's owner tools
 * (changing the recording / length) without opening the form. Keeps the song's catalog link.
 */
export function inputFromSong(song: Song, options: { preview?: SongPreviewInput | null; lengthSeconds?: number | null } = {}): SongInput {
  const values = valuesFromSong(song, song.genre ? [song.genre] : []);
  const input = toSongInput(values, { showId: song.show.id, preview: options.preview, catalogSongId: song.catalogSongId ?? undefined });
  if (options.lengthSeconds !== undefined) input.lengthSeconds = options.lengthSeconds;
  return input;
}

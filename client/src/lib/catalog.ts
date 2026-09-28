/**
 * Show & song catalog helpers (SPEC §7c) — pure, unit-tested in catalog.test.ts.
 *
 *  - "/add" step URLs: `parseAddStep(searchParams)` / `addHref({...})`
 *      /add?q=…                       Find your song (search the catalog)
 *      /add?catalogShow=<id>          a catalog show's song list to pick from
 *      /add?catalogSong=<id>          the song form, pre-filled from the catalog
 *      /add?manual=1[&show=<slug>|&catalogShow=<id>]   the song form, typed by hand
 *      /add?show=<slug>               (links from show pages) → that show's catalog song list if it has one
 *    `kind`, `q` and `fromShow` ride along so Back links and the browser's back button return to the same place.
 *  - Solo / Duet / Ensemble guesses, singer lists, act groups, suggestion wording.
 */
import type { CatalogSong, Confidence, ItunesCandidate, Kind } from '../types';
import { fold, tokenize } from './normalize';

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/** Wikipedia-derived song lists are CC BY-SA 4.0 — credit them wherever catalog data is shown. */
export const CATALOG_CREDIT = 'Song list from Wikipedia (CC BY-SA)';
/** Songs loaded from a show's cast album (catalog songs with source 'recording') came from Apple, not Wikipedia. */
export const RECORDING_LIST_CREDIT = 'Track list from Apple Music';
export const CC_BY_SA_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

/** https://en.wikipedia.org/wiki/<Title_with_underscores>, or null. */
export function wikipediaUrl(title: string | null | undefined): string | null {
  const t = title?.trim();
  if (!t) return null;
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`;
}

// ---------------------------------------------------------------------------
// "/add" steps (URL-driven so back/forward and sharing work)
// ---------------------------------------------------------------------------

export interface AddParams {
  q?: string | null;
  catalogShow?: number | null;
  catalogSong?: number | null;
  manual?: boolean;
  /** A site show slug (pre-fills the manual form; alone it asks for that show's catalog song list). */
  show?: string | null;
  /** The catalog show list a song was picked from (for "Back to the song list"). */
  fromShow?: number | null;
  kind?: Kind | null;
}

/** Build an "/add…" URL. Param order is stable so URLs compare equal. */
export function addHref(p: AddParams = {}): string {
  const params = new URLSearchParams();
  if (p.catalogSong) params.set('catalogSong', String(p.catalogSong));
  if (p.manual) params.set('manual', '1');
  if (p.catalogShow) params.set('catalogShow', String(p.catalogShow));
  if (p.show) params.set('show', p.show);
  if (p.fromShow) params.set('fromShow', String(p.fromShow));
  if (p.kind) params.set('kind', p.kind);
  const q = p.q?.trim();
  if (q) params.set('q', q);
  const s = params.toString();
  return s ? `/add?${s}` : '/add';
}

export type AddStep =
  | { step: 'find'; q: string; kind: Kind | null }
  | { step: 'show'; catalogShowId: number; q: string; kind: Kind | null }
  | { step: 'song'; catalogSongId: number; fromShow: number | null; q: string; kind: Kind | null }
  | { step: 'manual'; catalogShowId: number | null; showSlug: string | null; fromShow: number | null; q: string; kind: Kind | null }
  | { step: 'resolve-show'; showSlug: string; q: string; kind: Kind | null };

function positiveId(v: string | null): number | null {
  if (!v || !/^\d{1,12}$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function parseKind(v: string | null): Kind | null {
  return v === 'solo' || v === 'duet' ? v : null;
}

/**
 * Which "screen" a location is. The "/add" steps share one path, so the step's own params decide (typing in the
 * find box — ?q= — or ?kind= don't make a new screen). Used for focus + announcements on navigation (Layout) and
 * for the song form's unsaved-changes guard.
 */
export function addStepKey(location: { pathname: string; search: string }): string {
  if (location.pathname !== '/add') return location.pathname;
  const p = new URLSearchParams(location.search);
  return `/add|${p.get('catalogSong') ?? ''}|${p.has('manual') ? 'manual' : ''}|${p.get('catalogShow') ?? ''}`;
}

/** Which "/add" step a URL is on. Precedence: catalogSong > manual > catalogShow > show > find. */
export function parseAddStep(params: URLSearchParams): AddStep {
  const kind = parseKind(params.get('kind'));
  const q = (params.get('q') ?? '').slice(0, 200);
  const catalogSongId = positiveId(params.get('catalogSong'));
  const catalogShowId = positiveId(params.get('catalogShow'));
  const fromShow = positiveId(params.get('fromShow'));
  const showSlug = params.get('show')?.trim() || null;
  const manual = params.has('manual') && params.get('manual') !== '0';
  if (catalogSongId) return { step: 'song', catalogSongId, fromShow, q, kind };
  if (manual) return { step: 'manual', catalogShowId, showSlug, fromShow, q, kind };
  if (catalogShowId) return { step: 'show', catalogShowId, q, kind };
  if (showSlug) return { step: 'resolve-show', showSlug, q, kind };
  return { step: 'find', q, kind };
}

// ---------------------------------------------------------------------------
// Solo / Duet / Ensemble guesses
// ---------------------------------------------------------------------------

export type KindGuess = 'solo' | 'duet' | 'solo-ensemble' | 'duet-ensemble' | 'group' | 'ensemble';

/** From who sings it in the show. null = the source doesn't say. */
export function guessKind(song: { singers: readonly string[]; ensemble: boolean }): KindGuess | null {
  const n = song.singers.length;
  if (n >= 3) return 'group';
  if (n === 2) return song.ensemble ? 'duet-ensemble' : 'duet';
  if (n === 1) return song.ensemble ? 'solo-ensemble' : 'solo';
  return song.ensemble ? 'ensemble' : null;
}

export const KIND_GUESS: Record<KindGuess, { label: string; emoji: string; tone: 'solo' | 'duet' | 'group' }> = {
  solo: { label: 'Solo', emoji: '🎤', tone: 'solo' },
  duet: { label: 'Duet', emoji: '👯', tone: 'duet' },
  'solo-ensemble': { label: 'Solo + ensemble', emoji: '🎤', tone: 'solo' },
  'duet-ensemble': { label: 'Duet + ensemble', emoji: '👯', tone: 'duet' },
  group: { label: 'Group number', emoji: '🎶', tone: 'group' },
  ensemble: { label: 'Ensemble', emoji: '🎶', tone: 'group' },
};

/** The STAR kind a guess points to (group / ensemble numbers → null). */
export function kindForGuess(guess: KindGuess | null): Kind | null {
  if (guess === 'solo' || guess === 'solo-ensemble') return 'solo';
  if (guess === 'duet' || guess === 'duet-ensemble') return 'duet';
  return null;
}

/**
 * Could this catalog song plausibly be sung as `kind`? A song one character sings isn't a duet, and a two-character
 * song isn't a solo; group numbers and songs whose singers aren't listed could be either.
 */
export function kindFitsSong(song: { singers: readonly string[] }, kind: Kind): boolean {
  const n = song.singers.filter((s) => s.trim()).length;
  if (n === 0 || n >= 3) return true;
  return kind === 'solo' ? n === 1 : n === 2;
}

/**
 * Why we can't (or can only partly) say solo vs duet — shown with the kind suggestion. null when the song is a
 * plain solo or duet.
 */
export function kindNoteFor(song: { singers: readonly string[]; ensemble: boolean }): string | null {
  const guess = guessKind(song);
  switch (guess) {
    case 'group':
    case 'ensemble':
      return 'In the show this is a group number. STAR needs a solo or a duet — pick the version you’ll perform (a cut is fine; check with your teacher).';
    case 'solo-ensemble':
      return 'The ensemble joins in during the show — as a STAR solo you’d sing just the solo part.';
    case 'duet-ensemble':
      return 'The ensemble joins in during the show — as a STAR duet you’d sing just the two main parts.';
    case null:
      return 'The song list doesn’t say who sings this one — pick Solo or Duet for the version you’ll perform.';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** ["A"] → "A"; ["A","B"] → "A & B"; ["A","B","C","D","E"] (max 3) → "A, B, C & 2 more". */
export function formatSingers(singers: readonly string[], max = 3): string {
  const names = singers.map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  const extra = names.length - max;
  return `${names.slice(0, max).join(', ')} & ${extra} more`;
}

/** "Les Misérables (1980)" */
export function titleWithYear(title: string, year: number | null | undefined): string {
  return year ? `${title} (${year})` : title;
}

export interface ActGroup {
  act: number | null;
  /** '' when the show's list has no acts. */
  label: string;
  songs: CatalogSong[];
}

/** Songs in list order, grouped into acts ("Act 1", "Act 2"; songs without an act → "More songs"). */
export function groupByAct(songs: readonly CatalogSong[]): ActGroup[] {
  const ordered = [...songs].sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
  const hasActs = ordered.some((s) => s.act !== null && s.act !== undefined);
  if (!hasActs) return ordered.length ? [{ act: null, label: '', songs: ordered }] : [];
  const groups: ActGroup[] = [];
  for (const song of ordered) {
    const act = song.act ?? null;
    let group = groups.find((g) => g.act === act);
    if (!group) {
      group = { act, label: act === null ? 'More songs' : `Act ${act}`, songs: [] };
      groups.push(group);
    }
    group.songs.push(song);
  }
  return groups.sort((a, b) => (a.act ?? Number.MAX_SAFE_INTEGER) - (b.act ?? Number.MAX_SAFE_INTEGER));
}

/** Accent/case-insensitive filter on title + singers (every word must match). */
export function filterCatalogSongs(songs: readonly CatalogSong[], query: string): CatalogSong[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [...songs];
  return songs.filter((s) => {
    const hay = fold(`${s.title} ${s.singers.join(' ')} ${s.singersRaw ?? ''}`);
    return tokens.every((t) => hay.includes(t));
  });
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export const CONFIDENCE_LEVEL: Record<Confidence, 1 | 2 | 3> = { high: 3, medium: 2, low: 1 };

/**
 * The visible word next to the confidence dots. Plain-language certainty — a bare "high" / "medium" next to a
 * vocal range reads like a statement about the voice.
 */
export const CONFIDENCE_WORD: Record<Confidence, string> = { high: 'sure', medium: 'pretty sure', low: 'a guess' };

/** "Suggested from the Wikipedia song list, high confidence" — for screen readers. */
export function suggestionSentence(source: string, confidence?: Confidence | null): string {
  const s = source.trim();
  const from = /^(from|by|via|based on|using)\b/i.test(s) ? `Suggested ${s}` : `Suggested (${s})`;
  return confidence ? `${from}, ${confidence} confidence` : from;
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

/** Score from which a recording of the show (an `albumLabel`) is trusted without being a cast album. */
export const CONFIDENT_SCORE = 85;

/**
 * Is this recording clearly this song from this show — safe to pick without the student listening first?
 * A cast recording is. So is a strong match on another recording of the show (concert, film…). A single, a cover or
 * a weak title match isn't: wrong audio is worse than no audio. Answers without `castAlbum` (older servers, the
 * plain Apple search) fall back to the score.
 */
export function isConfidentRecording(c: Pick<ItunesCandidate, 'score' | 'castAlbum' | 'albumLabel'>): boolean {
  if (c.castAlbum === true) return true;
  if (c.castAlbum === undefined) return c.score >= CONFIDENT_SCORE;
  return c.score >= CONFIDENT_SCORE && Boolean(c.albumLabel?.trim());
}

/**
 * The recording to pick by itself: the first playable, confident one (the server sorts best first). null when
 * none is clearly the song — then the student listens and picks (or doesn't).
 */
export function bestCandidate(candidates: readonly ItunesCandidate[]): ItunesCandidate | null {
  return candidates.find((c) => Boolean(c.previewUrl) && isConfidentRecording(c)) ?? null;
}

/**
 * The badge on a catalog recording card: "Best match" for the auto-pick, what the album is, or "Listen first".
 * null for answers that don't say whether it's a cast album (use the match score instead).
 */
export function recordingBadge(c: Pick<ItunesCandidate, 'score' | 'castAlbum' | 'albumLabel'>, isBest: boolean): { text: string; tone: 'success' | 'gold' | 'outline' } | null {
  if (isBest) return { text: 'Best match', tone: 'success' };
  if (c.castAlbum === undefined) return null;
  const label = c.albumLabel?.trim();
  if (c.castAlbum === true) return { text: label ? capitalize(label) : 'Cast recording', tone: 'gold' };
  if (label && label !== 'recording' && isConfidentRecording(c)) return { text: capitalize(label), tone: 'outline' };
  return { text: 'Listen first', tone: 'outline' };
}

function capitalize(s: string): string {
  return s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;
}

/** "3:21" for a length field (null for missing / out-of-range durations). */
export function lengthText(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  const s = Math.round(seconds);
  if (s <= 0 || s >= 3600) return null;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

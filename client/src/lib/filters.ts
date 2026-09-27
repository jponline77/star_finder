/**
 * Browse filtering / sorting / URL (de)serialisation / search highlighting. Pure functions.
 *
 * URL params mirror the API query names (SPEC §5): q, kind, range, genre, subGenre, show,
 * maxSeconds, minSeconds, hideMature=1, hasAudio=1, sort. Defaults are omitted from the URL.
 */
import type { Kind, Song, SongSort, VocalRange } from '../types';
import { compareText, equalsLoose, foldWithMap, normalizeText, tokenize } from './normalize';
import { compareRanges, genreEmoji, KIND_EMOJI, KIND_LABEL, normalizeVocalRange, subGenreEmoji, VOCAL_RANGES } from './vocab';
import { formatLength } from './format';

export type KindFilter = 'all' | Kind;

export interface FilterState {
  /** free-text search (accent/case-insensitive) */
  q: string;
  kind: KindFilter;
  /** OR within the list; a duet matches if ANY part has one of these */
  ranges: VocalRange[];
  genres: string[];
  subGenres: string[];
  /** show slug ('' = any show) */
  show: string;
  maxSeconds: number | null;
  minSeconds: number | null;
  hideMature: boolean;
  /** preview, uploaded audio or external link (same semantics as API hasAudio=1) */
  hasAudio: boolean;
  sort: SongSort;
}

export const DEFAULT_FILTERS: Readonly<FilterState> = Object.freeze({
  q: '',
  kind: 'all',
  ranges: [],
  genres: [],
  subGenres: [],
  show: '',
  maxSeconds: null,
  minSeconds: null,
  hideMature: false,
  hasAudio: false,
  sort: 'title',
}) as Readonly<FilterState>;

/** Fresh mutable copy of the defaults. */
export function defaultFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    ...DEFAULT_FILTERS,
    ranges: [],
    genres: [],
    subGenres: [],
    ...overrides,
  };
}

export const SORT_OPTIONS: ReadonlyArray<{ value: SongSort; label: string }> = [
  { value: 'title', label: 'Title A–Z' },
  { value: 'show', label: 'Show A–Z' },
  { value: 'length', label: 'Shortest first' },
  { value: '-length', label: 'Longest first' },
  { value: 'newest', label: 'Newest additions' },
];
const SORT_VALUES = new Set<string>(SORT_OPTIONS.map((o) => o.value));

export function isSongSort(value: unknown): value is SongSort {
  return typeof value === 'string' && SORT_VALUES.has(value);
}

/** Max-length slider bounds (seconds). The slider's top position means "any length". */
export const LENGTH_SLIDER = { min: 60, max: 420, step: 15 } as const;

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** Has something playable inline (Apple preview or uploaded audio). */
export function hasPlayableAudio(song: Song): boolean {
  return Boolean(song.media.previewUrl || song.media.audioUrl);
}

/** Any audio at all (preview, upload or external link) — API `hasAudio=1` semantics. */
export function hasAnyAudio(song: Song): boolean {
  return Boolean(song.media.previewUrl || song.media.audioUrl || song.media.audioLink);
}

/** The text fields free-text search looks at (SPEC §5: title, show, characters, genre, subGenre). */
export function searchFields(song: Song): string[] {
  const fields = [song.title, song.show.name];
  for (const p of song.parts) fields.push(p.character);
  if (song.genre) fields.push(song.genre);
  if (song.subGenre) fields.push(song.subGenre);
  return fields;
}

/**
 * Accent/case-insensitive match: the whole query is a substring of any field, OR every token of
 * the query appears somewhere across the fields ("wicked popular" matches Popular from Wicked).
 */
export function songMatchesQuery(song: Song, query: string): boolean {
  const whole = normalizeText(query);
  if (!whole) return true;
  const fields = searchFields(song).map(normalizeText);
  if (fields.some((f) => f.includes(whole))) return true;
  const tokens = tokenize(query);
  if (tokens.length < 2) return false;
  const hay = fields.join(' \u0000 ');
  return tokens.every((t) => hay.includes(t));
}

function includesLooseValue(list: readonly string[], value: string | null | undefined): boolean {
  if (!value) return false;
  return list.some((v) => equalsLoose(v, value));
}

/** Does one song pass every filter in `state` (ignoring sort)? */
export function songMatchesFilters(song: Song, state: FilterState): boolean {
  if (state.kind !== 'all' && song.kind !== state.kind) return false;
  if (state.hideMature && song.mature) return false;
  if (state.hasAudio && !hasAnyAudio(song)) return false;
  if (state.show && song.show.slug !== state.show && String(song.show.id) !== state.show) return false;
  if (state.ranges.length) {
    const wanted = new Set<string>(state.ranges);
    const ok = song.parts.some((p) => {
      const r = normalizeVocalRange(p.vocalRange);
      return r !== null && wanted.has(r);
    });
    if (!ok) return false;
  }
  if (state.genres.length && !includesLooseValue(state.genres, song.genre)) return false;
  if (state.subGenres.length && !includesLooseValue(state.subGenres, song.subGenre)) return false;
  if (state.maxSeconds !== null) {
    if (song.lengthSeconds === null || song.lengthSeconds > state.maxSeconds) return false;
  }
  if (state.minSeconds !== null) {
    if (song.lengthSeconds === null || song.lengthSeconds < state.minSeconds) return false;
  }
  if (state.q && !songMatchesQuery(song, state.q)) return false;
  return true;
}

/**
 * Songs matching every filter EXCEPT `key` — the base for facet counts ("how many results if I
 * also pick this chip?").
 */
export function songsIgnoring(songs: readonly Song[], state: FilterState, key: keyof FilterState): Song[] {
  const relaxed = { ...state, [key]: DEFAULT_FILTERS[key] } as FilterState;
  return songs.filter((s) => songMatchesFilters(s, relaxed));
}

/** Filter + sort (returns a new array; input is not mutated). */
export function applyFilters(songs: readonly Song[], state: FilterState): Song[] {
  return sortSongs(
    songs.filter((s) => songMatchesFilters(s, state)),
    state.sort,
  );
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortColumn = 'title' | 'show' | 'kind' | 'range' | 'genre' | 'length' | 'newest';
export type SortDirection = 'asc' | 'desc';

function byTitle(a: Song, b: Song): number {
  return compareText(a.title, b.title) || compareText(a.show.name, b.show.name) || a.id - b.id;
}

function lengthOf(s: Song, dir: SortDirection): number {
  // unknown lengths always sort last
  if (s.lengthSeconds === null) return dir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return s.lengthSeconds;
}

function firstRange(s: Song): string | null {
  const sorted = s.parts.map((p) => p.vocalRange).sort(compareRanges);
  return sorted[0] ?? null;
}

/**
 * Generic column sort (used by SongTable). `desc` reverses the primary key; ties fall back to
 * title A–Z. Unknown values sort last in both directions.
 */
export function sortSongsBy(songs: readonly Song[], column: SortColumn, direction: SortDirection = 'asc'): Song[] {
  const sign = direction === 'asc' ? 1 : -1;
  const out = [...songs];
  const nullsLast = (a: string | null | undefined, b: string | null | undefined): number => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return sign * compareText(a, b);
  };
  out.sort((a, b) => {
    let primary = 0;
    switch (column) {
      case 'title':
        return sign * byTitle(a, b);
      case 'show':
        primary = sign * compareText(a.show.name, b.show.name);
        break;
      case 'kind':
        primary = sign * compareText(a.kind, b.kind);
        break;
      case 'range': {
        const ra = firstRange(a);
        const rb = firstRange(b);
        if (!ra && !rb) primary = 0;
        else if (!ra) primary = 1;
        else if (!rb) primary = -1;
        else primary = sign * compareRanges(ra, rb);
        break;
      }
      case 'genre':
        primary = nullsLast(a.genre, b.genre) || nullsLast(a.subGenre, b.subGenre);
        break;
      case 'length': {
        const la = lengthOf(a, direction);
        const lb = lengthOf(b, direction);
        primary = la === lb ? 0 : sign * (la < lb ? -1 : 1);
        break;
      }
      case 'newest': {
        // 'asc' for newest = most recent first (the natural reading of "newest")
        const ta = Date.parse(a.createdAt) || 0;
        const tb = Date.parse(b.createdAt) || 0;
        primary = ta === tb ? sign * (b.id - a.id) : sign * (tb - ta);
        break;
      }
    }
    return primary || byTitle(a, b);
  });
  return out;
}

/** Sort by one of the API sort keys (title|show|length|-length|newest). */
export function sortSongs(songs: readonly Song[], sort: SongSort = 'title'): Song[] {
  switch (sort) {
    case 'show':
      return sortSongsBy(songs, 'show', 'asc');
    case 'length':
      return sortSongsBy(songs, 'length', 'asc');
    case '-length':
      return sortSongsBy(songs, 'length', 'desc');
    case 'newest':
      return sortSongsBy(songs, 'newest', 'asc');
    case 'title':
    default:
      return sortSongsBy(songs, 'title', 'asc');
  }
}

// ---------------------------------------------------------------------------
// URL round-trip
// ---------------------------------------------------------------------------

/** Every URL key owned by the filter state (others, e.g. `view`, are preserved untouched). */
export const FILTER_PARAM_KEYS = [
  'q',
  'kind',
  'range',
  'genre',
  'subGenre',
  'show',
  'maxSeconds',
  'minSeconds',
  'hideMature',
  'hasAudio',
  'sort',
] as const;

// Commas separate list values, so escape literal '%' and ',' inside a value.
const escapeListValue = (v: string) => v.replace(/%/g, '%25').replace(/,/g, '%2C');
const unescapeListValue = (v: string) => v.replace(/%2C/gi, ',').replace(/%25/g, '%');

function readList(params: URLSearchParams, key: string): string[] {
  const out: string[] = [];
  for (const raw of params.getAll(key)) {
    for (const piece of raw.split(',')) {
      const v = unescapeListValue(piece).trim();
      if (v && !out.some((o) => equalsLoose(o, v))) out.push(v);
    }
  }
  return out;
}

function readSeconds(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * A max length the Browse slider can show: at/over its top ("any length") → null, under its
 * bottom → the bottom. Keeps the thumb, its label and the filter pill telling the same story for
 * hand-made URLs like ?maxSeconds=1000 or ?maxSeconds=30.
 */
export function clampMaxSeconds(seconds: number | null): number | null {
  if (seconds === null) return null;
  if (seconds >= LENGTH_SLIDER.max) return null;
  return Math.max(LENGTH_SLIDER.min, seconds);
}

function readBool(params: URLSearchParams, key: string): boolean {
  const raw = params.get(key);
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Parse filters from a URL query (unknown/invalid values are ignored, never thrown). */
export function filtersFromSearchParams(input: URLSearchParams | string): FilterState {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;
  const kindRaw = (params.get('kind') ?? '').toLowerCase();
  const ranges: VocalRange[] = [];
  for (const r of readList(params, 'range')) {
    const n = normalizeVocalRange(r);
    if (n && !ranges.includes(n)) ranges.push(n);
  }
  ranges.sort(compareRanges);
  const sortRaw = params.get('sort') ?? '';
  return defaultFilters({
    q: (params.get('q') ?? '').trim().slice(0, 200),
    kind: kindRaw === 'solo' || kindRaw === 'duet' ? kindRaw : 'all',
    ranges,
    genres: readList(params, 'genre'),
    subGenres: readList(params, 'subGenre'),
    show: (params.get('show') ?? '').trim(),
    maxSeconds: clampMaxSeconds(readSeconds(params, 'maxSeconds')),
    minSeconds: readSeconds(params, 'minSeconds'),
    hideMature: readBool(params, 'hideMature'),
    hasAudio: readBool(params, 'hasAudio'),
    sort: isSongSort(sortRaw) ? sortRaw : 'title',
  });
}

/**
 * Serialise filters to URL params, omitting defaults. Keys in `base` that are not filter keys
 * (e.g. `view=table`) are kept.
 */
export function filtersToSearchParams(state: FilterState, base?: URLSearchParams | string): URLSearchParams {
  const params = new URLSearchParams(base ?? '');
  for (const key of FILTER_PARAM_KEYS) params.delete(key);
  const list = (values: readonly string[]) => values.map(escapeListValue).join(',');
  const q = state.q.trim();
  if (q) params.set('q', q);
  if (state.kind !== 'all') params.set('kind', state.kind);
  if (state.ranges.length) params.set('range', list([...state.ranges].sort(compareRanges)));
  if (state.genres.length) params.set('genre', list(state.genres));
  if (state.subGenres.length) params.set('subGenre', list(state.subGenres));
  if (state.show) params.set('show', state.show);
  if (state.maxSeconds !== null) params.set('maxSeconds', String(state.maxSeconds));
  if (state.minSeconds !== null) params.set('minSeconds', String(state.minSeconds));
  if (state.hideMature) params.set('hideMature', '1');
  if (state.hasAudio) params.set('hasAudio', '1');
  if (state.sort !== 'title') params.set('sort', state.sort);
  return params;
}

/** `/songs?…` link for a partial filter state (handy for quick-pick chips). */
export function browseHref(partial: Partial<FilterState> = {}): string {
  const qs = filtersToSearchParams(defaultFilters(partial)).toString();
  return qs ? `/songs?${qs}` : '/songs';
}

// ---------------------------------------------------------------------------
// Toggling helpers & active pills
// ---------------------------------------------------------------------------

/** Add or remove `value` from a list (case/accent-insensitive). */
export function toggleInList<T extends string>(list: readonly T[], value: T): T[] {
  return list.some((v) => equalsLoose(v, value)) ? list.filter((v) => !equalsLoose(v, value)) : [...list, value];
}

/** True when nothing narrows the result set (sort is not a filter). */
export function isUnfiltered(state: FilterState): boolean {
  return countActiveFilters(state) === 0;
}

/** Number of active filter pills (search counts as one). */
export function countActiveFilters(state: FilterState): number {
  return activeFilterPills(state).length;
}

/** Reset every filter but keep the chosen sort. */
export function clearFilters(state: FilterState): FilterState {
  return defaultFilters({ sort: state.sort });
}

export interface FilterPill {
  /** stable key, e.g. 'range:Soprano' */
  id: string;
  group: 'Search' | 'Type' | 'Voice' | 'Genre' | 'Mood' | 'Show' | 'Length' | 'Mature' | 'Audio';
  label: string;
  emoji?: string;
  /** the state with this pill removed */
  next: FilterState;
}

/**
 * One pill per active filter value, in display order. `shows` (e.g. meta.shows) is used to turn a
 * show slug into its name.
 */
export function activeFilterPills(
  state: FilterState,
  shows: ReadonlyArray<{ slug: string; name: string; id?: number }> = [],
): FilterPill[] {
  const pills: FilterPill[] = [];
  const q = state.q.trim();
  if (q) pills.push({ id: 'q', group: 'Search', label: `“${q}”`, emoji: '🔎', next: { ...state, q: '' } });
  if (state.kind !== 'all') {
    pills.push({
      id: `kind:${state.kind}`,
      group: 'Type',
      label: `${KIND_LABEL[state.kind]}s`,
      emoji: KIND_EMOJI[state.kind],
      next: { ...state, kind: 'all' },
    });
  }
  for (const r of state.ranges) {
    pills.push({ id: `range:${r}`, group: 'Voice', label: r, next: { ...state, ranges: state.ranges.filter((x) => x !== r) } });
  }
  for (const g of state.genres) {
    pills.push({
      id: `genre:${g}`,
      group: 'Genre',
      label: g,
      emoji: genreEmoji(g),
      next: { ...state, genres: state.genres.filter((x) => x !== g) },
    });
  }
  for (const s of state.subGenres) {
    pills.push({
      id: `subGenre:${s}`,
      group: 'Mood',
      label: s,
      emoji: subGenreEmoji(s),
      next: { ...state, subGenres: state.subGenres.filter((x) => x !== s) },
    });
  }
  if (state.show) {
    const found = shows.find((s) => s.slug === state.show || String(s.id) === state.show);
    pills.push({ id: 'show', group: 'Show', label: found?.name ?? state.show, emoji: '🎟️', next: { ...state, show: '' } });
  }
  if (state.minSeconds !== null) {
    pills.push({
      id: 'minSeconds',
      group: 'Length',
      label: `At least ${formatLength(state.minSeconds)}`,
      emoji: '⏱️',
      next: { ...state, minSeconds: null },
    });
  }
  if (state.maxSeconds !== null) {
    pills.push({
      id: 'maxSeconds',
      group: 'Length',
      label: `Up to ${formatLength(state.maxSeconds)}`,
      emoji: '⏱️',
      next: { ...state, maxSeconds: null },
    });
  }
  if (state.hideMature) {
    pills.push({ id: 'hideMature', group: 'Mature', label: 'No mature themes', emoji: '🙈', next: { ...state, hideMature: false } });
  }
  if (state.hasAudio) {
    pills.push({ id: 'hasAudio', group: 'Audio', label: 'Has audio', emoji: '🎧', next: { ...state, hasAudio: false } });
  }
  return pills;
}

// ---------------------------------------------------------------------------
// Highlighting
// ---------------------------------------------------------------------------

export type HighlightRange = [start: number, end: number];

/**
 * Character ranges (in the ORIGINAL text, end-exclusive, merged & sorted) to highlight for a
 * search, accent/case-insensitively. If the whole query occurs in the text, only those matches are
 * highlighted ("les mis" on "Les Misérables" → [[0,7]]); otherwise each token is highlighted where
 * it starts a word ("wicked pop" on "Popular from Wicked" → [[0,3],[13,19]]).
 */
export function highlightRanges(text: string, query: string): HighlightRange[] {
  if (!text || !query) return [];
  const { folded, map } = foldWithMap(text);
  const raw: HighlightRange[] = [];
  const collect = (needle: string, wordStartOnly: boolean) => {
    let from = 0;
    for (;;) {
      const idx = folded.indexOf(needle, from);
      if (idx === -1) break;
      const atWordStart = idx === 0 || !/[\p{L}\p{N}]/u.test(folded[idx - 1] ?? '');
      if (!wordStartOnly || atWordStart) {
        const start = map[idx];
        const end = map[idx + needle.length];
        if (start !== undefined && end !== undefined && end > start) raw.push([start, end]);
      }
      from = idx + Math.max(1, needle.length);
    }
  };
  const whole = normalizeText(query);
  if (whole) collect(whole, false);
  if (!raw.length) for (const t of tokenize(query)) collect(t, true);
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: HighlightRange[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Split text into plain / matched segments for rendering with <mark>. */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const ranges = highlightRanges(text, query);
  if (!ranges.length) return text ? [{ text, match: false }] : [];
  const out: HighlightSegment[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) out.push({ text: text.slice(pos, s), match: false });
    out.push({ text: text.slice(s, e), match: true });
    pos = e;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: false });
  return out;
}

// ---------------------------------------------------------------------------
// Facets (for building chip lists from the actual data)
// ---------------------------------------------------------------------------

/** Count songs per vocal range (a duet with two parts of the same range counts once). */
export function rangeCounts(songs: readonly Song[]): Record<VocalRange, number> {
  const out = Object.fromEntries(VOCAL_RANGES.map((r) => [r, 0])) as Record<VocalRange, number>;
  for (const s of songs) {
    const seen = new Set<VocalRange>();
    for (const p of s.parts) {
      const r = normalizeVocalRange(p.vocalRange);
      if (r && !seen.has(r)) {
        seen.add(r);
        out[r] += 1;
      }
    }
  }
  return out;
}

/** Distinct non-empty values of a field with counts, sorted by count desc then A–Z. */
export function facetCounts(songs: readonly Song[], pick: (s: Song) => string | null | undefined): Array<{ value: string; count: number }> {
  const map = new Map<string, { value: string; count: number }>();
  for (const s of songs) {
    const v = pick(s)?.trim();
    if (!v) continue;
    const key = normalizeText(v);
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { value: v, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || compareText(a.value, b.value));
}

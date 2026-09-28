/**
 * Catalog → song form pre-fill (SPEC §7c). Turns GET /api/catalog/songs/:id/suggestions (or a catalog show for
 * "My song isn't listed") into initial form values plus the per-field suggestion chips.
 * Pure functions — unit-tested in __tests__/suggestions.test.ts.
 */
import type { ChipSuggestion } from '../../components/SuggestionChip';
import { guessKind, kindForGuess, kindNoteFor } from '../../lib/catalog';
import { equalsLoose, normalizeText } from '../../lib/normalize';
import { normalizeVocalRange } from '../../lib/vocab';
import type { CatalogShowDetail, CatalogSuggestions, Confidence, Kind, SuggestedPart } from '../../types';
import { EMPTY_NEW_SHOW, OTHER_GENRE, emptyPart, emptyValues, type NewShowDetails, type PartValues, type SongFormValues } from './model';

export interface RangeSuggestion {
  value: string;
  source: string;
  confidence?: Confidence;
  alternatives?: string[];
}

/** Credits of the catalog show a new site show is made from (sent with POST /api/shows). */
export interface CatalogShowLink {
  catalogShowId: number;
  name: string;
  siteShowId: number | null;
  siteShowSlug: string | null;
  composer: string | null;
  lyricist: string | null;
  bookWriter: string | null;
  year: number | null;
  wikiTitle: string | null;
}

export interface FormSuggestions {
  catalogSongId: number;
  show: CatalogShowLink;
  /** The catalog song as listed (banner). `source` 'recording' = from a cast album's track list (Apple), not Wikipedia. */
  song: { title: string; act: number | null; singers: string[]; ensemble: boolean; reprise: boolean; source: 'wikipedia' | 'recording' };
  /** The first site song that already is this catalog song (kept for older callers — prefer `existingAll`). */
  existing: { id: number; title: string; kind: Kind } | null;
  /** Every site song that already is this catalog song (e.g. a solo AND a duet version). */
  existingAll: { id: number; title: string; kind: Kind }[];
  kind: ChipSuggestion<Kind> | null;
  /** Shown when there's no solo/duet guess (group numbers, unknown singers) or with a partial one. */
  kindNote: string | null;
  title: ChipSuggestion<string>;
  showChip: ChipSuggestion<string>;
  /** Suggested character for part 1 and part 2 (null = nothing to suggest). */
  characters: [ChipSuggestion<string> | null, ChipSuggestion<string> | null];
  /** Vocal range per (folded) character name. */
  ranges: Map<string, RangeSuggestion>;
  genre: ChipSuggestion<string> | null;
  subGenre: ChipSuggestion<string> | null;
  mature: ChipSuggestion<boolean> | null;
}

export interface CatalogPrefill {
  values: SongFormValues;
  isNewShow: boolean;
  newShow: NewShowDetails;
  suggestions: FormSuggestions;
}

const uniqueLoose = (names: readonly string[]): string[] => {
  const out: string[] = [];
  for (const raw of names) {
    const n = raw?.trim();
    if (n && !out.some((o) => equalsLoose(o, n))) out.push(n);
  }
  return out;
};

/** Match a genre to the site's list case-insensitively → the form's select value (or "Other…" + text). */
export function genreFields(genre: string, genres: readonly string[]): Pick<SongFormValues, 'genreChoice' | 'genreOther'> {
  const g = genre.trim();
  if (!g) return { genreChoice: '', genreOther: '' };
  const known = genres.find((x) => equalsLoose(x, g));
  return known ? { genreChoice: known, genreOther: '' } : { genreChoice: OTHER_GENRE, genreOther: g };
}

/** New-show details pre-filled from catalog credits. */
export function newShowFromCatalog(show: Pick<CatalogShowLink, 'composer' | 'lyricist' | 'year'>): NewShowDetails {
  return {
    ...EMPTY_NEW_SHOW,
    composer: show.composer?.trim() ?? '',
    lyricist: show.lyricist?.trim() ?? '',
    year: show.year ? String(show.year) : '',
  };
}

/**
 * Drop catalog credits from new-show details once the show name no longer matches the catalog show (text the
 * student typed over the credits is kept).
 */
export function withoutCatalogCredits(ns: NewShowDetails, link: CatalogShowLink): NewShowDetails {
  const fromCatalog = newShowFromCatalog(link);
  return {
    ...ns,
    composer: ns.composer === fromCatalog.composer ? '' : ns.composer,
    lyricist: ns.lyricist === fromCatalog.lyricist ? '' : ns.lyricist,
    year: ns.year === fromCatalog.year ? '' : ns.year,
  };
}

/** Is the form's show still the catalog show? */
export function showMatchesCatalog(link: CatalogShowLink, values: Pick<SongFormValues, 'showId' | 'showText'>, selectedName: string | null): boolean {
  if (link.siteShowId !== null && values.showId === link.siteShowId) return true;
  const name = selectedName ?? values.showText;
  return equalsLoose(name, link.name);
}

function rangeMap(parts: readonly SuggestedPart[], source: string): Map<string, RangeSuggestion> {
  const map = new Map<string, RangeSuggestion>();
  for (const p of parts) {
    const range = normalizeVocalRange(p.vocalRange ?? null);
    const key = normalizeText(p.character);
    if (!range || !key || map.has(key)) continue;
    const alternatives = (p.rangeAlternatives ?? []).map((r) => normalizeVocalRange(r)).filter((r): r is NonNullable<typeof r> => Boolean(r) && r !== range);
    map.set(key, { value: range, source: p.rangeSource?.trim() || source, confidence: p.rangeConfidence, alternatives });
    // the catalog's spelling finds it too ("Valjean" when the site says "Jean Valjean")
    const alias = normalizeText(p.catalogName);
    if (alias && !map.has(alias)) map.set(alias, map.get(key)!);
  }
  return map;
}

export interface PrefillOptions {
  /** The site's genre list (GENRES + meta.genres). */
  genres: readonly string[];
  /** ?kind= from the link, used when the catalog can't tell solo from duet. */
  kind?: Kind | null;
}

export function prefillFromSuggestions(s: CatalogSuggestions, options: PrefillOptions): CatalogPrefill {
  const song = s.catalogSong;
  const siteShow = s.show.siteShow;
  const link: CatalogShowLink = {
    catalogShowId: s.show.catalogShowId,
    name: s.show.name,
    siteShowId: siteShow?.id ?? null,
    siteShowSlug: siteShow?.slug ?? null,
    composer: s.show.composer,
    lyricist: s.show.lyricist,
    bookWriter: s.show.bookWriter,
    year: s.show.year,
    wikiTitle: s.show.wikiTitle,
  };

  // ---- kind
  const guess = guessKind(song);
  const kindValue = s.kind && (s.kind.value === 'solo' || s.kind.value === 'duet') ? s.kind.value : null;
  const kindNote = s.kindNote?.trim() || s.kind?.note?.trim() || kindNoteFor(song);
  const kind: Kind = kindValue ?? options.kind ?? kindForGuess(guess) ?? 'solo';
  const kindChip: ChipSuggestion<Kind> | null =
    kindValue && s.kind
      ? {
          value: kindValue,
          source: s.kind.source,
          confidence: s.kind.confidence,
          note: kindNote,
          // e.g. Solo for a two-singer song whose second singer may only have a line or two
          alternatives: (s.kind.alternatives ?? []).filter((k): k is Kind => (k === 'solo' || k === 'duet') && k !== kindValue),
        }
      : null;

  // ---- parts
  const suggestedParts = Array.isArray(s.parts?.value) ? s.parts.value : [];
  const altParts = (s.parts?.alternatives ?? []).flat();
  // A part in the site's spelling ("Marius") keeps the catalog's in `catalogName` ("Marius Pontmercy"); the song
  // list's singers use the catalog spelling, so drop those — they're the same person, and offering both would make
  // a second spelling of the character on the site.
  const catalogSpellings = [...suggestedParts, ...altParts].map((p) => p.catalogName?.trim()).filter((n): n is string => Boolean(n));
  const singers = song.singers.filter((n) => !catalogSpellings.some((c) => equalsLoose(c, n)));
  const ordered = uniqueLoose([...suggestedParts.map((p) => p.character), ...altParts.map((p) => p.character), ...singers]);
  const ranges = rangeMap([...suggestedParts, ...altParts], s.parts?.source ?? 'from the catalog');
  const partsSource = s.parts?.source ?? 'from the Wikipedia song list';
  const characterChip = (i: number): ChipSuggestion<string> | null => {
    const name = ordered[i];
    if (!name) return null;
    const listed = suggestedParts.some((p) => equalsLoose(p.character, name));
    return {
      value: name,
      source: listed ? partsSource : 'from the song list',
      confidence: listed ? s.parts.confidence : 'low',
      note: i === 0 ? (s.parts?.note ?? null) : null,
      alternatives: ordered.filter((n) => !equalsLoose(n, name)),
    };
  };
  const characters: FormSuggestions['characters'] = [characterChip(0), characterChip(1)];
  const partFor = (i: number): PartValues => {
    const name = ordered[i];
    if (!name) return emptyPart();
    return { character: name, vocalRange: ranges.get(normalizeText(name))?.value ?? '' };
  };

  // ---- values
  const base = emptyValues(kind);
  const title = s.title?.value?.trim() || song.title;
  const genre = s.genre?.value?.trim() ?? '';
  const values: SongFormValues = {
    ...base,
    title,
    showId: siteShow?.id ?? null,
    showText: siteShow?.name ?? s.show.name,
    ...genreFields(genre, options.genres),
    subGenre: s.subGenre?.value?.trim() ?? '',
    mature: s.mature?.value ?? false,
    parts: kind === 'duet' ? [partFor(0), partFor(1)] : [partFor(0)],
  };

  const suggestions: FormSuggestions = {
    catalogSongId: song.id,
    show: link,
    song: { title: song.title, act: song.act, singers: song.singers, ensemble: song.ensemble, reprise: song.reprise, source: song.source === 'recording' ? 'recording' : 'wikipedia' },
    existing: s.existingSong ?? s.existingSongs?.[0] ?? null,
    existingAll: existingSongsOf(s),
    kind: kindChip,
    kindNote,
    title: { value: title, source: s.title?.source ?? 'from the Wikipedia song list', confidence: s.title?.confidence ?? 'high', alternatives: s.title?.alternatives ?? [] },
    showChip: {
      value: siteShow?.name ?? s.show.name,
      source: siteShow ? 'from the show catalog — already on the site' : 'from the show catalog',
      confidence: 'high',
    },
    characters,
    ranges,
    genre: s.genre && genre ? { value: genre, source: s.genre.source, confidence: s.genre.confidence, note: s.genre.note, alternatives: s.genre.alternatives ?? [] } : null,
    subGenre:
      s.subGenre && s.subGenre.value?.trim()
        ? { value: s.subGenre.value.trim(), source: s.subGenre.source, confidence: s.subGenre.confidence, note: s.subGenre.note, alternatives: s.subGenre.alternatives ?? [] }
        : null,
    mature: s.mature ? { value: Boolean(s.mature.value), source: s.mature.source, confidence: s.mature.confidence, note: s.mature.note } : null,
  };

  return {
    values,
    isNewShow: siteShow === null,
    newShow: siteShow === null ? newShowFromCatalog(link) : EMPTY_NEW_SHOW,
    suggestions,
  };
}

/** Every site version of the catalog song (`existingSongs`; older answers only send `existingSong`), no repeats. */
function existingSongsOf(s: CatalogSuggestions): { id: number; title: string; kind: Kind }[] {
  const all = [...(Array.isArray(s.existingSongs) ? s.existingSongs : []), ...(s.existingSong ? [s.existingSong] : [])];
  return all.filter((e, i) => e && all.findIndex((x) => x.id === e.id) === i);
}

/** "My song isn't listed" on a catalog show that isn't on the site yet: the show typed in, credits filled. */
export function prefillFromCatalogShow(show: CatalogShowDetail, kind: Kind | null): { values: SongFormValues; isNewShow: boolean; newShow: NewShowDetails; link: CatalogShowLink } {
  const link: CatalogShowLink = {
    catalogShowId: show.id,
    name: show.title,
    siteShowId: show.onSite?.showId ?? null,
    siteShowSlug: show.onSite?.slug ?? null,
    composer: show.composer,
    lyricist: show.lyricist,
    bookWriter: show.bookWriter,
    year: show.year,
    wikiTitle: show.wikiTitle,
  };
  const values = { ...emptyValues(kind ?? 'solo'), showId: link.siteShowId, showText: show.title };
  return { values, isNewShow: link.siteShowId === null, newShow: link.siteShowId === null ? newShowFromCatalog(link) : EMPTY_NEW_SHOW, link };
}

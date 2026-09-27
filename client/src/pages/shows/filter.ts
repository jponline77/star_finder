/** Poster-wall search + sort (ShowsPage). Pure helpers, unit-tested. */
import { compareText, fold, stripLeadingArticle, tokenize } from '../../lib/normalize';
import type { Show } from '../../types';

export type ShowSort = 'az' | 'songs' | 'year' | 'added';

export const SHOW_SORTS: ReadonlyArray<{ value: ShowSort; label: string }> = [
  { value: 'az', label: 'A–Z' },
  { value: 'songs', label: 'Most songs' },
  { value: 'year', label: 'Newest musicals' },
  { value: 'added', label: 'Recently added' },
];

export const isShowSort = (v: string | null): v is ShowSort => SHOW_SORTS.some((s) => s.value === v);

const addedAt = (s: Show) => (s as Show & { createdAt?: string }).createdAt ?? '';

const byName = (a: Show, b: Show) => compareText(stripLeadingArticle(a.name), stripLeadingArticle(b.name));

/** Filter (every search word must appear somewhere) + sort. Pure — exported for tests. */
export function filterAndSortShows(shows: readonly Show[], q: string, sort: ShowSort): Show[] {
  const tokens = tokenize(q);
  const list = tokens.length
    ? shows.filter((s) => {
        const hay = fold([s.name, s.composer, s.lyricist, s.bookWriter, s.licensor, s.year ? String(s.year) : ''].filter(Boolean).join(' · '));
        return tokens.every((t) => hay.includes(t));
      })
    : [...shows];
  switch (sort) {
    case 'songs':
      return list.sort((a, b) => b.songCount - a.songCount || byName(a, b));
    case 'year':
      return list.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity) || byName(a, b));
    case 'added':
      // The server also sends createdAt (not in the SPEC type); newer ids break ties.
      return list.sort((a, b) => addedAt(b).localeCompare(addedAt(a)) || b.id - a.id);
    default:
      return list.sort(byName);
  }
}

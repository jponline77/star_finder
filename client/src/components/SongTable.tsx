import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { Song } from '../types';
import { sortSongsBy, type SortColumn, type SortDirection } from '../lib/filters';
import { songPath, showPath } from '../lib/links';
import { KIND_EMOJI, KIND_LABEL } from '../lib/vocab';
import { Highlight } from './Highlight';
import { LengthBadge } from './LengthBadge';
import { MatureBadge } from './MatureBadge';
import { PlayButton } from './PlayButton';
import { RangeBadge } from './RangeBadge';
import { SetlistHeart } from './SetlistHeart';
import { genreEmoji, subGenreEmoji } from '../lib/vocab';

export interface TableSort {
  column: SortColumn;
  direction: SortDirection;
}

export interface SongTableProps {
  songs: readonly Song[];
  query?: string;
  /** Controlled sort; omit to let the table sort itself (starts unsorted = input order). */
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort) => void;
  caption?: string;
  className?: string;
}

const COLUMNS: Array<{ id: SortColumn; label: string; className?: string }> = [
  { id: 'title', label: 'Song' },
  { id: 'show', label: 'Show' },
  { id: 'kind', label: 'Type' },
  { id: 'range', label: 'Voice' },
  { id: 'genre', label: 'Genre · Mood' },
  { id: 'length', label: 'Length' },
];

/** Sortable song table (click headers; aria-sort on the active column). Rows: data-testid="song-row". */
export function SongTable({ songs, query, sort: controlled, onSortChange, caption = 'Songs', className = '' }: SongTableProps) {
  const [internal, setInternal] = useState<TableSort | null>(null);
  const sort = controlled !== undefined ? controlled : internal;
  const rows = useMemo(() => (sort ? sortSongsBy(songs, sort.column, sort.direction) : [...songs]), [songs, sort]);

  const onHeader = (column: SortColumn) => {
    const next: TableSort = sort && sort.column === column ? { column, direction: sort.direction === 'asc' ? 'desc' : 'asc' } : { column, direction: 'asc' };
    if (onSortChange) onSortChange(next);
    if (controlled === undefined) setInternal(next);
  };

  return (
    <div className={`table-wrap ${className}`.trim()}>
      <table className="table song-table" data-testid="song-table">
        <caption className="visually-hidden">{caption} — click a column heading to sort</caption>
        <thead>
          <tr>
            <th scope="col" className="col-play">
              <span className="visually-hidden">Preview</span>
            </th>
            {COLUMNS.map((c) => {
              const active = sort?.column === c.id;
              const ariaSort = active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : 'none';
              const Icon = active ? (sort?.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th key={c.id} scope="col" aria-sort={ariaSort}>
                  <button type="button" className="sort-button" onClick={() => onHeader(c.id)} data-testid={`sort-${c.id}`}>
                    {c.label}
                    <Icon size={13} aria-hidden="true" />
                  </button>
                </th>
              );
            })}
            <th scope="col">
              <span className="visually-hidden">Mature</span>
            </th>
            <th scope="col" className="num" title="Comments">
              💬<span className="visually-hidden">Comments</span>
            </th>
            <th scope="col" className="col-heart">
              <span className="visually-hidden">Setlist</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} data-testid="song-row" data-song-id={s.id}>
              <td className="col-play">
                <PlayButton song={s} size="sm" showUnavailable />
              </td>
              <td className="col-title">
                <Link to={songPath(s.id)} data-testid="song-title">
                  <Highlight text={s.title} query={query} />
                </Link>
                <span className="table-chars">
                  <Highlight text={s.parts.map((p) => p.character).join(' & ')} query={query} />
                </span>
              </td>
              <td className="col-show">
                <Link to={showPath(s.show.slug)}>
                  <Highlight text={s.show.name} query={query} />
                </Link>
              </td>
              <td className="nowrap">
                <span aria-hidden="true">{KIND_EMOJI[s.kind]} </span>
                {KIND_LABEL[s.kind]}
              </td>
              <td>
                <span className="ranges">
                  {s.parts.map((p) => (
                    <RangeBadge key={p.position} range={p.vocalRange} />
                  ))}
                </span>
              </td>
              <td>
                {s.genre ? (
                  <span className="nowrap">
                    <span aria-hidden="true">{genreEmoji(s.genre)} </span>
                    {s.genre}
                  </span>
                ) : (
                  <span className="subtle">—</span>
                )}
                {s.subGenre && (
                  <span className="table-chars">
                    <span aria-hidden="true">{subGenreEmoji(s.subGenre)} </span>
                    {s.subGenre}
                  </span>
                )}
              </td>
              <td>
                <LengthBadge seconds={s.lengthSeconds} showText="never" />
              </td>
              <td>
                <MatureBadge mature={s.mature} variant="compact" />
              </td>
              <td className="num">{s.commentCount}</td>
              <td className="col-heart">
                <SetlistHeart songId={s.id} songTitle={s.title} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

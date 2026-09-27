/**
 * Shows "/shows" (SPEC §7.4): the lobby poster wall. Accent-insensitive search (name, credits,
 * licensor, year), sort (A–Z, most songs, newest musicals, recently added), counts, a Community
 * badge on community shows, and a friendly empty state. Search + sort live in the URL
 * (?q=…&sort=…) so the view is shareable.
 *
 * data-testids: search-input, show-sort, show-count, show-card, show-card-title, empty-state,
 * add-show-cta.
 */
import { MessageCircle, Plus } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ShowPoster } from '../components/ArtworkTile';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Highlight } from '../components/Highlight';
import { SearchBox } from '../components/SearchBox';
import { Skeleton } from '../components/Skeletons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { plural } from '../lib/format';
import { showPath } from '../lib/links';
import { useShows } from '../state/SongsProvider';
import type { Show } from '../types';
import { filterAndSortShows, isShowSort, SHOW_SORTS, type ShowSort } from './shows/filter';
import './ShowsPage.css';

export default function ShowsPage() {
  useDocumentTitle('Shows');
  const { shows, loading, error, reload } = useShows();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const sortParam = params.get('sort');
  const sort: ShowSort = isShowSort(sortParam) ? sortParam : 'az';

  const setParam = (key: 'q' | 'sort', value: string, fallback = '') => {
    const next = new URLSearchParams(params);
    if (value && value !== fallback) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const results = useMemo(() => filterAndSortShows(shows, q, sort), [shows, q, sort]);
  const totalSongs = shows.reduce((n, s) => n + s.songCount, 0);
  const community = shows.filter((s) => s.source === 'community').length;
  const firstLoad = loading && shows.length === 0;

  return (
    <div className="container shows-page">
      <header className="shows-hero">
        <div className="shows-hero-text">
          <p className="eyebrow">The lobby</p>
          <h1 className="page-title">Show poster wall</h1>
          <p className="page-subtitle">Every musical on the STAR list — tap a poster for the story, the cast of characters and every solo &amp; duet.</p>
        </div>
        {!firstLoad && !error && (
          <dl className="shows-stats" aria-label="Poster wall totals">
            <div>
              <dt>Shows</dt>
              <dd>{shows.length}</dd>
            </div>
            <div>
              <dt>Songs</dt>
              <dd>{totalSongs}</dd>
            </div>
            {community > 0 && (
              <div>
                <dt>Community</dt>
                <dd>{community}</dd>
              </div>
            )}
          </dl>
        )}
      </header>

      <div className="shows-toolbar" role="search" aria-label="Search shows">
        <div className="shows-search">
          <SearchBox value={q} onChange={(v) => setParam('q', v)} placeholder="Search shows, composers, years…" label="Search shows" />
        </div>
        <label className="shows-sort">
          <span className="shows-sort-label">Sort</span>
          <select className="select" value={sort} onChange={(e) => setParam('sort', e.target.value, 'az')} data-testid="show-sort">
            {SHOW_SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && shows.length === 0 ? (
        <ErrorState onRetry={() => void reload().catch(() => undefined)} />
      ) : firstLoad ? (
        <div role="status" aria-live="polite">
          <span className="visually-hidden">Loading shows…</span>
          <ul className="poster-wall" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <li key={i} className="poster-card is-skeleton">
                <Skeleton height="auto" style={{ aspectRatio: '2 / 3', display: 'block' }} radius={10} />
                <Skeleton height={16} width="80%" />
                <Skeleton height={12} width="55%" />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <p className="shows-count" role="status" aria-live="polite" data-testid="show-count" data-count={results.length}>
            {q.trim() ? `${results.length} of ${plural(shows.length, 'show')} match “${q.trim()}”` : `All ${plural(shows.length, 'show')}`}
          </p>
          {results.length === 0 ? (
            <EmptyState
              emoji="🎭"
              title={`No shows match “${q.trim()}”`}
              actions={
                <>
                  <button type="button" className="btn btn-primary" onClick={() => setParam('q', '')}>
                    Clear search
                  </button>
                  <Link to="/add" className="btn btn-ghost">
                    <Plus size={18} aria-hidden="true" /> Add a song from it
                  </Link>
                </>
              }
            >
              <p>Check the spelling (accents don’t matter) — or if it’s missing, add a song from it and the show joins the wall.</p>
            </EmptyState>
          ) : (
            <ul className="poster-wall" role="list">
              {results.map((show, i) => (
                <li key={show.id}>
                  <ShowCard show={show} query={q} index={i} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <aside className="shows-cta" data-testid="add-show-cta">
        <span className="shows-cta-emoji emoji" aria-hidden="true">
          🎟️
        </span>
        <div className="shows-cta-text">
          <h2 className="shows-cta-title">Can’t find a show?</h2>
          <p className="muted">Add a song from it — new shows get their own poster on the wall.</p>
        </div>
        <Link to="/add" className="btn btn-primary">
          <Plus size={18} aria-hidden="true" /> Add a song from it
        </Link>
      </aside>
    </div>
  );
}

function ShowCard({ show, query, index }: { show: Show; query: string; index: number }) {
  const community = show.source === 'community';
  const credit = show.composer?.trim();
  const style = { '--i': Math.min(index, 12) } as CSSProperties;
  return (
    <article className={`poster-card${community ? ' is-community' : ''}`} data-testid="show-card" data-show-slug={show.slug} style={style}>
      <div className="poster-frame">
        <ShowPoster show={show} alt="" eager={index < 4} />
        {community && <span className="poster-badge">Community</span>}
        {show.year && <span className="poster-year">{show.year}</span>}
      </div>
      <div className="poster-plaque">
        <h2 className="poster-title">
          <Link to={showPath(show.slug)} className="stretched-link" data-testid="show-card-title">
            <Highlight text={show.name} query={query} />
          </Link>
        </h2>
        {credit && (
          <p className="poster-credit" title={credit}>
            <Highlight text={credit} query={query} />
          </p>
        )}
        <ul className="poster-counts" aria-label="Songs">
          <li>
            <span className="emoji" aria-hidden="true">
              🎤
            </span>
            {plural(show.soloCount, 'solo')}
          </li>
          <li>
            <span className="emoji" aria-hidden="true">
              👯
            </span>
            {plural(show.duetCount, 'duet')}
          </li>
          {show.commentCount > 0 && (
            <li>
              <MessageCircle size={12} aria-hidden="true" />
              {show.commentCount}
              <span className="visually-hidden"> {show.commentCount === 1 ? 'comment' : 'comments'}</span>
            </li>
          )}
        </ul>
      </div>
    </article>
  );
}

/**
 * Browse "/songs" (SPEC §7.2): instant client-side filtering of the full list, filters synced to
 * the URL (shareable + back-button friendly), grid ↔ table, drawer filters on mobile, search
 * highlighting, result count and a fun empty state.
 *
 * data-testids: search-input, result-count, filter-kind-*, filter-range-<Range>, …(FilterPanel),
 * sort-select, view-grid, view-table, open-filters, clear-filters, song-card, song-row.
 */
import { LayoutGrid, Plus, SlidersHorizontal, Table2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ActiveFilterPills } from '../components/ActiveFilterPills';
import { SegmentedControl } from '../components/Controls';
import { Drawer } from '../components/Drawer';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { FilterPanel, KindSegmented, type FilterChangeOptions } from '../components/FilterPanel';
import { SearchBox } from '../components/SearchBox';
import { SongGridSkeleton } from '../components/Skeletons';
import { SongCard } from '../components/SongCard';
import { SongTable, type TableSort } from '../components/SongTable';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { currentSearch, useUrlFilters } from '../hooks/useUrlFilters';
import { errorMessage } from '../api';
import { applyFilters, clearFilters, countActiveFilters, isSongSort, SORT_OPTIONS, type FilterState } from '../lib/filters';
import { plural } from '../lib/format';
import { useSongs } from '../state/SongsProvider';
import './BrowsePage.css';

type View = 'grid' | 'table';

export default function BrowsePage() {
  useDocumentTitle('Browse songs');
  const { songs, meta, loading, error, reload } = useSongs();
  const [params, setParams] = useSearchParams();
  const isDesktop = useIsDesktop();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tableSort, setTableSort] = useState<TableSort | null>(null);

  const { filters, setFilters } = useUrlFilters();
  const view: View = params.get('view') === 'table' ? 'table' : 'grid';

  const setView = (v: View) => {
    const p = currentSearch();
    if (v === 'table') p.set('view', 'table');
    else p.delete('view');
    setParams(p, { replace: true, preventScrollReset: true });
  };

  const results = useMemo(() => applyFilters(songs, filters), [songs, filters]);
  const activeCount = countActiveFilters(filters);
  const panelFilterCount = countActiveFilters({ ...filters, q: '', kind: 'all' });

  useEffect(() => setTableSort(null), [filters.sort]);
  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);

  const onFiltersChange = (next: FilterState, options?: FilterChangeOptions) => setFilters(next, { replace: options?.replace });

  const total = songs.length;
  const countText = activeCount === 0 ? `All ${plural(total, 'song')}` : `${results.length} of ${plural(total, 'song')}`;

  const panel = <FilterPanel filters={filters} onChange={onFiltersChange} meta={meta} songs={songs} />;

  return (
    <div className="container browse">
      <header className="page-header browse-header">
        <div>
          <p className="eyebrow">The full songbook</p>
          <h1 className="page-title">Browse songs</h1>
          <p className="page-subtitle">Every solo &amp; duet on the list — filter by voice, mood and length, then press ▶ to listen.</p>
        </div>
        <Link to="/add" className="btn btn-ghost browse-header-add">
          <Plus size={18} aria-hidden="true" /> Add a song
        </Link>
      </header>

      <div className="browse-layout">
        {isDesktop && (
          <aside className="browse-sidebar" aria-label="Filters">
            <div className="browse-sidebar-inner panel">
              <h2 className="visually-hidden">Filters</h2>
              {panel}
            </div>
          </aside>
        )}

        <section className="browse-main" aria-labelledby="browse-results-title">
          {/* keeps the outline h1 → h2 → h3 (song cards) even when the Filters sidebar isn't shown */}
          <h2 id="browse-results-title" className="visually-hidden">
            Results
          </h2>
          <div className="browse-toolbar">
            <div className="browse-search">
              <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q }, { debounce: true })} />
            </div>
            <div className="browse-controls">
              <KindSegmented value={filters.kind} onChange={(kind) => onFiltersChange({ ...filters, kind })} />
              {!isDesktop && (
                <button type="button" className="btn btn-ghost browse-filter-button" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog" data-testid="open-filters">
                  <SlidersHorizontal size={18} aria-hidden="true" />
                  Filters
                  {panelFilterCount > 0 && <span className="count-badge">{panelFilterCount}</span>}
                </button>
              )}
              <label className="browse-sort">
                <span className="visually-hidden">Sort by</span>
                <select
                  className="select"
                  value={filters.sort}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (isSongSort(v)) onFiltersChange({ ...filters, sort: v });
                  }}
                  data-testid="sort-select"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <SegmentedControl<View>
                className="browse-view"
                label="View as"
                value={view}
                onChange={setView}
                options={[
                  { value: 'grid', label: <LayoutGrid size={18} aria-hidden="true" />, ariaLabel: 'Grid view', testId: 'view-grid' },
                  { value: 'table', label: <Table2 size={18} aria-hidden="true" />, ariaLabel: 'Table view', testId: 'view-table' },
                ]}
              />
            </div>
          </div>

          <div className="browse-status">
            <p className="result-count" data-testid="result-count" data-count={results.length} aria-live="polite" aria-atomic="true">
              {loading && !total ? 'Loading songs…' : countText}
            </p>
            <ActiveFilterPills filters={filters} onChange={(next) => setFilters(next)} shows={meta?.shows ?? []} />
          </div>

          {loading && !total ? (
            <SongGridSkeleton count={9} />
          ) : error && !total ? (
            <ErrorState title="The songbook is stuck in the wings" message={errorMessage(error)} onRetry={() => void reload()} />
          ) : results.length === 0 ? (
            <EmptyState
              emoji="🔦"
              title="No songs in the spotlight"
              actions={
                <>
                  {activeCount > 0 && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setFilters(clearFilters(filters))}
                    >
                      Clear all filters
                    </button>
                  )}
                  <Link to="/add" className="btn btn-ghost">
                    <Plus size={18} aria-hidden="true" /> Add the song yourself
                  </Link>
                </>
              }
            >
              <p>
                {filters.q.trim() ? (
                  <>
                    Nothing matches “<strong>{filters.q.trim()}</strong>”{activeCount > 1 ? ' with those filters' : ''}.
                  </>
                ) : (
                  <>Nothing matches that combination.</>
                )}{' '}
                Even understudies need a break — try loosening a filter or two, or check your spelling.
              </p>
            </EmptyState>
          ) : view === 'table' ? (
            <SongTable songs={results} query={filters.q} sort={tableSort} onSortChange={setTableSort} caption="Songs matching your filters" />
          ) : (
            <div className="song-grid browse-grid">
              {results.map((s) => (
                <SongCard key={s.id} song={s} query={filters.q} />
              ))}
            </div>
          )}
        </section>
      </div>

      {!isDesktop && (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Filters"
          testId="filter-drawer"
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onFiltersChange({ ...clearFilters(filters), kind: filters.kind, q: filters.q })}
                disabled={panelFilterCount === 0}
              >
                Reset
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setDrawerOpen(false)} data-testid="apply-filters">
                Show {plural(results.length, 'song')}
              </button>
              {/* The page's own result count is inert behind the modal drawer — announce it here. */}
              <p className="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="drawer-result-count">
                {countText}
              </p>
            </>
          }
        >
          {panel}
        </Drawer>
      )}
    </div>
  );
}

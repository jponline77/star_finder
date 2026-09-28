/**
 * "Song catalog" field of the Edit show modal (SPEC §7c): which catalog show this site show is. The link decides the
 * song list "Find your song" offers for the show and where suggestions come from. Normally it's matched by name
 * automatically; here it can be pointed at another catalog show (admins: any; owners: one with the same name — the
 * server checks), set to "not in the catalog" (never linked automatically), or put back to automatic.
 * Sends PUT /api/shows/:id `catalogShowId`: an id, null or 'auto' (nothing when left as it is).
 *
 * data-testids: catalog-link, catalog-link-current, catalog-link-<mode>, catalog-link-search, catalog-link-hit.
 */
import { Check, Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { searchCatalog } from '../../api';
import { useCatalogShow } from '../../hooks/useCatalog';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { titleWithYear } from '../../lib/catalog';
import type { CatalogShowHit } from '../../types';

export type CatalogLinkChoice = { mode: 'keep' } | { mode: 'auto' } | { mode: 'none' } | { mode: 'pick'; id: number; label: string };

/** The PUT body value for a choice (undefined = don't send). */
export function catalogLinkBody(choice: CatalogLinkChoice): number | null | 'auto' | undefined {
  switch (choice.mode) {
    case 'auto':
      return 'auto';
    case 'none':
      return null;
    case 'pick':
      return choice.id;
    default:
      return undefined;
  }
}

export interface CatalogLinkFieldProps {
  /** The show's current catalog link (null = not linked). */
  catalogShowId: number | null;
  value: CatalogLinkChoice;
  onChange: (choice: CatalogLinkChoice) => void;
  error?: string;
}

export function CatalogLinkField({ catalogShowId, value, onChange, error }: CatalogLinkFieldProps) {
  const id = useId();
  const current = useCatalogShow(catalogShowId);
  const [q, setQ] = useState('');
  const debounced = useDebouncedValue(q.trim(), 250);
  const [hits, setHits] = useState<CatalogShowHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (value.mode !== 'pick' || debounced.length < 2) {
      setHits(null);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    searchCatalog(debounced, { limit: 30 }, ctrl.signal)
      .then((r) => setHits(r.results.filter((h): h is CatalogShowHit => h.type === 'show').slice(0, 6)))
      .catch(() => {
        if (!ctrl.signal.aborted) setHits([]);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setSearching(false);
      });
    return () => ctrl.abort();
  }, [debounced, value.mode]);

  const currentText =
    catalogShowId === null
      ? 'Not linked to the catalog.'
      : current.data
        ? `Linked to ${titleWithYear(current.data.title, current.data.year)}${current.data.songCount ? ` · ${current.data.songCount} songs` : ''}.`
        : current.error
          ? `Linked to catalog show #${catalogShowId}.`
          : 'Linked to…';

  const radio = (mode: CatalogLinkChoice['mode'], label: string, hint?: string) => (
    <label className="catalog-link-option">
      <input
        type="radio"
        name={`${id}-mode`}
        checked={value.mode === mode}
        onChange={() => onChange(mode === 'pick' ? { mode: 'pick', id: 0, label: '' } : ({ mode } as CatalogLinkChoice))}
        data-testid={`catalog-link-${mode}`}
      />
      <span>
        {label}
        {hint && <span className="tiny muted catalog-link-hint">{hint}</span>}
      </span>
    </label>
  );

  return (
    <fieldset className="catalog-link" data-testid="catalog-link" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="label">Song catalog</legend>
      <p className="tiny muted" data-testid="catalog-link-current">
        {currentText} The catalog link decides which song list “Find your song” offers for this show.
      </p>
      <div className="catalog-link-options" role="radiogroup" aria-label="Song catalog link">
        {radio('keep', 'Keep as it is')}
        {radio('auto', 'Match it by name automatically')}
        {radio('none', 'It isn’t in the catalog', 'Never linked automatically — e.g. a different show with the same name')}
        {radio('pick', 'Link it to another catalog show…')}
      </div>
      {value.mode === 'pick' && (
        <div className="catalog-link-pick">
          <label className="catalog-link-search">
            <Search size={16} aria-hidden="true" />
            <span className="visually-hidden">Search the catalog for a show</span>
            <input type="search" className="input" placeholder="Search the catalog for a show…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="catalog-link-search" />
          </label>
          <p className="visually-hidden" role="status" aria-live="polite">
            {searching ? 'Searching…' : hits ? `${hits.length} shows found` : ''}
          </p>
          {hits && hits.length === 0 && !searching && <p className="tiny muted">No catalog show matches “{debounced}”.</p>}
          {hits && hits.length > 0 && (
            <ul className="catalog-link-hits" role="list">
              {hits.map((h) => {
                const label = titleWithYear(h.title, h.year);
                const picked = value.id === h.id;
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      className={`btn btn-sm ${picked ? 'btn-primary' : 'btn-ghost'} catalog-link-hit`}
                      aria-pressed={picked}
                      onClick={() => onChange({ mode: 'pick', id: h.id, label })}
                      data-testid="catalog-link-hit"
                    >
                      {picked && <Check size={15} aria-hidden="true" />}
                      <span className="catalog-link-hit-text">
                        <span>{label}</span>
                        <span className="tiny muted">{[h.composer, `${h.songCount} songs`].filter(Boolean).join(' · ')}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {value.id > 0 && <p className="tiny">Will link to {value.label}.</p>}
        </div>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * "/add" step 1 — Find your song (SPEC §7c). A big catalog typeahead (debounced, abortable, keyboard friendly,
 * ARIA combobox + listbox) over songs AND shows. Song → /add?catalogSong=<id> (the form, pre-filled); show →
 * /add?catalogShow=<id> (that show's song list). "Can't find it? Enter it manually" is always there.
 * The query lives in the URL (?q=, replaced as you type) so Back returns to the same results.
 *
 * Enter picks the highlighted row, else the top match — pressed before the results arrive, it waits for them.
 * Songs already on the site carry an "Already in the songbook" badge; their links sit below the listbox (an option
 * can't hold a link for assistive tech).
 *
 * data-testids: find-song, catalog-search, catalog-listbox, catalog-option (+ data-type="song|show"),
 * catalog-status, catalog-onsite (badge), catalog-onsite-links, catalog-onsite-link, catalog-example, enter-manually,
 * catalog-credit.
 */
import { ArrowLeft, ArrowRight, ChevronRight, LoaderCircle, PencilLine, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArtworkTile } from '../../components/ArtworkTile';
import { CatalogCredit } from '../../components/CatalogCredit';
import { Highlight } from '../../components/Highlight';
import { normalizeCatalogQuery, useCatalogSearch, useCatalogStatus } from '../../hooks/useCatalog';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { KIND_GUESS, addHref, formatSingers, guessKind } from '../../lib/catalog';
import { plural } from '../../lib/format';
import { songPath } from '../../lib/links';
import { useSongs } from '../../state/SongsProvider';
import type { CatalogHit, Kind } from '../../types';

const EXAMPLES = ['Defying Gravity', 'Hadestown', 'On My Own', 'Waving Through a Window', 'Shrek'];

export interface FindSongStepProps {
  initialQuery: string;
  kind: Kind | null;
}

export function FindSongStep({ initialQuery, kind }: FindSongStepProps) {
  useDocumentTitle('Add a song — find it');
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const [text, setText] = useState(initialQuery);
  const [active, setActive] = useState(-1);
  /** Enter pressed before the results for this query arrived (a phone's Search key right after typing). */
  const [pendingEnter, setPendingEnter] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const statusId = useId();
  const hintId = useId();
  const search = useCatalogSearch(text);
  // A server without the catalog file answers every search with no results — say so instead (SPEC §7c empty state).
  const catalogStatus = useCatalogStatus();
  const notLoaded = catalogStatus.data?.available === false;
  // Posters of shows already on the site (catalog hits only know the site show's id).
  const { songs } = useSongs();
  const posters = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of songs) if (s.show.imageUrl && !map.has(s.show.id)) map.set(s.show.id, s.show.imageUrl);
    return map;
  }, [songs]);
  // Jump straight into the box with a mouse/trackpad; on phones don't pop the keyboard over the page.
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');
  const q = text.trim();
  const tooShort = [...q].length < 2;
  const results = tooShort ? [] : search.results;
  const open = results.length > 0;

  // Keep ?q= in step with the box (replace, so typing doesn't flood the history).
  const debounced = useDebouncedValue(q, 400);
  // Set once the student picks a result or follows a link: a ?q= sync that lands between that navigation starting
  // and this step unmounting would replace it (Enter ~400 ms after typing used to bounce back to the search).
  const leaving = useRef(false);
  useEffect(() => {
    if (leaving.current) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debounced) next.set('q', debounced);
        else next.delete('q');
        return next.toString() === prev.toString() ? prev : next;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [debounced, setParams]);

  // New results → no highlighted row until the student uses the arrows (Enter still takes the first).
  useEffect(() => {
    setActive(-1);
  }, [search.query]);

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const hrefFor = (hit: CatalogHit) =>
    hit.type === 'song' ? addHref({ catalogSong: hit.id, q, kind }) : addHref({ catalogShow: hit.id, q, kind });

  const choose = (hit: CatalogHit) => {
    setPendingEnter(null);
    leaving.current = true;
    // Remember the query on this history entry before moving on (Back comes here).
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (q) next.set('q', q);
      return next;
    }, { replace: true });
    navigate(hrefFor(hit));
  };

  // A pending Enter takes the top match as soon as this query's results are in (nothing to take → just stop waiting).
  const chooseRef = useRef(choose);
  useEffect(() => {
    chooseRef.current = choose;
  });
  useEffect(() => {
    if (pendingEnter === null) return;
    if (pendingEnter !== normalizeCatalogQuery(text)) {
      setPendingEnter(null);
      return;
    }
    if (search.status === 'error') setPendingEnter(null);
    else if (search.current) {
      const first = search.results[0];
      if (first) chooseRef.current(first);
      else setPendingEnter(null);
    }
  }, [pendingEnter, text, search.current, search.status, search.results]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        if (!open) return;
        e.preventDefault();
        setActive((i) => (i + 1) % results.length);
        break;
      case 'ArrowUp':
        if (!open) return;
        e.preventDefault();
        setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
        break;
      case 'Home':
        if (open && active >= 0) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (open && active >= 0) {
          e.preventDefault();
          setActive(results.length - 1);
        }
        break;
      case 'Enter': {
        e.preventDefault();
        const hit = active >= 0 ? results[active] : search.current ? results[0] : undefined;
        if (hit) choose(hit);
        else if (!tooShort && !search.current && search.status !== 'error') setPendingEnter(normalizeCatalogQuery(text));
        break;
      }
      case 'Escape':
        if (active >= 0) {
          e.preventDefault();
          setActive(-1);
        } else if (text) {
          e.preventDefault();
          setText('');
        }
        break;
      default:
        break;
    }
  };

  const activeId = open && active >= 0 ? `${listId}-opt-${active}` : undefined;
  const loading = search.status === 'loading' && !tooShort;
  const unavailable = notLoaded || (search.status === 'error' && (search.error?.status === 404 || search.error?.status === 501));
  let statusText = '';
  if (!tooShort) {
    if (pendingEnter !== null && !search.current) statusText = 'Still searching — we’ll open the top match as soon as it’s in.';
    else if (loading && !results.length) statusText = 'Searching the catalog…';
    else if (search.status === 'done' && results.length) statusText = `${plural(results.length, 'match', 'matches')} — use the up and down arrows, then Enter to pick.`;
    else if (search.status === 'done') statusText = notLoaded ? 'The song catalog isn’t loaded on this server yet — add your song by hand.' : `No matches for “${q}”.`;
    else if (search.status === 'error') statusText = 'The catalog search didn’t work.';
  }

  return (
    <div
      className="container song-form-page add-find"
      data-testid="find-song"
      onClickCapture={(e) => {
        // following a link ("Enter it manually", "Back to all songs", an on-site song) leaves this step too
        if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && (e.target as Element).closest?.('a[href]')) leaving.current = true;
      }}
    >
      <header className="page-header add-find-header">
        <div>
          <Link to="/songs" className="back-link">
            <ArrowLeft size={16} aria-hidden="true" /> Back to all songs
          </Link>
          <p className="eyebrow">Join the songbook</p>
          <h1 className="page-title">Add a song</h1>
          <p className="page-subtitle">Find it in our catalog of stage musicals and we’ll fill in the show, the characters and more — then you just check it.</p>
        </div>
      </header>

      <ol className="add-steps" aria-label="How adding a song works">
        <li className="is-current">
          <span className="add-steps-num" aria-hidden="true">
            1
          </span>
          <span>
            <strong>Find it</strong>
            <span className="visually-hidden"> (you are here)</span>
          </span>
        </li>
        <li>
          <span className="add-steps-num" aria-hidden="true">
            2
          </span>
          <span>
            <strong>Check it</strong>
          </span>
        </li>
        <li>
          <span className="add-steps-num" aria-hidden="true">
            3
          </span>
          <span>
            <strong>Add art &amp; audio</strong>
          </span>
        </li>
      </ol>

      <section className="find-stage" aria-labelledby="find-label">
        <label id="find-label" htmlFor="catalog-search" className="find-label">
          Find your song{' '}
          <span className="emoji" aria-hidden="true">
            🎤
          </span>
        </label>
        <div className={`find-combo${open ? ' is-open' : ''}`}>
          <Search className="find-combo-icon" size={24} aria-hidden="true" />
          <input
            ref={inputRef}
            id="catalog-search"
            className="input find-input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-describedby={`${hintId} ${statusId}`}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="Song or show name…"
            value={text}
            maxLength={120}
            onChange={(e) => {
              setText(e.target.value);
              setPendingEnter(null);
            }}
            onKeyDown={onKeyDown}
            autoFocus={finePointer}
            data-testid="catalog-search"
          />
          <span className="find-combo-end">
            {loading && <LoaderCircle className="find-spinner" size={20} aria-hidden="true" />}
            {text && (
              <button
                type="button"
                className="btn-icon btn-icon-sm"
                aria-label="Clear the search"
                onClick={() => {
                  setText('');
                  inputRef.current?.focus();
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </span>
        </div>
        <p id={hintId} className="hint find-hint">
          Type at least 2 letters. Accents don’t matter — “les miserables” finds “Les Misérables”.
        </p>
        <p id={statusId} className="visually-hidden" role="status" aria-live="polite" data-testid="catalog-status">
          {statusText}
        </p>

        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Songs and shows in the catalog"
          className={`find-results${loading ? ' is-stale' : ''}`}
          hidden={!open}
          data-testid="catalog-listbox"
        >
          {results.map((hit, i) => (
            <ResultOption
              key={`${hit.type}-${hit.id}`}
              hit={hit}
              index={i}
              id={`${listId}-opt-${i}`}
              active={i === active}
              query={search.query}
              poster={posterFor(hit, posters)}
              onPick={choose}
              onHover={setActive}
            />
          ))}
        </ul>

        <OnSiteLinks results={results} />

        {notLoaded && (
          <div className="callout callout-warning find-error" role="status" data-testid="catalog-unavailable">
            <span className="emoji" aria-hidden="true">
              🎭
            </span>
            <div>
              <p>The song catalog isn’t loaded on this server yet, so there’s nothing to search. You can still add your song by hand.</p>
              <Link to={addHref({ manual: true, kind, q })} className="btn btn-sm btn-primary">
                <PencilLine size={16} aria-hidden="true" /> Enter it manually
              </Link>
            </div>
          </div>
        )}

        {tooShort && !notLoaded && (
          <div className="find-examples">
            <span className="find-examples-label">Try:</span>
            <ul className="chip-group" role="list">
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setText(ex);
                      inputRef.current?.focus();
                    }}
                    data-testid="catalog-example"
                  >
                    {ex}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!tooShort && !notLoaded && search.status === 'done' && search.current && results.length === 0 && (
          <div className="find-empty" data-testid="catalog-empty">
            <span className="find-empty-emoji" aria-hidden="true">
              🔦
            </span>
            <div>
              <p className="find-empty-title">No song or show matches “{q}” — yet!</p>
              <p className="small muted">Check the spelling, try just a few words of the title, or add it by hand below. New musicals and rare songs might not be in the catalog.</p>
            </div>
          </div>
        )}

        {search.status === 'error' && !tooShort && !notLoaded && (
          <div className="callout callout-warning find-error" role="alert" data-testid="catalog-error">
            <span className="emoji" aria-hidden="true">
              🎭
            </span>
            <div>
              <p>{unavailable ? 'The show catalog isn’t available right now.' : search.error?.status === 429 ? 'Whoa, that’s a lot of searching! Wait a minute and try again.' : 'We couldn’t search the catalog just now.'} You can still add your song by hand.</p>
              {!unavailable && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={search.retry}>
                  Try again
                </button>
              )}
            </div>
          </div>
        )}

        <div className="find-footer">
          <p className="find-manual">
            <span>Can’t find it?</span>
            <Link to={addHref({ manual: true, kind, q })} className="btn btn-ghost btn-sm" data-testid="enter-manually">
              <PencilLine size={16} aria-hidden="true" /> Enter it manually
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </p>
          <CatalogCredit />
        </div>
      </section>
    </div>
  );
}

function posterFor(hit: CatalogHit, posters: Map<number, string>): string | null {
  const siteShowId = hit.type === 'show' ? hit.onSite?.showId : hit.show.onSite?.showId;
  return siteShowId ? (posters.get(siteShowId) ?? null) : null;
}

interface ResultOptionProps {
  hit: CatalogHit;
  poster: string | null;
  index: number;
  id: string;
  active: boolean;
  query: string;
  onPick: (hit: CatalogHit) => void;
  onHover: (index: number) => void;
}

function ResultOption({ hit, index, id, active, query, poster, onPick, onHover }: ResultOptionProps) {
  const common = {
    id,
    role: 'option' as const,
    'aria-selected': active,
    'data-index': index,
    'data-type': hit.type,
    'data-testid': 'catalog-option',
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onMouseMove: () => (active ? undefined : onHover(index)),
    onClick: () => onPick(hit),
  };

  if (hit.type === 'show') {
    return (
      <li {...common} className={`find-option is-show${active ? ' is-active' : ''}`}>
        <span className="find-option-art is-poster" aria-hidden="true">
          <ArtworkTile src={poster} seed={hit.title} label={hit.title} size={52} />
          <span className="find-option-art-badge">🎭</span>
        </span>
        <span className="find-option-body">
          <span className="find-option-title">
            <span>
              <Highlight text={hit.title} query={query} />
            </span>
            <span className="badge badge-teal find-option-type">Show</span>
          </span>
          <span className="find-option-meta">
            {[hit.year, hit.composer, hit.songCount ? plural(hit.songCount, 'song') : 'no song list yet'].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="find-option-side">
          {hit.onSite && (
            <span className="badge badge-success" title="This show already has a page on the site">
              ✓ On the site
            </span>
          )}
          <span className="find-option-go">
            See songs <ChevronRight size={16} aria-hidden="true" />
          </span>
        </span>
      </li>
    );
  }

  const guess = guessKind(hit);
  const kind = guess ? KIND_GUESS[guess] : null;
  const singers = formatSingers(hit.singers);
  return (
    <li {...common} className={`find-option is-song${active ? ' is-active' : ''}`}>
      <span className="find-option-art" aria-hidden="true">
        <ArtworkTile src={poster} seed={hit.show.title} label={hit.show.title} size={52} />
      </span>
      <span className="find-option-body">
        <span className="find-option-title">
          <span>
            <Highlight text={hit.title} query={query} />
          </span>
          {hit.reprise && <span className="badge badge-outline">Reprise</span>}
        </span>
        <span className="find-option-meta">
          from <strong>{hit.show.title}</strong>
          {hit.show.year ? ` (${hit.show.year})` : ''}
          {singers ? ` · ${singers}` : ''}
        </span>
      </span>
      <span className="find-option-side">
        {kind && (
          <span className={`kind-guess is-${kind.tone}`} title="Our guess from who sings it in the show">
            <span aria-hidden="true">{kind.emoji}</span> {kind.label}
          </span>
        )}
        {/* A plain badge: an option can't hold a link (axe nested-interactive). Picking the option opens the form with
            an "Already in the songbook — open it" callout, and the song's link is listed below the results. */}
        {hit.onSite && (
          <span className="find-onsite" data-testid="catalog-onsite">
            <span aria-hidden="true">✓</span>Already in the songbook
          </span>
        )}
      </span>
    </li>
  );
}

/** Links to the songs in the results that are already on the site — outside the listbox, so they're real links. */
function OnSiteLinks({ results }: { results: readonly CatalogHit[] }) {
  const onSite = results.filter((h): h is Extract<CatalogHit, { type: 'song' }> => h.type === 'song' && h.onSite !== null).slice(0, 3);
  if (!onSite.length) return null;
  return (
    <p className="find-onsite-links small" data-testid="catalog-onsite-links">
      <span className="find-onsite-links-label">Already in the songbook:</span>{' '}
      {onSite.map((h, i) => (
        <span key={h.id}>
          {i > 0 && ', '}
          <Link to={songPath(h.onSite!.songId)} data-testid="catalog-onsite-link">
            {h.title}
            <span className="visually-hidden"> from {h.show.title} — open the song page</span>
          </Link>
        </span>
      ))}
    </p>
  );
}

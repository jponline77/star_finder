/**
 * Accessible show picker (ARIA 1.2 combobox + listbox): type to filter the existing shows
 * accent-insensitively, ↑/↓ to move, Enter to pick, Esc to close/clear. The last option is
 * "➕ Add new show: <typed name>" when the text doesn't match an existing show. Leaving the field
 * while the list is open (Tab, tapping the next field, the phone keyboard's "Next") accepts the
 * highlighted option, just like Enter — so "Hades" + Tab picks the highlighted "Hadestown" rather
 * than quietly creating a new show called "Hades".
 *
 * data-testids: song-show (input), song-show-listbox, song-show-option, song-show-new.
 */
import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArtworkTile } from '../../components/ArtworkTile';
import { Highlight } from '../../components/Highlight';
import { plural } from '../../lib/format';
import { compareText, fold, stripLeadingArticle, tokenize } from '../../lib/normalize';
import { matchShow } from './model';

export interface ShowOption {
  id: number;
  name: string;
  slug: string;
  imageUrl: string | null;
  songCount: number;
}

export interface ShowComboboxProps {
  id: string;
  shows: readonly ShowOption[];
  text: string;
  selectedId: number | null;
  onTextChange: (text: string) => void;
  onSelectExisting: (show: ShowOption) => void;
  onSelectNew: (name: string) => void;
  describedBy?: string;
  invalid?: boolean;
  loading?: boolean;
}

type Item = { type: 'show'; show: ShowOption } | { type: 'new'; name: string };

export function filterShows(shows: readonly ShowOption[], text: string): ShowOption[] {
  const tokens = tokenize(text);
  const sorted = [...shows].sort((a, b) => compareText(stripLeadingArticle(a.name), stripLeadingArticle(b.name)));
  if (!tokens.length) return sorted;
  const matches = sorted.filter((s) => {
    const name = fold(s.name);
    return tokens.every((t) => name.includes(t));
  });
  // names that start with the query first
  const q = tokens.join(' ');
  return matches.sort((a, b) => Number(!stripLeadingArticle(fold(a.name)).startsWith(q)) - Number(!stripLeadingArticle(fold(b.name)).startsWith(q)));
}

export function ShowCombobox({ id, shows, text, selectedId, onTextChange, onSelectExisting, onSelectNew, describedBy, invalid, loading }: ShowComboboxProps) {
  const listId = useId();
  const statusId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // When a show is already chosen, opening the list shows everything (not just that one name).
  const query = selectedId !== null ? '' : text;
  const items = useMemo<Item[]>(() => {
    const list: Item[] = filterShows(shows, query).map((show) => ({ type: 'show', show }));
    const typed = text.trim();
    if (typed && selectedId === null && !matchShow(typed, shows)) list.push({ type: 'new', name: typed });
    return list;
  }, [shows, query, text, selectedId]);

  useEffect(() => {
    if (active >= items.length) setActive(items.length - 1);
  }, [items.length, active]);

  // keep the active option scrolled into view
  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const choose = (item: Item) => {
    if (item.type === 'show') onSelectExisting(item.show);
    else onSelectNew(item.name);
    setOpen(false);
    setActive(-1);
  };

  const openList = () => {
    setOpen(true);
    if (active < 0 && items.length) {
      const i = selectedId !== null ? items.findIndex((it) => it.type === 'show' && it.show.id === selectedId) : 0;
      setActive(Math.max(0, i));
    }
  };

  /**
   * On leaving the field: take the highlighted option if the list is open, else snap to an
   * exactly matching show, else treat the text as a new show.
   */
  const resolve = () => {
    const highlighted = open && active >= 0 ? items[active] : undefined;
    setOpen(false);
    setActive(-1);
    if (selectedId !== null) return;
    const typed = text.trim();
    if (!typed) return;
    if (highlighted) {
      choose(highlighted);
      return;
    }
    const match = matchShow(typed, shows);
    if (match) onSelectExisting(match);
    else onSelectNew(typed);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList();
        else setActive((i) => (items.length ? (i + 1) % items.length : -1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openList();
        else setActive((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1));
        break;
      case 'Home':
        if (open && items.length) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (open && items.length) {
          e.preventDefault();
          setActive(items.length - 1);
        }
        break;
      case 'Enter': {
        if (open && active >= 0 && items[active]) {
          e.preventDefault();
          choose(items[active]);
        } else if (text.trim() && selectedId === null) {
          e.preventDefault();
          resolve();
        }
        break;
      }
      case 'Escape':
        if (open) {
          e.preventDefault();
          setOpen(false);
          setActive(-1);
        } else if (text) {
          e.preventDefault();
          onTextChange('');
        }
        break;
      case 'Tab':
        // accept the highlighted option (no preventDefault: focus still moves on)
        if (open && active >= 0 && items[active]) choose(items[active]);
        else if (open) setOpen(false);
        break;
      default:
        break;
    }
  };

  const activeId = open && active >= 0 && items[active] ? `${listId}-opt-${active}` : undefined;
  const showCount = items.filter((i) => i.type === 'show').length;
  const status = !open ? '' : showCount ? `${plural(showCount, 'show')} found. Use up and down arrows to choose.` : text.trim() ? `No shows match. Press Enter to add “${text.trim()}” as a new show.` : '';

  return (
    <div
      className={`show-combo${open ? ' is-open' : ''}`}
      ref={wrapRef}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) resolve();
      }}
    >
      <div className="show-combo-field">
        <input
          ref={inputRef}
          id={id}
          className="input show-combo-input"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-describedby={[describedBy, statusId].filter(Boolean).join(' ') || undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={loading ? 'Loading shows…' : 'Start typing, e.g. “Hadestown”'}
          value={text}
          maxLength={160}
          onChange={(e) => {
            onTextChange(e.target.value);
            setOpen(true);
            setActive(e.target.value.trim() ? 0 : -1);
          }}
          onClick={() => (open ? undefined : openList())}
          onKeyDown={onKeyDown}
          data-testid="song-show"
        />
        <button
          type="button"
          className="show-combo-toggle btn-icon btn-icon-sm"
          tabIndex={-1}
          aria-label={open ? 'Hide the list of shows' : 'Show all shows'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) setOpen(false);
            else {
              openList();
              inputRef.current?.focus();
            }
          }}
        >
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      </div>
      <span id={statusId} className="visually-hidden" aria-live="polite">
        {status}
      </span>
      <ul ref={listRef} id={listId} role="listbox" aria-label="Shows" className="show-combo-list" hidden={!open || items.length === 0} data-testid="song-show-listbox">
        {items.map((item, i) => {
          const isActive = i === active;
          if (item.type === 'new') {
            return (
              <li
                key="__new"
                id={`${listId}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={isActive}
                className={`show-combo-option is-new${isActive ? ' is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
                data-testid="song-show-new"
              >
                <span className="show-combo-new-icon" aria-hidden="true">
                  <Plus size={18} />
                </span>
                <span className="show-combo-text">
                  <span className="show-combo-name">
                    Add new show: <strong>“{item.name}”</strong>
                  </span>
                  <span className="show-combo-meta">It’ll get its own spot on the poster wall</span>
                </span>
              </li>
            );
          }
          const { show } = item;
          return (
            <li
              key={show.id}
              id={`${listId}-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={isActive}
              className={`show-combo-option${isActive ? ' is-active' : ''}${show.id === selectedId ? ' is-chosen' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item)}
              data-testid="song-show-option"
            >
              <span className="show-combo-thumb" aria-hidden="true">
                <ArtworkTile src={show.imageUrl} seed={show.name} size={40} />
              </span>
              <span className="show-combo-text">
                <span className="show-combo-name">
                  <Highlight text={show.name} query={query} />
                </span>
                <span className="show-combo-meta">{show.songCount ? `${plural(show.songCount, 'song')} on the list` : 'No songs yet'}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

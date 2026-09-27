/**
 * Festival pickers (SPEC §7b) — all read/write `useFestival()`.
 *
 *   <FestivalPicker />                     compact chip "📍 Surrey" / "📍 Choose your festival" + listbox popover (header, heroes)
 *   <FestivalPicker variant="select" />    labelled native <select> with optgroups (mobile menu)
 *   <FestivalPicker variant="inline" />    select + a summary card of the chosen festival (My Stuff)
 *   <FestivalChips labelledBy="…" />       one-tap chips for every choice (Home "Where are you performing?")
 *   <FestivalSummary festival={f} />       name, date, venue, status
 *
 * The popover is a WAI-ARIA listbox (focus stays on the list, `aria-activedescendant` tracks the
 * option): ↑/↓/Home/End move, Enter/Space choose, Escape closes and returns focus to the chip,
 * typing a letter jumps to the next festival starting with it; Tab moves on to the popover's
 * "All festival dates" link, and the popover closes once focus leaves it. Options are grouped
 * ("BC regional festivals", "Online") and show name/city + date.
 */
import { Check, ChevronDown, ExternalLink, MapPin } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useClickOutside } from '../hooks/useClickOutside';
import { useLocalDay } from '../hooks/useLocalDay';
import {
  FESTIVAL_KIND_EMOJI,
  festivalChipDate,
  festivalDateNote,
  festivalShortName,
  festivalStatus,
  formatFestivalDate,
  pickerGroups,
} from '../lib/festivals';
import { isHttpsUrl } from '../lib/links';
import { useFestival } from '../state/FestivalProvider';
import { useToast } from '../state/ToastProvider';
import type { Festival } from '../types';

export interface FestivalPickerProps {
  /** compact = chip + popover (default); select = native select; inline = select + summary */
  variant?: 'compact' | 'select' | 'inline';
  className?: string;
  /** compact: chip text when nothing is chosen */
  placeholder?: string;
  /** compact: shorter text used where space is tight (CSS decides; default 'Festival') */
  shortPlaceholder?: string;
  /** compact: 'marquee' = styled for the dark marquee heroes; popover alignment follows `align`. */
  tone?: 'default' | 'marquee';
  /** compact: which edge the popover lines up with (default 'end') */
  align?: 'start' | 'center' | 'end';
  /** select/inline: the visible label */
  label?: ReactNode;
  /** select/inline: id for the <select> */
  id?: string;
  /** select/inline: offer "No festival chosen" even when one is chosen */
  allowClear?: boolean;
  /** Toast "Surrey it is!" after a choice (default true for compact/chips, false for selects). */
  announce?: boolean;
  /** Called after a choice is kept (e.g. close the mobile menu). */
  onPicked?: (festival: Festival | null) => void;
  testId?: string;
}

export function FestivalPicker({ variant = 'compact', ...props }: FestivalPickerProps) {
  if (variant === 'select') return <FestivalSelect {...props} />;
  if (variant === 'inline') return <FestivalInline {...props} />;
  return <CompactPicker {...props} />;
}

/** "Fraser Valley · Mission" (city only when it adds something). */
function nameWithCity(f: Festival): { short: string; city: string | null } {
  const short = festivalShortName(f);
  const city = f.city?.trim() || null;
  return { short, city: city && city.toLowerCase() !== short.toLowerCase() ? city : null };
}

function useAnnounce(enabled: boolean) {
  const toast = useToast();
  return useCallback(
    (f: Festival | null) => {
      if (!enabled) return;
      if (f) toast.success(`${festivalShortName(f)} it is! Your countdown is set.`, { emoji: '📍', id: 'festival-set', duration: 3000 });
      else toast.info('Festival cleared — pick one any time.', { emoji: '📍', id: 'festival-set', duration: 3000 });
    },
    [enabled, toast],
  );
}

// ---------------------------------------------------------------------------
// Compact chip + listbox popover
// ---------------------------------------------------------------------------

function CompactPicker({ className = '', placeholder = 'Choose your festival', shortPlaceholder = 'Festival', tone = 'default', align = 'end', announce = true, onPicked, testId = 'festival-picker' }: FestivalPickerProps) {
  const { regionalChoices, selected, setFestival, ready, loadError } = useFestival();
  const say = useAnnounce(announce);
  const groups = useMemo(() => pickerGroups(regionalChoices), [regionalChoices]);
  const options = useMemo(() => groups.flatMap((g) => g.festivals), [groups]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLAnchorElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const listId = `fp-${baseId}-list`;
  const titleId = `fp-${baseId}-title`;
  const optionId = useCallback((slug: string) => `fp-${baseId}-opt-${slug}`, [baseId]);

  const close = useCallback(() => setOpen(false), []);
  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);
  useClickOutside(wrapRef, close, open, closeAndRefocus);

  const openList = (edge?: 'first' | 'last') => {
    const start = edge === 'last' ? options[options.length - 1] : edge === 'first' ? options[0] : (options.find((o) => o.slug === selected?.slug) ?? options[0]);
    setActive(start?.slug ?? null);
    setOpen(true);
  };

  useEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open || !active) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, optionId]);

  const pick = (f: Festival) => {
    closeAndRefocus();
    if (f.slug === selected?.slug) return;
    void setFestival(f.slug).then((ok) => {
      if (!ok) return;
      say(f);
      onPicked?.(f);
    });
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList(e.key === 'ArrowUp' ? 'last' : undefined);
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!options.length) return;
    const i = Math.max(0, options.findIndex((o) => o.slug === active));
    const move = (to: number) => {
      e.preventDefault();
      setActive(options[Math.min(options.length - 1, Math.max(0, to))]?.slug ?? null);
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(i + 1);
      case 'ArrowUp':
        return move(i - 1);
      case 'Home':
      case 'PageUp':
        return move(0);
      case 'End':
      case 'PageDown':
        return move(options.length - 1);
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const f = options[i];
        if (f) pick(f);
        return;
      }
      case 'Tab':
        // on to the "All festival dates" link (Shift+Tab goes back to the chip, closing the list)
        if (e.shiftKey || !moreRef.current) {
          setOpen(false);
          return;
        }
        e.preventDefault();
        moreRef.current.focus();
        return;
      default: {
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        const now = Date.now();
        const t = typeahead.current;
        t.text = now - t.at < 700 ? t.text + e.key.toLowerCase() : e.key.toLowerCase();
        t.at = now;
        const matches = (o: Festival) => festivalShortName(o).toLowerCase().startsWith(t.text);
        // a single letter cycles past the current option; a longer prefix may stay on it
        const order = [...options.slice(i + (t.text.length === 1 ? 1 : 0)), ...options.slice(0, i + (t.text.length === 1 ? 1 : 0))];
        const hit = order.find(matches);
        if (hit) {
          e.preventDefault();
          setActive(hit.slug);
        }
      }
    }
  };

  // Close once keyboard focus moves somewhere outside the picker (e.g. Tab past the link).
  // (A null relatedTarget — a click on nothing focusable — is left to useClickOutside.)
  const onBlurWithin = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget;
    if (open && to instanceof Node && !wrapRef.current?.contains(to)) setOpen(false);
  };

  const short = selected ? festivalShortName(selected) : null;

  return (
    <div className={`festival-picker is-${tone} align-${align} ${className}`.trim()} ref={wrapRef} onBlur={onBlurWithin}>
      <button
        ref={buttonRef}
        type="button"
        className={`festival-chip${selected ? ' is-set' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open && options.length ? listId : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onButtonKey}
        data-testid={testId}
        aria-label={short ? `Your festival: ${short}` : placeholder}
        title={selected ? `${selected.name} — change festival` : undefined}
      >
        <span className="festival-chip-pin emoji" aria-hidden="true">
          📍
        </span>
        <span className="festival-chip-text">
          {short ?? (
            <>
              <span className="festival-chip-long">{placeholder}</span>
              <span className="festival-chip-short">{shortPlaceholder}</span>
            </>
          )}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="festival-chip-caret" />
      </button>
      {open && (
        <div className="festival-popover" data-testid={`${testId}-popover`}>
          <p id={titleId} className="festival-popover-title">
            Where are you performing?
          </p>
          {!options.length ? (
            <p className="festival-popover-empty" role="status">
              {ready ? 'No festivals are listed yet — check back soon.' : loadError ? 'We couldn’t load the festivals — try again in a moment.' : 'Loading festivals…'}
            </p>
          ) : (
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={0}
              aria-labelledby={titleId}
              aria-activedescendant={active ? optionId(active) : undefined}
              className="festival-listbox"
              onKeyDown={onListKey}
              data-testid={`${testId}-listbox`}
            >
              {groups.map((g) => (
                <div role="group" aria-labelledby={`fp-${baseId}-g-${g.id}`} key={g.id} className="festival-group">
                  <div role="presentation" id={`fp-${baseId}-g-${g.id}`} className="festival-group-label">
                    {g.label}
                  </div>
                  {g.festivals.map((f) => {
                    const { short: name, city } = nameWithCity(f);
                    const status = festivalStatus(f);
                    const isSelected = f.slug === selected?.slug;
                    const date = formatFestivalDate(f, { month: 'short' });
                    return (
                      <div
                        key={f.slug}
                        id={optionId(f.slug)}
                        role="option"
                        aria-selected={isSelected}
                        aria-label={`${name}${city ? ` (${city})` : ''}, ${date}${status.state === 'past' ? `, ${status.label.toLowerCase()}` : ''}`}
                        className={`festival-option is-${status.state}${f.slug === active ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`}
                        onClick={() => pick(f)}
                        onPointerMove={() => setActive(f.slug)}
                        data-testid={`festival-option-${f.slug}`}
                      >
                        <span className="festival-option-emoji emoji" aria-hidden="true">
                          {FESTIVAL_KIND_EMOJI[f.kind]}
                        </span>
                        <span className="festival-option-text">
                          <span className="festival-option-name">
                            {name}
                            {city && <span className="festival-option-city"> · {city}</span>}
                          </span>
                          <span className="festival-option-date">
                            {date}
                            {status.state === 'past' && <span className="festival-option-past"> · {status.label}</span>}
                          </span>
                        </span>
                        <span className="festival-option-check" aria-hidden="true">
                          {isSelected && <Check size={18} strokeWidth={3} />}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          <Link ref={moreRef} to="/star-prep#dates" className="festival-popover-more" onClick={close} data-testid={`${testId}-more`}>
            All festival dates &amp; details <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Native select (+ inline summary)
// ---------------------------------------------------------------------------

function optionText(f: Festival): string {
  const { short, city } = nameWithCity(f);
  return `${short}${city ? ` (${city})` : ''} — ${formatFestivalDate(f, { month: 'short' })}`;
}

function FestivalSelect({ className = '', label, id, allowClear = false, announce = false, onPicked, testId = 'festival-select' }: FestivalPickerProps) {
  const { regionalChoices, selected, setFestival, ready, loadError, saving } = useFestival();
  const say = useAnnounce(announce);
  const groups = useMemo(() => pickerGroups(regionalChoices), [regionalChoices]);
  const auto = useId();
  const selectId = id ?? `festival-select-${auto.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const empty = !regionalChoices.length;
  return (
    <div className={`festival-select field ${className}`.trim()}>
      <label htmlFor={selectId} className="label festival-select-label">
        {label ?? (
          <>
            <MapPin size={16} aria-hidden="true" /> Your festival
          </>
        )}
      </label>
      <select
        id={selectId}
        className="select"
        value={selected?.slug ?? ''}
        disabled={empty}
        aria-busy={saving || undefined}
        onChange={(e) => {
          const slug = e.target.value || null;
          void setFestival(slug).then((ok) => {
            if (!ok) return;
            const f = slug ? (regionalChoices.find((x) => x.slug === slug) ?? null) : null;
            say(f);
            onPicked?.(f);
          });
        }}
        data-testid={testId}
      >
        {(!selected || allowClear) && <option value="">{empty ? (ready ? 'No festivals listed yet' : loadError ? 'Couldn’t load the festivals' : 'Loading festivals…') : selected ? 'No festival chosen' : 'Choose your festival…'}</option>}
        {groups.map((g) => (
          <optgroup key={g.id} label={g.label}>
            {g.festivals.map((f) => (
              <option key={f.slug} value={f.slug}>
                {optionText(f)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function FestivalInline(props: FestivalPickerProps) {
  const { selected } = useFestival();
  return (
    <div className={`festival-inline ${props.className ?? ''}`.trim()}>
      <FestivalSelect {...props} className="" allowClear={props.allowClear ?? true} />
      {selected ? (
        <FestivalSummary festival={selected} />
      ) : (
        <p className="hint festival-inline-empty">Pick the festival you’re performing at and we’ll count down to it on the home page and highlight it on STAR Prep.</p>
      )}
    </div>
  );
}

/** Name, date, venue, status (+ info link) for one festival. */
export function FestivalSummary({ festival, className = '' }: { festival: Festival; className?: string }) {
  const now = useLocalDay();
  const status = festivalStatus(festival, now);
  const note = festivalDateNote(festival);
  return (
    <div className={`festival-summary is-${status.state} ${className}`.trim()} data-testid="festival-summary">
      <p className="festival-summary-name">
        <span className="emoji" aria-hidden="true">
          {FESTIVAL_KIND_EMOJI[festival.kind]}
        </span>{' '}
        {festival.name}
      </p>
      <p className="festival-summary-when">
        <span className="festival-status">{status.label}</span>
        <span className="festival-summary-meta">{formatFestivalDate(festival, { weekday: true })}</span>
      </p>
      {note && <p className="festival-summary-meta">{note}</p>}
      {festival.venue && <p className="festival-summary-meta">{festival.venue}</p>}
      {isHttpsUrl(festival.infoUrl) && (
        <a className="festival-summary-link" href={festival.infoUrl} target="_blank" rel="noopener noreferrer">
          Festival info <ExternalLink size={13} aria-hidden="true" />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One-tap chips
// ---------------------------------------------------------------------------

export interface FestivalChipsProps {
  /** id of the heading that names the group ("Where are you performing?") */
  labelledBy?: string;
  className?: string;
  announce?: boolean;
  onPicked?: (festival: Festival) => void;
  testId?: string;
}

export function FestivalChips({ labelledBy, className = '', announce = true, onPicked, testId = 'festival-chips' }: FestivalChipsProps) {
  const { regionalChoices, selected, setFestival } = useFestival();
  const say = useAnnounce(announce);
  return (
    <ul className={`festival-chips ${className}`.trim()} role="list" aria-labelledby={labelledBy} data-testid={testId}>
      {regionalChoices.map((f) => {
        const pressed = f.slug === selected?.slug;
        return (
          <li key={f.slug}>
            <button
              type="button"
              className="festival-chip-option"
              aria-pressed={pressed}
              onClick={() => {
                if (pressed) {
                  onPicked?.(f);
                  return;
                }
                void setFestival(f.slug).then((ok) => {
                  if (!ok) return;
                  say(f);
                  onPicked?.(f);
                });
              }}
              data-testid={`festival-chip-${f.slug}`}
            >
              <span className="emoji" aria-hidden="true">
                {FESTIVAL_KIND_EMOJI[f.kind]}
              </span>
              <span className="festival-chip-option-name">{festivalShortName(f)}</span>
              <span className="festival-chip-option-date">{festivalChipDate(f)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

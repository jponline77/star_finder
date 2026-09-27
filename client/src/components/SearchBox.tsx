import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, type FormEvent } from 'react';

export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter (the form submit). */
  onSubmit?: (value: string) => void;
  placeholder?: string;
  /** Visually-hidden label (default "Search songs"). */
  label?: string;
  size?: 'md' | 'lg';
  autoFocus?: boolean;
  /** Ctrl+K (⌘K on a Mac) focuses this box (default true). Only enable on one box per page. */
  shortcut?: boolean;
  /** default "search-input" */
  testId?: string;
  className?: string;
  id?: string;
}

const IS_MAC = typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

/**
 * True for the "jump to search" shortcut: Ctrl+K, or ⌘K on a Mac. A modifier shortcut (not a bare
 * "/") so speech-input and switch users can't trigger it by accident (WCAG 2.1.4).
 */
export function isSearchShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, mac = IS_MAC): boolean {
  if (e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return false;
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** Search input with icon, clear button and a Ctrl+K / ⌘K keyboard shortcut. */
export function SearchBox({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search songs, shows, characters…',
  label = 'Search songs',
  size = 'md',
  autoFocus = false,
  shortcut = true,
  testId = 'search-input',
  className = '',
  id,
}: SearchBoxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const autoId = useId();
  const inputId = id ?? `search-${autoId}`;

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.(value);
  };

  return (
    <form role="search" className={`search-box${size === 'lg' ? ' is-lg' : ''} ${className}`.trim()} onSubmit={submit}>
      <label htmlFor={inputId} className="visually-hidden">
        {label}
      </label>
      <Search className="search-box-icon" size={size === 'lg' ? 22 : 18} aria-hidden="true" />
      <input
        ref={ref}
        id={inputId}
        className="input"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            onChange('');
          }
        }}
        data-testid={testId}
      />
      <span className="search-box-end">
        {value ? (
          <button
            type="button"
            className="btn-icon btn-icon-sm"
            aria-label="Clear search"
            onClick={() => {
              onChange('');
              ref.current?.focus();
            }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        ) : (
          shortcut && (
            <kbd className="search-box-kbd" aria-hidden="true" title={`Press ${IS_MAC ? '⌘K' : 'Ctrl+K'} to search`}>
              {IS_MAC ? '⌘K' : 'Ctrl K'}
            </kbd>
          )
        )}
      </span>
    </form>
  );
}

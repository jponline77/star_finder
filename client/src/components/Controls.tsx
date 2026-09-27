/**
 * Small form controls: Switch, SegmentedControl, ToggleChip, Tabs/TabPanel, Field.
 */
import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

// ---------------------------------------------------------------- Switch
export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  testId?: string;
  id?: string;
  className?: string;
}

/** iOS-style switch (a real checkbox with role="switch"). */
export function Switch({ checked, onChange, label, disabled, testId, id, className = '' }: SwitchProps) {
  return (
    <label className={`switch ${className}`.trim()}>
      <input type="checkbox" role="switch" id={id} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="switch-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------- SegmentedControl
export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  testId?: string;
  /** accessible name when label is an icon */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentOption<T>>;
  /** accessible group label */
  label: string;
  block?: boolean;
  className?: string;
}

/** Radio-group style segmented control (arrow keys move the selection). */
export function SegmentedControl<T extends string>({ value, onChange, options, label, block = false, className = '' }: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = options.length - 1;
    if (next >= 0) {
      e.preventDefault();
      const opt = options[next];
      if (opt) onChange(opt.value);
      refs.current[next]?.focus();
    }
  };
  return (
    <div role="radiogroup" aria-label={label} className={`segmented${block ? ' segmented-block' : ''} ${className}`.trim()}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.ariaLabel}
            tabIndex={selected ? 0 : -1}
            className="segmented-option"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            data-testid={o.testId}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- ToggleChip
export interface ToggleChipProps {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** small count bubble */
  count?: number;
  /** CSS colour for range chips (e.g. rangeColorVar('Soprano')) → adds a coloured dot */
  color?: string;
  disabled?: boolean;
  testId?: string;
  className?: string;
  title?: string;
}

/** Filter chip with aria-pressed. */
export function ToggleChip({ pressed, onToggle, children, count, color, disabled, testId, className = '', title }: ToggleChipProps) {
  const style = color ? ({ '--chip-color': color } as CSSProperties) : undefined;
  return (
    <button
      type="button"
      className={`chip${color ? ' chip-range' : ''}${count === 0 && !pressed ? ' is-empty' : ''} ${className}`.trim()}
      aria-pressed={pressed}
      onClick={onToggle}
      disabled={disabled}
      style={style}
      data-testid={testId}
      title={title}
    >
      {color && <span className="chip-dot" aria-hidden="true" />}
      {children}
      {count !== undefined && (
        <span className="chip-count" aria-label={`${count} songs`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- Tabs
export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  badge?: ReactNode;
  testId?: string;
}

export interface TabsProps<T extends string> {
  tabs: ReadonlyArray<TabItem<T>>;
  active: T;
  onChange: (id: T) => void;
  label: string;
  /** prefix for tab/panel ids (use the same in <TabPanel idPrefix>) */
  idPrefix?: string;
  className?: string;
}

/** WAI-ARIA tabs (arrow keys). Pair each tab with <TabPanel id=… active=…>. */
export function Tabs<T extends string>({ tabs, active, onChange, label, idPrefix = 'tab', className = '' }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      const t = tabs[next];
      if (t) onChange(t.id);
      refs.current[next]?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} className={`tabs ${className}`.trim()}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-${t.id}`}
          aria-selected={t.id === active}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={t.id === active ? 0 : -1}
          className="tab"
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
          data-testid={t.testId}
        >
          {t.label}
          {t.badge !== undefined && <span className="chip-count">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ id, active, idPrefix = 'tab', children, className = '' }: { id: string; active: boolean; idPrefix?: string; children: ReactNode; className?: string }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-${id}`} tabIndex={0} className={`tab-panel ${className}`.trim()}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Field
export interface FieldProps {
  label: ReactNode;
  /** render-prop receives the ids to wire onto the control */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  id?: string;
}

/**
 * Label + control + hint + error with correct aria wiring:
 *   <Field label="Email" error={errors.email}>{(p) => <input className="input" id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} />}</Field>
 */
export function Field({ label, children, hint, error, optional, className = '', id }: FieldProps) {
  const auto = useId();
  const fieldId = id ?? `f-${auto}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={fieldId} className="label">
        {label} {optional && <span className="optional">(optional)</span>}
      </label>
      {children({ id: fieldId, describedBy, invalid: Boolean(error) })}
      {hint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

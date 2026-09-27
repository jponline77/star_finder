/**
 * Tiny, dependency-free chart pieces for the Stats page (CSS bars + a little SVG-free geometry).
 *
 * Every chart is readable without colour or hover:
 *  - BarList: a real <ol> — each row prints its label, count and share; the bar itself is aria-hidden.
 *  - ColumnChart: each column carries an aria-label ("Soprano: 41 songs, 34%") and optional link.
 *  - SplitBar / Meter: the numbers are printed next to the graphic.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { percent } from '../../lib/format';

const share = (count: number, total: number) => (total > 0 ? count / total : 0);

/** "41 songs" */
export function songsLabel(n: number): string {
  return `${n} ${n === 1 ? 'song' : 'songs'}`;
}

// ---------------------------------------------------------------- BarList
export interface BarDatum {
  key: string;
  /** Plain-text label (used for aria + link text). */
  label: string;
  count: number;
  href?: string;
  emoji?: string;
  /** Leading visual (e.g. a poster thumbnail). Decorative. */
  lead?: ReactNode;
  /** Optional per-bar colour (CSS value). Defaults to the list colour. */
  color?: string;
}

export interface BarListProps {
  items: readonly BarDatum[];
  /** Denominator for the share (usually the total number of songs). */
  total: number;
  /** Scale max (defaults to the largest count) — pass a shared max to compare lists. */
  max?: number;
  /** Bar colour (CSS value). */
  color?: string;
  /** Show the % share next to the count (default true). */
  showShare?: boolean;
  /** Number the rows (for rankings). */
  ranked?: boolean;
  /** One-line rows: label · bar · value (for long lists). */
  compact?: boolean;
  className?: string;
  testId?: string;
  /** Accessible label for the list. */
  label?: string;
}

export function BarList({ items, total, max, color, showShare = true, ranked = false, compact = false, className = '', testId, label }: BarListProps) {
  const scaleMax = Math.max(1, max ?? Math.max(0, ...items.map((i) => i.count)));
  const style = color ? ({ '--bar-color': color } as CSSProperties) : undefined;
  return (
    <ol className={`sbar-list${ranked ? ' is-ranked' : ''}${compact ? ' is-compact' : ''} ${className}`.trim()} role="list" style={style} data-testid={testId} aria-label={label}>
      {items.map((d, i) => {
        const w = d.count / scaleMax;
        const barStyle = { '--w': w.toFixed(4), '--i': i, ...(d.color ? { '--bar-color': d.color } : {}) } as CSSProperties;
        const text = (
          <>
            {d.emoji && (
              <span className="emoji sbar-emoji" aria-hidden="true">
                {d.emoji}
              </span>
            )}
            <span className="sbar-text">{d.label}</span>
          </>
        );
        return (
          <li key={d.key} className="sbar" style={barStyle} data-testid={testId ? `${testId}-item` : undefined}>
            <div className="sbar-head">
              {ranked && (
                <span className="sbar-rank" aria-hidden="true">
                  {i + 1}
                </span>
              )}
              {d.lead && (
                <span className="sbar-lead" aria-hidden="true">
                  {d.lead}
                </span>
              )}
              <span className="sbar-label">
                {d.href ? (
                  <Link to={d.href} className="sbar-link">
                    {text}
                  </Link>
                ) : (
                  text
                )}
              </span>
              <span className="sbar-value">
                <strong>{d.count}</strong>
                <span className="visually-hidden"> {d.count === 1 ? 'song' : 'songs'}</span>
                {showShare && total > 0 && (
                  <span className="sbar-share">
                    <span aria-hidden="true"> · </span>
                    <span className="visually-hidden">, </span>
                    {percent(share(d.count, total))}
                  </span>
                )}
              </span>
            </div>
            <div className="sbar-track" aria-hidden="true">
              <span className="sbar-fill" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- ColumnChart
export interface ColumnDatum {
  key: string;
  /** Short label printed under the column. */
  short: string;
  /** Full label for aria/tooltip. */
  label: string;
  /** Label printed under the column on wide screens (defaults to `short`). */
  long?: string;
  count: number;
  color: string;
  href?: string;
  /** Extra line in the tooltip. */
  note?: string;
}

export interface ColumnChartProps {
  items: readonly ColumnDatum[];
  total: number;
  /** Insert a threshold marker BEFORE the column at this index. */
  markerBefore?: number;
  markerLabel?: string;
  /** Accessible name for the chart as a whole. */
  label: string;
  testId?: string;
  className?: string;
}

export function ColumnChart({ items, total, markerBefore, markerLabel, label, testId, className = '' }: ColumnChartProps) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const cells: ReactNode[] = [];
  items.forEach((d, i) => {
    if (markerBefore === i) {
      cells.push(
        <li key="__marker" className="scol-marker" aria-hidden="true">
          <span className="scol-marker-line" />
          {markerLabel && <span className="scol-marker-label">{markerLabel}</span>}
        </li>,
      );
    }
    const pct = percent(share(d.count, total));
    const aria = `${d.label}: ${songsLabel(d.count)} (${pct})${d.note ? `. ${d.note}` : ''}${d.href ? '. Browse them' : ''}`;
    const style = { '--h': (d.count / max).toFixed(4), '--c': d.color, '--i': i } as CSSProperties;
    const inner = (
      <>
        <span className="scol-plot" aria-hidden="true">
          <span className="scol-value">{d.count}</span>
          <span className="scol-bar" />
          <span className="scol-tip">
            <strong>{d.label}</strong>
            <span>
              {songsLabel(d.count)} · {pct}
            </span>
            {d.note && <span>{d.note}</span>}
          </span>
        </span>
        <span className="scol-label" aria-hidden="true">
          <span className="scol-label-short">{d.short}</span>
          <span className="scol-label-long">{d.long ?? d.short}</span>
        </span>
      </>
    );
    cells.push(
      <li key={d.key} className="scol" style={style} data-testid={testId ? `${testId}-item` : undefined}>
        {d.href ? (
          <Link to={d.href} className="scol-hit" aria-label={aria}>
            {inner}
          </Link>
        ) : (
          <span className="scol-hit" role="img" aria-label={aria}>
            {inner}
          </span>
        )}
      </li>,
    );
  });
  return (
    <ol className={`scol-chart ${className}`.trim()} role="list" aria-label={label} data-testid={testId}>
      {cells}
    </ol>
  );
}

// ---------------------------------------------------------------- SplitBar
export interface SplitPart {
  key: string;
  label: string;
  emoji?: string;
  count: number;
  color: string;
  href?: string;
}

/** Part-to-whole bar (e.g. solos vs duets) with a legend that prints every number. */
export function SplitBar({ parts, testId }: { parts: readonly SplitPart[]; testId?: string }) {
  const total = parts.reduce((n, p) => n + p.count, 0);
  return (
    <div className="ssplit" data-testid={testId}>
      <div className="ssplit-bar" aria-hidden="true">
        {parts
          .filter((p) => p.count > 0)
          .map((p) => (
            <span key={p.key} className="ssplit-seg" style={{ flexGrow: p.count, '--c': p.color } as CSSProperties} />
          ))}
      </div>
      <ul className="ssplit-legend" role="list">
        {parts.map((p) => {
          const body = (
            <>
              <span className="ssplit-swatch" style={{ '--c': p.color } as CSSProperties} aria-hidden="true" />
              {p.emoji && (
                <span className="emoji" aria-hidden="true">
                  {p.emoji}
                </span>
              )}
              <span className="ssplit-name">{p.label}</span>
              <strong className="ssplit-count">{p.count}</strong>
              <span className="ssplit-share">{percent(share(p.count, total))}</span>
            </>
          );
          return (
            <li key={p.key}>
              {p.href ? (
                <Link to={p.href} className="ssplit-item">
                  {body}
                </Link>
              ) : (
                <span className="ssplit-item">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Meter
export interface MeterProps {
  value: number;
  total: number;
  /** Accessible name, e.g. "Songs with a 30-second preview". */
  label: string;
  color?: string;
  testId?: string;
}

/** Single-value meter (role="meter") — the printed sentence next to it carries the numbers. */
export function Meter({ value, total, label, color, testId }: MeterProps) {
  const frac = share(value, total);
  return (
    <div
      className="smeter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      aria-valuetext={`${value} of ${total} (${percent(frac)})`}
      style={{ '--w': frac.toFixed(4), ...(color ? { '--bar-color': color } : {}) } as CSSProperties}
      data-testid={testId}
    >
      <span className="smeter-fill" />
    </div>
  );
}

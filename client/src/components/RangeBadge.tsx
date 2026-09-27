import { normalizeVocalRange, RANGE_SHORT, rangeSlug } from '../lib/vocab';

export interface RangeBadgeProps {
  range: string | null | undefined;
  /** 'short' = "Mz" (default), 'full' = "Mezzo-soprano" */
  variant?: 'short' | 'full';
  size?: 'md' | 'lg';
  className?: string;
}

/** Coloured vocal-range pill. Always has an accessible name (title + sr text). */
export function RangeBadge({ range, variant = 'short', size = 'md', className = '' }: RangeBadgeProps) {
  const r = normalizeVocalRange(range);
  const full = r ?? (range?.trim() || 'Range unknown');
  const text = variant === 'full' ? full : r ? RANGE_SHORT[r] : '?';
  return (
    <span className={`range-badge range-${rangeSlug(range)}${size === 'lg' ? ' is-lg' : ''} ${className}`.trim()} title={full}>
      <span aria-hidden={variant === 'short' ? true : undefined}>{text}</span>
      {variant === 'short' && <span className="visually-hidden">{full}</span>}
    </span>
  );
}

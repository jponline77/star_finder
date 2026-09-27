import type { CSSProperties } from 'react';
import { formatLength, timeStatus, TIME_STATUS_LABEL } from '../lib/format';
import { TIME_LIMIT_SECONDS, WARN_SECONDS } from '../lib/vocab';

export interface TimeLimitBarProps {
  seconds: number | null | undefined;
  limit?: number;
  warn?: number;
  /** show the "m:ss of 6:00" caption (default true) */
  caption?: boolean;
  className?: string;
}

/**
 * Horizontal bar: length vs STAR's 6:00 limit (amber zone from 5:30). The scale runs to 7:00 so
 * over-limit songs visibly spill past the red line. role="meter" with a text value.
 */
export function TimeLimitBar({ seconds, limit = TIME_LIMIT_SECONDS, warn = WARN_SECONDS, caption = true, className = '' }: TimeLimitBarProps) {
  const max = Math.max(limit + 60, seconds ?? 0);
  const status = timeStatus(seconds, limit, warn);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  const text = seconds == null ? 'Length unknown' : `${formatLength(seconds)} of ${formatLength(limit)} — ${status ? TIME_STATUS_LABEL[status] : ''}`;
  return (
    <div className={`time-bar ${status ? `is-${status}` : 'is-unknown'} ${className}`.trim()} data-testid="time-limit-bar">
      <div
        className="time-bar-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={seconds ?? 0}
        aria-valuetext={text}
        aria-label="Song length compared with the 6:00 limit"
        style={{ '--warn': pct(warn), '--limit': pct(limit) } as CSSProperties}
      >
        <span className="time-bar-fill" style={{ width: seconds == null ? 0 : pct(seconds) }} />
        <span className="time-bar-limit" aria-hidden="true" />
      </div>
      {caption && (
        <p className="time-bar-caption">
          <strong>{formatLength(seconds, '?:??')}</strong> <span className="muted">of the {formatLength(limit)} limit</span>
          {status && <span className={`time-bar-status`}> · {TIME_STATUS_LABEL[status]}</span>}
        </p>
      )}
    </div>
  );
}

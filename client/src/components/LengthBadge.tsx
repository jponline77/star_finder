import { Ban, CircleCheck, Clock, TriangleAlert } from 'lucide-react';
import { formatLength, timeStatus, TIME_STATUS_LABEL, TIME_STATUS_SHORT } from '../lib/format';

export interface LengthBadgeProps {
  seconds: number | null | undefined;
  /** Show the short status text ("Close" / "Over 6:00") next to the time. Default: only for close/over. */
  showText?: 'auto' | 'always' | 'never';
  className?: string;
}

/**
 * Song length vs STAR's 6:00 limit: green ≤ 5:30, amber 5:31–6:00, red > 6:00.
 * Never colour-only: icon + text, and a full description for screen readers / tooltip.
 */
export function LengthBadge({ seconds, showText = 'auto', className = '' }: LengthBadgeProps) {
  const status = timeStatus(seconds);
  if (!status) {
    return (
      <span className={`length-badge is-unknown ${className}`.trim()} title="Length unknown">
        <Clock size={13} aria-hidden="true" />
        <span>?:??</span>
        <span className="visually-hidden">Length unknown</span>
      </span>
    );
  }
  const Icon = status === 'ok' ? CircleCheck : status === 'close' ? TriangleAlert : Ban;
  const text = showText === 'always' || (showText === 'auto' && status !== 'ok') ? TIME_STATUS_SHORT[status] : null;
  return (
    <span className={`length-badge is-${status} ${className}`.trim()} title={`${formatLength(seconds)} — ${TIME_STATUS_LABEL[status]}`} data-status={status}>
      <Icon size={13} aria-hidden="true" />
      <span>{formatLength(seconds)}</span>
      {text && <span aria-hidden="true">· {text}</span>}
      <span className="visually-hidden">— {TIME_STATUS_LABEL[status]}</span>
    </span>
  );
}

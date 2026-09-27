import { normalizeVocalRange, RANGE_SHORT, rangeSlug, VOCAL_RANGES } from '../lib/vocab';
import type { VocalRange } from '../types';

export interface VoiceLadderProps {
  /** Ranges to highlight (duets pass both parts). Unknown/null values are ignored. */
  ranges: ReadonlyArray<string | null | undefined>;
  orientation?: 'vertical' | 'horizontal';
  /** Show range names next to the bars (vertical: full names; horizontal: short). Default true. */
  showLabels?: boolean;
  className?: string;
}

/** 6-step scale (Soprano → Bass) highlighting the given range(s). role="img" with a text label. */
export function VoiceLadder({ ranges, orientation = 'vertical', showLabels = true, className = '' }: VoiceLadderProps) {
  const on = new Set<VocalRange>();
  for (const r of ranges) {
    const n = normalizeVocalRange(r);
    if (n) on.add(n);
  }
  const highlighted = VOCAL_RANGES.filter((r) => on.has(r));
  const label = highlighted.length
    ? `Voice ladder: ${highlighted.join(' and ')} highlighted, on a scale from Soprano (highest) to Bass (lowest)`
    : 'Voice ladder: vocal range unknown';
  return (
    <div className={`voice-ladder${orientation === 'horizontal' ? ' is-horizontal' : ''} ${className}`.trim()} role="img" aria-label={label}>
      {VOCAL_RANGES.map((r) => (
        <div key={r} className={`voice-ladder-step range-${rangeSlug(r)}${on.has(r) ? ' is-on' : ''}`} aria-hidden="true">
          <span className="voice-ladder-bar" />
          {showLabels && <span>{orientation === 'horizontal' ? RANGE_SHORT[r] : r}</span>}
        </div>
      ))}
    </div>
  );
}

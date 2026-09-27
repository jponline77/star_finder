import { useEffect, useState } from 'react';
import { countdownParts, festivalPhase, formatLongDate, parseLocalDate } from '../lib/format';

export interface CountdownProps {
  /** 'YYYY-MM-DD' (local midnight) */
  date: string;
  /** e.g. "Vancouver Regional STAR Fest" (used in the accessible label) */
  label?: string;
  /** Hide the seconds tile (also updates once a minute instead of every second). */
  hideSeconds?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * Live days/hours/minutes(/seconds) countdown tiles; "It's showtime!" on the day itself, and a
 * "That's a wrap" note once it's over (instead of a stale "showtime" for the rest of the year).
 */
export function Countdown({ date, label = 'the festival', hideSeconds = false, compact = false, className = '' }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), hideSeconds ? 30_000 : 1000);
    return () => window.clearInterval(id);
  }, [hideSeconds]);
  const p = countdownParts(date, now);
  if (p.past) {
    const over = festivalPhase(date, new Date(now)) === 'over';
    return (
      <p className={`countdown-done marquee-text ${className}`.trim()} data-testid="countdown" data-phase={over ? 'over' : 'today'}>
        {over ? `🎬 That’s a wrap for ${parseLocalDate(date).getFullYear()} — see you next season!` : '🎉 It’s showtime! Break a leg!'}
      </p>
    );
  }
  const units: Array<[number, string]> = [
    [p.days, p.days === 1 ? 'day' : 'days'],
    [p.hours, 'hrs'],
    [p.minutes, 'min'],
  ];
  if (!hideSeconds) units.push([p.seconds, 'sec']);
  return (
    <div className={`countdown${compact ? ' countdown-compact' : ''} ${className}`.trim()} data-testid="countdown">
      <span className="visually-hidden">
        {p.days} days and {p.hours} hours until {label} on {formatLongDate(date)}
      </span>
      {units.map(([value, unit]) => (
        <span className="countdown-unit" key={unit} aria-hidden="true">
          <span className="countdown-value">{unit === 'days' || unit === 'day' ? value : String(value).padStart(2, '0')}</span>
          <span className="countdown-label">{unit}</span>
        </span>
      ))}
    </div>
  );
}

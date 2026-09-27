import { useEffect, useState } from 'react';
import { countdownParts, festivalPhase, formatLongDate, parseLocalDate } from '../lib/format';

export interface CountdownProps {
  /** 'YYYY-MM-DD' (local midnight) */
  date: string;
  /** e.g. "Surrey Regional STAR Fest" (used in the accessible label) */
  label?: string;
  /**
   * `date` is a closing day (e.g. an online festival's entry deadline): count down to the END of that day,
   * and say "closed" (not "showtime") once it has passed.
   */
  deadline?: boolean;
  /** Hide the seconds tile (also updates once a minute instead of every second). */
  hideSeconds?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * Live days/hours/minutes(/seconds) countdown tiles; "It's showtime!" on the day itself, and a
 * "That's a wrap" note once it's over (instead of a stale "showtime" for the rest of the year).
 * With `deadline`, it runs until midnight at the end of `date`, then reads "Submissions closed".
 */
export function Countdown({ date, label = 'the festival', deadline = false, hideSeconds = false, compact = false, className = '' }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), hideSeconds ? 30_000 : 1000);
    return () => window.clearInterval(id);
  }, [hideSeconds]);
  const day = parseLocalDate(date);
  const target = deadline ? new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1) : day;
  const p = countdownParts(target, now);
  if (p.past) {
    if (deadline) {
      return (
        <p className={`countdown-done marquee-text ${className}`.trim()} data-testid="countdown" data-phase="over">
          ⏰ Submissions closed — see you next season!
        </p>
      );
    }
    const over = festivalPhase(date, new Date(now)) === 'over';
    return (
      <p className={`countdown-done marquee-text ${className}`.trim()} data-testid="countdown" data-phase={over ? 'over' : 'today'}>
        {over ? `🎬 That’s a wrap for ${day.getFullYear()} — see you next season!` : '🎉 It’s showtime! Break a leg!'}
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
    <div className={`countdown${compact ? ' countdown-compact' : ''} ${className}`.trim()} data-testid="countdown" data-phase="upcoming">
      <span className="visually-hidden">
        {deadline
          ? `${p.days} days and ${p.hours} hours until ${label} closes at the end of ${formatLongDate(date)}`
          : `${p.days} days and ${p.hours} hours until ${label} on ${formatLongDate(date)}`}
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

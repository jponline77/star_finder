/** Setlist summary numbers (pure). */
import type { Song } from '../../types';
import { TIME_LIMIT_SECONDS } from '../../lib/vocab';

export interface Totals {
  count: number;
  seconds: number;
  unknown: number;
  solos: number;
  duets: number;
  over: number;
  mature: number;
}

export function setlistTotals(songs: readonly Song[]): Totals {
  const t: Totals = { count: songs.length, seconds: 0, unknown: 0, solos: 0, duets: 0, over: 0, mature: 0 };
  for (const s of songs) {
    if (s.lengthSeconds === null) t.unknown += 1;
    else t.seconds += s.lengthSeconds;
    if (s.kind === 'solo') t.solos += 1;
    else t.duets += 1;
    if (s.lengthSeconds !== null && s.lengthSeconds > TIME_LIMIT_SECONDS) t.over += 1;
    if (s.mature) t.mature += 1;
  }
  return t;
}


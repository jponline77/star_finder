/**
 * Rehearsal timer (STAR Prep, SPEC §7.9) as a pure reducer. Every time-dependent action carries
 * `now` (ms, from Date.now()) so the reducer is deterministic and trivially testable.
 *
 *   const [state, dispatch] = useReducer(timerReducer, 'song', initialTimer);
 *   dispatch({ type: 'toggle', now: Date.now() });
 *   songElapsed(state, Date.now())  // ms on the song clock
 *
 * Modes:
 *   - 'song'  — one clock: Start/Pause/Reset. (STAR timing starts AFTER the slate.)
 *   - 'slate' — "slate first": Start runs a separate slate stopwatch; `slateDone` stops it and
 *               starts the song clock in the same instant.
 */
import { TIME_LIMIT_SECONDS, WARN_SECONDS } from '../../lib/vocab';

export type TimerMode = 'song' | 'slate';
export type TimerPhase = 'ready' | 'slate' | 'song';
export type TimerZone = 'ok' | 'warn' | 'over';

export interface Clock {
  /** ms accumulated before the current run */
  acc: number;
  /** timestamp the current run started, or null when stopped */
  since: number | null;
}

export interface Lap {
  id: number;
  /** song-clock ms when the lap was taken */
  at: number;
  note: string;
}

export interface TimerState {
  mode: TimerMode;
  phase: TimerPhase;
  slate: Clock;
  song: Clock;
  laps: Lap[];
  nextLapId: number;
}

export type TimerAction =
  | { type: 'start'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'toggle'; now: number }
  | { type: 'reset' }
  | { type: 'setMode'; mode: TimerMode }
  | { type: 'slateDone'; now: number }
  | { type: 'lap'; now: number; note?: string }
  | { type: 'noteLap'; id: number; note: string }
  | { type: 'removeLap'; id: number };

export const LIMIT_MS = TIME_LIMIT_SECONDS * 1000;
export const WARN_MS = WARN_SECONDS * 1000;
export const MAX_LAPS = 30;

const STOPPED: Clock = Object.freeze({ acc: 0, since: null }) as Clock;

export function initialTimer(mode: TimerMode = 'song'): TimerState {
  return { mode, phase: 'ready', slate: STOPPED, song: STOPPED, laps: [], nextLapId: 1 };
}

export function clockElapsed(clock: Clock, now: number): number {
  return clock.acc + (clock.since === null ? 0 : Math.max(0, now - clock.since));
}

const run = (clock: Clock, now: number): Clock => (clock.since === null ? { acc: clock.acc, since: now } : clock);
const stop = (clock: Clock, now: number): Clock => (clock.since === null ? clock : { acc: clockElapsed(clock, now), since: null });

export function isRunning(state: TimerState): boolean {
  return state.slate.since !== null || state.song.since !== null;
}

export function songElapsed(state: TimerState, now: number): number {
  return clockElapsed(state.song, now);
}

export function slateElapsed(state: TimerState, now: number): number {
  return clockElapsed(state.slate, now);
}

/** Has anything been timed yet (enables Reset)? */
export function hasStarted(state: TimerState): boolean {
  return state.phase !== 'ready' || state.song.acc > 0 || state.slate.acc > 0;
}

export function timerReducer(state: TimerState, action: TimerAction): TimerState {
  switch (action.type) {
    case 'start': {
      if (isRunning(state)) return state;
      if (state.phase === 'ready') {
        return state.mode === 'slate'
          ? { ...state, phase: 'slate', slate: run(state.slate, action.now) }
          : { ...state, phase: 'song', song: run(state.song, action.now) };
      }
      if (state.phase === 'slate') return { ...state, slate: run(state.slate, action.now) };
      return { ...state, song: run(state.song, action.now) };
    }
    case 'pause': {
      if (!isRunning(state)) return state;
      return { ...state, slate: stop(state.slate, action.now), song: stop(state.song, action.now) };
    }
    case 'toggle':
      return timerReducer(state, { type: isRunning(state) ? 'pause' : 'start', now: action.now });
    case 'slateDone': {
      if (state.phase !== 'slate') return state;
      return { ...state, phase: 'song', slate: stop(state.slate, action.now), song: run(state.song, action.now) };
    }
    case 'reset':
      return { ...initialTimer(state.mode) };
    case 'setMode':
      if (action.mode === state.mode) return state;
      return initialTimer(action.mode);
    case 'lap': {
      if (state.phase !== 'song' || state.laps.length >= MAX_LAPS) return state;
      const at = songElapsed(state, action.now);
      if (at <= 0) return state;
      const lap: Lap = { id: state.nextLapId, at, note: (action.note ?? '').slice(0, 120) };
      return { ...state, laps: [...state.laps, lap], nextLapId: state.nextLapId + 1 };
    }
    case 'noteLap':
      return { ...state, laps: state.laps.map((l) => (l.id === action.id ? { ...l, note: action.note.slice(0, 120) } : l)) };
    case 'removeLap':
      return { ...state, laps: state.laps.filter((l) => l.id !== action.id) };
    default:
      return state;
  }
}

/** Colour zone for a song-clock time: ok < 5:30 ≤ warn < 6:00 ≤ over. */
export function timerZone(ms: number, limitMs: number = LIMIT_MS, warnMs: number = WARN_MS): TimerZone {
  if (ms >= limitMs) return 'over';
  if (ms >= warnMs) return 'warn';
  return 'ok';
}

/** Zones newly entered when time moves from `prevMs` to `nextMs` (for screen-reader announcements). */
export function crossedZones(prevMs: number, nextMs: number): TimerZone[] {
  const out: TimerZone[] = [];
  if (nextMs <= prevMs) return out;
  if (prevMs < WARN_MS && nextMs >= WARN_MS && nextMs < LIMIT_MS) out.push('warn');
  if (prevMs < LIMIT_MS && nextMs >= LIMIT_MS) out.push('over');
  return out;
}

/** 83_450 → { minutes: '1', seconds: '23', tenths: '4', text: '1:23' }. */
export function formatClock(ms: number): { minutes: string; seconds: string; tenths: string; text: string } {
  const safe = Math.max(0, Math.floor(ms / 100)); // tenths
  const tenths = safe % 10;
  const totalSeconds = Math.floor(safe / 10);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const seconds = String(s).padStart(2, '0');
  return { minutes: String(m), seconds, tenths: String(tenths), text: `${m}:${seconds}` };
}

/** Screen-reader friendly "1 minute 23 seconds". */
export function spokenClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s || !m) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}

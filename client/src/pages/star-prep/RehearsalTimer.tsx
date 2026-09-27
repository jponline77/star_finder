/**
 * Rehearsal timer (STAR Prep): big stage clock with a 6:00 ring, Start/Pause/Reset, optional
 * "slate first" stopwatch, laps with notes, amber at 5:30 / red at 6:00 with screen-reader
 * announcements. Keyboard (while the clock is focused): Space start/pause, R reset, L lap,
 * S "slate done". All timing logic lives in the pure reducer (./timer.ts).
 */
import { Flag, Mic, Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { SegmentedControl } from '../../components/Controls';
import {
  crossedZones,
  formatClock,
  hasStarted,
  initialTimer,
  isRunning,
  LIMIT_MS,
  slateElapsed,
  songElapsed,
  spokenClock,
  timerReducer,
  timerZone,
  WARN_MS,
  type TimerAction,
  type TimerMode,
} from './timer';

const RING_R = 92;
const RING_C = 2 * Math.PI * RING_R;
const TICK_MS = 100;

const ZONE_TEXT = {
  ok: 'Plenty of time',
  warn: '5:30 — start wrapping up!',
  over: 'Over 6:00! That’s past the limit',
} as const;

export interface RehearsalTimerProps {
  /** Injectable clock for tests. */
  now?: () => number;
}

export function RehearsalTimer({ now: clock = Date.now }: RehearsalTimerProps) {
  const [state, dispatchRaw] = useReducer(timerReducer, 'song' as TimerMode, initialTimer);
  const [now, setNow] = useState(() => clock());
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const prevSong = useRef(0);
  const running = isRunning(state);

  const dispatch = (action: TimerAction) => {
    dispatchRaw(action);
    setNow(clock());
  };
  const act = (type: 'toggle' | 'slateDone' | 'lap') => dispatch({ type, now: clock() });

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(clock()), TICK_MS);
    return () => window.clearInterval(id);
  }, [running, clock]);

  const songMs = songElapsed(state, now);
  const slateMs = slateElapsed(state, now);
  const zone = timerZone(songMs);

  // Announce 5:30 and 6:00 exactly once each as time passes.
  useEffect(() => {
    const crossed = crossedZones(prevSong.current, songMs);
    prevSong.current = songMs;
    if (crossed.includes('over')) setAssertive('6:00 — time! You’ve reached the STAR time limit.');
    else if (crossed.includes('warn')) setPolite('5:30 — thirty seconds until the 6:00 limit.');
  }, [songMs]);

  const reset = () => {
    dispatch({ type: 'reset' });
    prevSong.current = 0;
    setPolite('Timer reset.');
    setAssertive('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select')) return;
    const onControl = Boolean(target.closest('button, a'));
    const key = e.key.toLowerCase();
    if ((e.key === ' ' || e.key === 'Spacebar') && !onControl) {
      e.preventDefault();
      act('toggle');
    } else if (key === 'r') {
      e.preventDefault();
      reset();
    } else if (key === 'l') {
      e.preventDefault();
      act('lap');
    } else if (key === 's' && state.phase === 'slate') {
      e.preventDefault();
      act('slateDone');
    }
  };

  const song = formatClock(songMs);
  const slate = formatClock(slateMs);
  const fraction = Math.min(songMs / LIMIT_MS, 1);
  const inSlate = state.phase === 'slate';
  const phaseLabel = inSlate ? (running ? 'Slating…' : 'Slate paused') : state.phase === 'song' ? (running ? 'Song time' : 'Paused') : 'Ready';
  const warnAngle = (WARN_MS / LIMIT_MS) * 360;

  return (
    <div className="prep-timer" onKeyDown={onKeyDown} data-testid="rehearsal-timer">
      <div className="prep-timer-mode">
        <SegmentedControl<TimerMode>
          label="Timer mode"
          value={state.mode}
          onChange={(mode) => dispatch({ type: 'setMode', mode })}
          options={[
            { value: 'song', label: '⏱️ Song only', testId: 'timer-mode-song' },
            { value: 'slate', label: '🎤 Slate first', testId: 'timer-mode-slate' },
          ]}
        />
        <p className="small muted">
          {state.mode === 'slate'
            ? 'Start the slate stopwatch, then hit “Start song” when you finish your slate. STAR only times the song.'
            : 'STAR timing starts after your slate, so start this when your music starts.'}
        </p>
      </div>

      <div className="prep-timer-grid">
        <div
          className={`prep-clock is-${zone}${running ? ' is-running' : ''}${inSlate ? ' is-slate' : ''}`}
          tabIndex={0}
          role="group"
          aria-label="Stage clock. Press Space to start or pause, R to reset, L to mark a lap."
          data-testid="timer-clock"
          data-zone={zone}
        >
          <svg className="prep-ring" viewBox="0 0 200 200" aria-hidden="true">
            <circle className="prep-ring-track" cx="100" cy="100" r={RING_R} />
            <circle
              className="prep-ring-fill"
              cx="100"
              cy="100"
              r={RING_R}
              style={{ strokeDasharray: RING_C, strokeDashoffset: RING_C * (1 - fraction) } as CSSProperties}
            />
            {/* 5:30 tick */}
            <line className="prep-ring-tick is-warn" x1="100" y1="2" x2="100" y2="20" transform={`rotate(${warnAngle} 100 100)`} />
            {/* 6:00 tick (top) */}
            <line className="prep-ring-tick is-limit" x1="100" y1="0" x2="100" y2="22" />
          </svg>
          <div className="prep-clock-face">
            {state.mode === 'slate' && (
              <p className={`prep-slate-clock${inSlate ? ' is-active' : ''}`} data-testid="timer-slate">
                <Mic size={14} aria-hidden="true" /> Slate {slate.text}
                <span className="prep-slate-tenths">.{slate.tenths}</span>
              </p>
            )}
            <p className="prep-clock-phase">{phaseLabel}</p>
            <p className="prep-clock-digits" aria-hidden="true" data-testid="timer-display">
              {song.minutes}:{song.seconds}
              <span className="prep-clock-tenths">.{song.tenths}</span>
            </p>
            <p className="prep-clock-status">
              <span className="prep-zone-dot" aria-hidden="true" />
              {ZONE_TEXT[zone]}
            </p>
            <p className="visually-hidden" role="timer">
              Song time {spokenClock(songMs)}
              {state.mode === 'slate' ? `, slate ${spokenClock(slateMs)}` : ''}. {ZONE_TEXT[zone]}.
            </p>
          </div>
        </div>

        <div className="prep-timer-side">
          <div className="prep-timer-controls">
            {inSlate && running ? (
              <button type="button" className="btn btn-pink btn-lg" onClick={() => act('slateDone')} data-testid="timer-slate-done">
                <Play size={20} aria-hidden="true" fill="currentColor" /> Start song
              </button>
            ) : (
              <button type="button" className={`btn btn-lg ${running ? 'btn-secondary' : 'btn-primary'}`} onClick={() => act('toggle')} data-testid="timer-toggle">
                {running ? <Pause size={20} aria-hidden="true" fill="currentColor" /> : <Play size={20} aria-hidden="true" fill="currentColor" />}
                {running ? 'Pause' : hasStarted(state) ? 'Resume' : state.mode === 'slate' ? 'Start slate' : 'Start'}
              </button>
            )}
            {inSlate && running && (
              <button type="button" className="btn btn-ghost" onClick={() => act('toggle')} data-testid="timer-toggle">
                <Pause size={18} aria-hidden="true" /> Pause
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => act('lap')} disabled={state.phase !== 'song' || songMs <= 0} data-testid="timer-lap">
              <Flag size={18} aria-hidden="true" /> Lap
            </button>
            <button type="button" className="btn btn-quiet" onClick={reset} disabled={!hasStarted(state)} data-testid="timer-reset">
              <RotateCcw size={18} aria-hidden="true" /> Reset
            </button>
          </div>
          <p className="prep-kbd small subtle">
            Click the clock, then use <kbd>Space</kbd> to start or pause, <kbd>R</kbd> to reset and <kbd>L</kbd> for a lap
            {state.mode === 'slate' ? (
              <>
                , and <kbd>S</kbd> when your slate is done
              </>
            ) : null}
            .
          </p>

          <div className="prep-laps">
            <h3 className="prep-laps-title">Laps &amp; notes</h3>
            {state.laps.length === 0 ? (
              <p className="small muted">Tap “Lap” at key moments (verse 2, the key change, the big note) to see where your time goes. Add notes to remember what to fix.</p>
            ) : (
              <ol className="prep-lap-list" data-testid="timer-laps">
                {state.laps.map((lap, i) => {
                  const t = formatClock(lap.at);
                  return (
                    <li key={lap.id} className={`prep-lap is-${timerZone(lap.at)}`}>
                      <span className="prep-lap-time">
                        <span className="prep-lap-num">#{i + 1}</span> {t.text}
                        <span className="prep-clock-tenths">.{t.tenths}</span>
                      </span>
                      <label className="visually-hidden" htmlFor={`lap-note-${lap.id}`}>
                        Note for lap {i + 1}
                      </label>
                      <input
                        id={`lap-note-${lap.id}`}
                        className="input prep-lap-note"
                        value={lap.note}
                        placeholder="Add a note…"
                        maxLength={120}
                        onChange={(e) => dispatch({ type: 'noteLap', id: lap.id, note: e.target.value })}
                      />
                      <button type="button" className="btn-icon btn-icon-sm" onClick={() => dispatch({ type: 'removeLap', id: lap.id })} aria-label={`Remove lap ${i + 1}`}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>

      <p className="visually-hidden" role="status" aria-live="polite" data-testid="timer-announce">
        {polite}
      </p>
      <p className="visually-hidden" aria-live="assertive" data-testid="timer-alert">
        {assertive}
      </p>
    </div>
  );
}

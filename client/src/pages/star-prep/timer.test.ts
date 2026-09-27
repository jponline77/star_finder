import { describe, expect, it } from 'vitest';
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
  type TimerState,
} from './timer';

const play = (state: TimerState, ...actions: TimerAction[]) => actions.reduce(timerReducer, state);

describe('timerReducer — song mode', () => {
  it('starts, pauses, resumes and accumulates time', () => {
    let s = initialTimer();
    expect(isRunning(s)).toBe(false);
    expect(hasStarted(s)).toBe(false);
    s = play(s, { type: 'start', now: 1000 });
    expect(s.phase).toBe('song');
    expect(isRunning(s)).toBe(true);
    expect(songElapsed(s, 4000)).toBe(3000);
    s = play(s, { type: 'pause', now: 5000 });
    expect(isRunning(s)).toBe(false);
    expect(songElapsed(s, 99_000)).toBe(4000);
    s = play(s, { type: 'toggle', now: 10_000 }, { type: 'toggle', now: 11_500 });
    expect(songElapsed(s, 50_000)).toBe(5500);
    expect(hasStarted(s)).toBe(true);
  });

  it('ignores duplicate start/pause and resets to ready', () => {
    let s = play(initialTimer(), { type: 'start', now: 0 }, { type: 'start', now: 500 });
    expect(songElapsed(s, 1000)).toBe(1000);
    s = play(s, { type: 'pause', now: 1000 }, { type: 'pause', now: 3000 });
    expect(songElapsed(s, 3000)).toBe(1000);
    s = play(s, { type: 'reset' });
    expect(s).toEqual(initialTimer('song'));
  });

  it('records laps with notes, and can edit/remove them', () => {
    let s = play(initialTimer(), { type: 'lap', now: 0 }); // not running → ignored
    expect(s.laps).toHaveLength(0);
    s = play(s, { type: 'start', now: 0 }, { type: 'lap', now: 30_000, note: 'Verse 2' }, { type: 'lap', now: 61_000 });
    expect(s.laps).toEqual([
      { id: 1, at: 30_000, note: 'Verse 2' },
      { id: 2, at: 61_000, note: '' },
    ]);
    s = play(s, { type: 'noteLap', id: 2, note: 'Key change' }, { type: 'removeLap', id: 1 });
    expect(s.laps).toEqual([{ id: 2, at: 61_000, note: 'Key change' }]);
  });
});

describe('timerReducer — slate-first mode', () => {
  it('runs the slate stopwatch, then hands over to the song clock', () => {
    let s = play(initialTimer(), { type: 'setMode', mode: 'slate' });
    expect(s.mode).toBe('slate');
    s = play(s, { type: 'start', now: 0 });
    expect(s.phase).toBe('slate');
    expect(slateElapsed(s, 8000)).toBe(8000);
    expect(songElapsed(s, 8000)).toBe(0);
    s = play(s, { type: 'slateDone', now: 9000 });
    expect(s.phase).toBe('song');
    expect(slateElapsed(s, 60_000)).toBe(9000);
    expect(songElapsed(s, 60_000)).toBe(51_000);
    // slateDone outside the slate phase does nothing
    expect(play(s, { type: 'slateDone', now: 70_000 })).toBe(s);
  });

  it('can pause and resume during the slate, and reset keeps the mode', () => {
    let s = play(initialTimer('slate'), { type: 'start', now: 0 }, { type: 'pause', now: 2000 }, { type: 'start', now: 5000 });
    expect(slateElapsed(s, 6000)).toBe(3000);
    s = play(s, { type: 'reset' });
    expect(s.mode).toBe('slate');
    expect(s.phase).toBe('ready');
  });

  it('switching mode starts fresh', () => {
    const s = play(initialTimer(), { type: 'start', now: 0 }, { type: 'setMode', mode: 'slate' });
    expect(s).toEqual(initialTimer('slate'));
    expect(play(s, { type: 'setMode', mode: 'slate' })).toBe(s);
  });
});

describe('zones & formatting', () => {
  it('turns amber at 5:30 and red at 6:00', () => {
    expect(timerZone(0)).toBe('ok');
    expect(timerZone(WARN_MS - 1)).toBe('ok');
    expect(timerZone(WARN_MS)).toBe('warn');
    expect(timerZone(LIMIT_MS - 1)).toBe('warn');
    expect(timerZone(LIMIT_MS)).toBe('over');
  });

  it('reports each threshold once as time passes', () => {
    expect(crossedZones(329_900, 330_000)).toEqual(['warn']);
    expect(crossedZones(330_000, 330_100)).toEqual([]);
    expect(crossedZones(359_950, 360_050)).toEqual(['over']);
    expect(crossedZones(300_000, 400_000)).toEqual(['over']); // jumped past both → only the latest
    expect(crossedZones(400_000, 0)).toEqual([]);
  });

  it('formats the stage clock', () => {
    expect(formatClock(0)).toEqual({ minutes: '0', seconds: '00', tenths: '0', text: '0:00' });
    expect(formatClock(83_450)).toEqual({ minutes: '1', seconds: '23', tenths: '4', text: '1:23' });
    expect(formatClock(360_000).text).toBe('6:00');
    expect(formatClock(-5).text).toBe('0:00');
    expect(spokenClock(83_450)).toBe('1 minute 23 seconds');
    expect(spokenClock(0)).toBe('0 seconds');
    expect(spokenClock(120_000)).toBe('2 minutes');
  });
});

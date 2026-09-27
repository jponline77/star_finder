import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeMeta } from '../../test/fixtures';
import { regionalStatus } from '../star-prep/content';
import { RehearsalTimer } from '../star-prep/RehearsalTimer';
import StarPrepPage from '../StarPrepPage';

afterEach(() => vi.useRealTimers());

describe('StarPrepPage', () => {
  it('covers the STAR rules, the slate, the rubric, the dates and the official link', () => {
    renderWithProviders(<StarPrepPage />, { route: '/star-prep', path: '/star-prep', meta: makeMeta() });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Get stage-ready');
    expect(screen.getByRole('heading', { name: '6:00 max, starting after your slate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pre-recorded, with NO vocals' })).toBeInTheDocument();
    for (const ext of ['.mp3', '.m4a', '.wav', '.aiff']) expect(screen.getByText(ext)).toBeInTheDocument();
    expect(screen.getByText(/Sing a cappella/)).toBeInTheDocument();
    expect(screen.getByText(/only appear in a film or TV version/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Up to 1 chair and 1 table' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Up to 2 chairs and 1 table' })).toBeInTheDocument();
    expect(screen.getByText(/I am Heather Black from Canada Junior High School/)).toBeInTheDocument();
    expect(screen.getByTestId('slate-builder')).toBeInTheDocument();
    expect(screen.getByTestId('rehearsal-timer')).toBeInTheDocument();
    for (const c of ['Expression', 'Characterization', 'Staging / Choreography', 'Singing Technique', 'Transitions', 'Execution'])
      expect(screen.getByRole('heading', { name: c })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Rubric levels' })).toHaveTextContent(/Advanced.*Proficient.*Developing.*Emerging/);
    expect(screen.getByRole('heading', { name: 'It’s not a competition!' })).toBeInTheDocument();
    const dates = screen.getByTestId('regional-dates');
    expect(within(dates).getAllByRole('listitem')).toHaveLength(6);
    expect(dates).toHaveTextContent(/Vancouver\s*Our festival/);
    expect(dates).toHaveTextContent('SFU School for the Contemporary Arts');
    expect(dates).toHaveTextContent('University of Victoria');
    expect(screen.getByText(/Always confirm with your teacher/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Official TAEA Regional STAR Fest page/ })).toHaveAttribute('href', 'https://taeacanada.ca/regional-star-fest/');
  });

  it('describes how far away each regional is', () => {
    expect(regionalStatus(-3)).toEqual({ label: 'Wrapped', state: 'past' });
    expect(regionalStatus(0).label).toBe('Today!');
    expect(regionalStatus(1).label).toBe('Tomorrow');
    expect(regionalStatus(12)).toEqual({ label: 'In 12 days', state: 'soon' });
    expect(regionalStatus(75).state).toBe('later');
  });
});

describe('RehearsalTimer', () => {
  function setup() {
    vi.useFakeTimers();
    let t = 1_000_000;
    const clock = { set: (ms: number) => (t = 1_000_000 + ms) };
    rtlRender(<RehearsalTimer now={() => t} />);
    const tick = () =>
      act(() => {
        vi.advanceTimersByTime(100);
      });
    return { clock, tick };
  }
  const display = () => screen.getByTestId('timer-display').textContent;

  it('starts, turns amber at 5:30 and red at 6:00 with announcements, pauses and resets', () => {
    const { clock, tick } = setup();
    expect(display()).toBe('0:00.0');
    fireEvent.click(screen.getByTestId('timer-toggle'));
    expect(screen.getByTestId('timer-toggle')).toHaveTextContent('Pause');
    clock.set(83_400);
    tick();
    expect(display()).toBe('1:23.4');
    expect(screen.getByTestId('timer-clock')).toHaveAttribute('data-zone', 'ok');

    clock.set(331_000);
    tick();
    expect(screen.getByTestId('timer-clock')).toHaveAttribute('data-zone', 'warn');
    expect(screen.getByTestId('timer-announce')).toHaveTextContent('5:30 — thirty seconds until the 6:00 limit.');
    expect(screen.getByTestId('timer-clock')).toHaveTextContent('5:30 — start wrapping up!');

    clock.set(360_200);
    tick();
    expect(screen.getByTestId('timer-clock')).toHaveAttribute('data-zone', 'over');
    expect(screen.getByTestId('timer-alert')).toHaveTextContent('6:00 — time!');

    fireEvent.click(screen.getByTestId('timer-toggle'));
    clock.set(400_000);
    tick();
    expect(display()).toBe('6:00.2');
    expect(screen.getByTestId('timer-toggle')).toHaveTextContent('Resume');

    fireEvent.click(screen.getByTestId('timer-reset'));
    expect(display()).toBe('0:00.0');
    expect(screen.getByTestId('timer-reset')).toBeDisabled();
  });

  it('supports Space / R / L keyboard shortcuts on the focused clock, and lap notes', () => {
    const { clock, tick } = setup();
    const face = screen.getByTestId('timer-clock');
    face.focus();
    fireEvent.keyDown(face, { key: ' ' });
    clock.set(45_000);
    tick();
    fireEvent.keyDown(face, { key: 'l' });
    const laps = screen.getByTestId('timer-laps');
    expect(laps).toHaveTextContent('#1 0:45.0');
    fireEvent.change(within(laps).getByLabelText('Note for lap 1'), { target: { value: 'Verse 2 rushed' } });
    expect(within(laps).getByLabelText('Note for lap 1')).toHaveValue('Verse 2 rushed');
    // typing a space in a note must not toggle the timer
    fireEvent.keyDown(within(laps).getByLabelText('Note for lap 1'), { key: ' ' });
    expect(screen.getByTestId('timer-toggle')).toHaveTextContent('Pause');
    fireEvent.keyDown(face, { key: ' ' });
    expect(screen.getByTestId('timer-toggle')).toHaveTextContent('Resume');
    fireEvent.keyDown(face, { key: 'R' });
    expect(display()).toBe('0:00.0');
    expect(screen.queryByTestId('timer-laps')).not.toBeInTheDocument();
  });

  it('slate-first mode times the slate separately, then starts the song clock', () => {
    const { clock, tick } = setup();
    fireEvent.click(screen.getByTestId('timer-mode-slate'));
    expect(screen.getByTestId('timer-toggle')).toHaveTextContent('Start slate');
    fireEvent.click(screen.getByTestId('timer-toggle'));
    // while slating, the big button becomes "Start song" and a smaller Pause appears
    expect(screen.getByTestId('timer-slate-done')).toHaveTextContent('Start song');
    expect(screen.getByTestId('timer-toggle')).toHaveTextContent('Pause');
    clock.set(7_300);
    tick();
    expect(screen.getByTestId('timer-slate')).toHaveTextContent('Slate 0:07.3');
    expect(display()).toBe('0:00.0');
    fireEvent.click(screen.getByTestId('timer-slate-done'));
    clock.set(67_300);
    tick();
    expect(display()).toBe('1:00.0');
    expect(screen.getByTestId('timer-slate')).toHaveTextContent('Slate 0:07.3');
  });
});

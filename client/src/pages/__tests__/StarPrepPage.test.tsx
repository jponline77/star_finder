import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeMeta } from '../../test/fixtures';
import { json, mockFetch } from './mockFetch';
import { FESTIVAL_STORAGE_KEY } from '../../lib/festivals';
import { RehearsalTimer } from '../star-prep/RehearsalTimer';
import StarPrepPage from '../StarPrepPage';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderPrep(local?: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 11, 1, 12));
  if (local) window.localStorage.setItem(FESTIVAL_STORAGE_KEY, local);
  return renderWithProviders(<StarPrepPage />, { route: '/star-prep', path: '/star-prep', meta: makeMeta() });
}

describe('StarPrepPage', () => {
  it('covers the STAR rules, the slate, the rubric, the dates and the official link', () => {
    renderPrep('vancouver');
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
    expect(screen.getByText(/Always confirm with your teacher/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Official TAEA Regional STAR Fest page/ })).toHaveAttribute('href', 'https://taeacanada.ca/regional-star-fest/');
  });
});

describe('StarPrepPage festivals (SPEC §7b — from the API, nothing hardcoded)', () => {
  const card = (slug: string) => screen.getAllByTestId('festival-card').find((c) => c.getAttribute('data-slug') === slug) as HTMLElement;

  it('lists every regional (date order, TBD last) and the Online Regional, with status and venue', () => {
    renderPrep();
    expect(screen.getByRole('heading', { name: /2026–27 Regional STAR Fests/ })).toBeInTheDocument();
    const dates = screen.getByTestId('regional-dates');
    expect(within(dates).getAllByTestId('festival-card').map((c) => c.getAttribute('data-slug'))).toEqual([
      'prince-george',
      'fraser-valley',
      'victoria',
      'vancouver',
      'burnaby',
      'surrey',
      'nanaimo',
      'online',
    ]);
    expect(card('prince-george')).toHaveTextContent('Wrapped');
    expect(card('fraser-valley')).toHaveTextContent('In 3 days');
    expect(card('fraser-valley')).toHaveTextContent('Clarke Theatre · Mission');
    expect(card('victoria')).toHaveTextContent('Thursday, December 10, 2026');
    expect(card('nanaimo')).toHaveTextContent('Date to be announced');
    expect(card('nanaimo')).toHaveTextContent('Date TBA');
    expect(card('online')).toHaveTextContent('Online entries close February 28, 2027');
    // no "📍 Online" venue line repeating the card's name
    expect(card('online').querySelectorAll('.prep-date-meta')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Your festival/ })).toBeNull();
  });

  it('with no festival chosen, the hero offers a picker instead of a countdown', () => {
    renderPrep();
    expect(screen.getByTestId('prep-festival')).toHaveTextContent('Pick your festival');
    expect(screen.getByTestId('prep-festival-picker')).toHaveAccessibleName('Choose your festival');
    expect(screen.queryByTestId('countdown')).toBeNull();
    expect(screen.queryByTestId('festival-share')).toBeNull();
  });

  it('highlights “Your festival”, counts down to it, and “Make this mine” switches', async () => {
    renderPrep('vancouver');
    expect(within(card('vancouver')).getByTestId('make-mine')).toHaveAccessibleName('Your festival: Vancouver Regional STAR Fest');
    expect(within(card('vancouver')).getByTestId('make-mine')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('prep-festival')).toHaveTextContent('Vancouver Regional STAR Fest · Friday, December 11, 2026');
    expect(screen.getByTestId('countdown')).toHaveTextContent(/9days12hrs00min/);
    const mine = within(card('surrey')).getByRole('button', { name: 'Make this mine: Surrey Regional STAR Fest' });
    mine.focus();
    fireEvent.click(mine);
    await waitFor(() => expect(mine).toHaveAccessibleName('Your festival: Surrey Regional STAR Fest'));
    expect(mine).toHaveFocus(); // the same button, so keyboard users stay put
    expect(within(card('vancouver')).getByTestId('make-mine')).toHaveAccessibleName('Make this mine: Vancouver Regional STAR Fest');
    expect(screen.getByTestId('prep-festival')).toHaveTextContent('Surrey Regional STAR Fest · Friday, January 29, 2027');
    expect(window.localStorage.getItem(FESTIVAL_STORAGE_KEY)).toBe('surrey');
  });

  it('online: counts down to the entry deadline', () => {
    renderPrep('online');
    expect(screen.getByTestId('prep-festival')).toHaveTextContent('Online Regional STAR Fest · Online entries close February 28, 2027');
    // Dec 1 noon → end of Feb 28 = 89 days 12 hours
    expect(screen.getByTestId('countdown')).toHaveTextContent(/89days12hrs/);
  });

  it('lists the national festivals after regionals', () => {
    renderPrep();
    const block = screen.getByRole('group', { name: /After regionals: National STAR Festivals/ });
    expect(block).toHaveAttribute('id', 'nationals');
    const national = within(block).getByTestId('festival-card');
    expect(national).toHaveTextContent('STAR Fest West');
    expect(national).toHaveTextContent('May 20–23, 2027');
    expect(national).toHaveTextContent('University of British Columbia (UBC Vancouver)');
    // the city isn't repeated when the venue already names it
    expect(national).not.toHaveTextContent('(UBC Vancouver) · Vancouver');
    expect(within(national).queryByTestId('make-mine')).toBeNull();
  });

  it('gives teachers a share link for the chosen festival', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderPrep('burnaby');
    const share = screen.getByTestId('festival-share');
    const url = `${window.location.origin}/?festival=burnaby`;
    expect(within(share).getByTestId('festival-share-url')).toHaveTextContent(url);
    fireEvent.click(within(share).getByRole('button', { name: 'Copy a link for this festival' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
  });
});

describe('StarPrepPage festivals — after the season, and when the list can’t be loaded', () => {
  it('after the nationals: no “Nationals are next” link, and those cards say “Wrapped”', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 5, 15, 12));
    window.localStorage.setItem(FESTIVAL_STORAGE_KEY, 'surrey');
    renderWithProviders(<StarPrepPage />, { route: '/star-prep', path: '/star-prep', meta: makeMeta() });
    const hero = screen.getByTestId('prep-festival');
    expect(hero).toHaveAttribute('data-phase', 'over');
    expect(hero).toHaveTextContent('That’s a wrap! 🎉 See you next season!');
    expect(within(hero).queryByRole('link', { name: /Nationals are next/ })).toBeNull();
    expect(within(screen.getByTestId('national-dates')).getByTestId('festival-card')).toHaveTextContent('Wrapped');
  });

  it('before the nationals the hero still points to them', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 2, 10, 12));
    window.localStorage.setItem(FESTIVAL_STORAGE_KEY, 'surrey');
    renderWithProviders(<StarPrepPage />, { route: '/star-prep', path: '/star-prep', meta: makeMeta() });
    expect(within(screen.getByTestId('prep-festival')).getByRole('link', { name: /Nationals are next/ })).toHaveAttribute('href', '#nationals');
  });

  it('shows an error with “Try again” (not a skeleton forever) when the festivals can’t be loaded; retrying applies a ?festival= link', async () => {
    let up = false;
    const festivals = makeMeta().festivals;
    mockFetch({
      'GET /api/songs': () => json(500, { error: 'down' }),
      'GET /api/meta': () => json(500, { error: 'down' }),
      'GET /api/festivals': () => (up ? json(200, { festivals }) : json(500, { error: 'down' })),
    });
    const { router } = renderWithProviders(<StarPrepPage />, { route: '/star-prep?festival=surrey', path: '/star-prep', live: true });
    const error = await screen.findByTestId('festival-dates-error');
    expect(error).toHaveTextContent('We couldn’t load the festival dates');
    expect(screen.queryByText('Loading festival dates…')).toBeNull();
    expect(document.querySelector('.prep-countdown-pending')).toBeNull();
    expect(router.state.location.search).toBe('?festival=surrey'); // not applied (or dropped) yet
    up = true;
    fireEvent.click(within(error).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByTestId('festival-card').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('festival-dates-error')).toBeNull();
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByTestId('prep-festival')).toHaveTextContent('Surrey Regional STAR Fest');
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

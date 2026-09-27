import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeMeta, makeShow, makeSong } from '../../test/fixtures';
import { FESTIVAL_STORAGE_KEY } from '../../lib/festivals';
import HomePage from '../HomePage';
import { json, mockFetch } from './mockFetch';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const media = makeSong().media;
const licensed = makeShow({ id: 1, name: 'Into the Woods', slug: 'into-the-woods', licensor: 'Music Theatre International (MTI)' });
const unlicensed = makeShow({ id: 2, name: 'Edgy Show', slug: 'edgy-show', licensor: null });
const ref = (sh: typeof licensed) => ({ id: sh.id, name: sh.name, slug: sh.slug, imageUrl: null });
const songs = [1, 2, 3, 4, 5, 6].map((id) =>
  makeSong({ id, title: `Song ${id}`, show: ref(id <= 2 ? licensed : unlicensed), mature: id > 2, media: { ...media, previewUrl: `https://p.mzstatic.com/${id}.m4a` } }),
);

/** Freeze "now" (Date only, so timers and promises still run). */
function at(y: number, m: number, d: number, h = 12) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(y, m - 1, d, h));
}

function renderHome(options: { festival?: string; route?: string; meta?: ReturnType<typeof makeMeta> } = {}) {
  if (options.festival) window.localStorage.setItem(FESTIVAL_STORAGE_KEY, options.festival);
  mockFetch({ 'GET /api/shows': () => json(200, { shows: [licensed, unlicensed] }) });
  return renderWithProviders(<HomePage />, { songs, meta: options.meta ?? makeMeta(), route: options.route ?? '/', path: '/' });
}

describe('HomePage', () => {
  it('features a non-mature song from a licensable show in the spotlight', async () => {
    renderHome();
    const card = await screen.findByTestId('spotlight-song');
    expect(within(card).getByRole('heading', { level: 3 }).textContent).toMatch(/Song [12]/);
  });
});

describe('HomePage festival hero (SPEC §7b)', () => {
  it('with no festival chosen asks “Where are you performing?” with one-tap chips and no countdown', async () => {
    at(2026, 9, 27);
    renderHome();
    const where = await screen.findByTestId('festival-where');
    expect(within(where).getByRole('heading', { name: 'Where are you performing?' })).toBeInTheDocument();
    const chips = within(where).getByRole('list', { name: 'Where are you performing?' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent?.replace(/^(📍|💻)/u, ''))).toEqual([
      'Prince GeorgeNov 20',
      'Fraser ValleyDec 4',
      'VictoriaDec 10',
      'VancouverDec 11',
      'BurnabyJan 22',
      'SurreyJan 29',
      'NanaimoDate TBA',
      'OnlineCloses Feb 28',
    ]);
    expect(screen.queryByTestId('countdown')).toBeNull();
    expect(screen.getByTestId('home-eyebrow')).not.toHaveTextContent('Vancouver');
  });

  it('tapping a chip sets the festival (remembered on this device) and starts the countdown', async () => {
    at(2026, 9, 27);
    renderHome();
    fireEvent.click(await screen.findByTestId('festival-chip-surrey'));
    expect(await screen.findByTestId('countdown')).toBeInTheDocument();
    expect(screen.getByTestId('home-eyebrow')).toHaveTextContent('Surrey Regional STAR Fest · Friday, January 29, 2027');
    expect(screen.getByText(/Curtain up at/)).toHaveTextContent('Curtain up at North Surrey Secondary School in…');
    expect(window.localStorage.getItem(FESTIVAL_STORAGE_KEY)).toBe('surrey');
    expect(screen.queryByTestId('festival-where')).toBeNull();
  });

  it('counts down to the visitor’s saved festival', async () => {
    at(2026, 12, 1);
    renderHome({ festival: 'victoria' });
    expect(await screen.findByTestId('home-festival')).toHaveAttribute('data-phase', 'upcoming');
    expect(screen.getByTestId('home-eyebrow')).toHaveTextContent('Victoria Regional STAR Fest · Thursday, December 10, 2026');
    expect(screen.getByTestId('countdown')).toHaveTextContent(/8days12hrs00min/);
  });

  it('online: “Online entries close in…” with a countdown to the end of the deadline day', async () => {
    at(2027, 2, 28, 18);
    renderHome({ festival: 'online' });
    await screen.findByTestId('home-festival');
    expect(screen.getByTestId('home-eyebrow')).toHaveTextContent('Online Regional STAR Fest · Closes Feb 28, 2027');
    expect(screen.getByText(/Online entries close/)).toHaveTextContent('Online entries close today!');
    // 18:00 → midnight = 6 hours left
    expect(screen.getByTestId('countdown')).toHaveTextContent(/0days06hrs00min/);
  });

  it('TBD: “Date to be announced — check with your teacher”', async () => {
    renderHome({ festival: 'nanaimo' });
    expect(await screen.findByTestId('festival-tbd')).toHaveTextContent('Date to be announced');
    expect(screen.getByText(/Check with your teacher/)).toBeInTheDocument();
    expect(screen.queryByTestId('countdown')).toBeNull();
  });

  it('on the day: “Curtain up today!”', async () => {
    at(2027, 1, 29, 9);
    renderHome({ festival: 'surrey' });
    expect(await screen.findByText(/Curtain up today/)).toHaveTextContent('Curtain up today at North Surrey Secondary School!');
    expect(screen.getByTestId('countdown')).toHaveTextContent('It’s showtime! Break a leg!');
  });

  it('afterwards: “That’s a wrap! 🎉” and a nudge toward the national festivals', async () => {
    at(2027, 1, 10);
    renderHome({ festival: 'vancouver' });
    const wrap = await screen.findByTestId('festival-wrap');
    expect(wrap).toHaveTextContent('That’s a wrap! 🎉');
    expect(screen.queryByText(/Curtain up/)).toBeNull();
    expect(screen.queryByTestId('countdown')).toBeNull();
    expect(within(wrap).getByTestId('nationals-nudge')).toHaveTextContent('STAR Fest West (National) · May 20–23, 2027 · University of British Columbia (UBC Vancouver)');
    expect(within(wrap).getByRole('link', { name: /national festivals/ })).toHaveAttribute('href', '/star-prep#nationals');
  });

  it('uses the site default when the visitor has not chosen', async () => {
    at(2026, 9, 27);
    renderHome({ meta: makeMeta({ defaultFestivalSlug: 'fraser-valley' }) });
    await screen.findByTestId('home-festival');
    expect(screen.getByTestId('home-eyebrow')).toHaveTextContent('Fraser Valley Regional STAR Fest');
    expect(screen.getByText(/Curtain up at/)).toHaveTextContent('Clarke Theatre');
  });

  it('a teacher’s ?festival= link picks it, then leaves the URL tidy', async () => {
    at(2026, 9, 27);
    const { router } = renderHome({ festival: 'surrey', route: '/?festival=prince-george&utm=class' });
    await waitFor(() => expect(screen.getByTestId('home-eyebrow')).toHaveTextContent('Prince George Regional STAR Fest'));
    await waitFor(() => expect(router.state.location.search).toBe('?utm=class'));
    expect(window.localStorage.getItem(FESTIVAL_STORAGE_KEY)).toBe('prince-george');
    expect(await screen.findByText('Your festival is set to Prince George.')).toBeInTheDocument();
  });

  it('“Not your festival? Change it” reveals the chips', async () => {
    at(2026, 9, 27);
    renderHome({ festival: 'surrey' });
    const toggle = await screen.findByTestId('home-change-festival');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('festival-chip-surrey')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('festival-chip-burnaby'));
    await waitFor(() => expect(screen.getByTestId('home-eyebrow')).toHaveTextContent('Burnaby Regional STAR Fest'));
    expect(screen.queryByTestId('festival-chip-surrey')).toBeNull(); // panel closed again
    expect(screen.getByTestId('home-change-festival')).toHaveFocus();
  });
});

describe('HomePage festival hero — online opening days, midnight and nationals', () => {
  const withOnlineOpening = () =>
    makeMeta({ festivals: makeMeta().festivals.map((f) => (f.slug === 'online' ? { ...f, startDate: '2027-01-15' } : f)) });

  it('an online festival with an “Opens” day still counts down to its deadline', async () => {
    at(2026, 11, 15);
    renderHome({ festival: 'online', meta: withOnlineOpening() });
    const hero = await screen.findByTestId('home-festival');
    expect(hero).toHaveAttribute('data-phase', 'upcoming');
    expect(hero).toHaveTextContent('Online entries open Friday, January 15 and close in…');
    expect(hero).not.toHaveTextContent('Curtain up');
    expect(screen.getByTestId('home-eyebrow')).toHaveTextContent('Online Regional STAR Fest · Closes Feb 28, 2027');
    expect(screen.getByTestId('countdown')).toHaveTextContent(/until Online Regional STAR Fest closes at the end of/);
  });

  it('…while entries are open it’s still the deadline countdown (not “on now”), and “close today!” on the last day', async () => {
    at(2027, 2, 1);
    const first = renderHome({ festival: 'online', meta: withOnlineOpening() });
    const hero = await screen.findByTestId('home-festival');
    expect(hero).toHaveAttribute('data-phase', 'upcoming');
    expect(hero).toHaveTextContent('Online entries close in…');
    expect(hero).not.toHaveTextContent('on now');
    expect(screen.getByTestId('countdown')).toHaveTextContent(/27days12hrs/);
    first.unmount();

    at(2027, 2, 28, 18);
    renderHome({ festival: 'online', meta: withOnlineOpening() });
    expect(await screen.findByTestId('home-festival')).toHaveAttribute('data-phase', 'today');
    expect(screen.getByText(/Online entries close/)).toHaveTextContent('Online entries close today!');
    expect(screen.getByTestId('countdown')).toHaveTextContent(/0days06hrs00min/);
  });

  it('switches phase at midnight together with the countdown (the page left open)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 11, 9, 23, 59, 50));
    renderHome({ festival: 'victoria' });
    const hero = screen.getByTestId('home-festival');
    expect(hero).toHaveAttribute('data-phase', 'upcoming');
    expect(hero).toHaveTextContent('Curtain up at University of Victoria (UVic) in…');
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByTestId('home-festival')).toHaveAttribute('data-phase', 'today');
    expect(screen.getByTestId('home-festival')).toHaveTextContent('Curtain up today at University of Victoria (UVic)!');
    expect(screen.getByTestId('countdown')).toHaveTextContent('It’s showtime! Break a leg!');
  });

  it('an online deadline passing at midnight turns into “that’s a wrap”', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2027, 1, 28, 23, 59, 50));
    renderHome({ festival: 'online' });
    expect(screen.getByTestId('home-festival')).toHaveAttribute('data-phase', 'today');
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByTestId('home-festival')).toHaveAttribute('data-phase', 'over');
    expect(screen.getByTestId('festival-wrap')).toHaveTextContent('Submissions are in — that’s a wrap! 🎉');
    expect(screen.queryByText(/close today/)).toBeNull();
  });

  it('after the national festivals too, there is no “Next stop” — just see you next season', async () => {
    at(2027, 6, 15);
    renderHome({ festival: 'surrey' });
    const wrap = await screen.findByTestId('festival-wrap');
    expect(wrap).toHaveTextContent('That’s a wrap! 🎉');
    expect(wrap).toHaveTextContent('Hope it was magic. See you next season!');
    expect(screen.queryByTestId('nationals-nudge')).toBeNull();
    expect(wrap).not.toHaveTextContent('Next stop');
  });
});


import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeMeta, makeSong, part } from '../../test/fixtures';
import { __resetSetlistCacheForTests, getSetlist, setSetlist } from '../../lib/setlist';
import { setlistTotals } from '../setlist/totals';
import SetlistPage from '../SetlistPage';

const songs = [
  makeSong({ id: 1, title: 'Popular', kind: 'solo', lengthSeconds: 185, parts: [part('Glinda', 'Soprano')] }),
  makeSong({ id: 2, title: 'Stars', kind: 'solo', lengthSeconds: 200, parts: [part('Javert', 'Baritone')] }),
  makeSong({ id: 3, title: 'A Heart Full of Love', kind: 'duet', lengthSeconds: 170, parts: [part('Cosette', 'Soprano', 1), part('Marius', 'Tenor', 2)] }),
  makeSong({ id: 4, title: 'Epiphany', kind: 'solo', mature: true, lengthSeconds: 400, parts: [part('Sweeney', 'Baritone')] }),
];

const render = (route = '/setlist') => renderWithProviders(<SetlistPage />, { route, path: '/setlist', songs, meta: makeMeta() });
const titles = () => screen.getAllByTestId('setlist-row').map((r) => within(r).getByRole('heading').textContent?.replace(/^\d+\.\s*/, ''));

beforeEach(() => {
  __resetSetlistCacheForTests();
});
afterEach(() => {
  act(() => setSetlist([]));
});

describe('setlistTotals', () => {
  it('adds up running time and counts', () => {
    expect(setlistTotals([...songs, makeSong({ lengthSeconds: null, kind: 'duet' })])).toEqual({
      count: 5,
      seconds: 955,
      unknown: 1,
      solos: 3,
      duets: 2,
      over: 1,
      mature: 1,
    });
  });
});

describe('SetlistPage', () => {
  it('shows a friendly empty state with ways to find songs', () => {
    render();
    const empty = screen.getByTestId('empty-state');
    expect(empty).toHaveTextContent('Your setlist is empty');
    expect(within(empty).getByRole('link', { name: /Browse songs/ })).toHaveAttribute('href', '/songs');
    expect(within(empty).getByRole('link', { name: /Matchmaker/ })).toHaveAttribute('href', '/match');
    expect(within(empty).getByRole('link', { name: /Spin/ })).toHaveAttribute('href', '/spin');
  });

  it('lists saved songs in order with totals', () => {
    setSetlist([3, 1, 4]);
    render();
    expect(titles()).toEqual(['A Heart Full of Love', 'Popular', 'Epiphany']);
    expect(screen.getByTestId('setlist-count')).toHaveTextContent('3songs');
    expect(screen.getByTestId('setlist-total')).toHaveTextContent('12:35');
    expect(screen.getByText('2 solos · 1 duet')).toBeInTheDocument();
    expect(screen.getByText('over 6:00 (needs a cut)')).toBeInTheDocument();
  });

  it('reorders with up/down buttons and keeps focus on the moved song', async () => {
    setSetlist([1, 2, 3]);
    render();
    const rows = screen.getAllByTestId('setlist-row');
    expect(within(rows[0]!).getByTestId('setlist-move-up')).toBeDisabled();
    fireEvent.click(within(rows[0]!).getByTestId('setlist-move-down'));
    expect(titles()).toEqual(['Stars', 'Popular', 'A Heart Full of Love']);
    expect(getSetlist()).toEqual([2, 1, 3]);
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Move “Popular” down'));
    fireEvent.click(screen.getByRole('button', { name: 'Move “A Heart Full of Love” up' }));
    expect(getSetlist()).toEqual([2, 3, 1]);
    expect(screen.getByText('Moved “A Heart Full of Love” to position 2 of 3.')).toBeInTheDocument();
  });

  it('removes a song with an Undo toast', async () => {
    setSetlist([1, 2]);
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Remove “Popular” from your setlist' }));
    expect(titles()).toEqual(['Stars']);
    const toast = await screen.findByTestId('toast');
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    expect(getSetlist()).toEqual([1, 2]);
  });

  it('clears everything only after confirming', async () => {
    setSetlist([1, 2]);
    render();
    fireEvent.click(screen.getByTestId('setlist-clear'));
    expect(await screen.findByTestId('confirm-dialog')).toHaveTextContent('Clear your whole setlist?');
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-button'));
    });
    expect(getSetlist()).toEqual([]);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('copies a share link with the ids', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setSetlist([3, 1]);
    render();
    await act(async () => {
      fireEvent.click(screen.getByTestId('setlist-share'));
    });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/setlist?ids=3,1`);
  });

  it('flags saved ids that no longer exist and tidies them up', () => {
    setSetlist([1, 999]);
    render();
    expect(screen.getByTestId('setlist-missing')).toHaveTextContent('1 saved song is no longer on the site');
    fireEvent.click(within(screen.getByTestId('setlist-missing')).getByRole('button'));
    expect(getSetlist()).toEqual([1]);
  });
});

describe('SetlistPage shared links', () => {
  it('shows the shared list without touching mine, then imports only new songs when asked', async () => {
    setSetlist([1, 2]);
    const { router } = render('/setlist?ids=2,3');
    const banner = screen.getByTestId('setlist-shared-banner');
    expect(banner).toHaveTextContent('Someone shared a setlist with you');
    expect(banner).toHaveTextContent('2 songs · 6:10 total · 1 already in yours');
    expect(getSetlist()).toEqual([1, 2]); // never overwritten silently
    fireEvent.click(within(banner).getByTestId('setlist-import'));
    expect(getSetlist()).toEqual([1, 2, 3]);
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.queryByTestId('setlist-shared-banner')).not.toBeInTheDocument();
  });

  it('can replace my list after confirming, or be dismissed', async () => {
    setSetlist([1]);
    const { router } = render('/setlist?ids=3,2');
    fireEvent.click(screen.getByTestId('setlist-replace'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('confirm-button'));
    });
    expect(getSetlist()).toEqual([3, 2]);
    await waitFor(() => expect(router.state.location.search).toBe(''));

    const second = render('/setlist?ids=4');
    fireEvent.click(within(second.container).getByTestId('setlist-dismiss'));
    await waitFor(() => expect(second.router.state.location.search).toBe(''));
    expect(getSetlist()).toEqual([3, 2]);
  });

  it('says so when every shared song is already saved', () => {
    setSetlist([2, 3]);
    render('/setlist?ids=2,3');
    expect(screen.getByTestId('setlist-shared-banner')).toHaveTextContent('You already have every song from this list.');
    expect(screen.queryByTestId('setlist-import')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setlist-replace')).not.toBeInTheDocument();
  });
});

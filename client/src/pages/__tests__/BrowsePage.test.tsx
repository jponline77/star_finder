import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeMeta, makeSong, part } from '../../test/fixtures';
import BrowsePage from '../BrowsePage';

const songs = [
  makeSong({ id: 1, title: 'Popular', kind: 'solo', genre: 'Comedy', subGenre: 'Satire', parts: [part('Glinda', 'Soprano')] }),
  makeSong({ id: 2, title: 'Stars', kind: 'solo', show: { id: 2, name: 'Les Misérables', slug: 'les-miserables', imageUrl: null }, parts: [part('Javert', 'Baritone')] }),
  makeSong({ id: 3, title: 'A Heart Full of Love', kind: 'duet', parts: [part('Cosette', 'Soprano', 1), part('Marius', 'Tenor', 2)] }),
  makeSong({ id: 4, title: 'Epiphany', kind: 'solo', mature: true, lengthSeconds: 400, parts: [part('Sweeney', 'Baritone')] }),
];

afterEach(() => vi.useRealTimers());

const count = () => screen.getByTestId('result-count');

describe('BrowsePage', () => {
  it('shows all songs, then filters instantly by kind (URL updated)', async () => {
    const { router } = renderWithProviders(<BrowsePage />, { route: '/songs', path: '/songs', songs, meta: makeMeta() });
    expect(count()).toHaveTextContent('All 4 songs');
    expect(screen.getAllByTestId('song-card')).toHaveLength(4);
    fireEvent.click(screen.getByTestId('filter-kind-duet'));
    expect(count()).toHaveTextContent('1 of 4 songs');
    await waitFor(() => expect(router.state.location.search).toBe('?kind=duet'));
  });

  it('reads filters from the URL', () => {
    renderWithProviders(<BrowsePage />, { route: '/songs?range=Baritone&hideMature=1', path: '/songs', songs, meta: makeMeta() });
    expect(count()).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('song-title')).toHaveTextContent('Stars');
    expect(screen.getAllByTestId('filter-pill')).toHaveLength(2);
  });

  it('searches accent-insensitively and debounces the URL write', async () => {
    const { router } = renderWithProviders(<BrowsePage />, { route: '/songs', path: '/songs', songs, meta: makeMeta() });
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'les miserables' } });
    expect(count()).toHaveTextContent('1 of 4 songs');
    expect(router.state.location.search).toBe('');
    await waitFor(() => expect(router.state.location.search).toBe('?q=les+miserables'));
  });

  it('filters by vocal range from the mobile drawer (a duet matches if any part does)', async () => {
    renderWithProviders(<BrowsePage />, { route: '/songs', path: '/songs', songs, meta: makeMeta() });
    fireEvent.click(screen.getByTestId('open-filters'));
    fireEvent.click(await screen.findByTestId('filter-range-Tenor'));
    expect(count()).toHaveAttribute('data-count', '1');
    fireEvent.click(screen.getByTestId('filter-range-Soprano'));
    expect(count()).toHaveAttribute('data-count', '2');
  });

  it('shows a fun empty state and clears filters', async () => {
    renderWithProviders(<BrowsePage />, { route: '/songs?q=zzzz', path: '/songs', songs, meta: makeMeta() });
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No songs in the spotlight');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    });
    expect(count()).toHaveTextContent('All 4 songs');
  });

  it('shows the active show in the dropdown when the URL uses a show id', async () => {
    const meta = makeMeta({ shows: [{ id: 1, name: 'Wicked', slug: 'wicked' }, { id: 2, name: 'Les Misérables', slug: 'les-miserables' }] });
    renderWithProviders(<BrowsePage />, { route: '/songs?show=2', path: '/songs', songs, meta });
    expect(count()).toHaveAttribute('data-count', '1');
    fireEvent.click(screen.getByTestId('open-filters'));
    expect(await screen.findByTestId('filter-show')).toHaveValue('les-miserables');
  });

  it('keeps the length slider and its label in agreement for out-of-range URLs', async () => {
    const { unmount } = renderWithProviders(<BrowsePage />, { route: '/songs?maxSeconds=1000', path: '/songs', songs, meta: makeMeta() });
    fireEvent.click(screen.getByTestId('open-filters'));
    const slider = await screen.findByTestId('filter-max-length');
    expect(slider).toHaveValue('420');
    expect(slider).toHaveAttribute('aria-valuetext', 'Any length');
    unmount();
    renderWithProviders(<BrowsePage />, { route: '/songs?maxSeconds=30', path: '/songs', songs, meta: makeMeta() });
    fireEvent.click(screen.getByTestId('open-filters'));
    const low = await screen.findByTestId('filter-max-length');
    expect(low).toHaveValue('60');
    expect(low).toHaveAttribute('aria-valuetext', 'Up to 1:00');
  });

  it('keeps a heading between the page title and the song cards on mobile', () => {
    renderWithProviders(<BrowsePage />, { route: '/songs', path: '/songs', songs, meta: makeMeta() });
    const results = screen.getByRole('region', { name: 'Results' });
    expect(results.querySelector('h2')).toHaveTextContent('Results');
    const levels = [...document.querySelectorAll('h1, h2, h3')].map((h) => Number(h.tagName[1]));
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
  });

  it('announces the result count inside the (modal) filter drawer', async () => {
    renderWithProviders(<BrowsePage />, { route: '/songs', path: '/songs', songs, meta: makeMeta() });
    fireEvent.click(screen.getByTestId('open-filters'));
    const live = await screen.findByTestId('drawer-result-count');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('filter-drawer')).toContainElement(live);
    fireEvent.click(screen.getByTestId('filter-range-Tenor'));
    expect(live).toHaveTextContent('1 of 4 songs');
  });

  it('switches to the sortable table', async () => {
    renderWithProviders(<BrowsePage />, { route: '/songs?view=table', path: '/songs', songs, meta: makeMeta() });
    expect(screen.getByTestId('song-table')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sort-length'));
    fireEvent.click(screen.getByTestId('sort-length'));
    expect(screen.getAllByTestId('song-row')[0]).toHaveAttribute('data-song-id', '4');
  });
});

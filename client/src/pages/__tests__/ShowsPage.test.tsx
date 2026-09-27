import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeMeta, makeShow } from '../../test/fixtures';
import ShowsPage from '../ShowsPage';
import { json, mockFetch } from './mockFetch';

const shows = [
  makeShow({ id: 1, name: 'The Book of Mormon', slug: 'the-book-of-mormon', composer: 'Trey Parker', year: 2011, songCount: 4, soloCount: 2, duetCount: 2 }),
  makeShow({ id: 2, name: 'Les Misérables', slug: 'les-miserables', composer: 'Claude-Michel Schönberg', year: 1985, songCount: 14, soloCount: 11, duetCount: 3, commentCount: 2 }),
  makeShow({ id: 3, name: 'Hamilton', slug: 'hamilton', composer: 'Lin-Manuel Miranda', year: 2015, songCount: 1, soloCount: 1, duetCount: 0, source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' } }),
];

afterEach(() => vi.unstubAllGlobals());

const titles = () => screen.getAllByTestId('show-card-title').map((a) => a.textContent);

describe('ShowsPage', () => {
  it('hangs every poster A–Z (ignoring “The”) with counts and a Community badge', async () => {
    mockFetch({ 'GET /api/shows': () => json(200, { shows }) });
    renderWithProviders(<ShowsPage />, { route: '/shows', path: '/shows', meta: makeMeta() });
    expect(screen.getByRole('heading', { level: 1, name: 'Show poster wall' })).toBeInTheDocument();
    await screen.findAllByTestId('show-card');
    expect(titles()).toEqual(['The Book of Mormon', 'Hamilton', 'Les Misérables']);
    expect(screen.getByTestId('show-count')).toHaveTextContent('All 3 shows');
    const les = screen.getAllByTestId('show-card')[2]!;
    expect(les).toHaveTextContent('11 solos');
    expect(les).toHaveTextContent('3 duets');
    expect(les).toHaveTextContent('2 comments');
    expect(within(les).getByRole('link', { name: 'Les Misérables' })).toHaveAttribute('href', '/shows/les-miserables');
    expect(within(screen.getAllByTestId('show-card')[1]!).getByText('Community')).toBeInTheDocument();
    expect(screen.getByTestId('add-show-cta')).toContainElement(screen.getAllByRole('link', { name: /Add a song from it/ })[0]!);
  });

  it('searches accent-insensitively (names + composers) and syncs ?q=', async () => {
    mockFetch({ 'GET /api/shows': () => json(200, { shows }) });
    const { router } = renderWithProviders(<ShowsPage />, { route: '/shows', path: '/shows', meta: makeMeta() });
    await screen.findAllByTestId('show-card');
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'miserables' } });
    expect(titles()).toEqual(['Les Misérables']);
    expect(screen.getByTestId('show-count')).toHaveTextContent('1 of 3 shows match “miserables”');
    await waitFor(() => expect(router.state.location.search).toBe('?q=miserables'));
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'schonberg' } });
    expect(titles()).toEqual(['Les Misérables']);
  });

  it('shows a fun empty state that clears the search', async () => {
    mockFetch({ 'GET /api/shows': () => json(200, { shows }) });
    renderWithProviders(<ShowsPage />, { route: '/shows?q=zzzz', path: '/shows', meta: makeMeta() });
    const empty = await screen.findByTestId('empty-state');
    expect(empty).toHaveTextContent('No shows match “zzzz”');
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByTestId('show-card')).toHaveLength(3);
  });

  it('sorts by most songs and newest musicals (kept in the URL)', async () => {
    mockFetch({ 'GET /api/shows': () => json(200, { shows }) });
    const { router } = renderWithProviders(<ShowsPage />, { route: '/shows', path: '/shows', meta: makeMeta() });
    await screen.findAllByTestId('show-card');
    fireEvent.change(screen.getByTestId('show-sort'), { target: { value: 'songs' } });
    expect(titles()).toEqual(['Les Misérables', 'The Book of Mormon', 'Hamilton']);
    await waitFor(() => expect(router.state.location.search).toBe('?sort=songs'));
    fireEvent.change(screen.getByTestId('show-sort'), { target: { value: 'year' } });
    expect(titles()).toEqual(['Hamilton', 'The Book of Mormon', 'Les Misérables']);
  });

  it('offers a retry when the list fails to load', async () => {
    let fail = true;
    mockFetch({ 'GET /api/shows': () => (fail ? json(500, { error: 'boom' }) : json(200, { shows })) });
    renderWithProviders(<ShowsPage />, { route: '/shows', path: '/shows', meta: makeMeta() });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findAllByTestId('show-card')).toHaveLength(3);
  });
});

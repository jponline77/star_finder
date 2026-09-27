import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeMeta, makeSong, part } from '../../test/fixtures';
import StatsPage from '../StatsPage';

afterEach(() => vi.unstubAllGlobals());

const STATS = {
  byGenre: [
    { label: 'Drama', count: 6 },
    { label: 'Comedy', count: 3 },
    { label: 'Romantic', count: 1 },
  ],
  bySubGenre: [
    { label: 'Longing', count: 4 },
    { label: 'Satire', count: 3 },
    { label: 'Hopeful', count: 2 },
    { label: 'In Love', count: 1 },
  ],
  byRange: [
    { label: 'Soprano', count: 4 },
    { label: 'Mezzo-soprano', count: 1 },
    { label: 'Alto', count: 0 },
    { label: 'Tenor', count: 3 },
    { label: 'Baritone', count: 2 },
    { label: 'Bass', count: 1 },
  ],
  byShow: Array.from({ length: 10 }, (_, i) => ({ label: i === 0 ? 'Les Misérables' : `Show ${i}`, count: 10 - i })),
  byKind: [
    { label: 'solo', count: 7 },
    { label: 'duet', count: 3 },
  ],
  lengthBuckets: [
    { label: 'Under 2:00', count: 1, min: 0, max: 119 },
    { label: '2:00–2:59', count: 3, min: 120, max: 179 },
    { label: '3:00–3:59', count: 3, min: 180, max: 239 },
    { label: '4:00–4:59', count: 1, min: 240, max: 299 },
    { label: '5:00–5:30', count: 0, min: 300, max: 330 },
    { label: '5:31–6:00', count: 1, min: 331, max: 360 },
    { label: 'Over 6:00', count: 1, min: 361, max: null },
  ],
  mature: { yes: 2, no: 8 },
  overLimit: 1,
  withPreview: 9,
  total: 10,
};

function stubApi(stats: unknown = STATS, status = 200) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/stats')) return new Response(JSON.stringify(status === 200 ? stats : { error: 'Server sad' }), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('/api/shows')) return new Response(JSON.stringify({ shows: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ error: 'nope' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const songs = [
  makeSong({ id: 1, title: 'Quick One', lengthSeconds: 75, parts: [part('A', 'Soprano')] }),
  makeSong({ id: 2, title: 'Long One', lengthSeconds: 372, parts: [part('B', 'Tenor')] }),
  makeSong({ id: 3, title: 'Middle', lengthSeconds: 200 }),
];

const meta = makeMeta({
  shows: [{ id: 9, name: 'Les Misérables', slug: 'les-miserables' }],
  subGenres: [
    { name: 'Longing', genre: 'Drama', count: 4 },
    { name: 'Hopeful', genre: 'Drama', count: 2 },
    { name: 'Satire', genre: 'Comedy', count: 3 },
    { name: 'In Love', genre: 'Romantic', count: 1 },
  ],
});

describe('StatsPage', () => {
  it('renders headline numbers, ticker and the spreadsheet download', async () => {
    stubApi();
    renderWithProviders(<StatsPage />, { route: '/stats', path: '/stats', songs, meta });
    const tiles = await screen.findByTestId('stats-tiles');
    const values = within(tiles)
      .getAllByTestId('stats-tile-value')
      .map((n) => n.textContent);
    // songs, solos, duets, shows, with preview, fit under 6:00
    expect(values).toEqual(['10', '7', '3', '10', '9', '9']);
    expect(screen.getByTestId('stats-ticker')).toHaveTextContent('10 songs');
    expect(screen.getByTestId('stats-ticker')).toHaveTextContent('4 sopranos');
    expect(screen.getByTestId('download-xlsx')).toHaveAttribute('href', '/api/export.xlsx');
    expect(screen.getByTestId('download-xlsx')).toHaveAttribute('download');
    expect(document.title).toMatch(/By the Numbers/);
  });

  it('draws accessible genre bars that link to filtered browse pages', async () => {
    stubApi();
    renderWithProviders(<StatsPage />, { route: '/stats', path: '/stats', songs, meta });
    const genre = await screen.findByTestId('chart-genre');
    const items = within(genre).getAllByTestId('chart-genre-item');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/Drama.*6.*songs.*60%/);
    expect(within(items[1]).getByRole('link', { name: /Comedy/ })).toHaveAttribute('href', '/songs?genre=Comedy');
  });

  it('labels every vocal-range column (high → low) and links to the range filter', async () => {
    stubApi();
    renderWithProviders(<StatsPage />, { route: '/stats', path: '/stats', songs, meta });
    const chart = await screen.findByTestId('chart-range');
    const links = within(chart).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('aria-label')?.split(':')[0])).toEqual(['Soprano', 'Mezzo-soprano', 'Alto', 'Tenor', 'Baritone', 'Bass']);
    expect(links[0]).toHaveAccessibleName(/Soprano: 4 songs \(40%\)/);
    expect(links[0]).toHaveAttribute('href', '/songs?range=Soprano');
  });

  it('shows the length histogram with the 6:00 marker and an over-the-limit note', async () => {
    stubApi();
    renderWithProviders(<StatsPage />, { route: '/stats', path: '/stats', songs, meta });
    const chart = await screen.findByTestId('chart-length');
    expect(within(chart).getAllByTestId('chart-length-item')).toHaveLength(7);
    expect(chart.querySelector('.scol-marker')).not.toBeNull();
    const over = within(chart).getByRole('link', { name: /Over 6:00: 1 song/ });
    expect(over).toHaveAttribute('href', '/songs?minSeconds=361');
    expect(within(chart).getByRole('link', { name: /Under 2:00/ })).toHaveAttribute('href', '/songs?maxSeconds=119');
    expect(screen.getByTestId('length-note')).toHaveTextContent('1 song runs over 6:00');
  });

  it('groups sub-genres under their genre', async () => {
    stubApi();
    renderWithProviders(<StatsPage />, { route: '/stats', path: '/stats', songs, meta });
    const moods = await screen.findByTestId('chart-subgenre');
    const drama = within(moods).getByRole('list', { name: 'Drama sub-genres' });
    expect(within(drama).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Longing'), expect.stringContaining('Hopeful')]);
    expect(within(moods).getByRole('list', { name: 'Comedy sub-genres' })).toHaveTextContent('Satire');
  });

  it('ranks top shows, links them, and can expand to all shows', async () => {
    stubApi();
    renderWithProviders(<StatsPage />, { route: '/stats', path: '/stats', songs, meta });
    const shows = await screen.findByTestId('chart-shows');
    expect(within(shows).getAllByTestId('chart-shows-item')).toHaveLength(8);
    expect(within(shows).getByRole('link', { name: /Les Misérables/ })).toHaveAttribute('href', '/shows/les-miserables');
    expect(within(shows).getByRole('link', { name: /Show 3/ })).toHaveAttribute('href', '/shows/show-3');
    fireEvent.click(screen.getByTestId('toggle-all-shows'));
    expect(within(screen.getByTestId('chart-shows')).getAllByTestId('chart-shows-item')).toHaveLength(10);
  });

  it('shows meters for mature themes and preview coverage, plus fun facts', async () => {
    stubApi();
    renderWithProviders(<StatsPage />, { route: '/stats', path: '/stats', songs, meta });
    const mature = await screen.findByTestId('chart-mature');
    expect(mature).toHaveAttribute('role', 'meter');
    expect(mature).toHaveAttribute('aria-valuetext', '2 of 10 (20%)');
    expect(screen.getByTestId('chart-preview')).toHaveAttribute('aria-valuenow', '9');
    const facts = screen.getByTestId('fun-facts');
    expect(facts).toHaveTextContent('Quick One');
    expect(facts).toHaveTextContent('1:15');
    expect(facts).toHaveTextContent('Long One');
    expect(within(facts).getByRole('link', { name: /Most songs from one show/ })).toHaveAttribute('href', '/shows/les-miserables');
  });

  it('shows a friendly error with retry', async () => {
    const fn = stubApi(null, 500);
    renderWithProviders(<StatsPage />, { route: '/stats', path: '/stats', songs, meta });
    expect(await screen.findByText('The numbers missed their cue')).toBeInTheDocument();
    const calls = fn.mock.calls.filter((c) => String(c[0]).startsWith('/api/stats')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(fn.mock.calls.filter((c) => String(c[0]).startsWith('/api/stats')).length).toBe(calls + 1));
  });
});

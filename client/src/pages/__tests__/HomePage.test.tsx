import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeMeta, makeShow, makeSong } from '../../test/fixtures';
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

describe('HomePage', () => {
  it('features a non-mature song from a licensable show in the spotlight', async () => {
    mockFetch({ 'GET /api/shows': () => json(200, { shows: [licensed, unlicensed] }) });
    renderWithProviders(<HomePage />, { songs, meta: makeMeta() });
    const card = await screen.findByTestId('spotlight-song');
    expect(within(card).getByRole('heading', { level: 3 }).textContent).toMatch(/Song [12]/);
  });

  it('drops the “curtain up in…” countdown once the festival is over', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 0, 10, 12));
    mockFetch({ 'GET /api/shows': () => json(200, { shows: [licensed, unlicensed] }) });
    renderWithProviders(<HomePage />, { songs, meta: makeMeta() });
    await screen.findByTestId('spotlight-song');
    expect(screen.queryByText(/Curtain up/)).toBeNull();
    expect(screen.getByTestId('countdown')).toHaveTextContent('That’s a wrap for 2026');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeComment, makeMeta, makeShow, makeSong, makeUser, part } from '../../test/fixtures';
import { useShows } from '../../state/SongsProvider';
import type { ShowDetail, User } from '../../types';
import ShowDetailPage from '../ShowDetailPage';
import { json, mockFetch } from './mockFetch';

const ref = { id: 5, name: 'Hadestown', slug: 'hadestown', imageUrl: '/media/shows/hadestown.png' };
const songs = [
  makeSong({ id: 17, title: 'Flowers', show: ref, parts: [part('Eurydice', 'Soprano')] }),
  makeSong({ id: 19, title: 'Epic II', show: ref, parts: [part('Orpheus', 'Tenor')] }),
  makeSong({ id: 18, title: 'Wedding Song', kind: 'duet', show: ref, parts: [part('Orpheus', 'Tenor', 1), part('Eurydice', 'Soprano', 2)] }),
];
const hadestown: ShowDetail = {
  ...makeShow({
    id: 5,
    name: 'Hadestown',
    slug: 'hadestown',
    composer: 'Anaïs Mitchell',
    lyricist: 'Anaïs Mitchell',
    bookWriter: 'Anaïs Mitchell',
    year: 2019,
    licensor: 'Concord Theatricals',
    licensingNote: 'Only Hadestown: Teen Edition can be licensed right now.',
    description: 'Orpheus and Eurydice, retold with folk and jazz.',
    imageUrl: '/media/shows/hadestown.png',
    imageCredit: 'Image via Wikipedia',
    source: 'community',
    createdBy: { id: 7, displayName: 'Stage Kid' },
    songCount: 3,
    soloCount: 2,
    duetCount: 1,
  }),
  songs,
  characters: [
    { name: 'Eurydice', vocalRanges: ['Soprano'], songIds: [17, 18] },
    { name: 'Orpheus', vocalRanges: ['Tenor'], songIds: [19, 18] },
  ],
};
const empty: ShowDetail = { ...makeShow({ id: 9, name: 'The Empty Stage', slug: 'the-empty-stage', songCount: 0, soloCount: 0, duetCount: 0, source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' }, licensor: null }), songs: [], characters: [] };

function setup(show: ShowDetail, user: User | null = makeUser({ id: 7 }), extra: Parameters<typeof mockFetch>[0] = {}) {
  const api = mockFetch({
    [`GET /api/shows/${show.slug}`]: () => json(200, show),
    [`GET /api/shows/${show.id}/comments`]: () => json(200, { comments: [] }),
    'GET /api/songs': () => json(200, { songs, total: songs.length }),
    'GET /api/meta': () => json(200, makeMeta()),
    ...extra,
  });
  const view = renderWithProviders(<ShowDetailPage />, { route: `/shows/${show.slug}`, path: '/shows/:slug', user, songs, meta: makeMeta() });
  return { api, ...view };
}

afterEach(() => vi.unstubAllGlobals());

describe('ShowDetailPage', () => {
  it('renders the hero, credits, licensing, solos/duets and the cast', async () => {
    setup(hadestown, null);
    expect(await screen.findByTestId('show-title')).toHaveTextContent('Hadestown');
    await waitFor(() => expect(document.title).toContain('Hadestown'));
    expect(screen.getByTestId('show-credits')).toHaveTextContent('Music, lyrics & book by');
    expect(screen.getByText('Orpheus and Eurydice, retold with folk and jazz.')).toBeInTheDocument();
    const lic = screen.getByTestId('licensing-panel');
    expect(within(lic).getByTestId('licensing-status')).toHaveTextContent('Approved publisher');
    expect(lic).toHaveTextContent('Teen Edition');
    expect(lic).toHaveTextContent('Always confirm with your teacher');
    expect(within(screen.getByTestId('solos-section')).getAllByTestId('song-card')).toHaveLength(2);
    expect(within(screen.getByTestId('duets-section')).getAllByTestId('song-card')).toHaveLength(1);
    const cast = screen.getAllByTestId('character-card');
    expect(cast).toHaveLength(2);
    expect(within(cast[0]!).getByRole('link', { name: 'Flowers' })).toHaveAttribute('href', '/songs/17');
    expect(screen.getByTestId('add-song-from-show')).toHaveAttribute('href', '/add?show=hadestown');
    expect(screen.getByTestId('added-by')).toHaveTextContent('Added by Stage Kid');
    expect(screen.queryByTestId('edit-button')).toBeNull(); // logged out
    expect(await screen.findByTestId('comments-section')).toBeInTheDocument();
  });

  it('owners can edit (PUT + rename → new URL) but not delete a show that has songs', async () => {
    const { api, router } = setup(hadestown, makeUser({ id: 7 }), {
      'PUT /api/shows/5': (req) => json(200, { ...hadestown, ...req.body, slug: 'hadestown-teen-edition', songs: undefined, characters: undefined }),
    });
    fireEvent.click(await screen.findByTestId('edit-button'));
    expect(screen.queryByTestId('delete-button')).toBeNull();
    expect(screen.getByTestId('delete-blocked')).toHaveTextContent('remove its 3 songs first');
    const modal = screen.getByTestId('edit-show-modal');
    expect(within(modal).getByTestId('show-name')).toHaveValue('Hadestown');
    expect(within(modal).queryByTestId('show-licensing-note')).toBeNull(); // admins only
    fireEvent.change(within(modal).getByTestId('show-wiki-url'), { target: { value: 'https://example.com/x' } });
    fireEvent.click(screen.getByTestId('save-show'));
    expect(await within(modal).findByText(/Use a Wikipedia link/)).toBeInTheDocument();
    expect(api.calls('PUT /api/shows/5')).toHaveLength(0);
    fireEvent.change(within(modal).getByTestId('show-wiki-url'), { target: { value: 'https://en.wikipedia.org/wiki/Hadestown' } });
    fireEvent.change(within(modal).getByTestId('show-name'), { target: { value: 'Hadestown Teen Edition' } });
    fireEvent.change(within(modal).getByTestId('show-year'), { target: { value: '2023' } });
    fireEvent.click(screen.getByTestId('save-show'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/shows/hadestown-teen-edition'));
    const body = api.calls('PUT /api/shows/5')[0]?.body;
    expect(body).toMatchObject({ name: 'Hadestown Teen Edition', year: 2023, wikiUrl: 'https://en.wikipedia.org/wiki/Hadestown', composer: 'Anaïs Mitchell' });
    expect(body).not.toHaveProperty('licensingNote');
    expect(body).not.toHaveProperty('imageUrl');
  });

  it('admins get the licensing note field and can remove the poster', async () => {
    const { api } = setup(hadestown, makeUser({ id: 1, role: 'admin' }), {
      'PUT /api/shows/5': (req) => json(200, { ...hadestown, ...req.body, imageUrl: null }),
    });
    fireEvent.click(await screen.findByTestId('edit-button'));
    const modal = screen.getByTestId('edit-show-modal');
    fireEvent.change(within(modal).getByTestId('show-licensing-note'), { target: { value: 'Teen Edition only.' } });
    fireEvent.click(within(modal).getByTestId('show-poster-remove'));
    expect(modal).toHaveTextContent('The poster will be removed');
    fireEvent.click(screen.getByTestId('save-show'));
    await waitFor(() => expect(api.calls('PUT /api/shows/5')).toHaveLength(1));
    expect(api.calls('PUT /api/shows/5')[0]?.body).toMatchObject({ licensingNote: 'Teen Edition only.', imageUrl: null });
  });

  it('the song-catalog link: keep by default, "not in the catalog", or pick another catalog show', async () => {
    const linked = { ...hadestown, catalogShowId: 44 };
    const { api } = setup(linked, makeUser({ id: 1, role: 'admin' }), {
      'GET /api/catalog/shows/44': () => json(200, { id: 44, title: 'Hadestown', year: 2016, songCount: 33, wikiTitle: 'Hadestown', composer: null, lyricist: null, bookWriter: null, onSite: null, songs: [] }),
      'GET /api/catalog/search': () =>
        json(200, {
          results: [
            { type: 'show', id: 45, title: 'Hadestown', year: 2006, composer: 'Anaïs Mitchell', songCount: 20, onSite: null },
            { type: 'song', id: 9, title: 'Hadestown', show: { id: 44, title: 'Hadestown', year: 2016 }, singers: [], reprise: false, ensemble: true, onSite: null },
          ],
        }),
      'PUT /api/shows/5': (req) => json(200, { ...linked, ...req.body, songs: undefined, characters: undefined }),
    });
    fireEvent.click(await screen.findByTestId('edit-button'));
    const modal = screen.getByTestId('edit-show-modal');
    expect(await within(modal).findByTestId('catalog-link-current')).toHaveTextContent('Linked to Hadestown (2016) · 33 songs.');
    expect(within(modal).getByTestId('catalog-link-keep')).toBeChecked();
    // picking without choosing a show is caught before saving
    fireEvent.click(within(modal).getByTestId('catalog-link-pick'));
    fireEvent.click(screen.getByTestId('save-show'));
    expect(await within(modal).findByText(/Pick a catalog show from the search/)).toBeInTheDocument();
    expect(api.calls('PUT /api/shows/5')).toHaveLength(0);
    fireEvent.change(within(modal).getByTestId('catalog-link-search'), { target: { value: 'hades' } });
    const hits = await within(modal).findAllByTestId('catalog-link-hit', {}, { timeout: 3000 });
    expect(hits).toHaveLength(1); // shows only
    fireEvent.click(hits[0]!);
    expect(hits[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('save-show'));
    await waitFor(() => expect(api.calls('PUT /api/shows/5')).toHaveLength(1));
    expect(api.calls('PUT /api/shows/5')[0]?.body).toMatchObject({ catalogShowId: 45 });
  });

  it('the song-catalog link is not sent when left as it is; "not in the catalog" sends null', async () => {
    const { api } = setup(hadestown, makeUser({ id: 7 }), {
      'PUT /api/shows/5': (req) => json(200, { ...hadestown, ...req.body, songs: undefined, characters: undefined }),
    });
    fireEvent.click(await screen.findByTestId('edit-button'));
    const modal = screen.getByTestId('edit-show-modal');
    expect(within(modal).getByTestId('catalog-link-current')).toHaveTextContent('Not linked to the catalog.');
    fireEvent.click(screen.getByTestId('save-show'));
    await waitFor(() => expect(api.calls('PUT /api/shows/5')).toHaveLength(1));
    expect(api.calls('PUT /api/shows/5')[0]?.body).not.toHaveProperty('catalogShowId');
    fireEvent.click(await screen.findByTestId('edit-button'));
    fireEvent.click(within(screen.getByTestId('edit-show-modal')).getByTestId('catalog-link-none'));
    fireEvent.click(screen.getByTestId('save-show'));
    await waitFor(() => expect(api.calls('PUT /api/shows/5')).toHaveLength(2));
    expect(api.calls('PUT /api/shows/5')[1]?.body).toMatchObject({ catalogShowId: null });
  });

  it('deletes a show with no songs after confirming', async () => {
    const { api, router } = setup(empty, makeUser({ id: 7 }), { 'DELETE /api/shows/9': () => new Response(null, { status: 204 }) });
    expect(await screen.findByText('No songs here yet')).toBeInTheDocument();
    expect(screen.getByTestId('licensing-status')).toHaveTextContent('Licensor unknown');
    fireEvent.click(screen.getByTestId('delete-button'));
    fireEvent.click(await screen.findByTestId('confirm-button'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/shows'));
    expect(api.calls('DELETE /api/shows/9')).toHaveLength(1);
  });

  it('shows a friendly 404', async () => {
    mockFetch({ 'GET /api/shows/nope': () => json(404, { error: 'Show not found' }) });
    renderWithProviders(<ShowDetailPage />, { route: '/shows/nope', path: '/shows/:slug', meta: makeMeta() });
    expect(await screen.findByTestId('show-not-found')).toHaveTextContent('This show isn’t on our playbill');
    await waitFor(() => expect(document.title).toContain('Show not found'));
  });

  it('keeps the /shows poster-wall comment count in sync after commenting', async () => {
    function PosterWallCount() {
      const { shows } = useShows();
      const h = shows.find((x) => x.id === 5);
      return <p data-testid="wall-count">{h ? String(h.commentCount) : '-'}</p>;
    }
    mockFetch({
      [`GET /api/shows/${hadestown.slug}`]: () => json(200, hadestown),
      [`GET /api/shows/${hadestown.id}/comments`]: () => json(200, { comments: [] }),
      [`POST /api/shows/${hadestown.id}/comments`]: (req) =>
        json(201, makeComment({ id: 40, body: req.body.body, tag: req.body.tag, author: { id: 7, displayName: 'Stage Kid', role: 'user' } })),
      'GET /api/shows': () => json(200, { shows: [{ ...hadestown, commentCount: 0 }] }),
    });
    renderWithProviders(
      <>
        <ShowDetailPage />
        <PosterWallCount />
      </>,
      { route: `/shows/${hadestown.slug}`, path: '/shows/:slug', user: makeUser({ id: 7 }), songs, meta: makeMeta() },
    );
    await waitFor(() => expect(screen.getByTestId('wall-count')).toHaveTextContent('0'));
    fireEvent.change(await screen.findByTestId('comment-input'), { target: { value: 'Loved this show' } });
    fireEvent.click(screen.getByTestId('comment-submit'));
    await waitFor(() => expect(screen.getByTestId('wall-count')).toHaveTextContent('1'));
  });
});

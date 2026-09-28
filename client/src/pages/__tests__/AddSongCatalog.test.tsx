/**
 * "/add" catalog flow (SPEC §7c): find your song → (show song list) → pre-filled form with suggestion chips →
 * recording picker → album art + backing track uploads after the save.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import * as api from '../../api';
import { clearCatalogCaches } from '../../hooks/useCatalog';
import {
  candidate,
  catalogSong,
  catalogShowEmpty,
  catalogShowLesMis,
  suggestionsBringHimHome,
  suggestionsOneDayMore,
  suggestionsWizardAndI,
} from '../../test/catalogFixtures';
import { makeMeta, makeSong, makeUser, part } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import type { CatalogHit, Song } from '../../types';
import SongFormPage from '../SongFormPage';
import { json, mockFetch, type Handler } from './mockFetch';

vi.mock('../../components/Confetti', () => ({ fireConfetti: vi.fn(() => () => undefined), Confetti: () => null }));
vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return { ...actual, uploadSongArtwork: vi.fn(), uploadSongAudio: vi.fn() };
});
const mocked = vi.mocked(api);

const wicked = { id: 1, name: 'Wicked', slug: 'wicked', imageUrl: null };
const hadestown = { id: 2, name: 'Hadestown', slug: 'hadestown', imageUrl: null };
const lesMis = { id: 14, name: 'Les Misérables', slug: 'les-miserables', imageUrl: '/media/shows/les-miserables.png' };
const meta = makeMeta({
  shows: [
    { id: 1, name: 'Wicked', slug: 'wicked' },
    { id: 2, name: 'Hadestown', slug: 'hadestown' },
    { id: 14, name: 'Les Misérables', slug: 'les-miserables' },
  ],
});
const songs: Song[] = [
  makeSong({ id: 1, title: 'Popular', show: wicked, parts: [part('Glinda', 'Soprano')] }),
  makeSong({ id: 2, title: 'Flowers', show: hadestown, parts: [part('Eurydice', 'Soprano')] }),
  makeSong({ id: 99, title: 'Bring Him Home', show: lesMis, parts: [part('Jean Valjean', 'Tenor')] }),
];
const user = makeUser({ id: 7 });

const songHit = (o: Partial<Extract<CatalogHit, { type: 'song' }>> & { id: number; title: string }): CatalogHit => ({
  type: 'song',
  show: { id: 1, title: 'Les Misérables', year: 1980, onSite: { showId: 14, slug: 'les-miserables' } },
  singers: ['Jean Valjean'],
  reprise: false,
  ensemble: false,
  onSite: null,
  ...o,
});
const showHitLesMis: CatalogHit = { type: 'show', id: 1, title: 'Les Misérables', year: 1980, composer: 'Claude-Michel Schönberg', songCount: 27, onSite: { showId: 14, slug: 'les-miserables' } };

function searchHandler(): Handler {
  return (req) => {
    const q = (req.query.get('q') ?? '').toLowerCase();
    if (q.startsWith('bring')) return json(200, { results: [songHit({ id: 22, title: 'Bring Him Home', onSite: { songId: 99 } }), showHitLesMis] });
    if (q.startsWith('les')) return json(200, { results: [showHitLesMis, songHit({ id: 11, title: 'Stars', singers: ['Javert'] })] });
    if (q.startsWith('one day')) return json(200, { results: [songHit({ id: 13, title: 'One Day More', singers: ['Valjean', 'Marius', 'Cosette'], ensemble: true })] });
    return json(200, { results: [] });
  };
}

const recordings = [
  candidate({ trackId: 1, collectionName: 'Les Misérables (Original Broadway Cast Recording)', durationSeconds: 201 }),
  candidate({ trackId: 2, collectionName: 'Les Misérables (Original London Cast Recording)', durationSeconds: 214 }),
];

function routes(extra: Record<string, Handler> = {}) {
  return mockFetch({
    'GET /api/songs': () => json(200, { songs, total: songs.length }),
    'GET /api/meta': () => json(200, meta),
    'GET /api/catalog/search': searchHandler(),
    'GET /api/catalog/shows/1': () => json(200, catalogShowLesMis),
    'GET /api/catalog/shows/6': () => json(200, catalogShowEmpty),
    'GET /api/catalog/songs/22/suggestions': () => json(200, suggestionsBringHimHome()),
    'GET /api/catalog/songs/13/suggestions': () => json(200, suggestionsOneDayMore()),
    'GET /api/catalog/songs/22/recordings': () => json(200, { candidates: recordings }),
    'GET /api/catalog/songs/13/recordings': () => json(200, { candidates: [] }),
    'POST /api/songs': (req) =>
      json(201, makeSong({ id: 50, title: req.body.title, kind: req.body.kind, show: req.body.showId === 14 ? lesMis : wicked, source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' } })),
    ...extra,
  });
}

const renderAdd = (route = '/add') => renderWithProviders(<SongFormPage />, { route, path: '/add', user, songs, meta });
const params = (router: ReturnType<typeof renderAdd>['router']) => Object.fromEntries(new URLSearchParams(router.state.location.search));

afterEach(() => {
  vi.unstubAllGlobals();
  clearCatalogCaches();
});

// ============================================================================ step 1: find it
describe('Find your song', () => {
  it('searches as you type (debounced, 2+ letters) and opens the pre-filled form with the keyboard', async () => {
    const apiLog = routes();
    const { router } = renderAdd();
    expect(screen.getByRole('heading', { level: 1, name: 'Add a song' })).toBeInTheDocument();
    const input = screen.getByRole('combobox', { name: /Find your song/ });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('catalog-credit')).toHaveTextContent('Song list from Wikipedia');
    expect(screen.getByTestId('catalog-credit')).toHaveTextContent('CC BY-SA');

    fireEvent.change(input, { target: { value: 'b' } });
    fireEvent.change(input, { target: { value: 'br' } });
    fireEvent.change(input, { target: { value: 'bri' } });
    fireEvent.change(input, { target: { value: 'bring' } });
    const options = await screen.findAllByTestId('catalog-option');
    expect(apiLog.calls('GET /api/catalog/search').map((c) => c.query.get('q'))).toEqual(['bring']);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('data-type', 'song');
    expect(options[0]).toHaveTextContent('Bring Him Home');
    expect(options[0]).toHaveTextContent('from Les Misérables (1980) · Jean Valjean');
    expect(options[0]).toHaveTextContent('Solo');
    // on the site: a plain badge in the option (an option can't hold a link), the link itself below the listbox
    expect(within(options[0]!).getByTestId('catalog-onsite')).toHaveTextContent('Already in the songbook');
    expect(within(options[0]!).queryByRole('link')).toBeNull();
    expect(within(screen.getByTestId('catalog-listbox')).queryByRole('link')).toBeNull();
    expect(within(screen.getByTestId('catalog-onsite-links')).getByTestId('catalog-onsite-link')).toHaveAttribute('href', '/songs/99');
    expect(options[0]!.querySelector('mark')).toHaveTextContent('Bring');
    expect(options[1]).toHaveAttribute('data-type', 'show');
    expect(options[1]).toHaveTextContent('1980 · Claude-Michel Schönberg · 27 songs');
    expect(options[1]).toHaveTextContent('On the site');
    expect(screen.getByTestId('catalog-status')).toHaveTextContent('2 matches');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // wraps
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    fireEvent.keyDown(input, { key: 'Escape' }); // first Escape just drops the highlight
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(input).toHaveValue('bring');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(params(router)).toEqual({ catalogSong: '22', q: 'bring' }));
    expect(await screen.findByTestId('catalog-banner')).toHaveTextContent('Bring Him Home');
    expect(screen.getByTestId('song-title')).toHaveValue('Bring Him Home');

    // Back → the same search, answered from the cache
    await act(() => router.navigate(-1));
    expect(await screen.findByRole('combobox', { name: /Find your song/ })).toHaveValue('bring');
    expect(screen.getAllByTestId('catalog-option')).toHaveLength(2);
    expect(apiLog.calls('GET /api/catalog/search')).toHaveLength(1);
  });

  it('Enter without arrows takes the top match; Escape clears the box', async () => {
    routes();
    const { router } = renderAdd('/add?q=les');
    const input = screen.getByRole('combobox', { name: /Find your song/ });
    expect(input).toHaveValue('les');
    await screen.findAllByTestId('catalog-option');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'les' } });
    await screen.findAllByTestId('catalog-option');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(params(router)).toEqual({ catalogShow: '1', q: 'les' }));
  });

  it('no matches, a missing catalog and errors all leave "Enter it manually" one tap away', async () => {
    let status = 200;
    routes({ 'GET /api/catalog/search': (req) => (status === 200 ? searchHandler()(req) : json(status, { error: 'nope' })) });
    const { router } = renderAdd('/add?q=zzqq&kind=duet');
    expect(await screen.findByTestId('catalog-empty')).toHaveTextContent('No song or show matches “zzqq”');
    const manual = screen.getByTestId('enter-manually');
    expect(manual).toHaveAttribute('href', '/add?manual=1&kind=duet&q=zzqq');

    status = 404;
    fireEvent.change(screen.getByTestId('catalog-search'), { target: { value: 'hamilton' } });
    expect(await screen.findByTestId('catalog-error')).toHaveTextContent('The show catalog isn’t available right now');
    expect(within(screen.getByTestId('catalog-error')).queryByRole('button', { name: 'Try again' })).toBeNull();

    status = 500;
    fireEvent.change(screen.getByTestId('catalog-search'), { target: { value: 'hamilto' } });
    const err = await screen.findByTestId('catalog-error');
    expect(err).toHaveTextContent('We couldn’t search the catalog just now');
    status = 200;
    fireEvent.click(within(err).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('catalog-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('enter-manually'));
    await waitFor(() => expect(params(router)).toMatchObject({ manual: '1', kind: 'duet' }));
    expect(await screen.findByTestId('add-song-form')).toBeInTheDocument();
    expect(screen.getByTestId('song-kind-duet')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('song-title')).toHaveValue('');
  });

  it('a server without a loaded catalog (GET /api/catalog → available: false) says so instead of "no matches"', async () => {
    routes({
      'GET /api/catalog': () => json(200, { available: false, version: null, generatedAt: null, loadedAt: null, shows: 0, songs: 0 }),
      'GET /api/catalog/search': () => json(200, { results: [] }),
    });
    renderAdd('/add?q=wicked&kind=solo');
    const note = await screen.findByTestId('catalog-unavailable');
    expect(note).toHaveTextContent('The song catalog isn’t loaded on this server yet');
    expect(within(note).getByRole('link', { name: /Enter it manually/ })).toHaveAttribute('href', '/add?manual=1&kind=solo&q=wicked');
    await waitFor(() => expect(screen.getByTestId('catalog-status')).toHaveTextContent('isn’t loaded'));
    expect(screen.queryByTestId('catalog-empty')).toBeNull();
    expect(screen.queryByTestId('catalog-example')).toBeNull();
  });
});

// ============================================================================ a show's song list
describe('A show’s song list', () => {
  it('lists the songs by act with who sings them; picking one opens the form with a way back', async () => {
    routes();
    const { router } = renderAdd('/add?q=les');
    fireEvent.click((await screen.findAllByTestId('catalog-option'))[0]!);
    await waitFor(() => expect(params(router)).toEqual({ catalogShow: '1', q: 'les' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Which song from Les Misérables?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Act 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Act 2' })).toBeInTheDocument();
    const rows = screen.getAllByTestId('catalog-song');
    expect(rows).toHaveLength(5);
    expect(rows[2]).toHaveTextContent('One Day More');
    expect(rows[2]).toHaveTextContent('Group number');
    expect(rows[3]).toHaveTextContent('Éponine & Marius');
    expect(rows[3]).toHaveTextContent('Duet');
    expect(within(rows[0]!).getByTestId('catalog-song-onsite')).toHaveAttribute('href', '/songs/501');
    expect(screen.getByTestId('catalog-credit')).toBeInTheDocument();
    expect(screen.getByTestId('song-not-listed')).toHaveAttribute('href', '/add?manual=1&show=les-miserables&fromShow=1&q=les');
    expect(screen.getByTestId('catalog-back')).toHaveAttribute('href', '/add?q=les');

    fireEvent.click(within(rows[4]!).getByRole('link', { name: /Bring Him Home/ }));
    await waitFor(() => expect(params(router)).toEqual({ catalogSong: '22', fromShow: '1', q: 'les' }));
    expect(await screen.findByTestId('catalog-banner')).toBeInTheDocument();
    expect(screen.getByTestId('form-back')).toHaveAttribute('href', '/add?catalogShow=1&q=les');
  });

  it('a show with no song list: load the cast album’s tracks, or type the song in', async () => {
    const apiLog = routes({
      'POST /api/catalog/shows/6/recording-tracks': () =>
        json(200, {
          album: { collectionId: 1, collectionName: 'Come From Away (Original Broadway Cast Recording)' },
          added: 2,
          saved: true,
          songs: [catalogSong({ id: 61, title: 'Welcome to the Rock', source: 'recording' }), catalogSong({ id: 62, title: 'Me and the Sky', source: 'recording' })],
        }),
    });
    renderAdd('/add?catalogShow=6');
    expect(await screen.findByTestId('catalog-songs-empty')).toHaveTextContent('We don’t have a song list for Come From Away yet');
    expect(screen.getByTestId('song-not-listed')).toHaveAttribute('href', '/add?manual=1&catalogShow=6');
    fireEvent.click(screen.getByTestId('load-recording-tracks'));
    expect(await screen.findByTestId('recording-tracks-status')).toHaveTextContent('Loaded 2 tracks from “Come From Away (Original Broadway Cast Recording)”');
    expect(screen.getAllByTestId('catalog-song').map((r) => r.textContent)).toEqual([expect.stringContaining('Welcome to the Rock'), expect.stringContaining('Me and the Sky')]);
    expect(screen.getAllByTestId('catalog-song')[0]).toHaveTextContent('Cast album track');
    const call = apiLog.calls('POST /api/catalog/shows/6/recording-tracks');
    expect(call).toHaveLength(1);
    expect(call[0]!.headers['X-Requested-With']).toBe('star-song-finder'); // saving needs the CSRF header
    expect(apiLog.calls('GET /api/catalog/shows/6/recording-tracks')).toHaveLength(0);
  });

  it('a busy Apple Music (503 + Retry-After) says how long to wait; a preview that saved nothing can’t be picked', async () => {
    let busy = true;
    routes({
      'POST /api/catalog/shows/6/recording-tracks': () =>
        busy
          ? new Response(JSON.stringify({ error: 'Apple Music lookups are busy right now — try again in a minute' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json', 'Retry-After': '40' },
            })
          : json(200, {
              album: { collectionId: 1, collectionName: 'Come From Away (Original Broadway Cast Recording)' },
              added: 0,
              saved: false,
              songs: [{ ...catalogSong({ id: 61, title: 'Welcome to the Rock', source: 'recording' }), id: null }],
            }),
    });
    renderAdd('/add?catalogShow=6');
    fireEvent.click(await screen.findByTestId('load-recording-tracks'));
    await waitFor(() => expect(screen.getByTestId('recording-tracks-announcer')).toHaveTextContent('Apple Music is busy with other look-ups right now — try again in about 40 seconds.'));
    busy = false;
    fireEvent.click(screen.getByTestId('load-recording-tracks'));
    await waitFor(() => expect(screen.getByTestId('recording-tracks-announcer')).toHaveTextContent('couldn’t save its track list'));
    expect(screen.queryAllByTestId('catalog-song')).toHaveLength(0);
  });

  it('"My song isn’t listed" on a show that isn’t on the site: the new show comes with its catalog credits', async () => {
    const apiLog = routes({
      'GET /api/catalog/shows/6': () => json(200, catalogShowEmpty),
      'POST /api/shows': (req) => json(201, { id: 80, name: req.body.name, slug: 'come-from-away', imageUrl: null }),
      'POST /api/songs': (req) => json(201, makeSong({ id: 51, title: req.body.title, show: { id: 80, name: 'Come From Away', slug: 'come-from-away', imageUrl: null } })),
    });
    const { router } = renderAdd('/add?manual=1&catalogShow=6');
    expect(await screen.findByTestId('new-show-panel')).toHaveTextContent('New show: “Come From Away”');
    expect(screen.getByTestId('song-show')).toHaveValue('Come From Away');
    expect(screen.getByTestId('new-show-composer')).toHaveValue('Irene Sankoff');
    expect(screen.getByTestId('new-show-year')).toHaveValue('2013');
    expect(screen.getByTestId('new-show-catalog-note')).toHaveTextContent('Credits filled in from the show catalog');
    expect(screen.getByTestId('form-back')).toHaveAttribute('href', '/add?catalogShow=6');
    fireEvent.change(screen.getByTestId('song-title'), { target: { value: 'Me and the Sky' } });
    fireEvent.change(screen.getByTestId('part-1-character'), { target: { value: 'Beverley' } });
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/songs/51'));
    expect(apiLog.calls('POST /api/shows')[0]?.body).toMatchObject({ name: 'Come From Away', composer: 'Irene Sankoff', year: 2013, catalogShowId: 6 });
    expect(apiLog.calls('POST /api/songs')[0]?.body).toMatchObject({ showId: 80, title: 'Me and the Sky' });
    expect(apiLog.calls('POST /api/songs')[0]?.body.catalogSongId).toBeUndefined();
  });

  it('show pages link to /add?show=<slug>: the catalog song list when the catalog has the show, else the manual form', async () => {
    const apiLog = routes();
    const first = renderAdd('/add?show=les-miserables&kind=duet');
    await waitFor(() => expect(params(first.router)).toEqual({ catalogShow: '1', kind: 'duet' }));
    expect(apiLog.calls('GET /api/catalog/search')[0]?.query.get('q')).toBe('Les Misérables');
    expect(await screen.findByTestId('catalog-show')).toBeInTheDocument();
    first.unmount();

    routes();
    const second = renderAdd('/add?show=hadestown');
    await waitFor(() => expect(params(second.router)).toEqual({ manual: '1', show: 'hadestown' }));
    // the show is filled in once the form has resolved the slug (the field can appear a moment earlier)
    await waitFor(() => expect(screen.getByTestId('song-show')).toHaveValue('Hadestown'), { timeout: 5000 });
  });
});

// ============================================================================ the pre-filled form
describe('The form, pre-filled from the catalog', () => {
  it('fills every field with a suggestion chip, flags a song already in the songbook, and sends catalogSongId', async () => {
    const apiLog = routes();
    const { router } = renderAdd('/add?catalogSong=22&q=bring');
    expect(await screen.findByTestId('catalog-banner')).toHaveTextContent('Les Misérables (1980) · Act 2 · sung by Jean Valjean');
    expect(screen.getByTestId('song-title')).toHaveValue('Bring Him Home');
    expect(screen.getByTestId('song-show')).toHaveValue('Les Misérables');
    expect(screen.getByTestId('song-kind-solo')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('kind-suggestion')).toHaveTextContent('sung by Jean Valjean');
    expect(screen.getByTestId('part-1-character')).toHaveValue('Jean Valjean');
    expect(screen.getByTestId('part-1-range')).toHaveValue('Tenor');
    expect(screen.getByTestId('part-1-range-suggestion')).toHaveTextContent('from 3 other Les Misérables songs on the site');
    expect(screen.getByTestId('song-genre')).toHaveValue('Drama');
    expect(screen.getByTestId('song-subgenre')).toHaveValue('Longing');
    expect(screen.getByTestId('title-suggestion')).toHaveTextContent('from the Wikipedia song list');
    expect(screen.getByTestId('title-suggestion')).toHaveTextContent('high');
    expect(screen.getByTestId('song-title')).toHaveAccessibleDescription(expect.stringContaining('Suggested from the Wikipedia song list, high confidence.'));

    // already in the songbook (as a solo) → friendly callout
    const already = screen.getByTestId('already-on-site');
    expect(already).toHaveTextContent('Already in the songbook!');
    expect(already).toHaveTextContent('would be a duplicate');
    // one character sings it in the show, so there's no nudge toward a duet version
    expect(already).not.toHaveTextContent('switch to');
    expect(within(already).getByTestId('already-on-site-link')).toHaveAttribute('href', '/songs/99');
    fireEvent.click(screen.getByTestId('song-kind-duet'));
    expect(screen.getByTestId('already-on-site-advice')).toHaveTextContent('In the show one character sings it — only add a duet version if that’s really how you’ll perform it.');
    expect(screen.getByTestId('already-on-site')).not.toHaveTextContent('Great');
    expect(screen.getByTestId('kind-suggestion')).toHaveAttribute('data-state', 'changed');
    fireEvent.click(screen.getByTestId('kind-suggestion-apply'));
    expect(screen.getByTestId('song-kind-solo')).toHaveAttribute('aria-checked', 'true');

    // clear + bring back; alternatives are one tap
    fireEvent.click(screen.getByTestId('title-suggestion-clear'));
    expect(screen.getByTestId('song-title')).toHaveValue('');
    fireEvent.click(screen.getByTestId('title-suggestion-apply'));
    expect(screen.getByTestId('song-title')).toHaveValue('Bring Him Home');
    fireEvent.click(within(screen.getByTestId('genre-suggestion')).getByRole('button', { name: 'Romantic' }));
    expect(screen.getByTestId('song-genre')).toHaveValue('Romantic');
    // typing in a field keeps its suggestion
    fireEvent.change(screen.getByTestId('song-subgenre'), { target: { value: 'Hopeful' } });
    expect(screen.getByTestId('subgenre-suggestion')).toHaveTextContent('Suggested: Longing');

    // the best recording is picked for you → 30-sec preview + length
    expect(await screen.findByTestId('chosen-preview')).toHaveTextContent('Best match — picked for you');
    expect(screen.getByTestId('song-length')).toHaveValue('3:21');
    expect(screen.getByTestId('length-suggestion')).toHaveTextContent('from Les Misérables (Original Broadway Cast Recording)');
    expect(screen.getByTestId('length-suggestion')).toHaveTextContent('That’s the length of the cast recording');
    expect(screen.getByTestId('length-suggestion')).not.toHaveTextContent('6:00');

    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/songs/50'));
    expect(apiLog.calls('POST /api/songs')[0]?.body).toEqual({
      kind: 'solo',
      title: 'Bring Him Home',
      showId: 14,
      genre: 'Romantic',
      subGenre: 'Hopeful',
      lengthSeconds: 201,
      mature: false,
      notes: null,
      parts: [{ character: 'Jean Valjean', vocalRange: 'Tenor' }],
      audioLink: null,
      catalogSongId: 22,
      preview: expect.objectContaining({ itunesTrackId: 1, recordingName: 'Les Misérables (Original Broadway Cast Recording)' }),
    });
  });

  it('picking another recording updates the length suggestion (and the length, unless you typed your own)', async () => {
    routes();
    renderAdd('/add?catalogSong=22');
    await screen.findByTestId('chosen-preview');
    expect(screen.getByTestId('song-length')).toHaveValue('3:21');
    fireEvent.click(screen.getByTestId('use-preview-1'));
    expect(screen.getByTestId('song-length')).toHaveValue('3:34');
    expect(screen.getByTestId('length-suggestion')).toHaveTextContent('from Les Misérables (Original London Cast Recording)');
    fireEvent.change(screen.getByTestId('song-length'), { target: { value: '4:05' } });
    fireEvent.click(screen.getByTestId('use-preview-0'));
    expect(screen.getByTestId('song-length')).toHaveValue('4:05');
    expect(screen.getByTestId('length-suggestion')).toHaveTextContent('Suggested: 3:21');
    fireEvent.click(screen.getByTestId('length-suggestion-apply'));
    expect(screen.getByTestId('song-length')).toHaveValue('3:21');
    // "No recording" drops the preview and its length suggestion
    fireEvent.click(screen.getByTestId('no-recording'));
    expect(screen.queryByTestId('chosen-preview')).toBeNull();
    expect(screen.queryByTestId('length-suggestion')).toBeNull();
  });

  it('group numbers: a note instead of a guess; singer chips swap in their vocal range; a duet brings the next singer', async () => {
    routes();
    renderAdd('/add?catalogSong=13');
    expect(await screen.findByTestId('kind-note')).toHaveTextContent('An ensemble number led by');
    expect(screen.queryByTestId('kind-suggestion')).toBeNull();
    expect(screen.getByTestId('part-1-character')).toHaveValue('Jean Valjean');
    expect(screen.getByTestId('part-1-range')).toHaveValue('Tenor');
    const chip = screen.getByTestId('part-1-character-suggestion');
    expect(chip).toHaveTextContent('Use the first character for a solo');
    fireEvent.click(within(chip).getByRole('button', { name: 'Cosette' }));
    expect(screen.getByTestId('part-1-character')).toHaveValue('Cosette');
    expect(screen.getByTestId('part-1-range')).toHaveValue('Soprano');
    fireEvent.click(within(screen.getByTestId('part-1-character-suggestion')).getByRole('button', { name: 'Marius' }));
    expect(screen.getByTestId('part-1-character')).toHaveValue('Marius');
    expect(screen.getByTestId('part-1-range')).toHaveValue(''); // no known range — the suggested one isn't kept
    fireEvent.click(screen.getByTestId('part-1-character-suggestion-apply'));
    expect(screen.getByTestId('part-1-character')).toHaveValue('Jean Valjean');
    fireEvent.click(screen.getByTestId('song-kind-duet'));
    expect(screen.getByTestId('part-2-character')).toHaveValue('Marius');
    expect(screen.getByTestId('recordings-status')).toHaveTextContent('couldn’t find a cast recording');
  });

  it('picking a different show drops the catalog link', async () => {
    const apiLog = routes();
    const { router } = renderAdd('/add?catalogSong=22');
    await screen.findByTestId('catalog-banner');
    const input = screen.getByTestId('song-show');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Wicked' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('Wicked');
    expect(screen.getByTestId('catalog-banner')).toHaveTextContent('won’t be linked to the catalog song');
    expect(screen.getByTestId('show-suggestion-chip')).toHaveTextContent('Suggested: Les Misérables');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/songs/50'));
    expect(apiLog.calls('POST /api/songs')[0]?.body).toMatchObject({ showId: 1 });
    expect(apiLog.calls('POST /api/songs')[0]?.body.catalogSongId).toBeUndefined();
  });

  it('a catalog show that isn’t on the site: typed in as a new show with its credits and catalogShowId', async () => {
    const s = suggestionsWizardAndI();
    const fresh = { ...s, show: { ...s.show, name: 'The Last Five Years', composer: 'Jason Robert Brown', lyricist: 'Jason Robert Brown', bookWriter: 'Jason Robert Brown', year: 2001 } };
    const apiLog = routes({
      'GET /api/catalog/songs/31/suggestions': () => json(200, fresh),
      'GET /api/catalog/songs/31/recordings': () => json(200, { candidates: [] }),
      'POST /api/shows': (req) => json(201, { id: 90, name: req.body.name, slug: 'the-last-five-years', imageUrl: null }),
    });
    renderAdd('/add?catalogSong=31');
    expect(await screen.findByTestId('new-show-panel')).toHaveTextContent('New show: “The Last Five Years”');
    expect(screen.getByTestId('new-show-composer')).toHaveValue('Jason Robert Brown');
    expect(screen.getByTestId('song-genre')).toHaveValue('__other__');
    expect(screen.getByTestId('song-genre-other')).toHaveValue('Tragicomedy');
    expect(screen.getByTestId('genre-suggestion')).toHaveTextContent('low');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(apiLog.calls('POST /api/songs')).toHaveLength(1));
    expect(apiLog.calls('POST /api/shows')[0]?.body).toMatchObject({ name: 'The Last Five Years', composer: 'Jason Robert Brown', year: 2001, catalogShowId: 3, bookWriter: 'Jason Robert Brown' });
    expect(apiLog.calls('POST /api/songs')[0]?.body).toMatchObject({ showId: 90, catalogSongId: 31, title: 'The Wizard and I' });
  });

  it('opening the form isn’t an unsaved change; editing it is (the steps share one page)', async () => {
    routes();
    const { router } = renderAdd('/add?catalogSong=22&q=bring');
    await screen.findByTestId('chosen-preview'); // the automatic pick doesn't count either
    fireEvent.change(screen.getByTestId('song-notes'), { target: { value: 'Big finish — needs a cut.' } });
    fireEvent.click(screen.getByTestId('form-back'));
    expect(await screen.findByTestId('leave-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    fireEvent.change(screen.getByTestId('song-notes'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('form-back'));
    await waitFor(() => expect(params(router)).toEqual({ q: 'bring' }));
    expect(screen.queryByTestId('leave-confirm')).toBeNull();
  });

  it('shows a friendly state when the catalog song is gone, with the manual form one tap away', async () => {
    routes({ 'GET /api/catalog/songs/404/suggestions': () => json(404, { error: 'Song not found in the catalog' }) });
    renderAdd('/add?catalogSong=404');
    expect(await screen.findByText('That song isn’t in the catalog')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Enter it manually' })).toHaveAttribute('href', '/add?manual=1');
  });
});

// ============================================================================ the last step: art + audio
describe('Album art & backing track (last step)', () => {
  it('upload after the song is created, with progress; a failed upload still saves the song', async () => {
    const apiLog = routes();
    let finishArt: (s: Song) => void = () => undefined;
    let artProgress: (n: number) => void = () => undefined;
    mocked.uploadSongArtwork.mockImplementation((_id, _file, opts) => {
      artProgress = opts?.onProgress ?? (() => undefined);
      return new Promise<Song>((resolve) => (finishArt = resolve));
    });
    mocked.uploadSongAudio.mockRejectedValue(new api.ApiError(413, 'You’ve used all your upload space (200 MB)'));
    const { router } = renderAdd('/add?catalogSong=22');
    await screen.findByTestId('chosen-preview');

    // the recording's art is used until you upload your own
    expect(screen.getByTestId('song-art-preview')).toHaveAttribute('data-state', 'recording');
    const art = new File([new Uint8Array(3000)], 'cover.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('song-art-file-input'), { target: { files: [new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })] } });
    expect(screen.getByTestId('song-art-upload-error')).toHaveTextContent('SVG');
    fireEvent.change(screen.getByTestId('song-art-file-input'), { target: { files: [art] } });
    expect(screen.getByTestId('song-art-preview')).toHaveAttribute('data-state', 'pending');
    expect(screen.getByTestId('song-art-use-recording')).toBeInTheDocument();
    const mp3 = new File([new Uint8Array(4096)], 'backing.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByTestId('song-audio-file-input'), { target: { files: [mp3] } });
    expect(screen.getByTestId('song-audio-pending')).toHaveTextContent('backing.mp3');

    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(mocked.uploadSongArtwork).toHaveBeenCalledWith(50, art, expect.objectContaining({ onProgress: expect.any(Function), signal: expect.any(AbortSignal) })));
    expect(apiLog.calls('POST /api/songs')).toHaveLength(1);
    act(() => artProgress(0.5));
    expect(screen.getByTestId('submit-song')).toHaveTextContent('Uploading album art… 50%');
    expect(screen.getByRole('progressbar', { name: 'Uploading album art cover.png' })).toHaveAttribute('aria-valuenow', '50');
    await act(async () => finishArt(makeSong({ id: 50, title: 'Bring Him Home', show: lesMis, media: { ...makeSong().media, artworkUrl: '/uploads/art/new.png', artworkSource: 'upload' } })));

    await waitFor(() => expect(router.state.location.pathname).toBe('/songs/50'));
    expect(mocked.uploadSongAudio).toHaveBeenCalledWith(50, mp3, expect.any(Object));
    expect(await screen.findByText(/Your song is saved, but the backing track \(You’ve used all your upload space/)).toBeInTheDocument();
  });

  it('Cancel skips an upload and says so', async () => {
    routes();
    mocked.uploadSongArtwork.mockImplementation(
      (_id, _file, opts) =>
        new Promise<Song>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')));
        }),
    );
    const { router } = renderAdd('/add?catalogSong=22');
    await screen.findByTestId('chosen-preview');
    fireEvent.change(screen.getByTestId('song-art-file-input'), { target: { files: [new File([new Uint8Array(10)], 'c.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(screen.getByTestId('submit-song'));
    fireEvent.click(await screen.findByTestId('song-art-upload-cancel'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/songs/50'));
    expect(await screen.findByText(/you skipped the album art/)).toBeInTheDocument();
  });
});

// ============================================================================ review fixes (catalog UX + a11y)
describe('Find step: Enter before results, copy', () => {
  it('Enter pressed before the results arrive opens the top match as soon as they do', async () => {
    routes();
    const { router } = renderAdd();
    const input = screen.getByRole('combobox', { name: /Find your song/ });
    fireEvent.change(input, { target: { value: 'les' } });
    fireEvent.keyDown(input, { key: 'Enter' }); // the search hasn't even been sent yet (debounce)
    expect(screen.getByTestId('catalog-status')).toHaveTextContent('Still searching');
    await waitFor(() => expect(params(router)).toEqual({ catalogShow: '1', q: 'les' }));
  });

  it('typing again after an early Enter forgets it', async () => {
    routes();
    const { router } = renderAdd();
    const input = screen.getByRole('combobox', { name: /Find your song/ });
    fireEvent.change(input, { target: { value: 'bring' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'bring him' } });
    await screen.findAllByTestId('catalog-option');
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(params(router).catalogSong).toBeUndefined();
    expect(screen.getByTestId('catalog-status')).toHaveTextContent('2 matches');
  });

  it('a show with no song list says so plainly (not "song list coming")', async () => {
    routes({
      'GET /api/catalog/search': () =>
        json(200, { results: [{ type: 'show', id: 7, title: 'Opening Night', year: 2024, composer: 'Rufus Wainwright', songCount: 0, onSite: null }] }),
    });
    renderAdd('/add?q=opening');
    const [option] = await screen.findAllByTestId('catalog-option');
    expect(option).toHaveTextContent('2024 · Rufus Wainwright · no song list yet');
    expect(option).not.toHaveTextContent('coming');
    expect(screen.queryByTestId('catalog-onsite-links')).toBeNull();
  });
});

describe('One step model everywhere (1 Find it · 2 Check it · 3 Add art & audio)', () => {
  it('the show list is still "Find it", the form "Check it", and art & audio is step 3', async () => {
    routes();
    const { router } = renderAdd('/add?catalogShow=1&q=les');
    expect(await screen.findByText('Step 1 of 3 · Find it — pick your song')).toBeInTheDocument();
    fireEvent.click(within(screen.getAllByTestId('catalog-song')[4]!).getByRole('link', { name: /Bring Him Home/ }));
    await waitFor(() => expect(params(router)).toMatchObject({ catalogSong: '22' }));
    expect(await screen.findByText('Step 2 of 3 · Check it')).toBeInTheDocument();
    expect(screen.getByText(/^Step 3 of 3 · Optional — both upload when you save/)).toBeInTheDocument();
    expect(screen.queryByText(/of 2/)).toBeNull();
  });
});

describe('Recording picker in the form: wrong audio is worse than none', () => {
  const weak = [
    candidate({ trackId: 7, trackName: 'Bring Him Home', collectionName: 'Bring Him Home - Single', artistName: 'A Pop Singer', durationSeconds: 211, score: 81, castAlbum: false, albumLabel: null }),
  ];

  it('no cast recording → nothing picked, no length filled in; a recording picked on purpose says it’s "this recording’s length"', async () => {
    routes({ 'GET /api/catalog/songs/22/recordings': () => json(200, { candidates: weak }) });
    renderAdd('/add?catalogSong=22');
    expect(await screen.findByTestId('recordings-unsure')).toHaveTextContent('Possible match — listen first');
    expect(screen.queryByTestId('chosen-preview')).toBeNull();
    expect(screen.getByTestId('song-length')).toHaveValue('');
    expect(screen.queryByTestId('length-suggestion')).toBeNull();
    expect(screen.getAllByTestId('preview-candidate')[0]).not.toHaveTextContent('Best match');

    fireEvent.click(screen.getByTestId('use-preview-0'));
    expect(screen.getByTestId('song-length')).toHaveValue('3:31');
    const chip = screen.getByTestId('length-suggestion');
    expect(chip).toHaveTextContent('That’s this recording’s length — your version may differ.');
    expect(chip).not.toHaveTextContent('cast');
    expect(chip).not.toHaveTextContent('6:00');
  });
});

describe('"Already in the songbook" callout', () => {
  const solo = { id: 99, title: 'One Day More', kind: 'solo' as const };
  const duet = { id: 100, title: 'One Day More', kind: 'duet' as const };

  it('a group number on the site as a solo: suggests a duet version (it can be one, and it isn’t there yet)', async () => {
    routes({ 'GET /api/catalog/songs/13/suggestions': () => json(200, { ...suggestionsOneDayMore(), existingSong: solo, existingSongs: [solo] }) });
    renderAdd('/add?catalogSong=13');
    const advice = await screen.findByTestId('already-on-site-advice');
    expect(advice).toHaveTextContent('would be a duplicate — leave a tip in its comments instead, or switch to a duet if that’s the version you sing.');
    fireEvent.click(screen.getByTestId('song-kind-duet'));
    expect(screen.getByTestId('already-on-site-advice')).toHaveTextContent('Adding it as a duet version? Great — keep going.');
  });

  it('on the site as a solo AND a duet: both are duplicates — no nudge, and "Open it" goes to the matching version', async () => {
    routes({ 'GET /api/catalog/songs/13/suggestions': () => json(200, { ...suggestionsOneDayMore(), existingSong: solo, existingSongs: [solo, duet] }) });
    renderAdd('/add?catalogSong=13');
    const callout = await screen.findByTestId('already-on-site');
    expect(callout).toHaveTextContent('is on the site as a solo and a duet');
    expect(screen.getByTestId('already-on-site-advice')).toHaveTextContent('Adding it again as a solo would be a duplicate — leave a tip in its comments instead.');
    expect(screen.getByTestId('already-on-site-link')).toHaveAttribute('href', '/songs/99');
    fireEvent.click(screen.getByTestId('song-kind-duet'));
    expect(screen.getByTestId('already-on-site-advice')).toHaveTextContent('Adding it again as a duet would be a duplicate');
    expect(screen.getByTestId('already-on-site-advice')).not.toHaveTextContent('Great');
    expect(screen.getByTestId('already-on-site-link')).toHaveAttribute('href', '/songs/100');
  });
});

describe('Catalog banner credit', () => {
  it('a song from a cast album’s track list credits Apple Music, not Wikipedia', async () => {
    const s = suggestionsBringHimHome();
    routes({ 'GET /api/catalog/songs/22/suggestions': () => json(200, { ...s, catalogSong: { ...s.catalogSong, source: 'recording' } }) });
    renderAdd('/add?catalogSong=22');
    const banner = await screen.findByTestId('catalog-banner');
    expect(within(banner).getByTestId('recording-list-credit')).toHaveTextContent('Track list from Apple Music');
    expect(within(banner).queryByTestId('catalog-credit')).toBeNull();
    expect(banner).not.toHaveTextContent('Wikipedia');
  });

  it('a Wikipedia song keeps the CC BY-SA credit', async () => {
    routes();
    renderAdd('/add?catalogSong=22');
    const banner = await screen.findByTestId('catalog-banner');
    expect(within(banner).getByTestId('catalog-credit')).toHaveTextContent('Song list from Wikipedia');
    expect(within(banner).queryByTestId('recording-list-credit')).toBeNull();
  });
});

describe('Keyboard focus stays put', () => {
  it('"More moods…" stays in place as a toggle (focus isn’t dropped to <body>)', async () => {
    routes();
    renderAdd('/add?catalogSong=22');
    const toggle = await screen.findByTestId('more-moods');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByTestId('subgenre-chip')).toHaveLength(0);
    act(() => toggle.focus());
    fireEvent.click(toggle);
    expect(screen.getByTestId('more-moods')).toBe(toggle);
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent('Fewer moods');
    expect(screen.getAllByTestId('subgenre-chip').length).toBeGreaterThan(0);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByTestId('subgenre-chip')).toHaveLength(0);
  });

  it('loading a cast album’s tracks moves focus to the new list and announces it through a region that was already there', async () => {
    routes({
      'POST /api/catalog/shows/6/recording-tracks': () =>
        json(200, {
          album: { collectionId: 1, collectionName: 'Come From Away (Original Broadway Cast Recording)' },
          added: 2,
          saved: true,
          songs: [catalogSong({ id: 61, title: 'Welcome to the Rock', source: 'recording' }), catalogSong({ id: 62, title: 'Me and the Sky', source: 'recording' })],
        }),
    });
    renderAdd('/add?catalogShow=6');
    await screen.findByTestId('catalog-songs-empty');
    const announcer = screen.getByTestId('recording-tracks-announcer');
    expect(announcer).toHaveAttribute('aria-live', 'polite');
    expect(announcer).toBeEmptyDOMElement();
    const button = screen.getByTestId('load-recording-tracks');
    act(() => button.focus());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('heading', { name: /Tracks on the cast album/ })).toHaveFocus());
    expect(screen.getByTestId('recording-tracks-announcer')).toBe(announcer); // the same node, now with the news
    expect(announcer).toHaveTextContent('Loaded 2 tracks from “Come From Away (Original Broadway Cast Recording)”');
    expect(screen.getByTestId('recording-tracks-status')).not.toHaveAttribute('role');
    // the list came from Apple, so the footer credits Apple Music, not Wikipedia
    expect(screen.getByTestId('recording-list-credit')).toHaveTextContent('Track list from Apple Music');
    expect(screen.queryByTestId('catalog-credit')).toBeNull();
  });

  it('a failed cast-album lookup is announced in the same region and keeps focus on the button', async () => {
    routes({ 'POST /api/catalog/shows/6/recording-tracks': () => json(404, { error: 'No cast album' }) });
    renderAdd('/add?catalogShow=6');
    const button = await screen.findByTestId('load-recording-tracks');
    act(() => button.focus());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('recording-tracks-announcer')).toHaveTextContent('We couldn’t find a cast album for this show.'));
    expect(button).toHaveFocus();
  });
});

describe('Character suggestions', () => {
  it('never offers the same person twice (the site’s "Marius" and the catalog’s "Marius Pontmercy")', async () => {
    const s = suggestionsBringHimHome();
    routes({
      'GET /api/catalog/songs/15/suggestions': () =>
        json(200, {
          ...s,
          catalogSong: { id: 15, title: 'Valjean’s Confession', act: 2, singers: ['Jean Valjean', 'Marius Pontmercy'], singersRaw: '', ensemble: false, reprise: false },
          existingSong: null,
          title: { value: 'Valjean’s Confession', source: 'from the Wikipedia song list', confidence: 'high' },
          kind: { value: 'duet', source: 'from the Wikipedia song list (sung by Jean Valjean and Marius Pontmercy)', confidence: 'high' },
          parts: {
            value: [
              { character: 'Jean Valjean', vocalRange: 'Tenor' },
              { character: 'Marius', catalogName: 'Marius Pontmercy', vocalRange: 'Tenor' },
            ],
            source: 'from the Wikipedia song list',
            confidence: 'high',
          },
        }),
      'GET /api/catalog/songs/15/recordings': () => json(200, { candidates: [] }),
    });
    renderAdd('/add?catalogSong=15');
    expect(await screen.findByTestId('part-2-character')).toHaveValue('Marius');
    const alts = (n: number) => within(screen.getByTestId(`part-${n}-character-suggestion`)).queryAllByTestId(`part-${n}-character-suggestion-alt`).map((b) => b.textContent);
    expect(alts(1)).toEqual(['Marius']);
    expect(alts(2)).toEqual(['Jean Valjean']);
    const listId = screen.getByTestId('part-1-character').getAttribute('list');
    const options = [...(document.getElementById(listId!)?.querySelectorAll('option') ?? [])].map((o) => o.getAttribute('value'));
    expect(options).toContain('Marius');
    expect(options).not.toContain('Marius Pontmercy');
  });
});

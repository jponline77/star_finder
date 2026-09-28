import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeMeta, makeSong, makeUser, part } from '../../test/fixtures';
import type { Song } from '../../types';
import SongFormPage from '../SongFormPage';
import { json, mockFetch } from './mockFetch';
import { fireConfetti } from '../../components/Confetti';
import * as apiModule from '../../api';

vi.mock('../../components/Confetti', () => ({ fireConfetti: vi.fn(() => () => undefined), Confetti: () => null }));
vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return { ...actual, uploadSongArtwork: vi.fn(), uploadSongAudio: vi.fn() };
});
const mockedApi = vi.mocked(apiModule);

const wicked = { id: 1, name: 'Wicked', slug: 'wicked', imageUrl: null };
const hadestown = { id: 2, name: 'Hadestown', slug: 'hadestown', imageUrl: '/media/shows/hadestown.png' };
const meta = makeMeta({
  shows: [
    { id: 1, name: 'Wicked', slug: 'wicked' },
    { id: 2, name: 'Hadestown', slug: 'hadestown' },
  ],
});
const songs: Song[] = [
  makeSong({ id: 1, title: 'Popular', show: wicked, parts: [part('Glinda', 'Soprano')] }),
  makeSong({ id: 2, title: 'Flowers', show: hadestown, parts: [part('Eurydice', 'Soprano')] }),
  makeSong({ id: 3, title: 'Wedding Song', kind: 'duet', show: hadestown, parts: [part('Orpheus', 'Tenor', 1), part('Eurydice', 'Soprano', 2)] }),
];
const user = makeUser({ id: 7 });

/** Default API: list reloads + echo creates. */
function routes(extra: Parameters<typeof mockFetch>[0] = {}) {
  return mockFetch({
    'GET /api/songs': () => json(200, { songs, total: songs.length }),
    'GET /api/meta': () => json(200, meta),
    'POST /api/songs': (req) =>
      json(201, makeSong({ id: 50, title: req.body.title, kind: req.body.kind, show: req.body.showId === 2 ? hadestown : wicked, source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' } })),
    ...extra,
  });
}

const renderAdd = (route = '/add?manual=1') => renderWithProviders(<SongFormPage />, { route, path: '/add', user, songs, meta });

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

function pickShow(text: string) {
  const input = screen.getByTestId('song-show');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SongFormPage — add', () => {
  it('adds a solo end-to-end: combobox, auto-filled range, length, submit → song page', async () => {
    const api = routes();
    const { router } = renderAdd();
    expect(screen.getByRole('heading', { level: 1, name: 'Add a song' })).toBeInTheDocument();

    const input = screen.getByTestId('song-show');
    fireEvent.change(input, { target: { value: 'wic' } });
    const listbox = screen.getByTestId('song-show-listbox');
    expect(within(listbox).getAllByTestId('song-show-option')).toHaveLength(1);
    expect(within(listbox).getByTestId('song-show-new')).toHaveTextContent('Add new show: “wic”');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('Wicked');
    expect(input).toHaveAttribute('aria-expanded', 'false');

    type('song-title', 'The Wizard and I');
    type('part-1-character', 'glinda');
    expect(screen.getByTestId('part-1-range')).toHaveValue('Soprano'); // from "Popular"
    fireEvent.change(screen.getByTestId('song-genre'), { target: { value: 'Drama' } });
    type('song-subgenre', 'Hopeful');
    type('song-length', '325');
    fireEvent.blur(screen.getByTestId('song-length'));
    expect(screen.getByTestId('song-length')).toHaveValue('3:25');
    fireEvent.click(screen.getByTestId('song-mature'));
    type('song-notes', 'Cut the second verse.');

    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/songs/50'));
    expect(fireConfetti).toHaveBeenCalled();
    const [post] = api.calls('POST /api/songs');
    expect(post?.headers['X-Requested-With']).toBe('star-song-finder');
    expect(post?.body).toEqual({
      kind: 'solo',
      title: 'The Wizard and I',
      showId: 1,
      genre: 'Drama',
      subGenre: 'Hopeful',
      lengthSeconds: 205,
      mature: true,
      notes: 'Cut the second verse.',
      parts: [{ character: 'glinda', vocalRange: 'Soprano' }],
      audioLink: null,
    });
  });

  it('solo ↔ duet toggles part 2 and keeps part 1 (and the stashed part 2)', () => {
    routes();
    renderAdd();
    type('part-1-character', 'Elphaba');
    fireEvent.click(screen.getByTestId('song-kind-duet'));
    expect(screen.getByTestId('song-kind-duet')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('part-1-character')).toHaveValue('Elphaba');
    type('part-2-character', 'Glinda');
    fireEvent.click(screen.getByTestId('song-kind-solo'));
    expect(screen.queryByTestId('part-2-character')).toBeNull();
    expect(screen.getByTestId('part-1-character')).toHaveValue('Elphaba');
    fireEvent.click(screen.getByTestId('song-kind-duet'));
    expect(screen.getByTestId('part-2-character')).toHaveValue('Glinda');
  });

  it('shows an error summary and never calls the API when required fields are missing', async () => {
    const api = routes();
    renderAdd('/add?manual=1&kind=duet');
    expect(screen.getByTestId('song-kind-duet')).toHaveAttribute('aria-checked', 'true');
    type('song-length', '9:99');
    fireEvent.click(screen.getByTestId('submit-song'));
    const summary = await screen.findByTestId('form-error-summary');
    expect(summary).toHaveTextContent('Fix these 5 things');
    expect(summary).toHaveTextContent('Give the song a title.');
    expect(summary).toHaveTextContent('Seconds go up to 59');
    expect(screen.getByTestId('song-title')).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls('POST /api/songs')).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('song-show')));
  });

  it('turns a 409 into a friendly “already on the list” link', async () => {
    routes({ 'POST /api/songs': () => json(409, { error: 'That song is already on the list', details: { existingId: '2', title: 'That song is already on the list' } }) });
    renderAdd();
    pickShow('hadestown');
    type('song-title', 'flowers');
    type('part-1-character', 'Eurydice');
    fireEvent.click(screen.getByTestId('submit-song'));
    const dup = await screen.findByTestId('duplicate-song');
    expect(dup).toHaveTextContent('Great minds think alike!');
    expect(within(dup).getByRole('link', { name: /See the existing song/ })).toHaveAttribute('href', '/songs/2');
  });

  it('maps server 400 details onto the fields', async () => {
    routes({ 'POST /api/songs': () => json(400, { error: 'Please fix the highlighted fields', details: { 'parts.0.vocalRange': 'Pick a vocal range', audioLink: 'Audio link must be a valid https:// link' } }) });
    renderAdd();
    pickShow('Wicked');
    type('song-title', 'Dancing Through Life');
    type('part-1-character', 'Fiyero');
    fireEvent.click(screen.getByTestId('submit-song'));
    expect(await screen.findByText('Pick a vocal range', { selector: '.field-error' })).toBeInTheDocument();
    expect(screen.getByText('Audio link must be a valid https:// link', { selector: '.field-error' })).toBeInTheDocument();
    expect(screen.getByTestId('part-1-range')).toHaveAttribute('aria-invalid', 'true');
  });

  it('new show without details → sends showName', async () => {
    const api = routes();
    renderAdd();
    pickShow('Hamilton');
    expect(screen.getByTestId('new-show-panel')).toHaveTextContent('New show: “Hamilton”');
    type('song-title', 'Burn');
    type('part-1-character', 'Eliza');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(api.calls('POST /api/songs')).toHaveLength(1));
    expect(api.calls('POST /api/shows')).toHaveLength(0);
    expect(api.calls('POST /api/songs')[0]?.body).toMatchObject({ showName: 'Hamilton' });
    expect(api.calls('POST /api/songs')[0]?.body.showId).toBeUndefined();
  });

  it('new show + “Fetch info from Wikipedia” → creates the show first, then the song', async () => {
    const api = routes({
      'GET /api/lookup/wikipedia': () =>
        json(200, { found: true, title: 'Hamilton (musical)', description: 'Musical by Lin-Manuel Miranda', extract: 'Hamilton is a musical. It is about Alexander Hamilton. It opened in 2015. It won awards.', imageUrl: 'https://upload.wikimedia.org/h.jpg', wikiUrl: 'https://en.wikipedia.org/wiki/Hamilton_(musical)' }),
      'POST /api/shows': (req) => json(201, { id: 77, name: req.body.name, slug: 'hamilton', imageUrl: '/media/shows/hamilton.jpg' }),
    });
    renderAdd();
    pickShow('Hamilton');
    fireEvent.click(screen.getByTestId('fetch-wikipedia'));
    const result = await screen.findByTestId('wiki-result');
    expect(result).toHaveTextContent('Hamilton (musical)');
    expect(screen.getByTestId('new-show-description')).toHaveValue('Hamilton is a musical. It is about Alexander Hamilton. It opened in 2015.');
    type('new-show-year', '2015');
    type('song-title', 'Burn');
    type('part-1-character', 'Eliza');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(api.calls('POST /api/songs')).toHaveLength(1));
    expect(api.calls('POST /api/shows')[0]?.body).toEqual({
      name: 'Hamilton',
      composer: null,
      lyricist: null,
      year: 2015,
      description: 'Hamilton is a musical. It is about Alexander Hamilton. It opened in 2015.',
      wikiUrl: 'https://en.wikipedia.org/wiki/Hamilton_(musical)',
      imageUrl: 'https://upload.wikimedia.org/h.jpg',
    });
    expect(api.calls('POST /api/songs')[0]?.body).toMatchObject({ showId: 77, title: 'Burn' });
  });

  it('never saves one show’s Wikipedia details onto a different new show name', async () => {
    const api = routes({
      'GET /api/lookup/wikipedia': (req) =>
        json(200, { found: true, title: req.query.get('name'), description: 'Musical', extract: `FAKE-EXTRACT-ABOUT-${req.query.get('name')}.`, imageUrl: 'https://upload.wikimedia.org/zeta.jpg', wikiUrl: 'https://en.wikipedia.org/wiki/Zeta' }),
      'POST /api/shows': (req) => json(201, { id: 78, name: req.body.name, slug: 'omega-beta-show', imageUrl: null }),
    });
    renderAdd();
    pickShow('Zeta Alpha Show');
    fireEvent.click(screen.getByTestId('fetch-wikipedia'));
    await screen.findByTestId('wiki-result');
    type('new-show-year', '2001');
    pickShow('Omega Beta Show');
    expect(screen.getByTestId('new-show-panel')).toHaveTextContent('New show: “Omega Beta Show”');
    expect(screen.queryByTestId('wiki-result')).toBeNull();
    expect(screen.getByTestId('new-show-description')).toHaveValue('');
    type('song-title', 'Opening');
    type('part-1-character', 'Narrator');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(api.calls('POST /api/songs')).toHaveLength(1));
    const body = api.calls('POST /api/shows')[0]?.body;
    expect(body).toMatchObject({ name: 'Omega Beta Show', year: 2001, description: null, wikiUrl: null });
    expect(body.imageUrl).toBeUndefined();
  });

  it('finds a 30-second preview and sends it with the song', async () => {
    const candidate = {
      trackId: 111,
      trackName: 'Popular',
      collectionName: 'Wicked (Original Broadway Cast Recording)',
      artistName: 'Kristin Chenoweth',
      previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a',
      artworkUrl: 'https://is1-ssl.mzstatic.com/a/600x600bb.jpg',
      appleMusicUrl: 'https://music.apple.com/ca/album/popular/1?i=111',
      durationSeconds: 224,
      score: 100,
    };
    const api = routes({ 'GET /api/lookup/itunes': () => json(200, { candidates: [candidate, { ...candidate, trackId: 112, score: 60, collectionName: 'Karaoke Hits' }] }) });
    renderAdd();
    expect(screen.getByTestId('find-preview')).toBeDisabled();
    pickShow('Wicked');
    type('song-title', 'Popular 2');
    type('part-1-character', 'Glinda');
    fireEvent.click(screen.getByTestId('find-preview'));
    const items = await screen.findAllByTestId('preview-candidate');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Great match');
    expect(items[1]).toHaveTextContent('Maybe');
    expect(api.calls('GET /api/lookup/itunes')[0]?.query.get('show')).toBe('Wicked');
    // a plain title search never picks for you
    expect(screen.queryByTestId('chosen-preview')).toBeNull();
    fireEvent.click(screen.getByTestId('use-preview-0'));
    expect(screen.getByTestId('chosen-preview')).toHaveTextContent('Kristin Chenoweth');
    // the empty length is filled from the recording, with a suggestion chip saying where it came from
    expect(screen.getByTestId('song-length')).toHaveValue('3:44');
    expect(screen.getByTestId('length-suggestion')).toHaveTextContent('from Wicked (Original Broadway Cast Recording)');
    expect(screen.getByTestId('use-preview-0')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(api.calls('POST /api/songs')).toHaveLength(1));
    expect(api.calls('POST /api/songs')[0]?.body.preview).toEqual({
      previewUrl: candidate.previewUrl,
      artworkUrl: candidate.artworkUrl,
      appleMusicUrl: candidate.appleMusicUrl,
      recordingName: candidate.collectionName,
      recordingArtist: candidate.artistName,
      itunesTrackId: 111,
    });
    expect(api.calls('POST /api/songs')[0]?.body.lengthSeconds).toBe(224);
  });

  it('combobox: arrows move the active option, Escape closes then clears', () => {
    routes();
    renderAdd();
    const input = screen.getByTestId('song-show');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const options = within(screen.getByTestId('song-show-listbox')).getAllByTestId('song-show-option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('Hadestown'), expect.stringContaining('Wicked')]);
    expect(input).toHaveAttribute('aria-activedescendant', options[0]!.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('Wicked');
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
  });

  it('Tab out of a partly typed show picks the highlighted show instead of creating a new one', async () => {
    const api = routes();
    renderAdd();
    const input = screen.getByTestId('song-show');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Hades' } });
    const [first] = within(screen.getByTestId('song-show-listbox')).getAllByTestId('song-show-option');
    expect(input).toHaveAttribute('aria-activedescendant', first!.id);
    expect(first).toHaveTextContent('Hadestown');
    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.blur(input, { relatedTarget: screen.getByTestId('song-title') });
    expect(input).toHaveValue('Hadestown');
    expect(screen.queryByTestId('new-show-panel')).toBeNull();
    type('song-title', 'Flowers 2');
    type('part-1-character', 'Eurydice');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(api.calls('POST /api/songs')).toHaveLength(1));
    expect(api.calls('POST /api/songs')[0]?.body).toMatchObject({ showId: 2 });
    expect(api.calls('POST /api/songs')[0]?.body.showName).toBeUndefined();
  });

  it('tapping the next field (no Tab key) also takes the highlighted show', () => {
    routes();
    renderAdd();
    const input = screen.getByTestId('song-show');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'hades' } });
    fireEvent.blur(input, { relatedTarget: screen.getByTestId('song-title') });
    expect(input).toHaveValue('Hadestown');
    expect(screen.queryByTestId('new-show-panel')).toBeNull();
  });

  it('still adds a new show when nothing matches, or when the list was dismissed', () => {
    routes();
    renderAdd();
    const input = screen.getByTestId('song-show');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Hamilton' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.blur(input, { relatedTarget: screen.getByTestId('song-title') });
    expect(screen.getByTestId('new-show-panel')).toHaveTextContent('New show: “Hamilton”');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Hades' } });
    fireEvent.keyDown(input, { key: 'Escape' }); // close the suggestions on purpose
    fireEvent.blur(input, { relatedTarget: screen.getByTestId('song-title') });
    expect(input).toHaveValue('Hades');
    expect(screen.getByTestId('new-show-panel')).toHaveTextContent('New show: “Hades”');
  });

  it('asks before leaving with unsaved changes', async () => {
    routes();
    const { router } = renderAdd();
    type('song-title', 'Half-finished');
    fireEvent.click(screen.getByRole('link', { name: /Back to the catalog/ }));
    expect(await screen.findByTestId('leave-confirm')).toHaveTextContent('Leave without saving?');
    expect(router.state.location.search).toBe('?manual=1');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.search).toBe('?manual=1');
    // leaving the page altogether is guarded too
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }));
    fireEvent.click(await screen.findByTestId('leave-confirm-button'));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(router.state.location.pathname).toBe('/add');
    expect(await screen.findByTestId('find-song')).toBeInTheDocument();
  });

  it('keeps the typed form when the session has ended, and restores it after logging back in', async () => {
    routes({ 'POST /api/songs': () => json(401, { error: 'Please log in first' }) });
    const first = renderAdd();
    pickShow('Wicked');
    type('song-title', 'The Wizard and I');
    type('part-1-character', 'Elphaba');
    type('song-notes', 'Long director notes that took ages to write.');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/login'));
    expect(first.router.state.location.search).toBe('?next=%2Fadd%3Fmanual%3D1');
    expect(screen.getByText(/we’ll bring back what you typed/)).toBeInTheDocument();
    first.unmount();
    expect(window.sessionStorage.getItem('star.draft.v1:song-form:add')).toContain('The Wizard and I');
    const saved = window.sessionStorage.getItem('star.draft.v1:song-form:add')!;

    // someone else logging in on this tab doesn't get it (and it's discarded)
    const other = renderWithProviders(<SongFormPage />, { route: '/add?manual=1', path: '/add', user: makeUser({ id: 99 }), songs, meta });
    expect(screen.getByTestId('song-title')).toHaveValue('');
    expect(window.sessionStorage.getItem('star.draft.v1:song-form:add')).toBeNull();
    other.unmount();

    // the same student, logged in again, finds everything where they left it
    window.sessionStorage.setItem('star.draft.v1:song-form:add', saved);
    routes();
    renderAdd();
    expect(screen.getByTestId('song-title')).toHaveValue('The Wizard and I');
    expect(screen.getByTestId('song-show')).toHaveValue('Wicked');
    expect(screen.getByTestId('part-1-character')).toHaveValue('Elphaba');
    expect(screen.getByTestId('song-notes')).toHaveValue('Long director notes that took ages to write.');
    expect(await screen.findByText(/We restored what you typed/)).toBeInTheDocument();
    // restored once: the draft is gone from storage
    expect(Object.keys(window.sessionStorage).filter((k) => k.startsWith('star.draft'))).toEqual([]);
  });

  it('does not pull the user back to the song when a slow save finishes after they left', async () => {
    let finish: (res: Response) => void = () => undefined;
    routes({ 'POST /api/songs': () => new Promise<Response>((resolve) => (finish = resolve)) });
    vi.mocked(fireConfetti).mockClear();
    const { router } = renderAdd();
    pickShow('Wicked');
    type('song-title', 'The Wizard and I');
    type('part-1-character', 'Elphaba');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(screen.getByTestId('submit-song')).toBeDisabled());
    await act(() => router.navigate('/shows'));
    expect(router.state.location.pathname).toBe('/shows');
    await act(async () => {
      finish(json(201, makeSong({ id: 50, title: 'The Wizard and I', show: wicked, source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' } })));
    });
    expect(await screen.findByText(/“The Wizard and I” is saved and on the list/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/shows');
    expect(fireConfetti).not.toHaveBeenCalled();
  });

  it('pre-selects a show from ?manual=1&show=<slug>', () => {
    routes();
    renderAdd('/add?manual=1&show=hadestown');
    expect(screen.getByTestId('song-show')).toHaveValue('Hadestown');
  });
});

describe('SongFormPage — edit', () => {
  const mine = makeSong({
    id: 60,
    title: 'Wait for Me',
    kind: 'duet',
    show: hadestown,
    source: 'community',
    createdBy: { id: 7, displayName: 'Stage Kid' },
    genre: 'Drama',
    lengthSeconds: 302,
    parts: [part('Orpheus', 'Tenor', 1), part('Eurydice', 'Soprano', 2)],
    media: { previewUrl: 'https://audio-ssl.itunes.apple.com/w.m4a', artworkUrl: '/media/art/w.jpg', appleMusicUrl: null, recordingName: 'Hadestown (OBC)', recordingArtist: 'Cast', audioUrl: null, audioLink: null },
  });

  function renderEdit(song: Song, who = user, extra: Parameters<typeof mockFetch>[0] = {}) {
    const api = routes({
      [`GET /api/songs/${song.id}`]: () => json(200, { ...song, similar: [] }),
      [`PUT /api/songs/${song.id}`]: (req) => json(200, { ...song, title: req.body.title }),
      ...extra,
    });
    const view = renderWithProviders(<SongFormPage />, { route: `/songs/${song.id}/edit`, path: '/songs/:id/edit', user: who, songs: [...songs, song], meta });
    return { api, ...view };
  }

  it('pre-fills the form and PUTs the full body without touching the preview', async () => {
    const { api, router } = renderEdit(mine);
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit “Wait for Me”' })).toBeInTheDocument();
    expect(screen.getByTestId('song-show')).toHaveValue('Hadestown');
    expect(screen.getByTestId('part-2-character')).toHaveValue('Eurydice');
    expect(screen.getByTestId('song-length')).toHaveValue('5:02');
    expect(screen.getByTestId('chosen-preview')).toHaveTextContent('Hadestown (OBC)');
    type('song-title', 'Wait for Me (Reprise)');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/songs/60'));
    const put = api.calls('PUT /api/songs/60')[0];
    expect(put?.body).toMatchObject({ kind: 'duet', title: 'Wait for Me (Reprise)', showId: 2, lengthSeconds: 302, genre: 'Drama' });
    expect(put?.body).not.toHaveProperty('preview');
    expect(api.calls('POST /api/songs')).toHaveLength(0);
  });

  it('sends preview: null when the preview is removed', async () => {
    const { api } = renderEdit(mine);
    await screen.findByTestId('chosen-preview');
    fireEvent.click(screen.getByTestId('remove-preview'));
    expect(screen.queryByTestId('chosen-preview')).toBeNull();
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(api.calls('PUT /api/songs/60')).toHaveLength(1));
    expect(api.calls('PUT /api/songs/60')[0]?.body.preview).toBeNull();
  });

  it('shows a friendly locked state to non-owners (spreadsheet songs: admins only)', async () => {
    renderEdit(songs[0]!, makeUser({ id: 99 }));
    const locked = await screen.findByTestId('edit-locked');
    expect(locked).toHaveTextContent('You can only edit songs you added');
    expect(locked).toHaveTextContent('only admins can change it');
    expect(within(locked).getByRole('link', { name: /Back to the song/ })).toHaveAttribute('href', '/songs/1');
    expect(screen.queryByTestId('add-song-form')).toBeNull();
  });

  it('lets an admin edit a spreadsheet song', async () => {
    renderEdit(songs[0]!, makeUser({ id: 1, role: 'admin' }));
    expect(await screen.findByTestId('add-song-form')).toBeInTheDocument();
    expect(screen.getByTestId('song-title')).toHaveValue('Popular');
  });

  it('shows a not-found state for a missing song', async () => {
    routes({ 'GET /api/songs/999': () => json(404, { error: 'Song not found' }) });
    renderWithProviders(<SongFormPage />, { route: '/songs/999/edit', path: '/songs/:id/edit', user, songs, meta });
    expect(await screen.findByText('We can’t find that song')).toBeInTheDocument();
  });

  it('media in edit mode: a new image uploads after the PUT; the catalog link is kept', async () => {
    const linked = { ...mine, catalogSongId: 44 };
    const { api, router } = renderEdit(linked);
    await screen.findByTestId('add-song-form');
    expect(screen.getByTestId('song-art-preview')).toHaveAttribute('data-state', 'recording');
    const file = new File([new Uint8Array(100)], 'poster.png', { type: 'image/png' });
    mockedApi.uploadSongArtwork.mockResolvedValue({ ...linked, media: { ...linked.media, artworkUrl: '/uploads/art/p.png', artworkSource: 'upload' } });
    fireEvent.change(screen.getByTestId('song-art-file-input'), { target: { files: [file] } });
    expect(screen.getByTestId('song-art-preview')).toHaveAttribute('data-state', 'pending');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/songs/60'));
    expect(api.calls('PUT /api/songs/60')[0]?.body).toMatchObject({ catalogSongId: 44 });
    expect(mockedApi.uploadSongArtwork).toHaveBeenCalledWith(60, file, expect.any(Object));
  });

  it('media in edit mode: "Use recording art" removes the uploaded image after saving; changing the show clears the catalog link', async () => {
    const uploaded = {
      ...mine,
      catalogSongId: 44,
      media: { ...mine.media, artworkUrl: '/uploads/art/mine.png', artworkSource: 'upload' as const, audioUrl: '/uploads/audio/t.mp3' },
    };
    const { api, router } = renderEdit(uploaded, user, {
      'DELETE /api/songs/60/artwork': () => json(200, { ...uploaded, media: { ...uploaded.media, artworkSource: 'recording' } }),
      'DELETE /api/songs/60/audio': () => json(200, { ...uploaded, media: { ...uploaded.media, audioUrl: null } }),
    });
    await screen.findByTestId('add-song-form');
    expect(screen.getByTestId('song-art-preview')).toHaveAttribute('data-state', 'upload');
    fireEvent.click(screen.getByTestId('song-art-use-recording'));
    expect(screen.getByTestId('song-art-preview')).toHaveAttribute('data-state', 'recording');
    expect(screen.getByTestId('song-art-undo')).toHaveTextContent('Keep my image');
    fireEvent.click(screen.getByTestId('song-audio-remove'));
    expect(screen.getByText('The uploaded track will be removed when you save.')).toBeInTheDocument();
    pickShow('Wicked');
    fireEvent.click(screen.getByTestId('submit-song'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/songs/60'));
    expect(api.calls('PUT /api/songs/60')[0]?.body).toMatchObject({ showId: 1, catalogSongId: null });
    expect(api.calls('DELETE /api/songs/60/artwork')).toHaveLength(1);
    expect(api.calls('DELETE /api/songs/60/audio')).toHaveLength(1);
  });
});

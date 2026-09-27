import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeComment, makeShow, makeSong, makeUser } from '../../test/fixtures';
import type { Contributions } from '../../types';
import MePage from '../MePage';
import { MiniPlayer } from '../../components/MiniPlayer';
import { addToSetlist, getSetlist } from '../../lib/setlist';

afterEach(() => vi.unstubAllGlobals());

type Handler = (init: RequestInit, url: string) => { status?: number; body?: unknown } | undefined;

/** Tiny fetch router: keys are "METHOD /path-prefix". */
function stubApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === method && url.startsWith(p);
    });
    const res = key ? routes[key](init, url) : { status: 404, body: { error: 'not stubbed' } };
    const status = res?.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(res?.body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const me = makeUser({ id: 7, displayName: 'Belter Bea', email: 'bea@example.com', createdAt: '2026-02-03T10:00:00.000Z' });
const mySong = makeSong({ id: 50, title: 'Welcome to the Rock', source: 'community', createdBy: { id: 7, displayName: 'Belter Bea' } });
const myShow = makeShow({ id: 60, name: 'Come From Away', slug: 'come-from-away', source: 'community', createdBy: { id: 7, displayName: 'Belter Bea' }, songCount: 0, soloCount: 0, duetCount: 0 });
const myComment = makeComment({ id: 70, body: 'Breathe before the bridge!', tag: 'tip', author: { id: 7, displayName: 'Belter Bea', role: 'user' }, target: { type: 'song', id: 1, title: 'Popular' } });
const showComment = makeComment({ id: 71, body: 'Loved this show', tag: 'performed', author: { id: 7, displayName: 'Belter Bea', role: 'user' }, target: { type: 'show', id: 60, title: 'Come From Away', slug: 'come-from-away' } as never });

const full: Contributions = { songs: [mySong], shows: [myShow], comments: [myComment, showComment] };
const empty: Contributions = { songs: [], shows: [], comments: [] };

const contributions = (data: Contributions): Handler => () => ({ body: data });

describe('MePage', () => {
  it('shows the backstage pass with name, role, member-since and counts', async () => {
    stubApi({ 'GET /api/me/contributions': contributions(full) });
    renderWithProviders(<MePage />, { route: '/me', path: '/me', user: me });
    expect(screen.getByTestId('me-name')).toHaveTextContent('Belter Bea');
    expect(screen.getByTestId('me-role')).toHaveTextContent('Member');
    expect(screen.getByTestId('me-pass')).toHaveTextContent('Member since Feb 3, 2026');
    expect(screen.getByTestId('me-pass')).toHaveTextContent('bea@example.com');
    await waitFor(() => expect(screen.getByTestId('me-count-comments')).toHaveTextContent('2'));
    expect(screen.getByTestId('me-count-songs')).toHaveTextContent('1');
  });

  it('shows the admin crown badge linking to /admin for admins', () => {
    stubApi({ 'GET /api/me/contributions': contributions(empty) });
    renderWithProviders(<MePage />, { route: '/me', path: '/me', user: makeUser({ role: 'admin' }) });
    const role = screen.getByTestId('me-role');
    expect(role).toHaveTextContent('Admin');
    expect(role).toHaveAttribute('href', '/admin');
  });

  it('lists my songs with edit/delete, and deletes after confirming', async () => {
    const fn = stubApi({ 'GET /api/me/contributions': contributions(full), 'DELETE /api/songs/50': () => ({ status: 204 }) });
    renderWithProviders(<MePage />, { route: '/me', path: '/me', user: me });
    const row = await screen.findByTestId('my-song');
    expect(within(row).getByRole('link', { name: 'Welcome to the Rock' })).toHaveAttribute('href', '/songs/50');
    expect(within(row).getByTestId('edit-button')).toHaveAttribute('href', '/songs/50/edit');
    fireEvent.click(within(row).getByTestId('delete-button'));
    fireEvent.click(await screen.findByTestId('confirm-button'));
    await waitFor(() => expect(screen.queryByTestId('my-song')).not.toBeInTheDocument());
    expect(fn.mock.calls.some(([u, i]) => String(u) === '/api/songs/50' && (i as RequestInit).method === 'DELETE')).toBe(true);
    expect(screen.getByText('No songs yet')).toBeInTheDocument();
    expect(screen.getByTestId('add-first-song')).toHaveAttribute('href', '/add');
  });

  it('deleting a song that is playing stops the player and drops it from the setlist', async () => {
    const playable = { ...mySong, media: { ...mySong.media, previewUrl: 'https://audio-ssl.itunes.apple.com/rock.m4a' } };
    stubApi({ 'GET /api/me/contributions': contributions({ ...empty, songs: [playable] }), 'DELETE /api/songs/50': () => ({ status: 204 }), 'GET /api/songs': () => ({ body: { songs: [], total: 0 } }), 'GET /api/meta': () => ({ body: {} }) });
    addToSetlist(50);
    renderWithProviders(
      <>
        <MePage />
        <MiniPlayer />
      </>,
      { route: '/me', path: '/me', user: me },
    );
    const row = await screen.findByTestId('my-song');
    fireEvent.click(within(row).getByTestId('play-preview'));
    expect(screen.getByTestId('mini-player-title')).toHaveTextContent('Welcome to the Rock');
    fireEvent.click(within(row).getByTestId('delete-button'));
    fireEvent.click(await screen.findByTestId('confirm-button'));
    await waitFor(() => expect(screen.queryByTestId('my-song')).not.toBeInTheDocument());
    expect(screen.queryByTestId('mini-player')).toBeNull();
    expect(getSetlist()).not.toContain(50);
  });

  it('sends a revoked session to log in instead of a dead-end error', async () => {
    stubApi({ 'GET /api/me/contributions': () => ({ status: 401, body: { error: 'Please log in first' } }) });
    const { router } = renderWithProviders(<MePage />, { route: '/me', path: '/me', user: me });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Fme');
    expect(screen.getByText(/Your session ended/)).toBeInTheDocument();
  });

  it('switches tabs (synced to ?tab=) and shows my shows', async () => {
    stubApi({ 'GET /api/me/contributions': contributions(full) });
    const { router } = renderWithProviders(<MePage />, { route: '/me', path: '/me', user: me });
    await screen.findByTestId('my-song');
    fireEvent.click(screen.getByTestId('me-tab-shows'));
    expect(router.state.location.search).toBe('?tab=shows');
    const show = screen.getByTestId('my-show');
    expect(within(show).getAllByRole('link', { name: /Come From Away|Open/ })[0]).toHaveAttribute('href', '/shows/come-from-away');
    expect(within(show).getByTestId('delete-button')).toBeInTheDocument(); // empty show can be deleted
  });

  it('edits a comment inline and deletes another after confirming', async () => {
    const fn = stubApi({
      'GET /api/me/contributions': contributions(full),
      'PATCH /api/comments/70': (init) => ({ body: { ...myComment, ...JSON.parse(String(init.body)), edited: true } }),
      'DELETE /api/comments/71': () => ({ status: 204 }),
    });
    renderWithProviders(<MePage />, { route: '/me?tab=comments', path: '/me', user: me });
    const items = await screen.findAllByTestId('my-comment');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole('link', { name: 'Popular' })).toHaveAttribute('href', '/songs/1#comments');
    expect(within(items[1]).getByRole('link', { name: 'Come From Away' })).toHaveAttribute('href', '/shows/come-from-away#comments');

    fireEvent.click(within(items[0]).getByTestId('comment-edit'));
    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'Breathe low before the bridge!' } });
    fireEvent.click(screen.getByTestId('comment-save'));
    await waitFor(() => expect(screen.getAllByTestId('my-comment-body')[0]).toHaveTextContent('Breathe low before the bridge!'));
    const patch = fn.mock.calls.find(([u]) => String(u) === '/api/comments/70');
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ body: 'Breathe low before the bridge!', tag: 'tip' });

    fireEvent.click(within(screen.getAllByTestId('my-comment')[1]).getByTestId('comment-delete'));
    fireEvent.click(await screen.findByTestId('confirm-button'));
    await waitFor(() => expect(screen.getAllByTestId('my-comment')).toHaveLength(1));
  });

  it('shows friendly empty states', async () => {
    stubApi({ 'GET /api/me/contributions': contributions(empty) });
    renderWithProviders(<MePage />, { route: '/me?tab=comments', path: '/me', user: me });
    expect(await screen.findByText('You haven’t said anything yet')).toBeInTheDocument();
  });

  it('updates the display name', async () => {
    const fn = stubApi({
      'GET /api/me/contributions': contributions(empty),
      'PUT /api/auth/me': (init) => ({ body: { user: { ...me, displayName: JSON.parse(String(init.body)).displayName } } }),
    });
    renderWithProviders(<MePage />, { route: '/me', path: '/me', user: me });
    expect(screen.getByTestId('profile-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('profile-name'), { target: { value: '  Bea the Belter ' } });
    fireEvent.click(screen.getByTestId('profile-save'));
    await waitFor(() => expect(screen.getByTestId('me-name')).toHaveTextContent('Bea the Belter'));
    const put = fn.mock.calls.find(([u]) => String(u) === '/api/auth/me');
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ displayName: 'Bea the Belter' });
  });

  it('validates the display name before calling the API', () => {
    const fn = stubApi({ 'GET /api/me/contributions': contributions(empty) });
    renderWithProviders(<MePage />, { route: '/me', path: '/me', user: me });
    fireEvent.change(screen.getByTestId('profile-name'), { target: { value: 'bea@example.com' } });
    fireEvent.click(screen.getByTestId('profile-save'));
    expect(screen.getByText(/don’t put an email address/)).toBeInTheDocument();
    expect(fn.mock.calls.some(([u]) => String(u) === '/api/auth/me')).toBe(false);
  });

  it('checks the new passwords match, then maps a wrong current password to its field', async () => {
    stubApi({
      'GET /api/me/contributions': contributions(empty),
      'PUT /api/auth/me': () => ({ status: 400, body: { error: 'Your current password is incorrect', details: { currentPassword: 'Your current password is incorrect' } } }),
    });
    renderWithProviders(<MePage />, { route: '/me', path: '/me', user: me });
    fireEvent.change(screen.getByTestId('password-current'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByTestId('password-new'), { target: { value: 'new-password-1' } });
    fireEvent.change(screen.getByTestId('password-confirm'), { target: { value: 'new-password-2' } });
    fireEvent.click(screen.getByTestId('password-save'));
    expect(screen.getByText('The two new passwords don’t match.')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('password-confirm'), { target: { value: 'new-password-1' } });
    fireEvent.click(screen.getByTestId('password-save'));
    expect(await screen.findByText('Your current password is incorrect')).toBeInTheDocument();
    expect(screen.getByTestId('password-current')).toHaveAttribute('aria-invalid', 'true');
  });

  it('changes the password, clears the form and removes the reset banner', async () => {
    const fn = stubApi({
      'GET /api/me/contributions': contributions(empty),
      'PUT /api/auth/me': () => ({ body: { user: { ...me, mustChangePassword: false } } }),
    });
    renderWithProviders(<MePage />, { route: '/me', path: '/me', user: { ...me, mustChangePassword: true } });
    expect(screen.getByTestId('me-password-banner')).toBeInTheDocument();
    expect(screen.getByText('Choose a new password')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('password-current')));

    fireEvent.change(screen.getByTestId('password-current'), { target: { value: 'Temp-1234-abcd' } });
    fireEvent.change(screen.getByTestId('password-new'), { target: { value: 'my-brand-new-pw' } });
    fireEvent.change(screen.getByTestId('password-confirm'), { target: { value: 'my-brand-new-pw' } });
    fireEvent.click(screen.getByTestId('password-save'));
    await waitFor(() => expect(screen.queryByTestId('me-password-banner')).not.toBeInTheDocument());
    expect(screen.getByTestId('password-current')).toHaveValue('');
    const put = fn.mock.calls.find(([u]) => String(u) === '/api/auth/me');
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ currentPassword: 'Temp-1234-abcd', newPassword: 'my-brand-new-pw' });
  });

  it('shows an error state with retry when contributions fail', async () => {
    stubApi({ 'GET /api/me/contributions': () => ({ status: 500, body: { error: 'Boom' } }) });
    renderWithProviders(<MePage />, { route: '/me', path: '/me', user: me });
    expect(await screen.findByText('Your stuff missed its cue')).toBeInTheDocument();
  });
});

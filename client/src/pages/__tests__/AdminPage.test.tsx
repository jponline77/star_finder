import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeComment, makeUser } from '../../test/fixtures';
import type { AdminUser } from '../../types';
import AdminPage from '../AdminPage';

afterEach(() => vi.unstubAllGlobals());

type Handler = (init: RequestInit, url: string) => { status?: number; body?: unknown } | undefined;

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

const adminUser = makeUser({ id: 1, displayName: 'Stage Manager Sam', email: 'admin@example.com', role: 'admin' });
const au = (o: Partial<AdminUser>): AdminUser => ({
  ...makeUser(),
  disabled: false,
  lastLoginAt: null,
  songCount: 0,
  showCount: 0,
  commentCount: 0,
  ...o,
});
const USERS: AdminUser[] = [
  au({ ...adminUser, lastLoginAt: '2026-09-20T10:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }),
  au({ id: 2, displayName: 'Belter Bea', email: 'bea@example.com', songCount: 2, commentCount: 3, createdAt: '2026-03-01T00:00:00.000Z' }),
  au({ id: 3, displayName: 'Tenor Theo', email: 'theo@example.com', disabled: true, createdAt: '2026-02-01T00:00:00.000Z' }),
];
const COMMENTS = [
  makeComment({ id: 90, body: 'lol so funny', tag: 'general', author: { id: 3, displayName: 'Tenor Theo', role: 'user' }, target: { type: 'song', id: 5, title: 'Agony' } }),
  makeComment({ id: 91, body: 'Loved it', tag: 'performed', author: { id: 2, displayName: 'Belter Bea', role: 'user' }, target: { type: 'show', id: 8, title: 'Cabaret', slug: 'cabaret' } as never }),
];

const baseRoutes = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  'GET /api/admin/users': () => ({ body: { users: USERS } }),
  'GET /api/admin/comments': () => ({ body: { comments: COMMENTS } }),
  ...extra,
});

const row = (name: string) => screen.getAllByTestId('user-row').find((r) => r.textContent?.includes(name)) as HTMLElement;

describe('AdminPage', () => {
  it('shows a polite “Admins only” page to non-admins (and never calls admin APIs)', () => {
    const fn = stubApi(baseRoutes());
    renderWithProviders(<AdminPage />, { route: '/admin', path: '/admin', user: makeUser() });
    expect(screen.getByTestId('admin-denied')).toHaveTextContent('Admins only');
    expect(screen.getByRole('link', { name: 'Back to the lobby' })).toHaveAttribute('href', '/');
    expect(fn.mock.calls.some(([u]) => String(u).startsWith('/api/admin'))).toBe(false);
  });

  it('lists users (newest first) with overview counts and the spreadsheet export', async () => {
    stubApi(baseRoutes());
    renderWithProviders(<AdminPage />, { route: '/admin', path: '/admin', user: adminUser });
    await screen.findByTestId('users-table');
    expect(screen.getAllByTestId('user-row').map((r) => r.getAttribute('data-user-id'))).toEqual(['2', '3', '1']);
    expect(screen.getByTestId('admin-overview')).toHaveTextContent('3members');
    expect(screen.getByTestId('admin-download-xlsx')).toHaveAttribute('href', '/api/export.xlsx');
    expect(within(row('Tenor Theo')).getByText('Disabled')).toBeInTheDocument();
    expect(within(row('Belter Bea')).getByRole('link', { name: 'bea@example.com' })).toBeInTheDocument();
    // you can't disable or reset yourself here
    expect(within(row('Stage Manager Sam')).getByTestId('user-active-switch')).toBeDisabled();
    expect(within(row('Stage Manager Sam')).getByTestId('reset-password')).toBeDisabled();
  });

  it('searches and filters users', async () => {
    stubApi(baseRoutes());
    renderWithProviders(<AdminPage />, { route: '/admin', path: '/admin', user: adminUser });
    await screen.findByTestId('users-table');
    fireEvent.change(screen.getByTestId('user-search'), { target: { value: 'theo@' } });
    expect(screen.getAllByTestId('user-row')).toHaveLength(1);
    fireEvent.change(screen.getByTestId('user-search'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('user-filter-admin'));
    expect(screen.getAllByTestId('user-row')).toHaveLength(1);
    expect(screen.getByTestId('user-row')).toHaveTextContent('Stage Manager Sam');
  });

  it('promotes a user after confirming', async () => {
    const fn = stubApi(baseRoutes({ 'PATCH /api/admin/users/2': (init) => ({ body: { ...USERS[1], ...JSON.parse(String(init.body)) } }) }));
    renderWithProviders(<AdminPage />, { route: '/admin', path: '/admin', user: adminUser });
    await screen.findByTestId('users-table');
    fireEvent.click(within(row('Belter Bea')).getByTestId('user-role-switch'));
    expect(await screen.findByText('Make Belter Bea an admin?')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-button'));
    await waitFor(() => expect(within(row('Belter Bea')).getByTestId('user-role-switch')).toBeChecked());
    const patch = fn.mock.calls.find(([u]) => String(u) === '/api/admin/users/2');
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ role: 'admin' });
  });

  it('does nothing when the confirm is cancelled', async () => {
    const fn = stubApi(baseRoutes());
    renderWithProviders(<AdminPage />, { route: '/admin', path: '/admin', user: adminUser });
    await screen.findByTestId('users-table');
    fireEvent.click(within(row('Belter Bea')).getByTestId('user-active-switch'));
    expect(await screen.findByText('Disable Belter Bea’s account?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('confirm-button')).not.toBeInTheDocument());
    expect(fn.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
  });

  it('explains a 409 (last admin) with a clear toast', async () => {
    stubApi(baseRoutes({ 'PATCH /api/admin/users/1': () => ({ status: 409, body: { error: "You can't remove the last admin — make someone else an admin first" } }) }));
    renderWithProviders(<AdminPage />, { route: '/admin', path: '/admin', user: adminUser });
    await screen.findByTestId('users-table');
    fireEvent.click(within(row('Stage Manager Sam')).getByTestId('user-role-switch'));
    expect(await screen.findByText('Step down as admin?')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-button'));
    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveTextContent('Can’t do that');
    expect(toast).toHaveTextContent('last admin');
    expect(within(row('Stage Manager Sam')).getByTestId('user-role-switch')).toBeChecked();
  });

  it('resets a password and shows the temporary password once with a copy button', async () => {
    stubApi(baseRoutes({ 'POST /api/admin/users/2/reset-password': () => ({ body: { temporaryPassword: 'Abcd-1234-Wxyz' } }) }));
    renderWithProviders(<AdminPage />, { route: '/admin', path: '/admin', user: adminUser });
    await screen.findByTestId('users-table');
    fireEvent.click(within(row('Belter Bea')).getByTestId('reset-password'));
    fireEvent.click(await screen.findByTestId('confirm-button'));
    expect(await screen.findByTestId('temp-password')).toHaveTextContent('Abcd-1234-Wxyz');
    expect(screen.getByTestId('temp-password-modal')).toHaveTextContent('only time you’ll see it');
    expect(screen.getByTestId('copy-temp-password')).toBeInTheDocument();
    expect(within(row('Belter Bea')).getByText('Temp password')).toBeInTheDocument();
    expect(screen.queryByTestId('temp-password-expiry')).not.toBeInTheDocument(); // older server: no expiresAt
    fireEvent.click(screen.getByTestId('temp-password-done'));
    await waitFor(() => expect(screen.queryByTestId('temp-password')).not.toBeInTheDocument());
  });

  it('says when an unused temporary password stops working', async () => {
    const expiresAt = new Date(Date.UTC(2026, 9, 1, 18, 30)).toISOString();
    stubApi(baseRoutes({ 'POST /api/admin/users/2/reset-password': () => ({ body: { temporaryPassword: 'Abcd-1234-Wxyz', expiresAt } }) }));
    renderWithProviders(<AdminPage />, { route: '/admin', path: '/admin', user: adminUser });
    await screen.findByTestId('users-table');
    fireEvent.click(within(row('Belter Bea')).getByTestId('reset-password'));
    fireEvent.click(await screen.findByTestId('confirm-button'));
    const expiry = await screen.findByTestId('temp-password-expiry');
    expect(expiry).toHaveTextContent(/stops working/);
    expect(expiry).toHaveTextContent(/October/);
  });

  it('moderates comments: links targets, removes after confirm, and loads more', async () => {
    const many = Array.from({ length: 100 }, (_, i) => makeComment({ id: 1000 + i, body: `Comment ${i}` }));
    const fn = stubApi(
      baseRoutes({
        'GET /api/admin/comments': (_i, url) => ({ body: { comments: url.includes('limit=200') ? [...COMMENTS, ...many] : [...COMMENTS, ...many.slice(0, 98)] } }),
        'DELETE /api/comments/90': () => ({ status: 204 }),
      }),
    );
    const { router } = renderWithProviders(<AdminPage />, { route: '/admin', path: '/admin', user: adminUser });
    fireEvent.click(await screen.findByTestId('admin-tab-comments'));
    expect(router.state.location.search).toBe('?tab=comments');
    const items = await screen.findAllByTestId('admin-comment');
    expect(items).toHaveLength(100);
    expect(within(items[0]).getByRole('link', { name: 'Agony' })).toHaveAttribute('href', '/songs/5#comments');
    expect(within(items[1]).getByRole('link', { name: 'Cabaret' })).toHaveAttribute('href', '/shows/cabaret#comments');

    fireEvent.click(within(items[0]).getByTestId('admin-remove-comment'));
    expect(await screen.findByText('Remove Tenor Theo’s comment?')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-button'));
    await waitFor(() => expect(screen.queryByText('lol so funny')).not.toBeInTheDocument());
    expect(fn.mock.calls.some(([u, i]) => String(u) === '/api/comments/90' && (i as RequestInit).method === 'DELETE')).toBe(true);

    fireEvent.click(screen.getByTestId('load-more-comments'));
    await waitFor(() => expect(fn.mock.calls.some(([u]) => String(u).includes('/api/admin/comments?limit=200'))).toBe(true));
  });

  it('filters the comment feed by tag', async () => {
    stubApi(baseRoutes());
    renderWithProviders(<AdminPage />, { route: '/admin?tab=comments', path: '/admin', user: adminUser });
    await screen.findAllByTestId('admin-comment');
    fireEvent.click(screen.getByTestId('admin-tag-performed'));
    expect(screen.getAllByTestId('admin-comment')).toHaveLength(1);
    expect(screen.getByTestId('admin-comment')).toHaveTextContent('Loved it');
  });
});

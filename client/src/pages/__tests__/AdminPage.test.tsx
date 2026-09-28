import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeComment, makeFestivals, makeMeta, makeUser } from '../../test/fixtures';
import type { AdminUser, Festival } from '../../types';
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

describe('AdminPage → Festivals (SPEC §7b)', () => {
  const hidden: Festival = { ...makeFestivals()[0]!, id: 20, slug: 'kamloops', name: 'Kamloops Regional STAR Fest', city: 'Kamloops', startDate: null, dateLabel: 'Date to be announced', venue: null, active: false, sortOrder: 90 };
  const ALL = [...makeFestivals(), hidden];
  const festivalRoutes = (extra: Record<string, Handler> = {}) =>
    baseRoutes({
      'GET /api/festivals': () => ({ body: { festivals: ALL } }),
      ...extra,
    });
  const frow = (slug: string) => screen.getAllByTestId('festival-row').find((r) => r.getAttribute('data-slug') === slug) as HTMLElement;
  const open = async (fn = stubApi(festivalRoutes())) => {
    const view = renderWithProviders(<AdminPage />, { route: '/admin?tab=festivals', path: '/admin', user: adminUser, meta: makeMeta() });
    await screen.findByTestId('festivals-panel');
    return { ...view, fn };
  };
  const body = (fn: ReturnType<typeof stubApi>, method: string, path: string) => {
    const call = fn.mock.calls.filter(([u, i]) => String(u) === path && (i as RequestInit).method === method).at(-1);
    return call ? JSON.parse(String((call[1] as RequestInit).body ?? 'null')) : undefined;
  };

  it('lists every festival (hidden ones too) grouped by kind, fetched with ?all=1 only when the tab opens', async () => {
    const { fn } = await open();
    expect(fn.mock.calls.some(([u]) => String(u) === '/api/festivals?all=1')).toBe(true);
    expect(screen.getByRole('heading', { name: /Regional festivals/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /National festivals/ })).toBeInTheDocument();
    expect(screen.getAllByTestId('festival-row')).toHaveLength(10);
    expect(frow('kamloops')).toHaveTextContent('Hidden');
    expect(within(frow('kamloops')).getByTestId('festival-active-switch')).not.toBeChecked();
    expect(frow('star-fest-west')).toHaveTextContent('May 20–23, 2027');
    // nationals are never in the pickers — their switch says whether they're listed at all
    expect(within(frow('star-fest-west')).getByRole('switch', { name: /^Listed/ })).toBeChecked();
    expect(within(frow('surrey')).getByRole('switch', { name: /^In pickers/ })).toBeChecked();
    expect(frow('surrey')).toHaveTextContent('/?festival=surrey');
    expect(frow('star-fest-west')).not.toHaveTextContent('/?festival=');
    expect(screen.getByTestId('festivals-panel')).toHaveTextContent('10 festivals · 1 hidden');
  });

  it('Cast albums: lists what users saved for catalog shows and removes one (rejected unless "let it be found again")', async () => {
    const shows = [
      { id: 6, key: 'Q1', title: 'Come From Away', year: 2013, castAlbum: { collectionId: 900, collectionName: 'Come From Away (Original Broadway Cast Recording)' }, recordingSongs: 17, savedAt: '2026-09-20T10:00:00.000Z', savedBy: { id: 2, displayName: 'Belter Bea' }, retired: false },
      { id: 7, key: 'Q2', title: 'Death Becomes Her', year: 2023, castAlbum: { collectionId: 901, collectionName: 'Death Becomes Her' }, recordingSongs: 0, savedAt: null, savedBy: null, retired: false },
    ];
    const deletes: string[] = [];
    const fn = stubApi(
      baseRoutes({
        'GET /api/admin/catalog/recordings': () => ({ body: { shows } }),
        'DELETE /api/admin/catalog/shows/': (_init, url) => {
          deletes.push(url);
          return { body: { removedSongs: url.includes('/6/') ? 17 : 0, rejectedCollectionId: null } };
        },
      }),
    );
    renderWithProviders(<AdminPage />, { route: '/admin', path: '/admin', user: adminUser });
    await screen.findByTestId('users-table');
    expect(fn.mock.calls.some(([u]) => String(u).startsWith('/api/admin/catalog'))).toBe(false); // only when the tab opens
    fireEvent.click(screen.getByTestId('admin-tab-recordings'));
    const items = await screen.findAllByTestId('admin-recording');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Come From Away (2013)');
    expect(items[0]).toHaveTextContent('17 songs from its track list');
    expect(items[0]).toHaveTextContent('by Belter Bea');
    expect(within(items[0]!).getByRole('link', { name: 'Come From Away' })).toHaveAttribute('href', '/add?catalogShow=6');
    expect(items[1]).toHaveTextContent('album only');

    fireEvent.click(within(items[0]!).getByTestId('admin-remove-recording'));
    const dialog = await screen.findByTestId('confirm-remove-recording');
    expect(dialog).toHaveTextContent('Its 17 songs from the track list disappear');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.getAllByTestId('admin-recording')).toHaveLength(1));
    expect(deletes[0]).toBe('/api/admin/catalog/shows/6/recording');

    fireEvent.click(screen.getByTestId('admin-remove-recording'));
    const dialog2 = await screen.findByTestId('confirm-remove-recording');
    fireEvent.click(within(dialog2).getByTestId('recording-allow-again'));
    fireEvent.click(within(dialog2).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryAllByTestId('admin-recording')).toHaveLength(0));
    expect(deletes[1]).toBe('/api/admin/catalog/shows/7/recording?reject=0');
    expect(await screen.findByText('No cast albums saved yet')).toBeInTheDocument();
  });

  it('does not load festivals until their tab is opened', async () => {
    const fn = stubApi(festivalRoutes());
    renderWithProviders(<AdminPage />, { route: '/admin', path: '/admin', user: adminUser });
    await screen.findByTestId('users-table');
    expect(fn.mock.calls.some(([u]) => String(u).startsWith('/api/festivals'))).toBe(false);
    fireEvent.click(screen.getByTestId('admin-tab-festivals'));
    await screen.findByTestId('festivals-panel');
  });

  it('adds a festival (validated first, then POSTed and listed)', async () => {
    const created: Festival = { ...hidden, id: 30, slug: 'kelowna', name: 'Kelowna Regional STAR Fest', city: 'Kelowna', startDate: '2027-02-05', dateLabel: null, active: true, sortOrder: 75 };
    const fn = stubApi(festivalRoutes({ 'POST /api/admin/festivals': () => ({ status: 201, body: created }) }));
    await open(fn);
    fireEvent.click(screen.getByTestId('festival-add'));
    const form = await screen.findByTestId('festival-form');
    // client-side validation mirrors the server
    fireEvent.change(within(form).getByTestId('festival-input-name'), { target: { value: 'Ke' } });
    fireEvent.change(within(form).getByTestId('festival-input-startDate'), { target: { value: '2027-02-05' } });
    fireEvent.change(within(form).getByTestId('festival-input-endDate'), { target: { value: '2027-02-01' } });
    fireEvent.change(within(form).getByTestId('festival-input-infoUrl'), { target: { value: 'http://example.com' } });
    fireEvent.click(within(form).getByTestId('festival-save'));
    expect(await within(form).findByText('Use at least 3 characters')).toBeInTheDocument();
    expect(within(form).getByText('The end date can’t be before the start date')).toBeInTheDocument();
    expect(within(form).getByText('Use a full https:// link')).toBeInTheDocument();
    expect(within(form).getByTestId('festival-input-name')).toHaveFocus();
    expect(fn.mock.calls.some(([u, i]) => String(u) === '/api/admin/festivals' && (i as RequestInit).method === 'POST')).toBe(false);

    fireEvent.change(within(form).getByTestId('festival-input-name'), { target: { value: 'Kelowna Regional STAR Fest' } });
    fireEvent.change(within(form).getByTestId('festival-input-endDate'), { target: { value: '' } });
    fireEvent.change(within(form).getByTestId('festival-input-infoUrl'), { target: { value: '' } });
    fireEvent.change(within(form).getByTestId('festival-input-city'), { target: { value: 'Kelowna' } });
    fireEvent.change(within(form).getByTestId('festival-input-sortOrder'), { target: { value: '75' } });
    fireEvent.click(within(form).getByTestId('festival-save'));
    await waitFor(() => expect(screen.queryByTestId('festival-form')).toBeNull());
    expect(body(fn, 'POST', '/api/admin/festivals')).toEqual({
      name: 'Kelowna Regional STAR Fest',
      kind: 'regional',
      province: 'BC',
      city: 'Kelowna',
      startDate: '2027-02-05',
      endDate: null,
      dateLabel: null,
      venue: null,
      infoUrl: null,
      sortOrder: 75,
      active: true,
    });
    expect(frow('kelowna')).toHaveTextContent('Kelowna Regional STAR Fest');
    expect(screen.getByText('Kelowna Regional STAR Fest added 🎉')).toBeInTheDocument();
    // the site-wide list is refreshed too
    await waitFor(() => expect(fn.mock.calls.some(([u]) => String(u) === '/api/festivals')).toBe(true));
  });

  it('shows the server’s field errors (400) and name clashes (409)', async () => {
    let calls = 0;
    const fn = stubApi(
      festivalRoutes({
        'POST /api/admin/festivals': () =>
          ++calls === 1
            ? { status: 400, body: { error: 'Please check the form', details: { venue: 'Venue is too long' } } }
            : { status: 409, body: { error: 'A festival with that name already exists' } },
      }),
    );
    await open(fn);
    fireEvent.click(screen.getByTestId('festival-add'));
    const form = await screen.findByTestId('festival-form');
    fireEvent.change(within(form).getByTestId('festival-input-name'), { target: { value: 'Surrey Regional STAR Fest' } });
    fireEvent.click(within(form).getByTestId('festival-save'));
    expect(await within(form).findByText('Venue is too long')).toBeInTheDocument();
    fireEvent.click(within(form).getByTestId('festival-save'));
    expect(await within(form).findByText('A festival with that name already exists')).toBeInTheDocument();
    expect(within(form).getByTestId('festival-input-name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('edits a festival (PUT with the changed fields)', async () => {
    const fn = stubApi(festivalRoutes({ 'PUT /api/admin/festivals/7': (init) => ({ body: { ...makeFestivals()[6], ...JSON.parse(String(init.body)) } }) }));
    await open(fn);
    fireEvent.click(within(frow('nanaimo')).getByTestId('festival-edit'));
    const form = await screen.findByTestId('festival-form');
    expect(screen.getByRole('heading', { name: 'Edit Nanaimo Regional STAR Fest' })).toBeInTheDocument();
    expect(within(form).getByTestId('festival-input-dateLabel')).toHaveValue('Date to be announced');
    fireEvent.change(within(form).getByTestId('festival-input-startDate'), { target: { value: '2027-02-12' } });
    fireEvent.change(within(form).getByTestId('festival-input-dateLabel'), { target: { value: '' } });
    fireEvent.change(within(form).getByTestId('festival-input-venue'), { target: { value: 'Port Theatre' } });
    fireEvent.click(within(form).getByTestId('festival-save'));
    await waitFor(() => expect(frow('nanaimo')).toHaveTextContent('Friday, February 12, 2027'));
    expect(body(fn, 'PUT', '/api/admin/festivals/7')).toMatchObject({ startDate: '2027-02-12', dateLabel: null, venue: 'Port Theatre', name: 'Nanaimo Regional STAR Fest' });
  });

  it('a half-typed date is an error — it is never saved as “no date”', async () => {
    const fn = stubApi(festivalRoutes({ 'PUT /api/admin/festivals/3': (init) => ({ body: { ...makeFestivals()[2], ...JSON.parse(String(init.body)) } }) }));
    await open(fn);
    fireEvent.click(within(frow('victoria')).getByTestId('festival-edit'));
    const form = await screen.findByTestId('festival-form');
    const start = within(form).getByTestId('festival-input-startDate') as HTMLInputElement;
    expect(start).toHaveValue('2026-12-10');
    // Chrome after Backspace in one segment: value '' but validity.badInput
    Object.defineProperty(start, 'validity', { configurable: true, value: { ...start.validity, badInput: true, valid: false } });
    fireEvent.change(start, { target: { value: '' } });
    fireEvent.click(within(form).getByTestId('festival-save'));
    expect(await within(form).findByText('Use a real date (YYYY-MM-DD)')).toBeInTheDocument();
    expect(start).toHaveFocus();
    expect(body(fn, 'PUT', '/api/admin/festivals/3')).toBeUndefined();
    // really cleared (empty, no bad input) → saved as no date
    Object.defineProperty(start, 'validity', { configurable: true, value: { ...start.validity, badInput: false, valid: true } });
    fireEvent.click(within(form).getByTestId('festival-save'));
    await waitFor(() => expect(screen.queryByTestId('festival-form')).toBeNull());
    expect(body(fn, 'PUT', '/api/admin/festivals/3')).toMatchObject({ startDate: null });
  });

  it('hides / shows a festival with the switch', async () => {
    const fn = stubApi(festivalRoutes({ 'PUT /api/admin/festivals/6': (init) => ({ body: { ...makeFestivals()[5], ...JSON.parse(String(init.body)) } }) }));
    await open(fn);
    fireEvent.click(within(frow('surrey')).getByTestId('festival-active-switch'));
    await waitFor(() => expect(frow('surrey')).toHaveTextContent('Hidden'));
    expect(body(fn, 'PUT', '/api/admin/festivals/6')).toEqual({ active: false });
  });

  it('deletes after confirming', async () => {
    const fn = stubApi(festivalRoutes({ 'DELETE /api/admin/festivals/20': () => ({ status: 204 }) }));
    await open(fn);
    fireEvent.click(within(frow('kamloops')).getByTestId('festival-delete'));
    expect(await screen.findByText('Delete Kamloops Regional STAR Fest?')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-button'));
    await waitFor(() => expect(screen.getAllByTestId('festival-row')).toHaveLength(9));
    expect(fn.mock.calls.some(([u, i]) => String(u) === '/api/admin/festivals/20' && (i as RequestInit).method === 'DELETE')).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { FESTIVAL_STORAGE_KEY } from '../../lib/festivals';
import { json, mockFetch, type Handler } from '../../pages/__tests__/mockFetch';
import { makeFestivals, makeMeta, makeUser } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import type { User } from '../../types';
import { useAuth } from '../AuthProvider';
import { useFestival } from '../FestivalProvider';

afterEach(() => vi.unstubAllGlobals());

function Probe() {
  const { selected, source, setFestival, saving, regionalChoices, nationals, refreshFestivals } = useFestival();
  const { user, login, logout, signup, updateProfile } = useAuth();
  const [result, setResult] = useState('');
  return (
    <>
      <p data-testid="selected">{selected?.slug ?? 'none'}</p>
      <p data-testid="source">{source}</p>
      <p data-testid="saving">{String(saving)}</p>
      <p data-testid="user">{user ? `${user.displayName}:${user.festivalSlug ?? '-'}` : 'anon'}</p>
      <p data-testid="counts">{`${regionalChoices.length}/${nationals.length}`}</p>
      <p data-testid="result">{result}</p>
      <button type="button" onClick={() => void setFestival('burnaby').then((ok) => setResult(String(ok)))}>
        pick burnaby
      </button>
      <button type="button" onClick={() => void setFestival('victoria').then((ok) => setResult(String(ok)))}>
        pick victoria
      </button>
      <button type="button" onClick={() => void setFestival('star-fest-west').then((ok) => setResult(String(ok)))}>
        pick national
      </button>
      <button type="button" onClick={() => void updateProfile({ currentPassword: 'temporary-pass', newPassword: 'a-new-password-1' }).catch(() => undefined)}>
        change password
      </button>
      <button type="button" onClick={() => void setFestival(null).then((ok) => setResult(String(ok)))}>
        clear
      </button>
      <button type="button" onClick={() => void login('kid@example.com', 'secret-password').catch(() => undefined)}>
        login
      </button>
      <button type="button" onClick={() => void signup({ email: 'new@example.com', password: 'secret-password', displayName: 'Newbie' }).catch(() => undefined)}>
        signup
      </button>
      <button type="button" onClick={() => void logout()}>
        logout
      </button>
      <button type="button" onClick={() => void refreshFestivals()}>
        refresh
      </button>
    </>
  );
}

const stored = () => window.localStorage.getItem(FESTIVAL_STORAGE_KEY);
const selected = () => screen.getByTestId('selected').textContent;
const source = () => screen.getByTestId('source').textContent;

/** PUT /api/auth/me echoing the new festival back on `user`. */
const putMe =
  (user: User): Handler =>
  (req) =>
    json(200, { user: { ...user, festivalSlug: req.body.festivalSlug } });

function setup(options: { user?: User | null; local?: string; route?: string; defaultSlug?: string | null; routes?: Record<string, Handler> } = {}) {
  if (options.local) window.localStorage.setItem(FESTIVAL_STORAGE_KEY, options.local);
  const api = mockFetch(options.routes ?? {});
  const view = renderWithProviders(<Probe />, {
    user: options.user ?? null,
    meta: makeMeta({ defaultFestivalSlug: options.defaultSlug ?? null }),
    route: options.route ?? '/',
  });
  return { ...view, api };
}

describe('FestivalProvider — selection priority (url → account → local → default → none)', () => {
  it('a ?festival= link beats the account, and is saved to it', async () => {
    const user = makeUser({ festivalSlug: 'victoria' });
    const { api } = setup({ user, local: 'burnaby', defaultSlug: 'vancouver', route: '/?festival=surrey', routes: { 'PUT /api/auth/me': putMe(user) } });
    await waitFor(() => expect(selected()).toBe('surrey'));
    expect(source()).toBe('url');
    expect(stored()).toBe('surrey');
    await waitFor(() => expect(api.calls('PUT /api/auth/me')).toHaveLength(1));
    expect(api.calls('PUT /api/auth/me')[0]?.body).toEqual({ festivalSlug: 'surrey' });
  });

  it('then the account (copied to this device)', () => {
    setup({ user: makeUser({ festivalSlug: 'victoria' }), local: 'burnaby', defaultSlug: 'vancouver' });
    expect(selected()).toBe('victoria');
    expect(source()).toBe('account');
    expect(stored()).toBe('victoria');
  });

  it('then this device', () => {
    const { api } = setup({ local: 'burnaby', defaultSlug: 'vancouver' });
    expect(selected()).toBe('burnaby');
    expect(source()).toBe('local');
    expect(api.fn).not.toHaveBeenCalled();
  });

  it('then the site default (not stored — it can change)', () => {
    setup({ defaultSlug: 'vancouver' });
    expect(selected()).toBe('vancouver');
    expect(source()).toBe('default');
    expect(stored()).toBeNull();
  });

  it('else nothing', () => {
    setup();
    expect(selected()).toBe('none');
    expect(source()).toBe('none');
    expect(screen.getByTestId('counts')).toHaveTextContent('8/1');
  });

  it('skips unknown, national and junk slugs', () => {
    setup({ local: 'star-fest-west', defaultSlug: 'atlantis' });
    expect(selected()).toBe('none');
  });
});

describe('FestivalProvider — ?festival= links', () => {
  it('is applied once, then removed with replace (other params and the hash kept)', async () => {
    const { router } = setup({ route: '/songs?q=wicked&festival=nanaimo&kind=duet#top' });
    await waitFor(() => expect(router.state.location.search).toBe('?q=wicked&kind=duet'));
    expect(router.state.location.hash).toBe('#top');
    expect(router.state.location.pathname).toBe('/songs');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(selected()).toBe('nanaimo');
    expect(stored()).toBe('nanaimo');
  });

  it('an unknown slug is ignored gracefully (falls back, explains, still tidies the URL)', async () => {
    const { router } = setup({ local: 'burnaby', route: '/?festival=atlantis' });
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(selected()).toBe('burnaby');
    expect(stored()).toBe('burnaby');
    expect(await screen.findByText(/didn’t match a current festival/)).toBeInTheDocument();
  });

  it('also works for a link followed inside the app', async () => {
    const { router } = setup({ local: 'burnaby' });
    await act(() => router.navigate('/star-prep?festival=victoria'));
    await waitFor(() => expect(selected()).toBe('victoria'));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(router.state.location.pathname).toBe('/star-prep');
  });
});

describe('FestivalProvider — changing it', () => {
  it('logged out: saved on this device only', async () => {
    const { api } = setup({ local: 'surrey' });
    fireEvent.click(screen.getByText('pick burnaby'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true'));
    expect(selected()).toBe('burnaby');
    expect(source()).toBe('local');
    expect(stored()).toBe('burnaby');
    expect(api.fn).not.toHaveBeenCalled();
  });

  it('logged in: optimistic, then saved to the account', async () => {
    const user = makeUser({ festivalSlug: 'victoria' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { api } = setup({ user, routes: { 'PUT /api/auth/me': async (req) => (await gate, putMe(user)(req)) } });
    fireEvent.click(screen.getByText('pick burnaby'));
    expect(selected()).toBe('burnaby'); // straight away
    expect(screen.getByTestId('saving')).toHaveTextContent('true');
    release();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Stage Kid:burnaby'));
    await waitFor(() => expect(screen.getByTestId('saving')).toHaveTextContent('false'));
    expect(source()).toBe('account');
    expect(api.calls('PUT /api/auth/me')[0]?.body).toEqual({ festivalSlug: 'burnaby' });
    expect(api.calls('PUT /api/auth/me')[0]?.headers['X-Requested-With']).toBe('star-song-finder');
  });

  it('rolls back (choice + storage) with a toast when the save fails', async () => {
    const user = makeUser({ festivalSlug: 'victoria' });
    setup({ user, routes: { 'PUT /api/auth/me': () => json(400, { error: 'Please check the form', details: { festivalSlug: 'Choose an active regional or online festival' } }) } });
    expect(selected()).toBe('victoria');
    fireEvent.click(screen.getByText('pick burnaby'));
    expect(selected()).toBe('burnaby');
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'));
    expect(selected()).toBe('victoria');
    expect(stored()).toBe('victoria');
    expect(screen.getByText('Couldn’t save your festival')).toBeInTheDocument();
    expect(screen.getByText('Choose an active regional or online festival')).toBeInTheDocument();
  });

  it('a network failure rolls back too', async () => {
    setup({ user: makeUser({ festivalSlug: null }), local: 'surrey', routes: { 'PUT /api/auth/me': () => Promise.reject(new TypeError('offline')) } });
    // the account had none → this device's choice was pushed (and failed quietly)
    await waitFor(() => expect(screen.getByTestId('saving')).toHaveTextContent('false'));
    fireEvent.click(screen.getByText('pick burnaby'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'));
    expect(selected()).toBe('surrey');
    expect(stored()).toBe('surrey');
  });

  it('clearing forgets it here and on the account', async () => {
    const user = makeUser({ festivalSlug: 'victoria' });
    const { api } = setup({ user, routes: { 'PUT /api/auth/me': putMe(user) } });
    fireEvent.click(screen.getByText('clear'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Stage Kid:-'));
    expect(selected()).toBe('none');
    expect(stored()).toBeNull();
    expect(api.calls('PUT /api/auth/me')[0]?.body).toEqual({ festivalSlug: null });
  });

  it('national (not choosable) slugs are refused', async () => {
    setup({ local: 'surrey' });
    fireEvent.click(screen.getByText('pick national'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'));
    expect(selected()).toBe('surrey');
  });

  it('going back to the account’s festival while a save is on its way is saved too (A→B→A: the last choice wins)', async () => {
    const user = makeUser({ festivalSlug: 'victoria' });
    const gates: Array<() => void> = [];
    const { api } = setup({
      user,
      routes: {
        'PUT /api/auth/me': async (req) => {
          await new Promise<void>((r) => gates.push(r));
          return putMe(user)(req);
        },
      },
    });
    fireEvent.click(screen.getByText('pick burnaby'));
    fireEvent.click(screen.getByText('pick victoria'));
    expect(selected()).toBe('victoria');
    await waitFor(() => expect(gates).toHaveLength(1));
    gates[0]!(); // Burnaby's save answers…
    await waitFor(() => expect(gates).toHaveLength(2)); // …then Victoria's is sent
    expect(selected()).toBe('victoria'); // Burnaby's answer doesn't take over
    expect(stored()).toBe('victoria');
    gates[1]!();
    await waitFor(() => expect(screen.getByTestId('saving')).toHaveTextContent('false'));
    expect(api.calls('PUT /api/auth/me').map((c) => c.body)).toEqual([{ festivalSlug: 'burnaby' }, { festivalSlug: 'victoria' }]);
    expect(screen.getByTestId('user')).toHaveTextContent('Stage Kid:victoria');
    expect(selected()).toBe('victoria');
    expect(source()).toBe('account');
    expect(stored()).toBe('victoria');
  });

  it('a save that answers after logging out does not log the user back in', async () => {
    const user = makeUser({ festivalSlug: 'victoria' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    setup({
      user,
      routes: {
        'PUT /api/auth/me': async (req) => (await gate, putMe(user)(req)),
        'POST /api/auth/logout': () => new Response(null, { status: 204 }),
      },
    });
    fireEvent.click(screen.getByText('pick burnaby'));
    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anon'));
    release();
    await waitFor(() => expect(screen.getByTestId('saving')).toHaveTextContent('false'));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.getByTestId('user')).toHaveTextContent('anon');
    expect(selected()).toBe('burnaby');
    expect(source()).toBe('local');
  });

  it('a choice made on a temporary password goes to the account after the new password — even if the account had one', async () => {
    const user = makeUser({ festivalSlug: 'surrey', mustChangePassword: true });
    const { api } = setup({
      user,
      routes: {
        'PUT /api/auth/me': (req) =>
          json(200, { user: { ...user, mustChangePassword: false, festivalSlug: req.body.festivalSlug === undefined ? user.festivalSlug : req.body.festivalSlug } }),
      },
    });
    expect(selected()).toBe('surrey');
    fireEvent.click(screen.getByText('pick burnaby'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true'));
    expect(source()).toBe('local'); // only on this device for now
    expect(api.calls('PUT /api/auth/me')).toHaveLength(0);
    fireEvent.click(screen.getByText('change password'));
    await waitFor(() => expect(api.calls('PUT /api/auth/me')).toHaveLength(2));
    expect(api.calls('PUT /api/auth/me')[1]?.body).toEqual({ festivalSlug: 'burnaby' });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Stage Kid:burnaby'));
    await waitFor(() => expect(source()).toBe('account'));
    expect(selected()).toBe('burnaby');
    expect(stored()).toBe('burnaby');
  });

  it('a choice whose save found the session ended is saved to that account after logging back in', async () => {
    const user = makeUser({ festivalSlug: 'surrey' });
    let session = false;
    const { api } = setup({
      user,
      routes: {
        'PUT /api/auth/me': (req) => (session ? putMe(user)(req) : json(401, { error: 'Please log in first' })),
        'POST /api/auth/logout': () => new Response(null, { status: 204 }),
        'POST /api/auth/login': () => ((session = true), json(200, { user })),
      },
    });
    fireEvent.click(screen.getByText('pick burnaby'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true')); // kept on this device
    expect(stored()).toBe('burnaby');
    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anon'));
    expect(selected()).toBe('burnaby');
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(api.calls('PUT /api/auth/me')).toHaveLength(2));
    expect(api.calls('PUT /api/auth/me')[1]?.body).toEqual({ festivalSlug: 'burnaby' });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Stage Kid:burnaby'));
    expect(selected()).toBe('burnaby');
  });

  it('…but someone else logging in on this computer gets their own account’s festival', async () => {
    const user = makeUser({ festivalSlug: 'surrey' });
    const other = makeUser({ id: 77, displayName: 'Other Kid', festivalSlug: 'victoria' });
    const { api } = setup({
      user,
      routes: {
        'PUT /api/auth/me': () => json(401, { error: 'Please log in first' }),
        'POST /api/auth/logout': () => new Response(null, { status: 204 }),
        'POST /api/auth/login': () => json(200, { user: other }),
      },
    });
    fireEvent.click(screen.getByText('pick burnaby'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true'));
    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anon'));
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(selected()).toBe('victoria'));
    expect(source()).toBe('account');
    expect(api.calls('PUT /api/auth/me')).toHaveLength(1);
  });

  it('while on a temporary password: this device only (no 403 round-trip)', async () => {
    const { api } = setup({ user: makeUser({ mustChangePassword: true, festivalSlug: null }) });
    fireEvent.click(screen.getByText('pick burnaby'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true'));
    expect(stored()).toBe('burnaby');
    expect(api.fn).not.toHaveBeenCalled();
  });
});

describe('FestivalProvider — login / signup / logout', () => {
  it('login adopts the account’s festival', async () => {
    const account = makeUser({ festivalSlug: 'victoria' });
    const { api } = setup({ local: 'surrey', routes: { 'POST /api/auth/login': () => json(200, { user: account }) } });
    expect(selected()).toBe('surrey');
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(selected()).toBe('victoria'));
    expect(source()).toBe('account');
    expect(stored()).toBe('victoria');
    expect(api.calls('PUT /api/auth/me')).toHaveLength(0);
  });

  it('login with no festival on the account saves this browser’s choice to it', async () => {
    const account = makeUser({ festivalSlug: null });
    const { api } = setup({ local: 'surrey', routes: { 'POST /api/auth/login': () => json(200, { user: account }), 'PUT /api/auth/me': putMe(account) } });
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(api.calls('PUT /api/auth/me')).toHaveLength(1));
    expect(api.calls('PUT /api/auth/me')[0]?.body).toEqual({ festivalSlug: 'surrey' });
    await waitFor(() => expect(source()).toBe('account'));
    expect(selected()).toBe('surrey');
  });

  it('a site default is never pushed to an account', async () => {
    const account = makeUser({ festivalSlug: null });
    const { api } = setup({ defaultSlug: 'vancouver', routes: { 'POST /api/auth/login': () => json(200, { user: account }) } });
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Stage Kid'));
    await act(() => new Promise((r) => setTimeout(r, 30))); // let the login sync run
    expect(selected()).toBe('vancouver');
    expect(api.calls('PUT /api/auth/me')).toHaveLength(0);
  });

  it('signup saves this browser’s choice to the new account', async () => {
    const created = makeUser({ id: 99, displayName: 'Newbie', festivalSlug: null });
    const { api } = setup({ local: 'online', routes: { 'POST /api/auth/signup': () => json(201, { user: created }), 'PUT /api/auth/me': putMe(created) } });
    fireEvent.click(screen.getByText('signup'));
    await waitFor(() => expect(api.calls('PUT /api/auth/me')).toHaveLength(1));
    expect(api.calls('PUT /api/auth/me')[0]?.body).toEqual({ festivalSlug: 'online' });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('Newbie:online'));
  });

  it('logout keeps the choice on this device', async () => {
    setup({ user: makeUser({ festivalSlug: 'victoria' }), routes: { 'POST /api/auth/logout': () => new Response(null, { status: 204 }) } });
    expect(selected()).toBe('victoria');
    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('anon'));
    await waitFor(() => expect(source()).toBe('local')); // (the account → device hand-over runs in an effect)
    expect(selected()).toBe('victoria');
    expect(stored()).toBe('victoria');
  });

  it('an account festival that is no longer active is ignored (this device’s choice is kept and re-saved)', async () => {
    const festivals = makeFestivals().filter((f) => f.slug !== 'victoria');
    window.localStorage.setItem(FESTIVAL_STORAGE_KEY, 'burnaby');
    const user = makeUser({ festivalSlug: 'victoria' });
    const api = mockFetch({ 'PUT /api/auth/me': putMe(user) });
    renderWithProviders(<Probe />, { user, meta: makeMeta({ festivals }) });
    expect(selected()).toBe('burnaby');
    await waitFor(() => expect(api.calls('PUT /api/auth/me')[0]?.body).toEqual({ festivalSlug: 'burnaby' }));
  });

  it('a hidden festival shown again comes back without a reload (when nothing else was chosen)', async () => {
    const all = makeFestivals();
    const user = makeUser({ festivalSlug: 'victoria' });
    const api = mockFetch({ 'GET /api/festivals': () => json(200, { festivals: all }) });
    renderWithProviders(<Probe />, { user, meta: makeMeta({ festivals: all.filter((f) => f.slug !== 'victoria') }) });
    expect(selected()).toBe('none');
    fireEvent.click(screen.getByText('refresh'));
    await waitFor(() => expect(selected()).toBe('victoria'));
    expect(source()).toBe('account');
    expect(stored()).toBe('victoria');
    expect(api.calls('PUT /api/auth/me')).toHaveLength(0);
  });

  it('…but a refreshed list never overrides a festival that is already chosen', async () => {
    const all = makeFestivals();
    window.localStorage.setItem(FESTIVAL_STORAGE_KEY, 'burnaby');
    mockFetch({ 'GET /api/festivals': () => json(200, { festivals: all }) });
    renderWithProviders(<Probe />, { meta: makeMeta({ festivals: all.filter((f) => f.slug !== 'victoria') }), user: null });
    expect(selected()).toBe('burnaby');
    fireEvent.click(screen.getByText('refresh'));
    await waitFor(() => expect(screen.getByTestId('counts')).toHaveTextContent('8/1'));
    expect(selected()).toBe('burnaby');
    expect(source()).toBe('local');
  });
});

describe('FestivalProvider — the festival list can’t be loaded', () => {
  it('reports loadError when /api/meta and GET /api/festivals both fail; retryLoad recovers', async () => {
    let up = false;
    mockFetch({
      'GET /api/songs': () => json(500, { error: 'down' }),
      'GET /api/meta': () => json(500, { error: 'down' }),
      'GET /api/festivals': () => (up ? json(200, { festivals: makeFestivals() }) : json(500, { error: 'down' })),
    });
    function LoadProbe() {
      const { ready, loadError, retryLoad, regionalChoices } = useFestival();
      return (
        <>
          <p data-testid="state">{`${ready}/${loadError}/${regionalChoices.length}`}</p>
          <button type="button" onClick={() => void retryLoad()}>
            retry
          </button>
        </>
      );
    }
    renderWithProviders(<LoadProbe />, { live: true });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('false/true/0'));
    up = true;
    fireEvent.click(screen.getByText('retry'));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('true/false/8'));
  });
});

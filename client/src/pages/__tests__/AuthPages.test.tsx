import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { makeUser } from '../../test/fixtures';
import LoginPage from '../LoginPage';
import SignupPage from '../SignupPage';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('LoginPage', () => {
  it('logs in and follows ?next=', async () => {
    const fn = stubFetch(200, { user: makeUser({ displayName: 'Belter' }) });
    const { router } = renderWithProviders(<LoginPage />, { route: '/signin?next=%2Fadd', path: '/signin' });
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'kid@example.com' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/add'));
    const init = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[0]).toBe('/api/auth/login');
    expect(JSON.parse(String(init[1].body))).toEqual({ email: 'kid@example.com', password: 'secret123' });
  });

  it('keeps keyboard focus on the submit button while checking and after an error', async () => {
    let answer: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    renderWithProviders(<LoginPage />, { route: '/signin', path: '/signin' });
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'kid@example.com' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'nope-nope' } });
    const submit = screen.getByTestId('login-submit');
    submit.focus();
    fireEvent.click(submit);
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(submit).not.toBeDisabled(); // a disabled button would drop focus to <body>
    expect(submit).toHaveFocus();
    fireEvent.click(submit); // ignored while busy
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    answer(new Response(JSON.stringify({ error: 'Email or password is incorrect' }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    expect(await screen.findByTestId('login-error')).toBeInTheDocument();
    expect(submit).toHaveFocus();
    expect(submit).not.toHaveAttribute('aria-disabled');
  });

  it('shows the server error for wrong credentials', async () => {
    stubFetch(401, { error: 'Email or password is incorrect' });
    renderWithProviders(<LoginPage />, { route: '/signin', path: '/signin' });
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'kid@example.com' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'nope-nope' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('login-error')).toHaveTextContent('Email or password is incorrect');
  });

  it('never redirects off-site', async () => {
    stubFetch(200, { user: makeUser() });
    const { router } = renderWithProviders(<LoginPage />, { route: '/signin?next=%2F%2Fevil.com', path: '/signin' });
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'kid@example.com' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it.each(['%2F%09%2Fexample.com', '%2F%0A%2Fexample.com', '%2F%0D%2Fexample.com'])(
    'falls back home for a control-character next (%s) instead of an external target',
    async (encoded) => {
      stubFetch(200, { user: makeUser() });
      const { router } = renderWithProviders(<LoginPage />, { route: `/signin?next=${encoded}`, path: '/signin' });
      fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'kid@example.com' } });
      fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret123' } });
      fireEvent.click(screen.getByTestId('login-submit'));
      await waitFor(() => expect(router.state.location.pathname).toBe('/'));
      expect(router.state.location.search).toBe('');
    },
  );

  it('sends users who must change their password to /me', async () => {
    stubFetch(200, { user: makeUser({ mustChangePassword: true }) });
    const { router } = renderWithProviders(<LoginPage />, { route: '/signin?next=%2Fsongs', path: '/signin' });
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'kid@example.com' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'temp-pass-1' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'));
  });
});

describe('SignupPage', () => {
  it('validates before calling the API', () => {
    const fn = stubFetch(201, {});
    renderWithProviders(<SignupPage />, { route: '/join', path: '/join' });
    fireEvent.click(screen.getByTestId('signup-submit'));
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(3);
    expect(fn).not.toHaveBeenCalled();
  });

  it('is honest about who sees the email, and gives safe password advice', () => {
    stubFetch(201, {});
    renderWithProviders(<SignupPage />, { route: '/join', path: '/join' });
    const hint = screen.getByText(/Used only to log in/);
    expect(hint).toHaveTextContent('Only you and the site admins (your teachers) can see it');
    expect(hint).not.toHaveTextContent('never shown to anyone else');
    const pw = screen.getByText(/At least 8 characters/);
    expect(pw).toHaveTextContent(/random words/);
    expect(pw).not.toHaveTextContent(/song/);
  });

  it('shows a duplicate-email error with a login link', async () => {
    stubFetch(409, { error: 'An account with that email already exists' });
    renderWithProviders(<SignupPage />, { route: '/join', path: '/join' });
    fireEvent.change(screen.getByTestId('signup-name'), { target: { value: 'Belter' } });
    fireEvent.change(screen.getByTestId('signup-email'), { target: { value: 'kid@example.com' } });
    fireEvent.change(screen.getByTestId('signup-password'), { target: { value: 'long-enough-1' } });
    fireEvent.click(screen.getByTestId('signup-submit'));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'log in instead?' })).toBeInTheDocument();
  });
});

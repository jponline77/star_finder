import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { makeUser } from '../../test/fixtures';
import { AudioProvider } from '../../state/AudioProvider';
import { AuthProvider } from '../../state/AuthProvider';
import { RequireAuth } from '../../state/RequireAuth';
import { SongsProvider } from '../../state/SongsProvider';
import { ToastProvider } from '../../state/ToastProvider';
import { useUnsavedChangesGuard } from '../../pages/song-form/useUnsavedChangesGuard';
import { saveDraft } from '../../lib/drafts';
import { AccountMenu } from '../AccountMenu';

afterEach(() => vi.unstubAllGlobals());

function DirtyForm() {
  const { blocker } = useUnsavedChangesGuard(true);
  return (
    <div>
      <p>DIRTY FORM</p>
      {blocker.state === 'blocked' && (
        <div role="dialog" aria-label="Leave without saving?">
          <button type="button" onClick={() => blocker.reset?.()}>
            Keep editing
          </button>
          <button type="button" onClick={() => blocker.proceed?.()}>
            Leave
          </button>
        </div>
      )}
    </div>
  );
}

/** The account menu lives in the header, outside the routed page — like in the real Layout. */
function renderApp(route: string) {
  const logout = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', logout);
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ToastProvider>
            <AuthProvider initialUser={makeUser({ id: 7, displayName: 'Stage Kid' })}>
              <SongsProvider initialSongs={[]} initialMeta={null}>
                <AudioProvider>
                  <header>
                    <AccountMenu />
                  </header>
                  <Outlet />
                </AudioProvider>
              </SongsProvider>
            </AuthProvider>
          </ToastProvider>
        ),
        children: [
          { index: true, element: <p>HOME</p> },
          { path: 'me', element: <RequireAuth><p>MY STUFF</p></RequireAuth> },
          { path: 'add', element: <RequireAuth><DirtyForm /></RequireAuth> },
          { path: 'login', element: <p>LOGIN PAGE</p> },
        ],
      },
    ],
    { initialEntries: [route] },
  );
  render(<RouterProvider router={router} />);
  return { router, logout };
}

function openMenuAndLogOut() {
  fireEvent.click(screen.getByTestId('account-menu-button'));
  fireEvent.click(screen.getByTestId('logout-button'));
}

describe('AccountMenu', () => {
  it('logging out from a login-only page lands on home, not /login?next=…', async () => {
    const { router, logout } = renderApp('/me');
    openMenuAndLogOut();
    await waitFor(() => expect(screen.getByTestId('login-link')).toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.search).toBe('');
    expect(router.state.location.state).toBeNull();
    expect(screen.getByText('HOME')).toBeInTheDocument();
    expect(logout).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });

  it('asks before leaving unsaved changes; cancelling keeps you logged in', async () => {
    const { router, logout } = renderApp('/add');
    openMenuAndLogOut();
    expect(await screen.findByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/add');
    expect(screen.getByText('DIRTY FORM')).toBeInTheDocument();
    expect(screen.getByTestId('account-menu-button')).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    openMenuAndLogOut();
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.getByTestId('login-link')).toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/');
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('forgets saved drafts and slate details on logout (shared computers)', async () => {
    saveDraft('song-form:add', 7, { values: {} });
    window.localStorage.setItem('star.slate.remembered.v1', JSON.stringify({ name1: 'Heather Black' }));
    renderApp('/');
    openMenuAndLogOut();
    await waitFor(() => expect(screen.getByTestId('login-link')).toBeInTheDocument());
    expect(window.sessionStorage.getItem('star.draft.v1:song-form:add')).toBeNull();
    expect(window.localStorage.getItem('star.slate.remembered.v1')).toBeNull();
  });

  it('Escape closes the menu and returns focus to the account button', () => {
    renderApp('/');
    const button = screen.getByTestId('account-menu-button');
    expect(button).not.toHaveAttribute('aria-haspopup');
    fireEvent.click(button);
    const item = screen.getByRole('link', { name: /My stuff/ });
    act(() => item.focus());
    fireEvent.keyDown(item, { key: 'Escape' });
    expect(screen.queryByTestId('account-menu')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('closes when keyboard focus leaves it', () => {
    renderApp('/');
    fireEvent.click(screen.getByTestId('account-menu-button'));
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    fireEvent.blur(screen.getByTestId('logout-button'), { relatedTarget: outside });
    expect(screen.queryByTestId('account-menu')).toBeNull();
    outside.remove();
  });
});

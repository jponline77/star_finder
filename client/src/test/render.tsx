/**
 * Render helper for component/page tests — wraps the UI in every provider the app uses,
 * with no network for auth/songs (initial data passed in).
 *
 *   renderWithProviders(<SongCard song={makeSong()} />);
 *   renderWithProviders(<BrowsePage />, { route: '/songs?kind=duet', path: '/songs', songs, meta, user: makeUser() });
 */
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { AudioProvider } from '../state/AudioProvider';
import { AuthProvider } from '../state/AuthProvider';
import { SongsProvider } from '../state/SongsProvider';
import { ToastProvider } from '../state/ToastProvider';
import type { Meta, Song, User } from '../types';

export interface ProviderOptions {
  /** initial URL (default '/') */
  route?: string;
  /** route pattern the UI is mounted at (default '*') */
  path?: string;
  user?: User | null;
  songs?: Song[];
  meta?: Meta | null;
}

export function renderWithProviders(ui: ReactElement, options: ProviderOptions = {}): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const { route = '/', path = '*', user = null, songs = [], meta = null } = options;
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ToastProvider>
            <AuthProvider initialUser={user}>
              <SongsProvider initialSongs={songs} initialMeta={meta}>
                <AudioProvider>
                  <RoutesOutlet />
                </AudioProvider>
              </SongsProvider>
            </AuthProvider>
          </ToastProvider>
        ),
        children: [
          ...(path === '*' ? [{ index: true, element: ui }] : []),
          { path: path === '*' ? '*' : path.replace(/^\//, ''), element: ui },
          { path: 'login', element: <p data-testid="login-route">LOGIN PAGE</p> },
          ...(path === '*' ? [] : [{ path: '*', element: <p data-testid="other-route">OTHER PAGE</p> }]),
        ],
      },
    ],
    { initialEntries: [route] },
  );
  const result = render(<RouterProvider router={router} />);
  return Object.assign(result, { router });
}

function RoutesOutlet() {
  return <Outlet />;
}

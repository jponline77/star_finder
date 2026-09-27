import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router';
import { makeSong } from '../../test/fixtures';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { AudioProvider } from '../../state/AudioProvider';
import { AuthProvider } from '../../state/AuthProvider';
import { SongsProvider } from '../../state/SongsProvider';
import { ToastProvider } from '../../state/ToastProvider';
import { Layout } from '../Layout';
import { PlayButton } from '../PlayButton';

// jsdom doesn't implement scrolling (ScrollRestoration calls it) — silence it for these tests
const realScrollTo = window.scrollTo;
beforeAll(() => {
  window.scrollTo = (() => undefined) as typeof window.scrollTo;
});
afterAll(() => {
  window.scrollTo = realScrollTo;
});

const song = makeSong({ id: 9, title: 'Popular', media: { ...makeSong().media, previewUrl: 'https://p.mzstatic.com/a.m4a' } });

function Home() {
  useDocumentTitle(null);
  return (
    <>
      <h1>Home</h1>
      <Link to="/songs/9" data-testid="card-link">
        Open Popular
      </Link>
      <PlayButton song={song} />
    </>
  );
}
function Browse() {
  useDocumentTitle('Browse songs');
  return (
    <>
      <h1>Browse songs</h1>
      <Link to="/songs?q=pop" data-testid="filter-link">
        Filter
      </Link>
    </>
  );
}
function Detail() {
  useDocumentTitle('Popular — Wicked');
  return <h1>Popular</h1>;
}

function renderApp(route = '/') {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ToastProvider>
            <AuthProvider initialUser={null}>
              <SongsProvider initialSongs={[song]} initialMeta={null}>
                <AudioProvider>
                  <Outlet />
                </AudioProvider>
              </SongsProvider>
            </AuthProvider>
          </ToastProvider>
        ),
        children: [
          {
            element: <Layout />,
            children: [
              { index: true, element: <Home /> },
              { path: 'songs', element: <Browse /> },
              { path: 'songs/:id', element: <Detail /> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [route] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('Layout route changes', () => {
  it('moves focus to <main> and announces the new page after following a header link', async () => {
    renderApp('/');
    const nav = screen.getByTestId('nav-browse');
    act(() => nav.focus());
    fireEvent.click(nav);
    await screen.findByRole('heading', { name: 'Browse songs' });
    expect(document.getElementById('main')).toHaveFocus();
    await waitFor(() => expect(screen.getByTestId('route-announcer')).toHaveTextContent('Browse songs · STAR Song Finder'));
  });

  it('does not leave focus on <body> when the followed link unmounts', async () => {
    renderApp('/');
    const link = screen.getByTestId('card-link');
    act(() => link.focus());
    fireEvent.click(link);
    await screen.findByRole('heading', { name: 'Popular' });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.getElementById('main')).toHaveFocus();
  });

  it('leaves focus alone for query-only changes (filters)', async () => {
    const router = renderApp('/songs');
    const link = screen.getByTestId('filter-link');
    act(() => link.focus());
    fireEvent.click(link);
    await waitFor(() => expect(router.state.location.search).toBe('?q=pop'));
    expect(link).toHaveFocus();
  });
});

describe('Header mobile menu', () => {
  it('Escape closes the menu and returns focus to the menu button', () => {
    renderApp('/');
    const toggle = screen.getByTestId('menu-toggle');
    fireEvent.click(toggle);
    const link = screen.getByTestId('mobile-nav-shows');
    act(() => link.focus());
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(document.getElementById('mobile-nav')).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it('closes when focus moves outside the menu and its button', () => {
    renderApp('/');
    fireEvent.click(screen.getByTestId('menu-toggle'));
    fireEvent.blur(screen.getByTestId('mobile-nav-shows'), { relatedTarget: screen.getByTestId('card-link') });
    expect(document.getElementById('mobile-nav')).toBeNull();
  });
});

describe('MiniPlayer close', () => {
  it('returns keyboard focus to the play button that started the preview', () => {
    renderApp('/');
    const play = screen.getByTestId('play-preview');
    act(() => play.focus());
    fireEvent.click(play);
    fireEvent.click(screen.getByTestId('mini-player-close'));
    expect(screen.queryByTestId('mini-player')).toBeNull();
    expect(play).toHaveFocus();
  });
});

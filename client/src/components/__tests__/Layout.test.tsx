import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, Outlet, RouterProvider, useSearchParams } from 'react-router';
import { makeMeta, makeSong } from '../../test/fixtures';
import type { Meta } from '../../types';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { AudioProvider } from '../../state/AudioProvider';
import { AuthProvider } from '../../state/AuthProvider';
import { FestivalProvider } from '../../state/FestivalProvider';
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

/** A stand-in for /add: its steps share the path and differ by params (like SongFormPage). */
function AddSteps() {
  const [params] = useSearchParams();
  const show = params.get('catalogShow');
  const song = params.get('catalogSong');
  const title = song ? 'Add “Stars”' : show ? 'Add a song from Les Misérables' : 'Add a song — find it';
  useDocumentTitle(title);
  if (song) return <h1>Add “Stars”</h1>;
  if (show)
    return (
      <>
        <h1>Which song from Les Misérables?</h1>
        <Link to="/add?catalogSong=15719&fromShow=1" data-testid="song-link">
          Stars
        </Link>
      </>
    );
  return (
    <>
      <h1>Add a song</h1>
      <Link to="/add?q=les" data-testid="typing-link">
        Type
      </Link>
      <Link to="/add?catalogShow=1&q=les" data-testid="show-link">
        Les Misérables
      </Link>
    </>
  );
}

function renderApp(route = '/', meta: Meta | null = null) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ToastProvider>
            <AuthProvider initialUser={null}>
              <SongsProvider initialSongs={[song]} initialMeta={meta}>
                <FestivalProvider>
                  <AudioProvider>
                    <Outlet />
                  </AudioProvider>
                </FestivalProvider>
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
              { path: 'add', element: <AddSteps /> },
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

  it('/add steps share a path: moving to the next step still moves focus to <main> and announces it', async () => {
    const router = renderApp('/add');
    const link = screen.getByTestId('show-link');
    act(() => link.focus());
    fireEvent.click(link);
    await screen.findByRole('heading', { name: 'Which song from Les Misérables?' });
    expect(router.state.location.pathname).toBe('/add');
    expect(document.activeElement).not.toBe(document.body);
    expect(document.getElementById('main')).toHaveFocus();
    await waitFor(() => expect(screen.getByTestId('route-announcer')).toHaveTextContent('Add a song from Les Misérables · STAR Song Finder'));

    const song = screen.getByTestId('song-link');
    act(() => song.focus());
    fireEvent.click(song);
    await screen.findByRole('heading', { name: 'Add “Stars”' });
    expect(document.getElementById('main')).toHaveFocus();
    await waitFor(() => expect(screen.getByTestId('route-announcer')).toHaveTextContent('Add “Stars” · STAR Song Finder'));
  });

  it('typing in the /add find box (?q=) is not a new step: focus stays put', async () => {
    const router = renderApp('/add');
    const link = screen.getByTestId('typing-link');
    act(() => link.focus());
    fireEvent.click(link);
    await waitFor(() => expect(router.state.location.search).toBe('?q=les'));
    expect(link).toHaveFocus();
  });

  it('announces the refined title when a page sets it once its data loads', async () => {
    function Loading() {
      const [params] = useSearchParams();
      useDocumentTitle(params.get('ready') ? 'Add a song from Wicked' : 'Add a song');
      return <h1>Show</h1>;
    }
    const router = createMemoryRouter(
      [
        {
          element: (
            <ToastProvider>
              <AuthProvider initialUser={null}>
                <SongsProvider initialSongs={[song]} initialMeta={null}>
                  <FestivalProvider>
                    <AudioProvider>
                      <Layout />
                    </AudioProvider>
                  </FestivalProvider>
                </SongsProvider>
              </AuthProvider>
            </ToastProvider>
          ),
          children: [
            { index: true, element: <Home /> },
            { path: 'add', element: <Loading /> },
          ],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    await act(() => router.navigate('/add?catalogShow=3'));
    await waitFor(() => expect(screen.getByTestId('route-announcer')).toHaveTextContent('Add a song · STAR Song Finder'));
    await act(() => router.navigate('/add?catalogShow=3&ready=1', { replace: true }));
    await waitFor(() => expect(screen.getByTestId('route-announcer')).toHaveTextContent('Add a song from Wicked · STAR Song Finder'));
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

describe('Header festival picker (SPEC §7b)', () => {
  it('is in the header bar and in the mobile menu, and both stay in sync', async () => {
    renderApp('/', makeMeta());
    const chip = screen.getByTestId('header-festival');
    expect(chip).toHaveAccessibleName('Choose your festival');
    fireEvent.click(screen.getByTestId('menu-toggle'));
    const select = screen.getByTestId('mobile-festival');
    expect(select).toHaveAccessibleName('Your festival');
    fireEvent.change(select, { target: { value: 'victoria' } });
    await waitFor(() => expect(chip).toHaveAccessibleName('Your festival: Victoria'));
    expect(await screen.findByText('Victoria it is! Your countdown is set.')).toBeInTheDocument();
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

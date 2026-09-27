import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { makeShow, makeSong } from '../../test/fixtures';
import { json, mockFetch } from '../../pages/__tests__/mockFetch';
import { SongsProvider, useShows, useSong, useSongs } from '../SongsProvider';

afterEach(() => vi.unstubAllGlobals());

function Probe({ id }: { id: number }) {
  const { songs, error } = useSongs();
  const { song } = useSong(id);
  return (
    <>
      <p data-testid="list">{`${songs.length} songs · ${error ? 'error' : 'ok'}`}</p>
      <p data-testid="detail">{song ? song.title : 'none'}</p>
    </>
  );
}

describe('SongsProvider', () => {
  it('keeps a failed list failed after one song detail loads (no one-song catalogue)', async () => {
    mockFetch({
      'GET /api/songs': () => json(503, { error: 'Down' }),
      'GET /api/meta': () => json(503, { error: 'Down' }),
      'GET /api/songs/5': () => json(200, { ...makeSong({ id: 5, title: 'Big Fun' }), similar: [] }),
    });
    render(
      <SongsProvider>
        <Probe id={5} />
      </SongsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('detail')).toHaveTextContent('Big Fun'));
    await waitFor(() => expect(screen.getByTestId('list')).toHaveTextContent('error'));
    expect(screen.getByTestId('list')).toHaveTextContent('0 songs · error');
  });

  it('loads every page when the catalogue is bigger than one GET /api/songs answer', async () => {
    const api = mockFetch({
      'GET /api/songs': (req) => {
        const offset = Number(req.query.get('offset') ?? 0);
        const page = offset === 0 ? [makeSong({ id: 1 }), makeSong({ id: 2 })] : offset === 2 ? [makeSong({ id: 3 })] : [];
        return json(200, { songs: page, total: 3 });
      },
      'GET /api/meta': () => json(200, {}),
    });
    render(
      <SongsProvider>
        <Probe id={99} />
      </SongsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('list')).toHaveTextContent('3 songs · ok'));
    const pages = api.calls('GET /api/songs');
    expect(pages).toHaveLength(2);
    expect(pages[1]?.query.get('offset')).toBe('2');
  });

  it('merges details into the list once it has loaded', async () => {
    mockFetch({ 'GET /api/songs/5': () => json(200, { ...makeSong({ id: 5, title: 'New title' }), similar: [] }) });
    render(
      <SongsProvider initialSongs={[makeSong({ id: 5, title: 'Old title' })]}>
        <Probe id={5} />
      </SongsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('detail')).toHaveTextContent('New title'));
    expect(screen.getByTestId('list')).toHaveTextContent('1 songs · ok');
  });

  it('patchShow updates the cached /api/shows list (e.g. comment counts)', async () => {
    mockFetch({ 'GET /api/shows': () => json(200, { shows: [makeShow({ id: 3, name: 'Hadestown', commentCount: 0 })] }) });
    let patch: ReturnType<typeof useSongs>['patchShow'] = () => undefined;
    function Shows() {
      const { shows } = useShows();
      patch = useSongs().patchShow;
      return <p data-testid="shows">{shows.map((s) => `${s.name}:${s.commentCount}`).join(',')}</p>;
    }
    render(
      <SongsProvider initialSongs={[]} initialMeta={null}>
        <Shows />
      </SongsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('shows')).toHaveTextContent('Hadestown:0'));
    act(() => patch(3, { commentCount: 1 }));
    expect(screen.getByTestId('shows')).toHaveTextContent('Hadestown:1');
  });

  it('a first /api/shows load racing the first songs load is never lost (no stuck "loading")', async () => {
    let releaseSongs: () => void = () => undefined;
    const songsGate = new Promise<void>((r) => (releaseSongs = r));
    mockFetch({
      'GET /api/shows': async () => {
        await songsGate; // lands in the same tick as the songs list
        return json(200, { shows: [makeShow({ id: 3, name: 'Hadestown' })] });
      },
      'GET /api/songs': async () => {
        await songsGate;
        return json(200, { songs: [makeSong({ id: 1 })], total: 1 });
      },
      'GET /api/meta': async () => {
        await songsGate;
        return json(200, {});
      },
    });
    function Shows() {
      const { shows, loading } = useShows();
      return <p data-testid="shows">{loading ? 'loading' : shows.map((x) => x.name).join(',')}</p>;
    }
    render(
      <SongsProvider>
        <Shows />
      </SongsProvider>,
    );
    expect(screen.getByTestId('shows')).toHaveTextContent('loading');
    await act(async () => releaseSongs());
    await waitFor(() => expect(screen.getByTestId('shows')).toHaveTextContent('Hadestown'));
  });

  it('reload() refreshes an already-loaded shows list in the background', async () => {
    let name = 'Hadestown';
    const api = mockFetch({
      'GET /api/shows': () => json(200, { shows: [makeShow({ id: 3, name })] }),
      'GET /api/songs': () => json(200, { songs: [], total: 0 }),
      'GET /api/meta': () => json(200, {}),
    });
    let reload: () => Promise<void> = async () => undefined;
    function Shows() {
      const { shows } = useShows();
      reload = useSongs().reload;
      return <p data-testid="shows">{shows.map((x) => x.name).join(',')}</p>;
    }
    render(
      <SongsProvider initialSongs={[]} initialMeta={null}>
        <Shows />
      </SongsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('shows')).toHaveTextContent('Hadestown'));
    name = 'Hadestown (renamed)';
    await act(() => reload());
    await waitFor(() => expect(screen.getByTestId('shows')).toHaveTextContent('Hadestown (renamed)'));
    expect(api.calls('GET /api/shows')).toHaveLength(2);
  });
});

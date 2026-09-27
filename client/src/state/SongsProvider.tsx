/**
 * App-wide song data. Fetches GET /api/songs and GET /api/meta ONCE and shares them.
 *
 *   const { songs, meta, loading, error, reload, upsertSong, removeSong } = useSongs();
 *   const { song, similar, loading, notFound } = useSong(id);       // detail (+ similar)
 *   const { show, loading, notFound } = useShow(slugOrId);          // detail (+ songs, characters)
 *   const { shows, loading } = useShows();                          // /api/shows (cached)
 *   const { meta } = useMeta();
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as api from '../api';
import { ApiError } from '../api';
import type { Meta, Show, ShowDetail, Song, SongDetail } from '../types';

export interface SongsContextValue {
  /** Every song (unsorted as sent by the server — sort with lib/filters). */
  songs: Song[];
  songsById: ReadonlyMap<number, Song>;
  meta: Meta | null;
  /** True during the first load of songs + meta. */
  loading: boolean;
  error: ApiError | null;
  /** Re-fetch songs + meta (and refresh the shows list if it has been loaded). */
  reload: () => Promise<void>;
  /**
   * Insert or replace a song in the cache (after create/edit/upload/detail fetch). Until the full
   * list has loaded, songs are kept aside (still found by getSong/useSong) so a failed list never
   * looks like a one-song catalogue.
   */
  upsertSong: (song: Song) => void;
  /** Drop a song from the cache (after delete). */
  removeSong: (id: number) => void;
  /** Shallow-merge fields into a cached song (e.g. { commentCount }). */
  patchSong: (id: number, patch: Partial<Song>) => void;
  getSong: (id: number) => Song | undefined;

  /** /api/shows cache — null until first requested via useShows()/loadShows(). */
  shows: Show[] | null;
  showsLoading: boolean;
  showsError: ApiError | null;
  loadShows: (force?: boolean) => Promise<Show[]>;
  /** Shallow-merge fields into a cached show (e.g. { commentCount }). */
  patchShow: (id: number, patch: Partial<Show>) => void;
}

const SongsContext = createContext<SongsContextValue | null>(null);

const toApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : 'Something went wrong');

/** Songs per GET /api/songs request (the server answers at most 5,000 at a time). */
const SONGS_PAGE_SIZE = 5000;

/** The whole catalogue: the first page, then further pages while the server says there are more. */
async function fetchAllSongs(): Promise<Song[]> {
  const first = await api.listSongs();
  let songs = first.songs;
  while (songs.length < first.total) {
    const next = await api.listSongs({ offset: songs.length, limit: SONGS_PAGE_SIZE });
    if (next.songs.length === 0) break;
    songs = songs.concat(next.songs);
  }
  return songs;
}

export function SongsProvider({
  children,
  initialSongs,
  initialMeta,
}: {
  children: ReactNode;
  /** For tests/storybook: skip the network and start with this data. */
  initialSongs?: Song[];
  initialMeta?: Meta | null;
}) {
  const [songs, setSongs] = useState<Song[]>(initialSongs ?? []);
  // Has `songs` ever held the full list? Before that, single songs go to `detached` instead.
  const listLoaded = useRef(initialSongs !== undefined);
  const [detached, setDetached] = useState<ReadonlyMap<number, Song>>(() => new Map());
  const [meta, setMeta] = useState<Meta | null>(initialMeta ?? null);
  const [loading, setLoading] = useState(initialSongs === undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [shows, setShows] = useState<Show[] | null>(null);
  const [showsLoading, setShowsLoading] = useState(false);
  const [showsError, setShowsError] = useState<ApiError | null>(null);
  const showsPromise = useRef<Promise<Show[]> | null>(null);
  // Only the newest /api/shows request may write state (a slow older one must not win), and
  // reload() refreshes the shows list only if something has asked for it.
  const showsGeneration = useRef(0);
  const showsRequested = useRef(false);

  const loadShows = useCallback((force = false) => {
    if (showsPromise.current && !force) return showsPromise.current;
    showsRequested.current = true;
    const gen = ++showsGeneration.current;
    const current = () => gen === showsGeneration.current;
    setShowsLoading(true);
    setShowsError(null);
    const p = api
      .listShows()
      .then((res) => {
        if (current()) setShows(res.shows);
        return res.shows;
      })
      .catch((e: unknown) => {
        const err = toApiError(e);
        if (current()) {
          setShowsError(err);
          showsPromise.current = null;
        }
        throw err;
      })
      .finally(() => {
        if (current()) setShowsLoading(false);
      });
    showsPromise.current = p;
    return p;
  }, []);

  const fetchAll = useCallback(
    async (refreshShows: boolean) => {
      setError(null);
      try {
        const [allSongs, metaRes] = await Promise.all([fetchAllSongs(), api.getMeta()]);
        listLoaded.current = true;
        setSongs(allSongs);
        setDetached(new Map());
        setMeta(metaRes);
        // Song/show changes alter the shows list (counts, new shows): refetch it in the background,
        // keeping the current list on screen meanwhile. (Clearing it here used to race a first
        // load still in flight and could leave the list stuck "loading".)
        if (refreshShows && showsRequested.current) loadShows(true).catch(() => undefined);
      } catch (e) {
        setError(toApiError(e));
      } finally {
        setLoading(false);
      }
    },
    [loadShows],
  );
  const reload = useCallback(() => fetchAll(true), [fetchAll]);

  useEffect(() => {
    if (initialSongs !== undefined) return;
    void fetchAll(false);
  }, [fetchAll, initialSongs]);

  const upsertSong = useCallback((song: Song) => {
    // Strip `similar` if a SongDetail was passed in.
    const { similar: _similar, ...plain } = song as SongDetail;
    void _similar;
    if (!listLoaded.current) {
      setDetached((m) => new Map(m).set(plain.id, plain));
      return;
    }
    setSongs((list) => {
      const i = list.findIndex((s) => s.id === plain.id);
      if (i === -1) return [...list, plain];
      const next = [...list];
      next[i] = plain;
      return next;
    });
  }, []);

  const removeSong = useCallback((id: number) => {
    setSongs((list) => list.filter((s) => s.id !== id));
    setDetached((m) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }, []);

  const patchSong = useCallback((id: number, patch: Partial<Song>) => {
    setSongs((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setDetached((m) => {
      const s = m.get(id);
      return s ? new Map(m).set(id, { ...s, ...patch }) : m;
    });
  }, []);

  const songsById = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const getSong = useCallback((id: number) => songsById.get(id) ?? detached.get(id), [songsById, detached]);

  const patchShow = useCallback((id: number, patch: Partial<Show>) => {
    setShows((list) => {
      const cur = list?.find((s) => s.id === id);
      if (!list || !cur || (Object.keys(patch) as Array<keyof Show>).every((k) => cur[k] === patch[k])) return list;
      return list.map((s) => (s.id === id ? { ...s, ...patch } : s));
    });
  }, []);


  const value = useMemo<SongsContextValue>(
    () => ({
      songs,
      songsById,
      meta,
      loading,
      error,
      reload,
      upsertSong,
      removeSong,
      patchSong,
      getSong,
      shows,
      showsLoading,
      showsError,
      loadShows,
      patchShow,
    }),
    [songs, songsById, meta, loading, error, reload, upsertSong, removeSong, patchSong, getSong, shows, showsLoading, showsError, loadShows, patchShow],
  );

  return <SongsContext.Provider value={value}>{children}</SongsContext.Provider>;
}

export function useSongs(): SongsContextValue {
  const ctx = useContext(SongsContext);
  if (!ctx) throw new Error('useSongs must be used inside <SongsProvider>');
  return ctx;
}

/** `/api/meta` (vocal ranges, genres, sub-genres, shows, counts, festival). */
export function useMeta(): { meta: Meta | null; loading: boolean; error: ApiError | null } {
  const { meta, loading, error } = useSongs();
  return { meta, loading, error };
}

export interface UseSongResult {
  /** Detail if loaded, else the cached list entry (instant render), else null. */
  song: Song | null;
  /** Similar songs (from the detail endpoint; [] until loaded). */
  similar: Song[];
  /** True while nothing is available to render yet. */
  loading: boolean;
  /** True while the detail request is in flight (even if a cached song is shown). */
  refreshing: boolean;
  error: ApiError | null;
  notFound: boolean;
  reload: () => Promise<void>;
  /** Replace the song locally + in the shared cache (e.g. after an upload). */
  setSong: (song: Song) => void;
}

/** Song detail by id (route param string is fine). */
export function useSong(id: number | string | undefined): UseSongResult {
  const { getSong, upsertSong, loading: listLoading } = useSongs();
  const numId = id === undefined ? NaN : Number(id);
  const valid = Number.isSafeInteger(numId) && numId > 0;
  const [detail, setDetail] = useState<SongDetail | null>(null);
  const [refreshing, setRefreshing] = useState(valid);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const reloadResolvers = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (!valid) {
      setRefreshing(false);
      return;
    }
    const ctrl = new AbortController();
    setRefreshing(true);
    setError(null);
    api
      .getSong(numId, ctrl.signal)
      .then((d) => {
        setDetail(d);
        upsertSong(d);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(toApiError(e));
      })
      .finally(() => {
        if (ctrl.signal.aborted) return;
        setRefreshing(false);
        const resolvers = reloadResolvers.current;
        reloadResolvers.current = [];
        resolvers.forEach((r) => r());
      });
    return () => ctrl.abort();
  }, [numId, valid, nonce, upsertSong]);

  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        reloadResolvers.current.push(resolve);
        setNonce((n) => n + 1);
      }),
    [],
  );

  const setSong = useCallback(
    (song: Song) => {
      setDetail((d) => ({ ...song, similar: d?.similar ?? [] }));
      upsertSong(song);
    },
    [upsertSong],
  );

  const current = detail && detail.id === numId ? detail : null;
  const cached = valid ? getSong(numId) : undefined;
  const song = current ?? cached ?? null;
  const notFound = !valid || (error?.status === 404 && !current);
  return {
    song: notFound ? null : song,
    similar: current?.similar ?? [],
    loading: !notFound && !song && (refreshing || listLoading) && !error,
    refreshing,
    error: notFound ? null : error,
    notFound,
    reload,
    setSong,
  };
}

export interface UseShowResult {
  show: ShowDetail | null;
  /** The summary from the /api/shows cache while the detail loads (may be null). */
  summary: Show | null;
  loading: boolean;
  error: ApiError | null;
  notFound: boolean;
  reload: () => void;
  setShow: (show: ShowDetail) => void;
}

/** Show detail (with songs + characters) by slug or id. */
export function useShow(slugOrId: string | number | undefined): UseShowResult {
  const { shows } = useSongs();
  const key = slugOrId === undefined ? '' : String(slugOrId);
  const [show, setShow] = useState<ShowDetail | null>(null);
  const [loading, setLoading] = useState(Boolean(key));
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!key) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api
      .getShow(key, ctrl.signal)
      .then((s) => setShow(s))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(toApiError(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [key, nonce]);

  const matches = show && (show.slug === key || String(show.id) === key) ? show : null;
  const summary = shows?.find((s) => s.slug === key || String(s.id) === key) ?? null;
  const notFound = !key || (error?.status === 404 && !matches);
  return {
    show: matches,
    summary,
    loading: !notFound && !matches && loading,
    error: notFound ? null : error,
    notFound,
    reload: useCallback(() => setNonce((n) => n + 1), []),
    setShow,
  };
}

/** All shows (GET /api/shows, cached for the session; `reload()` forces a refetch). */
export function useShows(): { shows: Show[]; loading: boolean; error: ApiError | null; reload: () => Promise<Show[]> } {
  const { shows, showsLoading, showsError, loadShows } = useSongs();
  useEffect(() => {
    if (shows === null && !showsError) loadShows().catch(() => undefined);
  }, [shows, showsError, loadShows]);
  const reload = useCallback(() => loadShows(true), [loadShows]);
  return { shows: shows ?? [], loading: shows === null && !showsError ? true : showsLoading, error: showsError, reload };
}

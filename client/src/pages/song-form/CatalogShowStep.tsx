/**
 * "/add?catalogShow=<id>" — pick a song from one show's catalog list (SPEC §7c). Songs are grouped by act with
 * who sings them, a Solo/Duet/Ensemble guess, reprise tags and "Already in the songbook ✓". When the catalog has
 * no list for the show, "Load songs from the cast album" asks POST …/recording-tracks (saved for everyone). "My song isn't listed"
 * → the form typed by hand with the show filled in.
 *
 * data-testids: catalog-show, catalog-show-title, catalog-song-filter, catalog-song (+ data-id), catalog-song-onsite,
 * load-recording-tracks, recording-tracks-status, song-not-listed, catalog-show-error.
 */
import { ArrowLeft, ArrowRight, ChevronRight, Disc3, PencilLine, Search } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { errorMessage, isApiError, loadCatalogRecordingTracks, lookupErrorMessage } from '../../api';
import { ArtworkTile } from '../../components/ArtworkTile';
import { CatalogCredit, RecordingListCredit } from '../../components/CatalogCredit';
import { EmptyState, ErrorState } from '../../components/EmptyState';
import { Skeleton } from '../../components/Skeletons';
import { primeCatalogShow, useCatalogShow } from '../../hooks/useCatalog';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { KIND_GUESS, addHref, filterCatalogSongs, formatSingers, groupByAct, guessKind, titleWithYear } from '../../lib/catalog';
import { plural } from '../../lib/format';
import { showPath, songPath } from '../../lib/links';
import { useSongs } from '../../state/SongsProvider';
import { creditLines } from '../song-detail/helpers';
import type { CatalogShowDetail, CatalogSong, Kind } from '../../types';

export interface CatalogShowStepProps {
  catalogShowId: number;
  q: string;
  kind: Kind | null;
}

type TracksState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; album: string | null } | { status: 'error'; message: string };

export function CatalogShowStep({ catalogShowId, q, kind }: CatalogShowStepProps) {
  const { data: show, loading, error, reload, setData } = useCatalogShow(catalogShowId);
  useDocumentTitle(show ? `Add a song from ${show.title}` : 'Add a song');
  const backTo = addHref({ q, kind });

  if (loading && !show) return <ShowStepSkeleton backTo={backTo} />;
  if (error || !show) {
    const missing = error?.status === 404;
    return (
      <div className="container song-form-page add-show" data-testid="catalog-show-error">
        <BackLink to={backTo} />
        <h1 className="visually-hidden">Add a song</h1>
        {missing ? (
          <EmptyState
            emoji="🕵️"
            title="That show isn’t in the catalog"
            actions={
              <>
                <Link to={backTo} className="btn btn-primary">
                  Search again
                </Link>
                <Link to={addHref({ manual: true, kind })} className="btn btn-ghost">
                  Enter it manually
                </Link>
              </>
            }
          >
            <p>The link may be old. Search for the show again, or add your song by hand.</p>
          </EmptyState>
        ) : (
          <ErrorState title="The curtain got stuck!" message={`We couldn’t load this show’s song list. ${error ? errorMessage(error) : ''}`} onRetry={reload} />
        )}
      </div>
    );
  }
  return <ShowSongs show={show} q={q} kind={kind} backTo={backTo} onShowUpdated={setData} />;
}

function BackLink({ to }: { to: string }) {
  return (
    <Link to={to} className="back-link" data-testid="catalog-back">
      <ArrowLeft size={16} aria-hidden="true" /> Back to the search
    </Link>
  );
}

function ShowStepSkeleton({ backTo }: { backTo: string }) {
  return (
    <div className="container song-form-page add-show" role="status" aria-live="polite">
      <BackLink to={backTo} />
      <h1 className="visually-hidden">Add a song</h1>
      <span className="visually-hidden">Loading the song list…</span>
      <div className="stack">
        <Skeleton height={120} radius={18} />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height={64} radius={12} />
        ))}
      </div>
    </div>
  );
}

function ShowSongs({ show, q, kind, backTo, onShowUpdated }: { show: CatalogShowDetail; q: string; kind: Kind | null; backTo: string; onShowUpdated: (s: CatalogShowDetail) => void }) {
  const [filter, setFilter] = useState('');
  const [tracks, setTracks] = useState<TracksState>({ status: 'idle' });
  const songsHeading = useRef<HTMLHeadingElement>(null);
  const { songs: siteSongs } = useSongs();
  const poster = useMemo(() => (show.onSite ? (siteSongs.find((s) => s.show.id === show.onSite?.showId && s.show.imageUrl)?.show.imageUrl ?? null) : null), [siteSongs, show.onSite]);
  const filterId = useId();
  const songs = show.songs ?? [];
  const fromRecording = songs.length > 0 && songs.every((s) => s.source === 'recording');
  const filtered = useMemo(() => filterCatalogSongs(songs, filter), [songs, filter]);
  const groups = useMemo(() => groupByAct(filtered), [filtered]);
  const credits = creditLines(show, { withBook: true });
  const notListedHref = show.onSite ? addHref({ manual: true, show: show.onSite.slug, fromShow: show.id, q, kind }) : addHref({ manual: true, catalogShow: show.id, q, kind });

  const loadTracks = async () => {
    if (tracks.status === 'loading') return;
    setTracks({ status: 'loading' });
    try {
      const res = await loadCatalogRecordingTracks(show.id);
      const album = res.recording?.collectionName ?? null;
      // Only saved tracks (with ids) can be picked; a preview (the server saved nothing) can't be linked to.
      const pickable = res.songs.filter((s) => typeof s.id === 'number');
      if (res.songs.length && !pickable.length) {
        setTracks({ status: 'error', message: 'We found the cast album but couldn’t save its track list just now — try again, or type your song in.' });
        return;
      }
      setTracks({ status: 'done', album });
      if (pickable.length) {
        const next = { ...show, songs: pickable, songCount: pickable.length };
        primeCatalogShow(next);
        onShowUpdated(next);
        // The button (and the empty state around it) is gone — land on the new list instead of <body>.
        requestAnimationFrame(() => songsHeading.current?.focus());
      }
    } catch (e) {
      setTracks({
        status: 'error',
        message: isApiError(e) && e.status === 404 ? 'We couldn’t find a cast album for this show.' : lookupErrorMessage(e),
      });
    }
  };

  return (
    <div className="container song-form-page add-show" data-testid="catalog-show">
      <header className="page-header add-show-header">
        <div>
          <BackLink to={backTo} />
          <p className="eyebrow">Step 1 of 3 · Find it — pick your song</p>
          <h1 className="page-title" data-testid="catalog-show-title">
            Which song from {show.title}?
          </h1>
        </div>
      </header>

      <section className="catalog-show-card" aria-label={`About ${show.title}`}>
        <div className="catalog-show-art" aria-hidden="true">
          <ArtworkTile src={poster} seed={show.title} label={show.title} size={96} />
        </div>
        <div className="catalog-show-body">
          <p className="catalog-show-name">{titleWithYear(show.title, show.year)}</p>
          {credits.length > 0 && (
            <p className="catalog-show-credits">
              {credits.map((c, i) => (
                <span key={c.role}>
                  {i > 0 && <span aria-hidden="true"> · </span>}
                  <span className="subtle">{c.role} by</span> {c.names}
                </span>
              ))}
            </p>
          )}
          <p className="catalog-show-tags">
            <span className="badge badge-outline">{songs.length ? plural(songs.length, 'song') : 'No song list yet'}</span>
            {show.onSite ? (
              <Link to={showPath(show.onSite.slug)} className="badge badge-success catalog-show-onsite">
                ✓ On the site — see its page
              </Link>
            ) : (
              <span className="badge badge-pink">New to the site</span>
            )}
          </p>
        </div>
      </section>

      <section className="catalog-songs" aria-labelledby="catalog-songs-title">
        <div className="catalog-songs-head">
          <h2 id="catalog-songs-title" className="section-title catalog-songs-title" ref={songsHeading} tabIndex={-1}>
            <span className="emoji" aria-hidden="true">
              🎼
            </span>
            {fromRecording ? 'Tracks on the cast album' : 'Songs in the show'}
          </h2>
          {songs.length > 8 && (
            <div className="catalog-song-filter">
              <label htmlFor={filterId} className="visually-hidden">
                Filter the songs in {show.title}
              </label>
              <Search size={18} aria-hidden="true" className="catalog-song-filter-icon" />
              <input
                id={filterId}
                className="input"
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by title or character"
                autoComplete="off"
                data-testid="catalog-song-filter"
              />
            </div>
          )}
        </div>
        {/* One live region that's always there, so loading the cast album's tracks is announced (a region that
            appears with its text already in it often isn't). The callouts below are what sighted students see. */}
        <p className="visually-hidden" role="status" aria-live="polite" data-testid="recording-tracks-announcer">
          {tracksAnnouncement(tracks, songs.length)}
        </p>
        {fromRecording && tracks.status !== 'done' && (
          <p className="small muted catalog-songs-note">From the show’s cast album — we don’t know who sings each track, so you’ll fill in the characters.</p>
        )}
        {tracks.status === 'done' && songs.length > 0 && (
          <p className="callout callout-success catalog-songs-note" data-testid="recording-tracks-status">
            <span className="emoji" aria-hidden="true">
              💿
            </span>
            <span>Loaded {plural(songs.length, 'track')}{tracks.album ? ` from “${tracks.album}”` : ' from the cast album'}. We don’t know who sings each one, so you’ll fill in the characters.</span>
          </p>
        )}

        {songs.length === 0 ? (
          <div className="catalog-songs-empty" data-testid="catalog-songs-empty">
            <span className="catalog-songs-empty-emoji" aria-hidden="true">
              📜
            </span>
            <div className="catalog-songs-empty-body">
              <p className="catalog-songs-empty-title">We don’t have a song list for {show.title} yet.</p>
              <p className="small muted">
                {show.recordingTracksAvailable === false
                  ? 'We couldn’t find its cast album on Apple Music either — type your song in, it only takes a minute.'
                  : show.recordingTracksAvailable
                    ? `Good news: its cast album is on Apple Music${show.castAlbum?.collectionName ? ` (“${show.castAlbum.collectionName}”)` : ''} — load its track list, or just type your song in.`
                    : 'We can ask Apple Music for the cast album’s track list — or just type your song in.'}
              </p>
              <div className="cluster">
                {show.recordingTracksAvailable !== false && (
                  <button
                    type="button"
                    className={`btn ${show.recordingTracksAvailable ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => void loadTracks()}
                    // aria-disabled, not disabled: a disabled button drops keyboard focus to <body> while it loads
                    aria-disabled={tracks.status === 'loading' || undefined}
                    data-testid="load-recording-tracks"
                  >
                    {tracks.status === 'loading' ? <span className="spinner" aria-hidden="true" /> : <Disc3 size={18} aria-hidden="true" />}
                    {tracks.status === 'loading' ? 'Asking Apple Music…' : 'Load songs from the cast album'}
                  </button>
                )}
                <Link to={notListedHref} className={`btn ${show.recordingTracksAvailable === false ? 'btn-primary' : 'btn-ghost'}`} data-testid="song-not-listed">
                  <PencilLine size={16} aria-hidden="true" /> Type it in
                </Link>
              </div>
              <div>
                {tracks.status === 'done' && (
                  <p className="callout catalog-songs-note" data-testid="recording-tracks-status">
                    <span className="emoji" aria-hidden="true">
                      🦗
                    </span>
                    <span>We couldn’t find a cast album for this show. Type your song in instead — it only takes a minute.</span>
                  </p>
                )}
                {tracks.status === 'error' && (
                  <p className="callout callout-warning catalog-songs-note" data-testid="recording-tracks-status">
                    {tracks.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <p className="callout catalog-songs-note" role="status">
            No songs match “{filter}”. <button type="button" className="btn btn-quiet btn-sm" onClick={() => setFilter('')}>Show all</button>
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.label || 'all'} className="catalog-act">
              {g.label && <h3 className="catalog-act-title">{g.label}</h3>}
              <ol className="catalog-song-list" role="list">
                {g.songs.map((s) => (
                  <CatalogSongRow key={s.id} song={s} href={addHref({ catalogSong: s.id, fromShow: show.id, q, kind })} />
                ))}
              </ol>
            </div>
          ))
        )}

        {songs.length > 0 && (
          <div className="catalog-songs-footer">
            <Link to={notListedHref} className="btn btn-ghost" data-testid="song-not-listed">
              <PencilLine size={16} aria-hidden="true" /> My song isn’t listed
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            {fromRecording ? <RecordingListCredit /> : <CatalogCredit wikiTitle={show.wikiTitle} />}
          </div>
        )}
      </section>
    </div>
  );
}

/** What the tracks announcer says (the same words as the visible callouts). */
function tracksAnnouncement(tracks: TracksState, count: number): string {
  if (tracks.status === 'loading') return 'Asking Apple Music for the cast album…';
  if (tracks.status === 'error') return tracks.message;
  if (tracks.status !== 'done') return '';
  if (!count) return 'We couldn’t find a cast album for this show. Type your song in instead — it only takes a minute.';
  return `Loaded ${plural(count, 'track')}${tracks.album ? ` from “${tracks.album}”` : ' from the cast album'}. We don’t know who sings each one, so you’ll fill in the characters.`;
}

function CatalogSongRow({ song, href }: { song: CatalogSong; href: string }) {
  const guess = guessKind(song);
  const kind = guess ? KIND_GUESS[guess] : null;
  const singers = formatSingers(song.singers, 4);
  return (
    <li className="catalog-song" data-testid="catalog-song" data-id={song.id}>
      <Link to={href} className="catalog-song-link">
        <span className="catalog-song-num" aria-hidden="true">
          {song.position ?? '♪'}
        </span>
        <span className="catalog-song-body">
          <span className="catalog-song-title">
            {song.title}
            {song.reprise && <span className="badge badge-outline">Reprise</span>}
            {song.instrumental && <span className="badge badge-outline">Instrumental</span>}
          </span>
          <span className="catalog-song-meta">{singers ? `${singers}${song.ensemble && song.singers.length ? ' + ensemble' : ''}` : song.ensemble ? 'Ensemble' : song.source === 'recording' ? 'Cast album track' : 'Singers not listed'}</span>
        </span>
        {kind && (
          <span className="catalog-song-side">
            <span className={`kind-guess is-${kind.tone}`}>
              <span aria-hidden="true">{kind.emoji}</span> {kind.label}
            </span>
          </span>
        )}
        <ChevronRight size={18} aria-hidden="true" className="catalog-song-chevron" />
      </Link>
      {song.onSite && (
        <Link to={songPath(song.onSite.songId)} className="catalog-song-onsite" data-testid="catalog-song-onsite">
          ✓ Already in the songbook<span className="visually-hidden">: open “{song.title}”</span>
        </Link>
      )}
    </li>
  );
}

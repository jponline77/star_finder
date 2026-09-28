/**
 * Add a song "/add" (SPEC §7c: find it in the catalog first) and edit a song "/songs/:id/edit" (SPEC §7.5).
 * Both routes are inside <RequireAuth>. The edit route shows a friendly locked state unless canEdit(user, song).
 *
 * "/add" is URL-driven (lib/catalog `parseAddStep`), so back/forward and shared links work:
 *   /add?q=…                 → FindSongStep (catalog typeahead over songs + shows)
 *   /add?catalogShow=<id>    → CatalogShowStep (that show's song list; cast-album fallback; "My song isn't listed")
 *   /add?catalogSong=<id>    → the SongForm pre-filled from GET /api/catalog/songs/:id/suggestions
 *   /add?manual=1[&show=<slug>|&catalogShow=<id>][&kind=duet] → the SongForm typed by hand
 *   /add?show=<slug>         → (links from show pages) that show's catalog list, else the manual form with the show
 * The form itself lives in song-form/SongForm.tsx.
 */
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { errorMessage, searchCatalog } from '../api';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useCatalogShow, useCatalogSuggestions } from '../hooks/useCatalog';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { addHref, parseAddStep } from '../lib/catalog';
import { songPath } from '../lib/links';
import { equalsLoose } from '../lib/normalize';
import { canEdit } from '../lib/permissions';
import { GENRES } from '../lib/vocab';
import { useAuth } from '../state/AuthProvider';
import { useSong, useSongs } from '../state/SongsProvider';
import type { Kind, Song } from '../types';
import { CatalogShowStep } from './song-form/CatalogShowStep';
import { FindSongStep } from './song-form/FindSongStep';
import { FormSkeleton } from './song-form/FormParts';
import { SongForm } from './song-form/SongForm';
import { prefillFromCatalogShow, prefillFromSuggestions } from './song-form/suggestions';
import './SongFormPage.css';

export default function SongFormPage() {
  const { id } = useParams();
  return id === undefined ? <AddSongRoute /> : <EditSongRoute id={id} />;
}

// ============================================================================ add: which step?
function AddSongRoute() {
  const [params] = useSearchParams();
  const step = parseAddStep(params);
  switch (step.step) {
    case 'find':
      return <FindSongStep key="find" initialQuery={step.q} kind={step.kind} />;
    case 'show':
      return <CatalogShowStep key={`show-${step.catalogShowId}`} catalogShowId={step.catalogShowId} q={step.q} kind={step.kind} />;
    case 'song':
      return <CatalogSongRoute key={`song-${step.catalogSongId}`} catalogSongId={step.catalogSongId} fromShow={step.fromShow} q={step.q} kind={step.kind} />;
    case 'manual':
      return (
        <ManualRoute
          key={`manual-${step.catalogShowId ?? ''}-${step.showSlug ?? ''}`}
          catalogShowId={step.catalogShowId}
          showSlug={step.showSlug}
          fromShow={step.fromShow}
          q={step.q}
          kind={step.kind}
        />
      );
    case 'resolve-show':
      return <ResolveShowStep key={`resolve-${step.showSlug}`} showSlug={step.showSlug} kind={step.kind} />;
  }
}

/** /add?catalogSong=<id> — load the suggestions, then the pre-filled form. */
function CatalogSongRoute({ catalogSongId, fromShow, q, kind }: { catalogSongId: number; fromShow: number | null; q: string; kind: Kind | null }) {
  const { meta } = useSongs();
  const { data, loading, error, reload } = useCatalogSuggestions(catalogSongId);
  const backTo = fromShow ? addHref({ catalogShow: fromShow, q, kind }) : addHref({ q, kind });
  const genres = useMemo(() => [...GENRES, ...(meta?.genres ?? [])], [meta]);
  const prefill = useMemo(() => (data ? prefillFromSuggestions(data, { genres, kind }) : null), [data, genres, kind]);
  useDocumentTitle(prefill ? `Add “${prefill.values.title}”` : 'Add a song');

  if (loading && !data) return <FormSkeleton label="Setting the stage — filling in what we know…" />;
  if (error || !prefill) {
    const missing = error?.status === 404;
    return (
      <div className="container-narrow song-form-page" data-testid="catalog-song-error">
        <Link to={backTo} className="back-link">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </Link>
        <h1 className="visually-hidden">Add a song</h1>
        {missing ? (
          <EmptyState
            emoji="🕵️"
            title="That song isn’t in the catalog"
            actions={
              <>
                <Link to={addHref({ q, kind })} className="btn btn-primary">
                  Search again
                </Link>
                <Link to={addHref({ manual: true, kind })} className="btn btn-ghost">
                  Enter it manually
                </Link>
              </>
            }
          >
            <p>The link may be old. Search for it again, or add your song by hand.</p>
          </EmptyState>
        ) : (
          <>
            <ErrorState title="The curtain got stuck!" message={`We couldn’t fill in this song. ${error ? errorMessage(error) : ''}`} onRetry={reload} />
            <p className="center">
              <Link to={addHref({ manual: true, kind })} className="btn btn-ghost">
                Enter it manually instead
              </Link>
            </p>
          </>
        )}
      </div>
    );
  }
  return <SongForm key={catalogSongId} mode="add" prefill={prefill} backTo={backTo} />;
}

/** /add?manual=1 — the form typed by hand (optionally with a catalog show filled in). */
function ManualRoute({ catalogShowId, showSlug, fromShow, q, kind }: { catalogShowId: number | null; showSlug: string | null; fromShow: number | null; q: string; kind: Kind | null }) {
  const wantShow = showSlug ? null : catalogShowId;
  const { data: show, loading } = useCatalogShow(wantShow);
  const back = fromShow ?? catalogShowId;
  const backTo = back ? addHref({ catalogShow: back, q, kind }) : addHref({ q, kind });
  const showPrefill = useMemo(() => (show ? prefillFromCatalogShow(show, kind) : null), [show, kind]);
  if (wantShow !== null && loading && !show) return <FormSkeleton label="Getting the show ready…" />;
  return <SongForm mode="add" showPrefill={showPrefill} backTo={backTo} />;
}

/**
 * /add?show=<slug> (the show pages link here): open that show's catalog song list when the catalog has it;
 * otherwise the manual form with the show picked (as before).
 */
function ResolveShowStep({ showSlug, kind }: { showSlug: string; kind: Kind | null }) {
  const navigate = useNavigate();
  const { meta, loading: songsLoading } = useSongs();
  const name = meta?.shows.find((s) => s.slug === showSlug)?.name ?? null;
  const waiting = !name && songsLoading;
  useEffect(() => {
    if (waiting) return;
    const ctrl = new AbortController();
    const manual = addHref({ manual: true, show: showSlug, kind });
    searchCatalog(name ?? showSlug.replace(/-/g, ' '), { limit: 10 }, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        const hit = (Array.isArray(res?.results) ? res.results : []).find(
          (h) => h.type === 'show' && (h.onSite?.slug === showSlug || (name !== null && equalsLoose(h.title, name))),
        );
        navigate(hit ? addHref({ catalogShow: hit.id, kind }) : manual, { replace: true });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) navigate(manual, { replace: true });
      });
    return () => ctrl.abort();
  }, [waiting, name, showSlug, kind, navigate]);
  return <FormSkeleton label={`Finding ${name ?? 'the show'} in the catalog…`} />;
}

// ============================================================================ edit route
function EditSongRoute({ id }: { id: string }) {
  const { user } = useAuth();
  const { song, loading, notFound, error, reload } = useSong(id);
  useDocumentTitle(song ? `Edit “${song.title}”` : 'Edit song');

  if (notFound) {
    return (
      <div className="container-narrow song-form-page">
        <h1 className="visually-hidden">Edit song</h1>
        <EmptyState
          emoji="🕵️"
          title="We can’t find that song"
          actions={
            <Link to="/songs" className="btn btn-primary">
              Browse songs
            </Link>
          }
        >
          <p>It may have been removed, or the link is mistyped.</p>
        </EmptyState>
      </div>
    );
  }
  if (error && !song) {
    return (
      <div className="container-narrow song-form-page">
        <h1 className="visually-hidden">Edit song</h1>
        <ErrorState onRetry={() => void reload()} />
      </div>
    );
  }
  if (loading || !song) return <FormSkeleton />;
  if (!canEdit(user, song)) return <EditLocked song={song} />;
  return <SongForm mode="edit" song={song} />;
}

function EditLocked({ song }: { song: Song }) {
  const spreadsheet = song.source === 'spreadsheet';
  return (
    <div className="container-narrow song-form-page" data-testid="edit-locked">
      <h1 className="visually-hidden">Edit “{song.title}”</h1>
      <EmptyState
        emoji="🔒"
        title="You can only edit songs you added"
        actions={
          <>
            <Link to={songPath(song.id)} className="btn btn-primary">
              <ArrowLeft size={18} aria-hidden="true" /> Back to the song
            </Link>
            <Link to="/add" className="btn btn-ghost">
              Add a different song
            </Link>
          </>
        }
      >
        {spreadsheet ? (
          <p>
            <strong>“{song.title}”</strong> comes from the official STAR spreadsheet, so only admins can change it. Spotted a mistake? Leave a comment on the song page and an admin will fix it.
          </p>
        ) : (
          <p>
            <strong>“{song.title}”</strong> was added by {song.createdBy?.displayName ?? 'another member'}. If something looks wrong, leave a comment on the song so they (or an admin) can fix it.
          </p>
        )}
      </EmptyState>
    </div>
  );
}

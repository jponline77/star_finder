/**
 * Show detail "/shows/:slug" (SPEC §7.4, §7.16, §7.17): poster hero with the story, credits,
 * year, Wikipedia link + image credit; licensing & STAR eligibility (approved-publisher caveat);
 * songs split into Solos / Duets; the cast of characters (avatar, ranges, their songs);
 * Added-by + owner/admin Edit (modal) / Delete (only when the show has no songs); comments.
 *
 * data-testids: show-hero, show-title, show-credits, licensing-panel, licensing-status,
 * solos-section, duets-section, character-card, edit-button, delete-button, delete-blocked,
 * add-song-from-show, show-not-found (+ SongCard / CommentsSection ids).
 */
import { ArrowLeft, BookOpen, ExternalLink, Plus, Search } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { deleteShow } from '../api';
import { ShowPoster } from '../components/ArtworkTile';
import { CharacterAvatar } from '../components/CharacterAvatar';
import { CommentsSection } from '../components/CommentsSection';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { AddedBy, OwnerControls } from '../components/Ownership';
import { RangeBadge } from '../components/RangeBadge';
import { Skeleton, SongGridSkeleton } from '../components/Skeletons';
import { SongCard } from '../components/SongCard';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { browseHref } from '../lib/filters';
import { plural } from '../lib/format';
import { isSafeHttpUrl, showPath, songPath } from '../lib/links';
import { compareText } from '../lib/normalize';
import { canEdit, isAdmin } from '../lib/permissions';
import { compareRanges, KIND_EMOJI, rangeSlug, TAEA_URL } from '../lib/vocab';
import { useAuth } from '../state/AuthProvider';
import { useShow, useSongs } from '../state/SongsProvider';
import { useToast } from '../state/ToastProvider';
import type { Show, ShowDetail, Song } from '../types';
import { EditShowModal } from './show-detail/EditShowModal';
import { creditLines, licensingStatus } from './show-detail/licensing';
import './ShowDetailPage.css';

export default function ShowDetailPage() {
  const { slug } = useParams();
  const { show, summary, loading, notFound, error, reload, setShow } = useShow(slug);
  useDocumentTitle(notFound ? 'Show not found' : (show?.name ?? summary?.name ?? 'Show'));

  if (notFound) return <ShowNotFound />;
  if (error && !show) {
    return (
      <div className="container show-detail">
        <h1 className="visually-hidden">Show</h1>
        <ErrorState onRetry={reload} />
      </div>
    );
  }
  if (loading || !show) return <ShowSkeleton name={summary?.name} />;
  return <ShowView show={show} setShow={setShow} />;
}

function ShowNotFound() {
  return (
    <div className="container show-detail" data-testid="show-not-found">
      <h1 className="visually-hidden">Show not found</h1>
      <EmptyState
        emoji="🎟️"
        title="This show isn’t on our playbill"
        actions={
          <>
            <Link to="/shows" className="btn btn-primary">
              See all shows
            </Link>
            <Link to="/add" className="btn btn-ghost">
              <Plus size={18} aria-hidden="true" /> Add a song from a new show
            </Link>
          </>
        }
      >
        <p>It may have been renamed or removed — or the link has a typo.</p>
      </EmptyState>
    </div>
  );
}

function ShowSkeleton({ name }: { name?: string }) {
  return (
    <div className="container show-detail" role="status" aria-live="polite">
      <span className="visually-hidden">Loading {name ?? 'the show'}…</span>
      <div className="show-hero is-skeleton">
        <div className="show-hero-grid">
          <Skeleton height="auto" style={{ aspectRatio: '2 / 3', display: 'block' }} radius={12} />
          <div className="stack">
            <Skeleton height={14} width={140} />
            <Skeleton height={52} width="70%" radius={10} />
            <Skeleton height={16} width="45%" />
            <Skeleton height={80} />
          </div>
        </div>
      </div>
      <div style={{ marginTop: 'var(--space-xl)' }}>
        <SongGridSkeleton count={3} label="Loading songs…" />
      </div>
    </div>
  );
}

// ============================================================================ the page
function ShowView({ show, setShow }: { show: ShowDetail; setShow: (s: ShowDetail) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { reload: reloadSongs, patchShow } = useSongs();
  const [editing, setEditing] = useState(false);

  const songs = useMemo(() => [...show.songs].sort((a, b) => compareText(a.title, b.title)), [show.songs]);
  const solos = songs.filter((s) => s.kind === 'solo');
  const duets = songs.filter((s) => s.kind === 'duet');
  const songsById = useMemo(() => new Map(show.songs.map((s) => [s.id, s])), [show.songs]);
  const characters = useMemo(
    () => [...show.characters].sort((a, b) => b.songIds.length - a.songIds.length || compareText(a.name, b.name)),
    [show.characters],
  );
  const credits = creditLines(show);
  const imageSourceUrl = (show as Show & { imageSourceUrl?: string | null }).imageSourceUrl;
  const editable = canEdit(user, show);
  const songTotal = show.songs.length;

  const onSaved = (updated: Show) => {
    setEditing(false);
    const ref = { id: updated.id, name: updated.name, slug: updated.slug, imageUrl: updated.imageUrl };
    setShow({ ...show, ...updated, songs: show.songs.map((s) => ({ ...s, show: ref })), characters: show.characters });
    toast.success(`“${updated.name}” is updated.`, { emoji: '🎭' });
    void reloadSongs();
    if (updated.slug !== show.slug) navigate(showPath(updated.slug), { replace: true });
  };

  const onDelete = async () => {
    await deleteShow(show.id);
    toast.success(`“${show.name}” was taken off the poster wall.`, { emoji: '🎭' });
    void reloadSongs();
    navigate('/shows', { replace: true });
  };

  const heroStyle = show.imageUrl ? ({ '--hero-image': `url("${show.imageUrl}")` } as CSSProperties) : undefined;

  return (
    <div className="show-detail">
      {/* ------------------------------------------------ hero */}
      <section className={`show-hero${show.imageUrl ? ' has-image' : ''}`} style={heroStyle} aria-labelledby="show-title" data-testid="show-hero">
        <div className="show-hero-backdrop" aria-hidden="true" />
        <div className="container show-hero-inner">
          <nav className="show-crumbs" aria-label="Breadcrumb">
            <Link to="/shows">
              <ArrowLeft size={16} aria-hidden="true" /> All shows
            </Link>
          </nav>
          <div className="show-hero-grid">
            <figure className="show-hero-poster">
              <div className="show-detail-frame">
                <ShowPoster show={show} alt={`${show.name} poster`} eager />
              </div>
              {show.imageUrl && show.imageCredit && (
                <figcaption className="show-image-credit">
                  {show.imageCredit}
                  {isSafeHttpUrl(imageSourceUrl) && (
                    <>
                      {' · '}
                      <a href={imageSourceUrl} target="_blank" rel="noopener noreferrer">
                        source<span className="visually-hidden"> (opens in a new tab)</span>
                      </a>
                    </>
                  )}
                </figcaption>
              )}
            </figure>

            <div className="show-hero-info">
              <p className="show-kicker">
                <span>Musical</span>
                {show.year && <span>{show.year}</span>}
                {show.source === 'community' && <span className="badge badge-pink">Community</span>}
              </p>
              <h1 id="show-title" className="show-title" data-testid="show-title">
                {show.name}
              </h1>
              {credits.length > 0 && (
                <dl className="show-credits" data-testid="show-credits">
                  {credits.map((c) => (
                    <div key={c.role}>
                      <dt>{c.role} by</dt>
                      <dd>{c.who}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {show.description ? (
                <p className="show-description">{show.description}</p>
              ) : (
                <p className="show-description is-empty">
                  No description yet.{editable ? ' Use “Edit show” to add one (or fetch it from Wikipedia).' : ''}
                </p>
              )}

              <ul className="show-stats" aria-label="At a glance">
                <li>
                  <span className="emoji" aria-hidden="true">
                    {KIND_EMOJI.solo}
                  </span>
                  <strong>{solos.length}</strong> {solos.length === 1 ? 'solo' : 'solos'}
                </li>
                <li>
                  <span className="emoji" aria-hidden="true">
                    {KIND_EMOJI.duet}
                  </span>
                  <strong>{duets.length}</strong> {duets.length === 1 ? 'duet' : 'duets'}
                </li>
                <li>
                  <span className="emoji" aria-hidden="true">
                    🎭
                  </span>
                  <strong>{characters.length}</strong> {characters.length === 1 ? 'character' : 'characters'}
                </li>
                {show.commentCount > 0 && (
                  <li>
                    <span className="emoji" aria-hidden="true">
                      💬
                    </span>
                    <strong>{show.commentCount}</strong> {show.commentCount === 1 ? 'comment' : 'comments'}
                  </li>
                )}
              </ul>

              <div className="show-actions">
                {songTotal > 0 && (
                  <Link to={browseHref({ show: show.slug })} className="btn btn-primary">
                    <Search size={18} aria-hidden="true" /> Filter these songs
                  </Link>
                )}
                <Link to={`/add?show=${encodeURIComponent(show.slug)}`} className="btn btn-ghost" data-testid="add-song-from-show">
                  <Plus size={18} aria-hidden="true" /> Add a song from this show
                </Link>
                {isSafeHttpUrl(show.wikiUrl) && (
                  <a href={show.wikiUrl} className="btn btn-quiet" target="_blank" rel="noopener noreferrer">
                    <BookOpen size={18} aria-hidden="true" /> Wikipedia
                    <ExternalLink size={14} aria-hidden="true" />
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                )}
              </div>

              <div className="show-owner-row">
                <AddedBy item={show} />
                {editable && (
                  <div className="show-owner-controls">
                    <OwnerControls
                      item={show}
                      noun="show"
                      size="sm"
                      onEdit={() => setEditing(true)}
                      onDelete={songTotal === 0 ? onDelete : undefined}
                      confirmTitle={`Delete “${show.name}”?`}
                      confirmBody={<p>The show and its comments will be removed for everyone. This can’t be undone.</p>}
                    />
                    {songTotal > 0 && (
                      <p className="tiny subtle" data-testid="delete-blocked">
                        Shows with songs can’t be deleted — remove its {plural(songTotal, 'song')} first.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container">
        <LicensingPanel show={show} />

        {/* ------------------------------------------------ songs */}
        <section className="section show-songs" aria-labelledby="songs-title">
          <h2 id="songs-title" className="section-title">
            <span className="emoji" aria-hidden="true">
              🎶
            </span>
            Songs from {show.name}
          </h2>
          {songTotal === 0 ? (
            <EmptyState
              emoji="🎼"
              title="No songs here yet"
              level={3}
              actions={
                <Link to={`/add?show=${encodeURIComponent(show.slug)}`} className="btn btn-primary">
                  <Plus size={18} aria-hidden="true" /> Add the first song
                </Link>
              }
            >
              <p>Know a solo or duet from {show.name}? Be the first to add it.</p>
            </EmptyState>
          ) : (
            <>
              <SongGroup kind="solo" title="Solos" songs={solos} show={show} />
              <SongGroup kind="duet" title="Duets" songs={duets} show={show} />
            </>
          )}
        </section>

        {/* ------------------------------------------------ cast */}
        {characters.length > 0 && (
          <section className="section" aria-labelledby="cast-title">
            <h2 id="cast-title" className="section-title">
              <span className="emoji" aria-hidden="true">
                🎭
              </span>
              Cast of characters
            </h2>
            <p className="muted show-cast-intro">Who sings what — tap a song to hear it. Colours show each character’s vocal range.</p>
            <ul className="cast-grid" role="list">
              {characters.map((c) => {
                const ranges = [...c.vocalRanges].sort(compareRanges);
                const theirSongs = c.songIds.map((id) => songsById.get(id)).filter((s): s is Song => Boolean(s));
                return (
                  <li key={c.name} className={`cast-card range-${rangeSlug(ranges[0])}`} data-testid="character-card">
                    <CharacterAvatar name={c.name} range={ranges[0] ?? null} size="lg" />
                    <div className="cast-card-body">
                      <h3 className="cast-name">{c.name}</h3>
                      <div className="cast-ranges">
                        {ranges.length ? ranges.map((r) => <RangeBadge key={r} range={r} variant="full" />) : <RangeBadge range={null} variant="full" />}
                      </div>
                      <ul className="cast-songs" aria-label={`Songs ${c.name} sings`}>
                        {theirSongs.map((s) => (
                          <li key={s.id}>
                            <span className="emoji" aria-hidden="true">
                              {KIND_EMOJI[s.kind]}
                            </span>
                            <Link to={songPath(s.id)}>{s.title}</Link>
                            {s.kind === 'duet' && <span className="visually-hidden"> (duet)</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ------------------------------------------------ comments */}
        <div className="section">
          <CommentsSection
            target={{ type: 'show', id: show.id }}
            onCountChange={(n) => {
              if (n !== show.commentCount) setShow({ ...show, commentCount: n });
              patchShow(show.id, { commentCount: n }); // keep the /shows poster-wall cards in sync
            }}
          />
        </div>
      </div>

      {editable && <EditShowModal open={editing} show={show} isAdmin={isAdmin(user)} onClose={() => setEditing(false)} onSaved={onSaved} />}
    </div>
  );
}

function SongGroup({ kind, title, songs, show }: { kind: 'solo' | 'duet'; title: string; songs: Song[]; show: Show }) {
  const id = `${kind}s-title`;
  return (
    <section className="show-song-group" aria-labelledby={id} data-testid={`${kind}s-section`}>
      <h3 id={id} className="show-song-group-title">
        <span className="emoji" aria-hidden="true">
          {KIND_EMOJI[kind]}
        </span>
        {title} <span className="count-badge">{songs.length}</span>
      </h3>
      {songs.length ? (
        <div className="song-grid">
          {songs.map((s) => (
            <SongCard key={s.id} song={s} headingLevel={4} hideShow hideKind />
          ))}
        </div>
      ) : (
        <p className="show-song-empty">
          No {title.toLowerCase()} from {show.name} yet.{' '}
          <Link to={`/add?show=${encodeURIComponent(show.slug)}&kind=${kind}`}>Add one →</Link>
        </p>
      )}
    </section>
  );
}

function LicensingPanel({ show }: { show: Show }) {
  const status = licensingStatus(show.licensor);
  return (
    <section className={`licensing-panel is-${status.kind}`} aria-labelledby="licensing-title" data-testid="licensing-panel">
      <div className="licensing-icon emoji" aria-hidden="true">
        🎟️
      </div>
      <div className="licensing-body">
        <h2 id="licensing-title" className="licensing-title">
          Licensing &amp; STAR eligibility
        </h2>
        <p className="licensing-licensor">
          {show.licensor ? (
            <>
              Licensed by <strong>{show.licensor}</strong>
            </>
          ) : (
            <>We don’t know who licenses this show yet.</>
          )}{' '}
          <span className={`badge ${status.kind === 'approved' ? 'badge-success' : status.kind === 'unlisted' ? 'badge-warning' : 'badge-outline'}`} data-testid="licensing-status">
            {status.kind === 'approved' ? '✓ Approved publisher' : status.kind === 'unlisted' ? 'Not on STAR’s approved list' : 'Licensor unknown'}
          </span>
        </p>
        {show.licensingNote && <p className="licensing-note">{show.licensingNote}</p>}
        {status.kind === 'approved' &&
          status.notes.map((n) => (
            <p key={n} className="licensing-note">
              {n}
            </p>
          ))}
        <p className="licensing-caveat">
          STAR needs one song from a <strong>published score written for a stage musical</strong>, from an approved publisher (MTI, Concord / R&amp;H / Tams-Witmark, TRW and others) or the public domain. Always confirm with your teacher before you commit.{' '}
          <a href={TAEA_URL} target="_blank" rel="noopener noreferrer">
            STAR Fest rules<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </p>
      </div>
    </section>
  );
}

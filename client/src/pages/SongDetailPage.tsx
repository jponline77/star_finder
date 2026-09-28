/**
 * /songs/:id — Song detail (SPEC §7.3, §7.16, §7.17).
 *
 * Hero (art + poster, title, show, credits, characters, tags, play/♥/Edit/Delete) → cast with
 * voice ladders → running time vs 6:00 → director's note / mature note → listen (Apple preview,
 * uploaded audio, external link, owner upload tools) → rehearsal kit links → slate builder;
 * aside: STAR checklist + about the show; then similar songs and Backstage Chatter.
 */
import { RotateCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { errorMessage } from '../api';
import { CommentsSection } from '../components/CommentsSection';
import { ErrorState } from '../components/EmptyState';
import { SongCard } from '../components/SongCard';
import { SongCardSkeleton } from '../components/Skeletons';
import { SlateBuilder } from '../components/SlateBuilder';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { canEdit } from '../lib/permissions';
import { useAuth } from '../state/AuthProvider';
import { useShow, useSong } from '../state/SongsProvider';
import { useToast } from '../state/ToastProvider';
import { useDeleteSong } from '../state/useDeleteSong';
import type { Song } from '../types';
import { songDocumentTitle } from './song-detail/helpers';
import { AboutShowCard, CastSection, DirectorsNote, MatureNote, RehearsalKit, TimingCard } from './song-detail/InfoCards';
import { ListenSection } from './song-detail/ListenSection';
import { SongDetailSkeleton, SongNotFound } from './song-detail/SongDetailStates';
import { SongHero } from './song-detail/SongHero';
import { SongMediaPanel } from './song-detail/SongMediaPanel';
import { StarChecklist } from './song-detail/StarChecklist';
import './SongDetailPage.css';

export default function SongDetailPage() {
  const { id } = useParams();
  const { song, similar, loading, refreshing, error, notFound, reload, setSong } = useSong(id);
  const { show, loading: showLoading, error: showError } = useShow(song?.show.slug);
  const { user } = useAuth();
  const deleteSong = useDeleteSong();
  const toast = useToast();
  const navigate = useNavigate();
  const [counted, setCounted] = useState<number | null>(null);

  useDocumentTitle(notFound ? 'Song not found' : (songDocumentTitle(song) ?? 'Song'));

  if (notFound) return <SongNotFound />;
  if (!song) {
    if (error && !loading)
      return (
        <div className="container sd-error">
          <ErrorState title="The curtain got stuck!" message={`We couldn’t load this song. ${errorMessage(error)}`} onRetry={() => void reload()} />
        </div>
      );
    return <SongDetailSkeleton />;
  }

  const current: Song = song;
  const manage = canEdit(user, current);
  const commentCount = counted ?? current.commentCount;
  // The show detail matches this song only once it has loaded for the right slug.
  const showInfo = show && show.slug === current.show.slug ? show : null;

  const handleDelete = async () => {
    await deleteSong(current); // also stops the player, updates the setlist and refreshes counts
    toast.success(`“${current.title}” was deleted`, { emoji: '🗑️', id: 'song-deleted' });
    navigate('/songs', { replace: true });
  };


  return (
    <div className="song-detail" data-testid="song-detail" data-song-id={current.id}>
      <SongHero song={current} show={showInfo} showLoading={showLoading} commentCount={commentCount} onDelete={handleDelete} canManage={manage} />

      {error && !refreshing && (
        <div className="container">
          <div className="callout callout-warning sd-refresh-error" role="status">
            <span>Couldn’t refresh this song — some details may be out of date.</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void reload()}>
              <RotateCw size={16} aria-hidden="true" /> Retry
            </button>
          </div>
        </div>
      )}

      <div className="container sd-layout">
        <div className="sd-main">
          <CastSection song={current} />
          <TimingCard seconds={current.lengthSeconds} />
          {(current.notes || current.mature) && (
            <div className="sd-notes">
              {current.notes && (
                <DirectorsNote
                  notes={current.notes}
                  signature={
                    current.source === 'community'
                      ? current.createdBy
                        ? `— ${current.createdBy.displayName}, who added this song`
                        : '— from the person who added this song'
                      : undefined
                  }
                />
              )}
              {current.mature && <MatureNote />}
            </div>
          )}
          <section className="sd-section" aria-labelledby="sd-listen-title" id="listen">
            <h2 id="sd-listen-title" className="section-title">
              <span className="emoji" aria-hidden="true">
                🎧
              </span>
              Listen
            </h2>
            <ListenSection song={current} canManage={manage} onSongUpdated={setSong} />
          </section>
          {manage && <SongMediaPanel song={current} onUpdated={setSong} />}
          <RehearsalKit song={current} />
          <section className="sd-section" aria-labelledby="sd-slate-title" id="slate">
            <h2 id="sd-slate-title" className="section-title">
              <span className="emoji" aria-hidden="true">
                🎬
              </span>
              Your slate
            </h2>
            <p className="sd-section-lede">Say this before you sing — the 6:00 clock starts after your slate. Your details stay in your browser — they’re never sent to the site.</p>
            <div className="card card-pad sd-slate">
              <SlateBuilder
                kind={current.kind}
                title={current.title}
                show={current.show.name}
                composer={showInfo?.composer ?? null}
                lyricist={showInfo?.lyricist ?? null}
              />
            </div>
          </section>
        </div>

        <div className="sd-aside">
          <StarChecklist song={current} show={showInfo} showLoading={showLoading} showFailed={Boolean(showError)} />
          <AboutShowCard song={current} show={showInfo} loading={showLoading} />
        </div>
      </div>

      {(similar.length > 0 || refreshing) && (
        <section className="container sd-similar" aria-labelledby="sd-similar-title" data-testid="similar-songs">
          <h2 id="sd-similar-title" className="section-title">
            <span className="emoji" aria-hidden="true">
              ✨
            </span>
            Similar songs
          </h2>
          <p className="sd-section-lede">Same mood or a similar voice — worth a listen.</p>
          {similar.length > 0 ? (
            <ul className="song-row sd-similar-row" role="list">
              {similar.map((s) => (
                <li key={s.id}>
                  <SongCard song={s} headingLevel={3} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="song-row sd-similar-row" aria-hidden="true">
              <SongCardSkeleton />
              <SongCardSkeleton />
              <SongCardSkeleton />
            </div>
          )}
        </section>
      )}

      <div className="container sd-chatter" id="chatter">
        <CommentsSection target={{ type: 'song', id: current.id }} onCountChange={setCounted} />
      </div>
    </div>
  );
}

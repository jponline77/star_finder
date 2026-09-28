/**
 * Song page hero: album art + show poster (links to the show), kind, title, show, credits,
 * characters, tags, play / setlist / comments, ownership + Edit/Delete.
 */
import { ChevronRight, ImagePlus, MessageCircle } from 'lucide-react';
import { Link } from 'react-router';
import { ArtworkTile, ShowPoster } from '../../components/ArtworkTile';
import { CharacterAvatar } from '../../components/CharacterAvatar';
import { GenreTag, KindTag, SubGenreTag } from '../../components/GenreTag';
import { LengthBadge } from '../../components/LengthBadge';
import { MatureBadge } from '../../components/MatureBadge';
import { AddedBy, OwnerControls } from '../../components/Ownership';
import { PlayButton } from '../../components/PlayButton';
import { RangeBadge } from '../../components/RangeBadge';
import { SetlistHeart } from '../../components/SetlistHeart';
import { Skeleton } from '../../components/Skeletons';
import { showPath, songEditPath } from '../../lib/links';
import type { Show, Song } from '../../types';
import { creditLines } from './helpers';
import { jumpToTool } from './ListenSection';

export interface SongHeroProps {
  song: Song;
  show: Show | null;
  showLoading: boolean;
  commentCount: number;
  onDelete: () => Promise<void>;
  /** Owner/admin: show "Add album art" when the song has none. */
  canManage?: boolean;
}

export function SongHero({ song, show, showLoading, commentCount, onDelete, canManage = false }: SongHeroProps) {
  const community = song.source === 'community';
  const credits = creditLines(show);
  const hasArt = Boolean(song.media.artworkUrl);
  const ribbon = community ? (
    <span className="ribbon sd-ribbon" data-testid="community-ribbon">
      Community
    </span>
  ) : null;
  const titleSize = song.title.length > 34 ? ' is-longer' : song.title.length > 20 ? ' is-long' : '';

  return (
    <section className={`sd-hero${community ? ' is-community' : ''}`} aria-labelledby="sd-title" data-testid="song-hero">
      <div className="sd-curtain is-left" aria-hidden="true" />
      <div className="sd-curtain is-right" aria-hidden="true" />
      <div className="container sd-hero-inner">
        <nav aria-label="Breadcrumb" className="sd-crumbs">
          <ol>
            <li>
              <Link to="/songs">Songs</Link>
              <ChevronRight size={14} aria-hidden="true" />
            </li>
            <li>
              <Link to={showPath(song.show.slug)}>{song.show.name}</Link>
              <ChevronRight size={14} aria-hidden="true" />
            </li>
            <li aria-current="page" className="truncate">
              {song.title}
            </li>
          </ol>
        </nav>

        <div className="sd-hero-grid">
          <div className={`sd-hero-art${hasArt ? '' : ' is-poster'}`}>
            <div className="sd-beam" aria-hidden="true" />
            {hasArt ? (
              <>
                <div className="sd-hero-cover">
                  <ArtworkTile src={song.media.artworkUrl} seed={song.show.name} size={300} alt={`Album art for ${song.media.recordingName ?? song.show.name}`} />
                  {ribbon}
                </div>
                <Link to={showPath(song.show.slug)} className="sd-hero-poster" data-testid="hero-show-poster" aria-label={`Show page: ${song.show.name}`}>
                  <ShowPoster show={song.show} alt="" eager />
                </Link>
              </>
            ) : (
              <Link to={showPath(song.show.slug)} className="sd-hero-mainposter" data-testid="hero-show-poster" aria-label={`Show page: ${song.show.name}`}>
                <ShowPoster show={song.show} alt="" eager />
                {ribbon}
              </Link>
            )}
            <div className="sd-floor" aria-hidden="true" />
            {canManage && !hasArt && (
              <a
                href="#media-art"
                className="sd-add-art"
                onClick={(e) => {
                  e.preventDefault();
                  jumpToTool('media-art', 'media-art-choose');
                }}
                data-testid="hero-add-art"
              >
                <ImagePlus size={16} aria-hidden="true" /> Add album art
              </a>
            )}
          </div>

          <div className="sd-hero-body">
            <div className="sd-hero-eyebrow">
              <KindTag kind={song.kind} link />
              {community && (
                <span className="badge badge-pink">
                  <span className="emoji" aria-hidden="true">
                    🌟
                  </span>{' '}
                  Community pick
                </span>
              )}
            </div>
            <h1 id="sd-title" className={`sd-title${titleSize}`} data-testid="song-detail-title">
              {song.title}
            </h1>
            <p className="sd-from">
              from{' '}
              <Link to={showPath(song.show.slug)} className="sd-show-link" data-testid="song-show-link">
                {song.show.name}
              </Link>
              {show?.year ? <span className="sd-year"> ({show.year})</span> : null}
            </p>
            {showLoading && !show ? (
              <Skeleton height={16} width="60%" className="sd-credits-skeleton" />
            ) : credits.length > 0 ? (
              <p className="sd-credits" data-testid="song-credits">
                {credits.map((c, i) => (
                  <span key={c.role}>
                    {i > 0 && (
                      <span className="sd-dot" aria-hidden="true">
                        {' '}
                        ·{' '}
                      </span>
                    )}
                    <span className="sd-credit-role">{c.role} by</span> {c.names}
                  </span>
                ))}
              </p>
            ) : null}

            <ul className="sd-hero-cast" role="list" aria-label={song.kind === 'duet' ? 'Characters' : 'Character'}>
              {song.parts.map((p) => (
                <li key={p.position}>
                  <CharacterAvatar name={p.character} range={p.vocalRange} size="sm" labelRange={false} />
                  <span className="sd-hero-char">{p.character}</span>
                  <RangeBadge range={p.vocalRange} />
                </li>
              ))}
            </ul>

            <div className="sd-hero-tags">
              <GenreTag genre={song.genre} link />
              <SubGenreTag subGenre={song.subGenre} link />
              <LengthBadge seconds={song.lengthSeconds} showText="always" />
              <MatureBadge mature={song.mature} />
            </div>

            <div className="sd-hero-actions">
              <PlayButton song={song} size="lg" label="Play preview" className="sd-hero-play" />
              <SetlistHeart songId={song.id} songTitle={song.title} withLabel />
              <a href="#chatter" className="btn btn-quiet sd-chatter-link" data-testid="comment-count-link">
                <MessageCircle size={18} aria-hidden="true" />
                {commentCount === 0 ? 'Start the chatter' : `${commentCount} comment${commentCount === 1 ? '' : 's'}`}
              </a>
            </div>

            <div className="sd-hero-owner">
              <AddedBy item={song} />
              <OwnerControls
                item={song}
                editTo={songEditPath(song.id)}
                onDelete={onDelete}
                noun="song"
                size="sm"
                confirmTitle={`Delete “${song.title}”?`}
                confirmBody={<p>This can’t be undone — the song, its uploaded audio and its comments will be removed for everyone.</p>}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import { MessageCircle } from 'lucide-react';
import { Link } from 'react-router';
import type { Song } from '../types';
import { songPath, showPath } from '../lib/links';
import { ArtworkTile } from './ArtworkTile';
import { GenreTag, KindTag, SubGenreTag } from './GenreTag';
import { Highlight } from './Highlight';
import { LengthBadge } from './LengthBadge';
import { MatureBadge } from './MatureBadge';
import { PlayButton } from './PlayButton';
import { RangeBadge } from './RangeBadge';
import { SetlistHeart } from './SetlistHeart';

export interface SongCardProps {
  song: Song;
  /** Search query to highlight in the title/show/characters. */
  query?: string;
  /** Heading level for the title (default 3). */
  headingLevel?: 2 | 3 | 4;
  /** Hide the kind tag (e.g. inside a "Solos" section). */
  hideKind?: boolean;
  /** Hide the show line (e.g. on the show's own page). */
  hideShow?: boolean;
  className?: string;
}

/**
 * The song tile used everywhere: artwork + ▶, title (links to the song; whole card is clickable),
 * show, parts with range badges, kind/genre/mood tags, length vs 6:00, mature flag, 💬 count, ♥.
 * data-testid: song-card, song-title, play-preview, setlist-heart.
 */
export function SongCard({ song, query, headingLevel = 3, hideKind = false, hideShow = false, className = '' }: SongCardProps) {
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const community = song.source === 'community';
  return (
    <article
      className={`card card-hover song-card${community ? ' is-community' : ''} ${className}`.trim()}
      data-testid="song-card"
      data-song-id={song.id}
      data-kind={song.kind}
    >
      {community && (
        <span className="ribbon" title={song.createdBy ? `Added by ${song.createdBy.displayName}` : 'Added by the community'}>
          Community
        </span>
      )}
      <div className="song-card-heart">
        <SetlistHeart songId={song.id} songTitle={song.title} />
      </div>
      <div className="song-card-top">
        <div className="song-card-art">
          <ArtworkTile src={song.media.artworkUrl ?? song.show.imageUrl} seed={song.show.name} size={92} />
          <PlayButton song={song} size="sm" />
        </div>
        <div className="song-card-head">
          <H className="song-card-title">
            <Link to={songPath(song.id)} className="stretched-link" data-testid="song-title">
              <Highlight text={song.title} query={query} />
            </Link>
          </H>
          {!hideShow && (
            <p className="song-card-show">
              <span className="emoji" aria-hidden="true">
                🎭{' '}
              </span>
              <Link to={showPath(song.show.slug)}>
                <Highlight text={song.show.name} query={query} />
              </Link>
            </p>
          )}
          <ul className="song-card-parts" aria-label={song.kind === 'duet' ? 'Characters' : 'Character'}>
            {song.parts.map((p) => (
              <li key={p.position}>
                <RangeBadge range={p.vocalRange} />
                <span className="character-name">
                  <Highlight text={p.character} query={query} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="song-card-tags">
        {!hideKind && <KindTag kind={song.kind} />}
        <GenreTag genre={song.genre} />
        <SubGenreTag subGenre={song.subGenre} />
      </div>
      <div className="song-card-footer">
        <LengthBadge seconds={song.lengthSeconds} />
        <MatureBadge mature={song.mature} variant="compact" />
        <span className="spacer" />
        <span className="comment-count" title={`${song.commentCount} comment${song.commentCount === 1 ? '' : 's'}`}>
          <MessageCircle size={14} aria-hidden="true" />
          {song.commentCount}
          <span className="visually-hidden"> comment{song.commentCount === 1 ? '' : 's'}</span>
        </span>
      </div>
    </article>
  );
}

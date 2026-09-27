/**
 * "Listen" card: Apple 30-sec preview (with credit + Apple Music link), community-uploaded audio,
 * an external audio link, and (for the owner/admin) upload/remove tools.
 */
import { ExternalLink, Headphones, Link2, Music2 } from 'lucide-react';
import { formatLength } from '../../lib/format';
import { hostOf, isSafeHttpUrl } from '../../lib/links';
import { useAudio, useAudioProgress } from '../../state/AudioProvider';
import { PlayButton } from '../../components/PlayButton';
import type { Song } from '../../types';
import { AudioManager } from './AudioManager';
import { previewCredit } from './helpers';

export interface ListenSectionProps {
  song: Song;
  canManage: boolean;
  onSongUpdated: (song: Song) => void;
}

export function ListenSection({ song, canManage, onSongUpdated }: ListenSectionProps) {
  const { media } = song;
  const audio = useAudio();
  const link = isSafeHttpUrl(media.audioLink) ? media.audioLink : null;
  const appleUrl = isSafeHttpUrl(media.appleMusicUrl) ? media.appleMusicUrl : null;
  const nothing = !media.previewUrl && !media.audioUrl && !link;
  const previewKey = `song:${song.id}`;
  const uploadKey = `upload:${song.id}`;

  return (
    <div className="card sd-listen" data-testid="listen-card">
      {media.previewUrl && (
        <div className={`sd-track${audio.isCurrent(previewKey) ? ' is-current' : ''}`} data-testid="preview-track">
          <PlayButton song={song} source="preview" size="lg" />
          <div className="sd-track-body">
            <p className="sd-track-title">
              30-second preview
              {audio.isPlaying(previewKey) && <Eq />}
            </p>
            <p className="sd-track-credit" data-testid="preview-credit">
              {previewCredit(media)}
            </p>
            {audio.isCurrent(previewKey) && <TrackProgress />}
          </div>
          {appleUrl && (
            <a className="btn btn-ghost btn-sm sd-track-link" href={appleUrl} target="_blank" rel="noopener noreferrer" data-testid="apple-music-link">
              <Music2 size={16} aria-hidden="true" /> Apple Music
              <ExternalLink size={14} aria-hidden="true" />
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      )}

      {media.audioUrl && (
        <div className={`sd-track${audio.isCurrent(uploadKey) ? ' is-current' : ''}`} data-testid="uploaded-track">
          <PlayButton song={song} source="upload" size="lg" />
          <div className="sd-track-body">
            <p className="sd-track-title">
              Uploaded audio
              {audio.isPlaying(uploadKey) && <Eq />}
            </p>
            <p className="sd-track-credit">
              A community upload — it plays in the mini player at the bottom of the screen.
            </p>
            {audio.isCurrent(uploadKey) && <TrackProgress />}
          </div>
        </div>
      )}

      {link && (
        <div className="sd-track" data-testid="external-audio">
          <span className="sd-track-icon" aria-hidden="true">
            <Link2 size={22} />
          </span>
          <div className="sd-track-body">
            <p className="sd-track-title">Listen elsewhere</p>
            <p className="sd-track-credit">A link someone shared on {hostOf(link) || 'another site'}.</p>
          </div>
          <a className="btn btn-secondary btn-sm sd-track-link" href={link} target="_blank" rel="noopener noreferrer nofollow" data-testid="audio-link">
            Listen on {hostOf(link) || 'the web'}
            <ExternalLink size={14} aria-hidden="true" />
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </div>
      )}

      {nothing && (
        <div className="sd-track sd-track-empty" data-testid="no-audio">
          <span className="sd-track-icon" aria-hidden="true">
            <Headphones size={22} />
          </span>
          <div className="sd-track-body">
            <p className="sd-track-title">No preview yet</p>
            <p className="sd-track-credit">Try “Watch performances” below to hear how it goes{canManage ? ', or upload a file' : ''}.</p>
          </div>
        </div>
      )}

      {canManage && <AudioManager song={song} onUpdated={onSongUpdated} />}
    </div>
  );
}

function Eq() {
  return (
    <span className="eq sd-eq" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** Slim progress line for the track that's loaded in the shared player. */
function TrackProgress() {
  const { currentTime, duration } = useAudioProgress();
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  return (
    <div className="sd-track-progress" aria-hidden="true">
      <span className="sd-track-progress-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="sd-track-time">
        {formatLength(currentTime, '0:00')} / {formatLength(duration > 0 ? duration : null, '…')}
      </span>
    </div>
  );
}

import { Pause, Play } from 'lucide-react';
import type { Song } from '../types';
import { songTrack, useAudio, type AudioSource, type AudioTrack } from '../state/AudioProvider';

export interface PlayButtonProps {
  /** A song (plays media.previewUrl, else media.audioUrl) … */
  song?: Song;
  /** … or any track (e.g. an iTunes candidate). */
  track?: AudioTrack | null;
  /** For songs: which source to play. */
  source?: AudioSource;
  size?: 'sm' | 'md' | 'lg';
  /** Visible label next to the button (e.g. "Play preview"). */
  label?: string;
  /** When nothing is playable: render a disabled button (true) or nothing (false, default). */
  showUnavailable?: boolean;
  className?: string;
}

/** Round gold ▶/❚❚ button wired to the shared audio player. data-testid="play-preview". */
export function PlayButton({ song, track, source = 'auto', size = 'md', label, showUnavailable = false, className = '' }: PlayButtonProps) {
  const audio = useAudio();
  const resolved: AudioTrack | null = track ?? (song ? songTrack(song, source) : null);
  const name = resolved?.title ?? song?.title ?? 'this song';
  if (!resolved) {
    if (!showUnavailable) return null;
    return (
      <button type="button" className={`play-button is-${size} ${className}`.trim()} disabled aria-label={`No preview available for ${name}`} title="No preview yet">
        <Play className="icon-play" aria-hidden="true" />
      </button>
    );
  }
  const playing = audio.isPlaying(resolved.key);
  const onClick = () => {
    if (audio.isCurrent(resolved.key)) audio.toggle();
    else audio.play(resolved);
  };
  const button = (
    <button
      type="button"
      className={`play-button is-${size}${playing ? ' is-playing' : ''} ${label ? '' : className}`.trim()}
      onClick={onClick}
      aria-label={playing ? `Pause ${name}` : `Play preview of ${name}`}
      data-playing={playing ? 'true' : 'false'}
      data-testid="play-preview"
    >
      {playing ? <Pause aria-hidden="true" fill="currentColor" /> : <Play className="icon-play" aria-hidden="true" fill="currentColor" />}
    </button>
  );
  if (!label) return button;
  return (
    <span className={`play-button-labeled ${className}`.trim()}>
      {button}
      <span aria-hidden="true">{playing ? 'Pause' : label}</span>
    </span>
  );
}

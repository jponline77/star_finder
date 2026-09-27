import { Pause, Play, X } from 'lucide-react';
import { useEffect, useRef, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { formatLength } from '../lib/format';
import { songPath } from '../lib/links';
import { useAudio, useAudioProgress } from '../state/AudioProvider';
import { ArtworkTile } from './ArtworkTile';

/** Bottom bar for the shared audio player (visible while a track is loaded). data-testid="mini-player". */
export function MiniPlayer() {
  const audio = useAudio();
  const { current, status } = audio;
  const visible = current !== null;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    document.body.classList.toggle('has-mini-player', visible);
    return () => document.body.classList.remove('has-mini-player');
  }, [visible]);

  // While the fixed player covers the bottom of the viewport, tell the browser (html
  // scroll-padding-bottom, base.css) how tall it is, so focusing a control scrolls it clear of the
  // player instead of leaving it hidden underneath (WCAG 2.4.11).
  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!visible || !el) return;
    root.classList.add('has-mini-player');
    const update = () => root.style.setProperty('--mini-player-offset', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.classList.remove('has-mini-player');
      root.style.removeProperty('--mini-player-offset');
    };
  }, [visible]);

  if (!current) {
    return <div className="visually-hidden" aria-live="polite" />;
  }
  const playing = status === 'playing' || status === 'loading';
  // Closing unmounts the focused button — send keyboard focus back to what started playback.
  const close = () => {
    const back = audio.returnFocusTarget();
    audio.stop();
    if (back) back.focus();
    else document.getElementById('main')?.focus({ preventScroll: true });
  };
  return (
    <section ref={ref} className="mini-player" aria-label="Audio player" data-testid="mini-player">
      <ProgressBar />
      <div className="container mini-player-inner">
        <div className="mini-player-art">
          <ArtworkTile src={current.artworkUrl} seed={current.artworkSeed ?? current.subtitle ?? current.title} size={52} />
        </div>
        <div className="mini-player-info" aria-live="polite">
          {current.songId ? (
            <Link to={songPath(current.songId)} className="mini-player-title" data-testid="mini-player-title">
              {current.title}
            </Link>
          ) : (
            <span className="mini-player-title" data-testid="mini-player-title">
              {current.title}
            </span>
          )}
          <span className="mini-player-sub">
            <span className="visually-hidden">{status === 'loading' ? 'Loading: ' : playing ? 'Now playing: ' : 'Paused: '}</span>
            {current.subtitle ?? '30-second preview'}
            <TimeMobile />
          </span>
        </div>
        <Seek />
        {current.credit && <p className="mini-player-note">{current.credit}</p>}
        <div className="mini-player-controls">
          <button
            type="button"
            className="play-button"
            onClick={() => audio.toggle()}
            aria-label={playing ? 'Pause' : 'Play'}
            data-testid="mini-player-toggle"
          >
            {status === 'loading' ? (
              <span className="spinner" aria-hidden="true" />
            ) : playing ? (
              <Pause aria-hidden="true" fill="currentColor" />
            ) : (
              <Play className="icon-play" aria-hidden="true" fill="currentColor" />
            )}
          </button>
          <button type="button" className="btn-icon" onClick={close} aria-label="Close player" data-testid="mini-player-close">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

function ProgressBar() {
  const { currentTime, duration } = useAudioProgress();
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  return <span className="mini-player-progress" style={{ width: `${pct}%` }} aria-hidden="true" />;
}

function TimeMobile() {
  const { currentTime, duration } = useAudioProgress();
  return (
    <span className="mini-player-time-mobile" aria-hidden="true">
      {' · '}
      {formatLength(currentTime, '0:00')} / {formatLength(duration || null, '0:30')}
    </span>
  );
}

function Seek() {
  const audio = useAudio();
  const { currentTime, duration } = useAudioProgress();
  const max = duration > 0 ? duration : 30;
  const pct = Math.min(100, (currentTime / max) * 100);
  return (
    <div className="mini-player-seek">
      <span>{formatLength(currentTime, '0:00')}</span>
      <input
        type="range"
        className="range-slider"
        min={0}
        max={max}
        step={0.5}
        value={Math.min(currentTime, max)}
        onChange={(e) => audio.seek(Number(e.target.value))}
        aria-label="Seek"
        aria-valuetext={`${formatLength(currentTime, '0:00')} of ${formatLength(max)}`}
        style={{ '--fill': `${pct}%` } as CSSProperties}
      />
      <span>{formatLength(duration || null, '0:30')}</span>
    </div>
  );
}

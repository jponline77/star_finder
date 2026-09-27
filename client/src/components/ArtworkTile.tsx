/**
 * Artwork with a generated fallback: gradient (hash of `seed`, e.g. the show name) + initials.
 * The <img> lazy-loads and fades in; on missing src or load error the fallback stays.
 * Load/error state is remembered per src, so a tile that stays mounted while its src changes
 * (the mini player, the song-form preview) tries each new image instead of sticking to the fallback.
 */
import { useState, type CSSProperties } from 'react';
import { gradientFor, initials } from '../lib/hash';

export interface ArtworkTileProps {
  src?: string | null;
  /** Gradient seed + initials source (usually the show name). */
  seed: string;
  /** Text used for initials (defaults to seed). */
  label?: string;
  /** Rendered width in px (sets the initials size; the tile is square and fills its container width). */
  size?: number;
  /** Alt text for the image; '' = decorative (default). */
  alt?: string;
  round?: boolean;
  className?: string;
}

/** `loaded` / `failed` for the current src only (state from an earlier src doesn't carry over). */
function useImageStatus(src: string | null | undefined) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return {
    loaded: Boolean(src) && loadedSrc === src,
    failed: Boolean(src) && failedSrc === src,
    onLoad: () => setLoadedSrc(src ?? null),
    onError: () => setFailedSrc(src ?? null),
  };
}

export function ArtworkTile({ src, seed, label, size = 92, alt = '', round = false, className = '' }: ArtworkTileProps) {
  const { loaded, failed, onLoad, onError } = useImageStatus(src);
  const g = gradientFor(seed);
  const style = { '--art-gradient': g.css, '--art-size': `${size}px` } as CSSProperties;
  const showImg = Boolean(src) && !failed;
  return (
    <div className={`art-tile${round ? ' is-round' : ''} ${className}`.trim()} style={style} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
      <span className="art-initials" aria-hidden="true">
        {initials(label ?? seed)}
      </span>
      {showImg && (
        <img
          key={src}
          src={src ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          className={loaded ? 'is-loaded' : undefined}
          onLoad={onLoad}
          onError={onError}
        />
      )}
    </div>
  );
}

export interface ShowPosterProps {
  show: { name: string; imageUrl: string | null };
  className?: string;
  /** Alt text; defaults to "<name> poster". Pass '' when a caption already names the show. */
  alt?: string;
  /** Load eagerly (e.g. the hero poster on a detail page). */
  eager?: boolean;
}

/** 2:3 show poster with gradient + title fallback. */
export function ShowPoster({ show, className = '', alt, eager = false }: ShowPosterProps) {
  const { loaded, failed, onLoad, onError } = useImageStatus(show.imageUrl);
  const g = gradientFor(show.name);
  const style = { '--art-gradient': g.css } as CSSProperties;
  const showImg = Boolean(show.imageUrl) && !failed;
  const label = alt ?? `${show.name} poster`;
  return (
    <div className={`show-poster ${className}`.trim()} style={style} role={label ? 'img' : undefined} aria-label={label || undefined}>
      {!(showImg && loaded) && (
        <div className="show-poster-fallback" aria-hidden="true">
          <span className="show-poster-initials">{initials(show.name)}</span>
          <span className="show-poster-name">{show.name}</span>
        </div>
      )}
      {showImg && (
        <img
          key={show.imageUrl}
          src={show.imageUrl ?? undefined}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className={loaded ? 'is-loaded' : undefined}
          onLoad={onLoad}
          onError={onError}
        />
      )}
    </div>
  );
}

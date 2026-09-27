import type { CSSProperties } from 'react';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}

/** A single shimmering block. */
export function Skeleton({ width = '100%', height = 16, radius, className = '', style }: SkeletonProps) {
  return <span className={`skeleton ${className}`.trim()} style={{ width, height, borderRadius: radius, ...style }} aria-hidden="true" />;
}

/** Lines of text. */
export function TextSkeleton({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`stack stack-sm ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={14} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

/** Placeholder with the same shape as <SongCard>. */
export function SongCardSkeleton() {
  return (
    <div className="card song-card" aria-hidden="true">
      <div className="song-card-top">
        <Skeleton width={92} height={92} radius={12} />
        <div className="stack stack-sm" style={{ flex: 1 }}>
          <Skeleton height={20} width="80%" />
          <Skeleton height={14} width="50%" />
          <Skeleton height={14} width="65%" />
        </div>
      </div>
      <div className="cluster">
        <Skeleton height={20} width={70} radius={999} />
        <Skeleton height={20} width={90} radius={999} />
      </div>
      <Skeleton height={22} width="45%" radius={999} />
    </div>
  );
}

/** Grid of card skeletons (announces loading to screen readers once). */
export function SongGridSkeleton({ count = 9, label = 'Loading songs…' }: { count?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      <div className="song-grid">
        {Array.from({ length: count }, (_, i) => (
          <SongCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** Generic page-level loading placeholder. */
export function PageSkeleton({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="container stack" role="status" aria-live="polite" style={{ paddingBlock: 'var(--space-xl)' }}>
      <span className="visually-hidden">{label}</span>
      <Skeleton height={44} width="55%" radius={10} />
      <Skeleton height={18} width="35%" />
      <div className="song-grid" style={{ marginTop: 'var(--space-lg)' }}>
        {Array.from({ length: 6 }, (_, i) => (
          <SongCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

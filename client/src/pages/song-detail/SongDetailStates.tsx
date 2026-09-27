/** Loading skeleton and "not in our program" (404) states for the song page. */
import { Link } from 'react-router';
import { Marquee } from '../../components/Marquee';
import { Skeleton, TextSkeleton } from '../../components/Skeletons';

export function SongDetailSkeleton() {
  return (
    <div role="status" aria-live="polite" data-testid="song-detail-loading">
      <span className="visually-hidden">Loading song…</span>
      <div className="sd-hero sd-hero-skeleton" aria-hidden="true">
        <div className="container sd-hero-inner">
          <div className="sd-crumbs-skeleton">
            <Skeleton height={14} width={220} />
          </div>
          <div className="sd-hero-grid">
            <div className="sd-hero-art">
              <div className="sd-hero-cover">
                <Skeleton width="100%" height="100%" radius={16} style={{ aspectRatio: '1', display: 'block' }} />
              </div>
            </div>
            <div className="sd-hero-body">
              <Skeleton height={22} width={90} radius={999} />
              <Skeleton height={56} width="85%" radius={12} />
              <Skeleton height={20} width="45%" />
              <Skeleton height={16} width="60%" />
              <div className="cluster">
                <Skeleton height={24} width={90} radius={999} />
                <Skeleton height={24} width={110} radius={999} />
                <Skeleton height={24} width={80} radius={999} />
              </div>
              <div className="cluster">
                <Skeleton height={56} width={56} radius={999} />
                <Skeleton height={44} width={150} radius={999} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="container sd-layout" aria-hidden="true">
        <div className="sd-main">
          <Skeleton height={28} width={200} radius={8} />
          <Skeleton height={170} radius={18} />
          <Skeleton height={28} width={180} radius={8} />
          <Skeleton height={140} radius={18} />
        </div>
        <div className="sd-aside">
          <div className="card card-pad">
            <TextSkeleton lines={8} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SongNotFound() {
  return (
    <div className="container sd-missing" data-testid="song-not-found">
      <Marquee size="lg" still innerClassName="sd-missing-inner">
        <p className="sd-missing-emoji emoji" aria-hidden="true">
          🎟️
        </p>
        <h1 className="sd-missing-title marquee-text">This song isn’t in our program</h1>
        <p className="sd-missing-text">It may have been cut from the show (deleted), or the link has a typo. The usher checked every row twice!</p>
      </Marquee>
      <div className="cluster sd-missing-actions">
        <Link to="/songs" className="btn btn-primary">
          Browse all songs
        </Link>
        <Link to="/add" className="btn btn-ghost">
          Add a song
        </Link>
      </div>
    </div>
  );
}

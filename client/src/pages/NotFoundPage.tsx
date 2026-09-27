/** 404 (SPEC §7.11) — "This scene was cut in previews". */
import { Link, useLocation } from 'react-router';
import { Marquee } from '../components/Marquee';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function NotFoundPage() {
  useDocumentTitle('Scene not found');
  const location = useLocation();
  return (
    <div className="container placeholder-stage" data-testid="not-found">
      <Marquee size="lg" still>
        <div style={{ padding: 'var(--space-xl) var(--space-lg)', textAlign: 'center' }}>
          <p className="marquee-text" style={{ fontSize: 'clamp(4rem, 3rem + 6vw, 7rem)', lineHeight: 1 }}>
            404
          </p>
          <h1 className="placeholder-title marquee-text">This scene was cut in previews</h1>
          <p style={{ color: 'var(--marquee-text)', marginTop: 'var(--space-sm)' }}>
            The director loved it, the producers… not so much. <span aria-hidden="true">🎬✂️</span>
          </p>
        </div>
      </Marquee>
      <p className="placeholder-body">
        We couldn’t find <code>{location.pathname}</code>. Maybe it moved to a different theatre?
      </p>
      <div className="cluster" style={{ justifyContent: 'center' }}>
        <Link to="/songs" className="btn btn-primary">
          Browse songs
        </Link>
        <Link to="/" className="btn btn-ghost">
          Back to the lobby
        </Link>
      </div>
    </div>
  );
}

import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Marquee } from './Marquee';

/** Router errorElement: friendly crash screen (still inside providers, outside Layout). */
export function RouteError() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  const message = isRouteErrorResponse(error) ? error.statusText : error instanceof Error ? error.message : 'Unknown error';
  if (import.meta.env.DEV) console.error(error);
  return (
    <div className="container placeholder-stage" role="alert">
      <Marquee size="lg" still>
        <div style={{ padding: 'var(--space-xl) var(--space-lg)', textAlign: 'center' }}>
          <h1 className="marquee-text placeholder-title">{status === 404 ? 'Scene not found' : 'Intermission!'}</h1>
          <p style={{ fontSize: '2.5rem', margin: '0.5rem 0' }} aria-hidden="true">
            🎪
          </p>
          <p style={{ color: 'var(--marquee-text)' }}>Something went wrong backstage. Our stage crew has been notified (well, the console has).</p>
        </div>
      </Marquee>
      <p className="muted small">{message}</p>
      <div className="cluster" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload the page
        </button>
        <Link to="/" className="btn btn-ghost" reloadDocument>
          Back to the lobby
        </Link>
      </div>
    </div>
  );
}

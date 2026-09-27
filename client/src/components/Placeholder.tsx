import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Marquee } from './Marquee';

export interface PlaceholderProps {
  /** Page name, e.g. "Song Matchmaker" */
  title: string;
  emoji?: string;
  children?: ReactNode;
}

/** Themed "Rehearsals in progress" stand-in for pages that are still being built. */
export function RehearsalPlaceholder({ title, emoji = '🎬', children }: PlaceholderProps) {
  useDocumentTitle(title);
  return (
    <div className="container placeholder-stage" data-testid="placeholder-page">
      <Marquee size="lg">
        <p className="eyebrow" style={{ color: 'var(--marquee-gold)' }}>
          Coming soon
        </p>
        <h1 className="placeholder-title marquee-text">{title}</h1>
        <p style={{ fontSize: '2.5rem', margin: '0.5rem 0' }} aria-hidden="true">
          {emoji}
        </p>
        <p style={{ color: 'var(--marquee-text)' }}>Rehearsals in progress…</p>
      </Marquee>
      <p className="placeholder-body">{children ?? 'This scene is still in rehearsal. Check back after tech week!'}</p>
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

import type { ReactNode } from 'react';

export interface EmptyStateProps {
  emoji?: string;
  title: string;
  children?: ReactNode;
  /** Buttons/links rendered under the text. */
  actions?: ReactNode;
  className?: string;
  /** Heading level for the title (default 2). */
  level?: 2 | 3;
}

/** Friendly, theatrical empty/zero state. */
export function EmptyState({ emoji = '🎭', title, children, actions, className = '', level = 2 }: EmptyStateProps) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className={`empty-state ${className}`.trim()} data-testid="empty-state">
      <span className="empty-state-emoji emoji" aria-hidden="true">
        {emoji}
      </span>
      <H className="empty-state-title">{title}</H>
      {children && <div className="empty-state-body">{children}</div>}
      {actions && <div className="empty-state-actions">{actions}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/** Error with an optional "Try again" button. */
export function ErrorState({ title = 'The curtain got stuck!', message = "We couldn't load this. Check your connection and try again.", onRetry, className = '' }: ErrorStateProps) {
  return (
    <EmptyState
      emoji="🎪"
      title={title}
      className={className}
      actions={
        onRetry ? (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Try again
          </button>
        ) : undefined
      }
    >
      <p role="alert">{message}</p>
    </EmptyState>
  );
}

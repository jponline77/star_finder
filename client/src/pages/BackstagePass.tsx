/**
 * Shared "Backstage Pass" ticket-stub card used by LoginPage and SignupPage.
 * (Not a route — a layout helper for the two auth pages.)
 */
import type { ReactNode } from 'react';
import './AuthPages.css';

export function BackstagePass({ title, kicker, children, stubText = 'ADMIT ONE' }: { title: string; kicker: string; children: ReactNode; stubText?: string }) {
  return (
    <div className="container auth-page">
      <div className="ticket" data-testid="backstage-pass">
        <div className="ticket-main">
          <p className="ticket-kicker">
            <span aria-hidden="true">🎟️ </span>
            {kicker}
          </p>
          <h1 className="ticket-title">{title}</h1>
          {children}
        </div>
        <div className="ticket-stub" aria-hidden="true">
          <span className="ticket-stub-star">★</span>
          <span className="ticket-stub-text">{stubText}</span>
          <span className="ticket-barcode" />
          <span className="ticket-stub-no">No. 2026-STAR</span>
        </div>
      </div>
    </div>
  );
}

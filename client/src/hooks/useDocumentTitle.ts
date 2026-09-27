import { useEffect } from 'react';

export const SITE_NAME = 'STAR Song Finder';

/** Fired on `window` whenever a page sets the document title (Layout announces route changes with it). */
export const TITLE_EVENT = 'star:title';

/** Sets `document.title` to "<title> · STAR Song Finder" (or just the site name). */
export function useDocumentTitle(title?: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
    window.dispatchEvent(new Event(TITLE_EVENT));
  }, [title]);
}

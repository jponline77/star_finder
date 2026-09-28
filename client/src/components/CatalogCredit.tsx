/**
 * "Song list from Wikipedia (CC BY-SA)" — the credit shown wherever catalog data appears (SPEC §7c).
 * Links to the show's Wikipedia article when we know it, and to the licence.
 * Songs loaded from a show's cast album (catalog source 'recording') came from Apple Music instead:
 * <RecordingListCredit /> says so.
 * data-testids: catalog-credit, recording-list-credit
 */
import { CC_BY_SA_URL, RECORDING_LIST_CREDIT, wikipediaUrl } from '../lib/catalog';
import './catalog.css';

export function CatalogCredit({ wikiTitle, className = '' }: { wikiTitle?: string | null; className?: string }) {
  const url = wikipediaUrl(wikiTitle);
  return (
    <p className={`catalog-credit ${className}`.trim()} data-testid="catalog-credit">
      <span className="catalog-credit-icon" aria-hidden="true">
        📚
      </span>
      <span>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            Song list from Wikipedia<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        ) : (
          'Song list from Wikipedia'
        )}{' '}
        (
        <a href={CC_BY_SA_URL} target="_blank" rel="license noopener noreferrer">
          CC BY-SA<span className="visually-hidden"> licence, opens in a new tab</span>
        </a>
        )
      </span>
    </p>
  );
}

/** "Track list from Apple Music" — for songs that came from a cast album's track list, not the Wikipedia song list. */
export function RecordingListCredit({ className = '' }: { className?: string }) {
  return (
    <p className={`catalog-credit ${className}`.trim()} data-testid="recording-list-credit">
      <span className="catalog-credit-icon" aria-hidden="true">
        💿
      </span>
      <span>{RECORDING_LIST_CREDIT}</span>
    </p>
  );
}

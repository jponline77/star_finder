/**
 * "🔎 Find a 30-sec preview" — searches Apple Music via GET /api/lookup/itunes (title + show) and
 * lists candidates (art, track, album, artist, duration, match score) with ▶ and "Use this".
 * The chosen preview is shown with a Remove button.
 *
 * data-testids: find-preview, preview-candidate, use-preview-<i>, chosen-preview, remove-preview,
 * use-preview-length.
 */
import { Check, Clock, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, isApiError, lookupItunes } from '../../api';
import { ArtworkTile } from '../../components/ArtworkTile';
import { PlayButton } from '../../components/PlayButton';
import { formatLength } from '../../lib/format';
import { isSafeHttpUrl } from '../../lib/links';
import { APPLE_PREVIEW_CREDIT, type AudioTrack } from '../../state/AudioProvider';
import type { ItunesCandidate } from '../../types';
import type { ChosenPreview } from './model';

export interface PreviewFinderProps {
  title: string;
  showName: string;
  chosen: ChosenPreview | null;
  onChoose: (preview: ChosenPreview) => void;
  onRemove: () => void;
  /** Current length field (seconds) — offers "use this recording's length" when empty. */
  lengthSeconds: number | null;
  onUseLength: (seconds: number) => void;
  error?: string;
}

type Status = 'idle' | 'loading' | 'done' | 'error';

export function scoreLabel(score: number): { text: string; tone: 'success' | 'gold' | 'outline' } {
  if (score >= 85) return { text: 'Great match', tone: 'success' };
  if (score >= 70) return { text: 'Likely match', tone: 'gold' };
  return { text: 'Maybe', tone: 'outline' };
}

export function candidateToPreview(c: ItunesCandidate): ChosenPreview {
  return {
    input: {
      previewUrl: c.previewUrl,
      artworkUrl: c.artworkUrl,
      appleMusicUrl: c.appleMusicUrl,
      recordingName: c.collectionName || null,
      recordingArtist: c.artistName || null,
      itunesTrackId: c.trackId,
    },
    trackName: c.trackName,
    durationSeconds: c.durationSeconds,
  };
}

function trackFor(p: { key: string; src: string | null; title: string; subtitle?: string | null; art?: string | null }): AudioTrack | null {
  if (!p.src) return null;
  return { key: p.key, src: p.src, title: p.title, subtitle: p.subtitle ?? undefined, artworkUrl: p.art ?? null, artworkSeed: p.subtitle ?? p.title, credit: APPLE_PREVIEW_CREDIT };
}

export function PreviewFinder({ title, showName, chosen, onChoose, onRemove, lengthSeconds, onUseLength, error }: PreviewFinderProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [candidates, setCandidates] = useState<ItunesCandidate[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState('');
  const ctrl = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const chosenRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const canSearch = Boolean(title.trim() && showName.trim());

  const search = async () => {
    if (!canSearch) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setStatus('loading');
    setMessage(null);
    const label = `“${title.trim()}” from ${showName.trim()}`;
    try {
      const res = await lookupItunes(title.trim(), showName.trim(), c.signal);
      if (c.signal.aborted) return;
      const usable = res.candidates.filter((x) => x.previewUrl);
      setCandidates(usable);
      setSearchedFor(label);
      setStatus('done');
      requestAnimationFrame(() => resultsRef.current?.focus());
    } catch (e) {
      if (c.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setStatus('error');
      setMessage(isApiError(e) && e.status === 429 ? 'Too many searches in a row — wait a minute and try again.' : errorMessage(e));
    }
  };

  const chosenTrack = chosen
    ? trackFor({ key: `chosen:${chosen.input.itunesTrackId ?? chosen.input.previewUrl}`, src: chosen.input.previewUrl, title: chosen.trackName, subtitle: chosen.input.recordingName, art: chosen.input.artworkUrl })
    : null;

  return (
    <div className="preview-finder">
      {chosen && (
        <div className="preview-chosen" data-testid="chosen-preview" ref={chosenRef} tabIndex={-1} aria-label={`Chosen preview: ${chosen.trackName}`}>
          <div className="preview-chosen-art">
            <ArtworkTile src={chosen.input.artworkUrl} seed={chosen.input.recordingName ?? chosen.trackName} size={72} />
            {chosenTrack && <PlayButton track={chosenTrack} size="sm" />}
          </div>
          <div className="preview-chosen-body">
            <p className="preview-chosen-eyebrow">
              <Check size={14} aria-hidden="true" /> Preview chosen
            </p>
            <p className="preview-chosen-title">{chosen.trackName}</p>
            {chosen.input.recordingName && <p className="preview-meta">{chosen.input.recordingName}</p>}
            {chosen.input.recordingArtist && (
              <p className="preview-meta subtle line-clamp-2" title={chosen.input.recordingArtist}>
                {chosen.input.recordingArtist}
              </p>
            )}
            <div className="preview-chosen-actions">
              {chosen.durationSeconds && lengthSeconds === null && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => onUseLength(chosen.durationSeconds as number)} data-testid="use-preview-length">
                  <Clock size={15} aria-hidden="true" /> Use {formatLength(chosen.durationSeconds)} as the length
                </button>
              )}
              {isSafeHttpUrl(chosen.input.appleMusicUrl) && (
                <a className="btn btn-quiet btn-sm" href={chosen.input.appleMusicUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={15} aria-hidden="true" /> Apple Music
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              )}
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={onRemove} data-testid="remove-preview">
                <X size={15} aria-hidden="true" /> Remove
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="preview-search-row">
        <button
          type="button"
          id="find-preview"
          className="btn btn-secondary"
          onClick={search}
          disabled={!canSearch || status === 'loading'}
          aria-describedby="find-preview-hint"
          data-testid="find-preview"
        >
          {status === 'loading' ? (
            <span className="spinner" aria-hidden="true" />
          ) : chosen || status === 'done' ? (
            <RefreshCw size={17} aria-hidden="true" />
          ) : (
            <span className="emoji" aria-hidden="true">
              🔎
            </span>
          )}
          {status === 'loading' ? 'Searching Apple Music…' : chosen ? 'Find a different preview' : 'Find a 30-sec preview'}
        </button>
        <p id="find-preview-hint" className="hint">
          {canSearch ? 'We’ll search Apple Music for cast recordings of this song.' : 'Add the song title and show first, then we can search.'}
        </p>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {status === 'error' && message && (
        <p className="callout callout-warning" role="alert">
          {message}
        </p>
      )}

      {status === 'done' && (
        <div className="preview-results" ref={resultsRef} tabIndex={-1} aria-label={`Preview results for ${searchedFor}`}>
          {candidates.length === 0 ? (
            <p className="callout" role="status">
              <span className="emoji" aria-hidden="true">
                🦗
              </span>
              <span>
                No cast recordings found for {searchedFor}. Double-check the spelling — or skip it, a preview is optional.
              </span>
            </p>
          ) : (
            <>
              <p className="preview-results-count" role="status">
                {candidates.length} recording{candidates.length === 1 ? '' : 's'} found — press ▶ to check it’s the right song, then pick one.
              </p>
              <ul className="preview-candidates" role="list">
                {candidates.map((c, i) => {
                  const label = scoreLabel(c.score);
                  const isChosen = chosen?.input.itunesTrackId === c.trackId;
                  const track = trackFor({ key: `itunes:${c.trackId}`, src: c.previewUrl, title: c.trackName, subtitle: c.collectionName, art: c.artworkUrl });
                  return (
                    <li key={c.trackId} className={`preview-candidate${isChosen ? ' is-chosen' : ''}`} data-testid="preview-candidate">
                      <div className="preview-candidate-art">
                        <ArtworkTile src={c.artworkUrl} seed={c.collectionName || c.trackName} size={56} />
                        {track && <PlayButton track={track} size="sm" />}
                      </div>
                      <div className="preview-candidate-body">
                        <p className="preview-candidate-title">{c.trackName}</p>
                        <p className="preview-meta">
                          {c.collectionName}
                          {c.durationSeconds ? <span className="preview-duration"> · {formatLength(c.durationSeconds)}</span> : null}
                        </p>
                        <p className="preview-meta subtle line-clamp-2" title={c.artistName}>
                          {c.artistName}
                        </p>
                      </div>
                      <div className="preview-candidate-side">
                        <span className={`badge badge-${label.tone}`} title={`Match score ${c.score} out of 100`}>
                          {label.text} · {c.score}%
                        </span>
                        <button
                          type="button"
                          className={`btn btn-sm ${isChosen ? 'btn-ghost' : 'btn-primary'}`}
                          onClick={() => {
                            onChoose(candidateToPreview(c));
                            setStatus('idle');
                            requestAnimationFrame(() => chosenRef.current?.focus());
                          }}
                          disabled={isChosen}
                          aria-label={isChosen ? `${c.trackName} (${c.collectionName}) is chosen` : `Use ${c.trackName} from ${c.collectionName}`}
                          data-testid={`use-preview-${i}`}
                        >
                          {isChosen ? <Check size={15} aria-hidden="true" /> : null}
                          {isChosen ? 'Chosen' : 'Use this'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="tiny subtle">{APPLE_PREVIEW_CREDIT}. Wrong audio is worse than none — only pick a recording that’s clearly this song from this show.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

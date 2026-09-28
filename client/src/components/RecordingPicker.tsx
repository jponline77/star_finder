/**
 * Recording picker (SPEC §7c) — used by the song form and the owner/admin media panel on the song page.
 *
 *  - Catalog songs: loads GET /api/catalog/songs/:id/recordings (the show's cast album first). With `autoLoad`
 *    it loads as soon as it mounts, and with `autoSelect` it picks the best match by itself (the form) — but only
 *    a recording that is clearly this song from this show (lib/catalog `bestCandidate`: a cast recording, or a
 *    strong match on another recording of the show). Anything weaker is offered as "Possible matches — listen
 *    first" with nothing chosen.
 *  - Anything else: "🔎 Find recordings" searches Apple by title + show (GET /api/lookup/itunes) and the
 *    student picks one — wrong audio is worse than no audio, so a plain search never auto-picks.
 *  - Shows the chosen recording (art, ▶ 30-sec preview, album, artist, length) and the alternatives in a
 *    scrollable strip with ▶, plus a "No recording" option. Choosing one tells the parent (which updates the
 *    length suggestion, "3:21 from <album>").
 *
 * data-testids: recording-picker, chosen-preview, remove-preview, find-preview, preview-candidate, use-preview-<i>,
 * no-recording, recordings-status, search-recordings.
 */
import { Check, ExternalLink, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCatalogRecordings, isApiError, lookupErrorMessage, lookupItunes } from '../api';
import { recordingCache } from '../hooks/useCatalog';
import { bestCandidate, recordingBadge } from '../lib/catalog';
import { formatLength, formatLengthLong } from '../lib/format';
import { isSafeHttpUrl } from '../lib/links';
import { candidateToPreview, candidateTrack, chosenTrack, isChosenCandidate, scoreLabel, type ChosenPreview } from '../lib/recordings';
import { APPLE_PREVIEW_CREDIT } from '../state/AudioProvider';
import type { ItunesCandidate } from '../types';
import { ArtworkTile } from './ArtworkTile';
import { PlayButton } from './PlayButton';
import { Skeleton } from './Skeletons';
import './media.css';

export type ChooseHow = 'auto' | 'user';

export interface RecordingPickerProps {
  /** Catalog song id → its recordings endpoint; null → search Apple by title + show. */
  catalogSongId: number | null;
  title: string;
  showName: string;
  chosen: ChosenPreview | null;
  onChoose: (preview: ChosenPreview | null, how: ChooseHow) => void;
  /** Load the recordings as soon as the picker appears (catalog recordings, else a title + show search). */
  autoLoad?: boolean;
  /** Pick the best match when nothing is chosen yet (catalog songs only). */
  autoSelect?: boolean;
  /** Buttons disabled (e.g. while the song page saves the choice). */
  busy?: boolean;
  error?: string;
  /** Hide the chosen summary (the song page shows its own). */
  hideChosen?: boolean;
}

type Status = 'idle' | 'loading' | 'done' | 'error';
type Via = 'catalog' | 'search';

export function RecordingPicker({
  catalogSongId,
  title,
  showName,
  chosen,
  onChoose,
  autoLoad = false,
  autoSelect = false,
  busy = false,
  error,
  hideChosen = false,
}: RecordingPickerProps) {
  const cached = catalogSongId !== null ? recordingCache.get(String(catalogSongId)) : undefined;
  const [status, setStatus] = useState<Status>(cached ? 'done' : 'idle');
  const [via, setVia] = useState<Via>(catalogSongId !== null ? 'catalog' : 'search');
  const [candidates, setCandidates] = useState<ItunesCandidate[]>(cached ?? []);
  const [message, setMessage] = useState<string | null>(null);
  const [autoPicked, setAutoPicked] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState('');
  /** The last load was started by the student (errors interrupt) rather than in the background (errors wait). */
  const [userLoad, setUserLoad] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  /** A background load that found Apple busy (503 + Retry-After) tries once more by itself. */
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retried = useRef(false);
  const chosenRef = useRef(chosen);
  const declined = useRef(false);
  const chosenBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chosenRef.current = chosen;
  }, [chosen]);
  useEffect(
    () => () => {
      ctrl.current?.abort();
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  const canSearch = Boolean(title.trim() && showName.trim());

  const maybeAutoSelect = useCallback(
    (list: ItunesCandidate[]) => {
      if (!autoSelect || chosenRef.current || declined.current) return;
      const best = bestCandidate(list);
      if (!best) return;
      const preview = candidateToPreview(best);
      setAutoPicked(best.previewUrl);
      onChoose(preview, 'auto');
    },
    [autoSelect, onChoose],
  );

  const load = useCallback(
    async (how: Via, byUser = true) => {
      if (how === 'catalog' && catalogSongId === null) return;
      if (how === 'search' && !canSearch) return;
      ctrl.current?.abort();
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      const c = new AbortController();
      ctrl.current = c;
      setStatus('loading');
      setMessage(null);
      setVia(how);
      setUserLoad(byUser);
      try {
        let list: ItunesCandidate[];
        const key = how === 'catalog' ? String(catalogSongId) : null;
        const hit = key ? recordingCache.get(key) : undefined;
        if (hit) list = hit;
        else {
          const res = how === 'catalog' ? await getCatalogRecordings(catalogSongId as number, c.signal) : await lookupItunes(title.trim(), showName.trim(), c.signal);
          list = (Array.isArray(res?.candidates) ? res.candidates : []).filter((x) => Boolean(x.previewUrl));
          if (key) recordingCache.set(key, list);
        }
        if (c.signal.aborted) return;
        setCandidates(list);
        setSearchedFor(how === 'catalog' ? '' : `“${title.trim()}” from ${showName.trim()}`);
        setStatus('done');
        if (how === 'catalog') maybeAutoSelect(list);
      } catch (e) {
        if (c.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        setStatus('error');
        setMessage(lookupErrorMessage(e));
        // Apple busy for the whole site (a short wait): a background load tries once more by itself.
        if (!byUser && !retried.current && isApiError(e) && e.status === 503 && e.retryAfter !== undefined && e.retryAfter <= 60) {
          retried.current = true;
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            void load(how, false);
          }, Math.max(1, e.retryAfter) * 1000);
        }
      }
    },
    [catalogSongId, canSearch, title, showName, maybeAutoSelect],
  );

  // `autoLoad`: load as soon as the picker appears (catalog recordings, else a title search). Re-runs only when
  // the catalog song changes; the cleanup aborts, so React's mount → unmount → mount check can't strand it.
  useEffect(() => {
    if (!autoLoad) return;
    if (catalogSongId !== null && cached) {
      maybeAutoSelect(cached);
      return;
    }
    if (catalogSongId === null && !canSearch) return;
    void load(catalogSongId !== null ? 'catalog' : 'search', false);
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, catalogSongId]);

  const choose = (c: ItunesCandidate | null) => {
    declined.current = c === null;
    setAutoPicked(null);
    onChoose(c ? candidateToPreview(c) : null, 'user');
    if (c) requestAnimationFrame(() => chosenBox.current?.focus());
  };

  const chosenAuto = chosen && autoPicked !== null && chosen.input.previewUrl === autoPicked;
  const cTrack = chosen ? chosenTrack(chosen) : null;
  const showStrip = status === 'done' && candidates.length > 0;
  // Catalog recordings: the one that's clearly this song (null = only possible matches — listen first).
  const best = via === 'catalog' ? bestCandidate(candidates) : null;
  const unsure = via === 'catalog' && showStrip && best === null;
  const errorBox =
    status === 'error' && message ? (
      <div className="callout callout-warning rec-error" role={userLoad ? 'alert' : undefined} data-testid="recordings-error">
        <span>{message}</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load(via)} disabled={busy}>
          <RefreshCw size={15} aria-hidden="true" /> Try again
        </button>
      </div>
    ) : null;

  return (
    <div className="rec-picker" data-testid="recording-picker">
      {chosen && !hideChosen && (
        <div className={`rec-chosen${chosenAuto ? ' is-auto' : ''}`} data-testid="chosen-preview" ref={chosenBox} tabIndex={-1} aria-label={`Chosen recording: ${chosen.trackName}`}>
          <div className="rec-chosen-art">
            <ArtworkTile src={chosen.input.artworkUrl} seed={chosen.input.recordingName ?? chosen.trackName} size={84} />
            {cTrack && <PlayButton track={cTrack} size="sm" name={chosen.input.recordingName ? `${chosen.trackName} — ${chosen.input.recordingName}` : chosen.trackName} />}
          </div>
          <div className="rec-chosen-body">
            <p className="rec-eyebrow">
              {chosenAuto ? (
                <>
                  <Sparkles size={14} aria-hidden="true" /> Best match — picked for you
                </>
              ) : (
                <>
                  <Check size={14} aria-hidden="true" /> Recording chosen
                </>
              )}
            </p>
            <p className="rec-chosen-title">{chosen.trackName}</p>
            {(chosen.input.recordingName || chosen.durationSeconds) && (
              <p className="rec-meta">
                {chosen.input.recordingName}
                {chosen.durationSeconds ? (
                  <span className="rec-duration">
                    {chosen.input.recordingName ? ' · ' : ''}
                    <span aria-label={formatLengthLong(chosen.durationSeconds)}>{formatLength(chosen.durationSeconds)}</span>
                  </span>
                ) : null}
              </p>
            )}
            {chosen.input.recordingArtist && (
              <p className="rec-meta subtle line-clamp-2" title={chosen.input.recordingArtist}>
                {chosen.input.recordingArtist}
              </p>
            )}
            <div className="rec-chosen-actions">
              {isSafeHttpUrl(chosen.input.appleMusicUrl) && (
                <a className="btn btn-quiet btn-sm" href={chosen.input.appleMusicUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={15} aria-hidden="true" /> Apple Music
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              )}
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => choose(null)} disabled={busy} data-testid="remove-preview">
                <X size={15} aria-hidden="true" /> Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {status === 'idle' && (
        <div className="rec-search-row">
          {via === 'catalog' && catalogSongId !== null ? (
            <button type="button" id="find-preview" className="btn btn-secondary" onClick={() => void load('catalog')} disabled={busy} data-testid="find-preview">
              <span className="emoji" aria-hidden="true">
                🎧
              </span>
              {chosen ? 'See other recordings' : 'Find recordings'}
            </button>
          ) : (
            <>
              <button
                type="button"
                id="find-preview"
                className="btn btn-secondary"
                onClick={() => void load('search')}
                disabled={!canSearch || busy}
                aria-describedby="find-preview-hint"
                data-testid="find-preview"
              >
                <span className="emoji" aria-hidden="true">
                  🔎
                </span>
                {chosen ? 'Find a different recording' : 'Find recordings'}
              </button>
              <p id="find-preview-hint" className="hint">
                {canSearch ? 'We’ll search Apple Music for cast recordings of this song.' : 'Add the song title and show first, then we can search.'}
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="rec-status" role="status" aria-live="polite" data-testid="recordings-status">
        {status === 'loading' && <span className="visually-hidden">Looking for recordings…</span>}
        {/* A background load's error waits its turn here (polite); one the student started interrupts (below). */}
        {!userLoad && errorBox}
        {status === 'done' &&
          (candidates.length === 0 ? (
            <span className="callout rec-empty">
              <span className="emoji" aria-hidden="true">
                🦗
              </span>
              <span>
                {via === 'catalog' ? 'We couldn’t find a cast recording of this song on Apple Music.' : `No cast recordings found for ${searchedFor}.`} A recording is optional —
                you can still add the song.
              </span>
            </span>
          ) : unsure ? (
            <span className="rec-count is-unsure" data-testid="recordings-unsure">
              {candidates.length === 1
                ? 'Possible match — listen first. It isn’t clearly the cast recording, so it isn’t picked for you. Only choose it if it’s this song from this show.'
                : 'Possible matches — listen first. None is clearly the cast recording, so nothing is picked for you. Only choose one if it’s this song from this show.'}
            </span>
          ) : (
            <span className="rec-count">
              {candidates.length} recording{candidates.length === 1 ? '' : 's'} — press ▶ to listen, then tap the right one.
            </span>
          ))}
      </div>

      {status === 'loading' && (
        <ul className="rec-strip is-loading" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="rec-card">
              <Skeleton height={132} radius={12} />
              <Skeleton height={14} width="80%" />
              <Skeleton height={12} width="60%" />
            </li>
          ))}
        </ul>
      )}

      {userLoad && errorBox}

      {showStrip && (
        <ul className="rec-strip" role="list" aria-label={unsure ? 'Possible matches — listen first' : 'Recordings to choose from'}>
          {candidates.map((c, i) => {
            const isChosen = isChosenCandidate(chosen, c);
            const track = candidateTrack(c);
            const label = (via === 'catalog' ? recordingBadge(c, c === best) : null) ?? scoreLabel(c.score);
            const described = `${c.trackName} — ${c.collectionName}${c.artistName ? `, ${c.artistName}` : ''}`;
            return (
              <li key={`${c.trackId}-${i}`} className={`rec-card${isChosen ? ' is-chosen' : ''}`} data-testid="preview-candidate">
                <div className="rec-card-art">
                  <ArtworkTile src={c.artworkUrl} seed={c.collectionName || c.trackName} size={132} />
                  {track && <PlayButton track={track} size="sm" name={described} />}
                  {isChosen && (
                    <span className="rec-card-check" aria-hidden="true">
                      <Check size={16} strokeWidth={3} />
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="rec-card-pick"
                  aria-pressed={isChosen}
                  disabled={busy}
                  onClick={() => (isChosen ? undefined : choose(c))}
                  aria-label={`${isChosen ? 'Chosen' : 'Use'}: ${described}${c.durationSeconds ? `, ${formatLengthLong(c.durationSeconds)}` : ''}${label.text === 'Best match' ? ' (best match)' : ''}`}
                  data-testid={`use-preview-${i}`}
                >
                  <span className="rec-card-title">{c.trackName}</span>
                  <span className="rec-card-album line-clamp-2">{c.collectionName}</span>
                  <span className="rec-card-artist truncate">{c.artistName}</span>
                  <span className="rec-card-foot">
                    {c.durationSeconds ? <span className="rec-card-time">{formatLength(c.durationSeconds)}</span> : <span />}
                    <span className={`badge badge-${label.tone}`} title={via === 'catalog' ? undefined : `Match score ${c.score} out of 100`}>
                      {label.text}
                    </span>
                  </span>
                  <span className="rec-card-cta">{isChosen ? '✓ Chosen' : 'Use this'}</span>
                </button>
              </li>
            );
          })}
          <li className={`rec-card is-none${chosen ? '' : ' is-chosen'}`}>
            <button type="button" className="rec-card-pick" aria-pressed={!chosen} disabled={busy} onClick={() => (chosen ? choose(null) : undefined)} data-testid="no-recording">
              <span className="rec-none-icon" aria-hidden="true">
                🔇
              </span>
              <span className="rec-card-title">No recording</span>
              <span className="rec-card-album">No 30-second preview for this song</span>
              <span className="rec-card-cta">{chosen ? 'Choose' : '✓ Chosen'}</span>
            </button>
          </li>
        </ul>
      )}

      {status === 'done' && (
        <div className="rec-foot">
          {via === 'catalog' ? (
            canSearch && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load('search')} disabled={busy} data-testid="search-recordings">
                <Search size={15} aria-hidden="true" /> Search Apple Music by title instead
              </button>
            )
          ) : (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load('search')} disabled={!canSearch || busy} data-testid="search-recordings">
              <RefreshCw size={15} aria-hidden="true" /> Search again
            </button>
          )}
          <p className="tiny subtle">{APPLE_PREVIEW_CREDIT}. Only pick a recording that’s clearly this song from this show — wrong audio is worse than none.</p>
        </div>
      )}
    </div>
  );
}

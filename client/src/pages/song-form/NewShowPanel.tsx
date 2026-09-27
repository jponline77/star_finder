/**
 * Shown when the song's show is new: optional details for the show's page, plus
 * "✨ Fetch info from Wikipedia" (GET /api/lookup/wikipedia) which previews the description and
 * poster. If the user adds any details, the page creates the show first (POST /api/shows) and
 * then the song; otherwise it just sends `showName`.
 *
 * data-testids: new-show-panel, fetch-wikipedia, wiki-result, wiki-use-poster, new-show-composer,
 * new-show-lyricist, new-show-year, new-show-description, show-suggestion.
 */
import { ExternalLink, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, lookupWikipedia } from '../../api';
import { Field } from '../../components/Controls';
import { isSafeHttpUrl } from '../../lib/links';
import { SHOW_DESCRIPTION_MAX, shortenExtract, type FieldErrors, type NewShowDetails } from './model';
import type { ShowOption } from './ShowCombobox';

export interface NewShowPanelProps {
  name: string;
  value: NewShowDetails;
  onChange: (next: NewShowDetails) => void;
  errors: FieldErrors;
  /** Existing shows that look similar ("Did you mean…?"). */
  suggestions: readonly ShowOption[];
  onPickSuggestion: (show: ShowOption) => void;
}

type WikiStatus = 'idle' | 'loading' | 'found' | 'missing' | 'error';

export function NewShowPanel({ name, value, onChange, errors, suggestions, onPickSuggestion }: NewShowPanelProps) {
  const [status, setStatus] = useState<WikiStatus>(value.wikiUrl ? 'found' : 'idle');
  const [message, setMessage] = useState<string | null>(null);
  const [blurb, setBlurb] = useState<string | null>(null);
  const [lookedUp, setLookedUp] = useState('');
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  // A different show name invalidates an earlier Wikipedia result.
  useEffect(() => {
    if (lookedUp && lookedUp !== name) {
      setStatus('idle');
      setBlurb(null);
      setMessage(null);
    }
  }, [name, lookedUp]);

  const set = (patch: Partial<NewShowDetails>) => onChange({ ...value, ...patch });

  const fetchWiki = async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setStatus('loading');
    setMessage(null);
    try {
      const res = await lookupWikipedia(name, c.signal);
      if (c.signal.aborted) return;
      setLookedUp(name);
      if (!res.found) {
        setStatus('missing');
        return;
      }
      setBlurb(res.description ?? null);
      setStatus('found');
      const keepOwn = value.description.trim() !== '' && value.description !== value.wikiDescription;
      const description = keepOwn ? value.description : shortenExtract(res.extract ?? res.description);
      onChange({
        ...value,
        description,
        wikiUrl: isSafeHttpUrl(res.wikiUrl) ? res.wikiUrl : null,
        wikiTitle: res.title ?? name,
        imageUrl: res.imageUrl ?? null,
        useImage: Boolean(res.imageUrl),
        wikiFor: name,
        wikiDescription: keepOwn ? '' : description,
      });
    } catch (e) {
      if (c.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setStatus('error');
      setMessage(errorMessage(e));
    }
  };

  const clearWiki = () => {
    onChange({ ...value, wikiUrl: null, wikiTitle: null, imageUrl: null, useImage: true, wikiFor: null, wikiDescription: '' });
    setStatus('idle');
    setBlurb(null);
  };

  const descLen = [...value.description].length;

  return (
    <section className="new-show-panel" aria-labelledby="new-show-heading" data-testid="new-show-panel">
      <div className="new-show-head">
        <span className="new-show-sparkle emoji" aria-hidden="true">
          ✨
        </span>
        <div>
          <h3 id="new-show-heading" className="new-show-title">
            New show: <span className="gold">“{name}”</span>
          </h3>
          <p className="hint">It’ll get its own page on the poster wall. Details are optional — you (or anyone) can add them later.</p>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="new-show-suggest">
          <span className="small muted">Did you mean</span>
          {suggestions.map((s) => (
            <button key={s.id} type="button" className="chip" onClick={() => onPickSuggestion(s)} data-testid="show-suggestion">
              {s.name}
            </button>
          ))}
          <span className="small muted">?</span>
        </div>
      )}

      <div className="new-show-wiki">
        <button type="button" id="fetch-wikipedia" className="btn btn-pink" onClick={fetchWiki} disabled={status === 'loading' || !name.trim()} data-testid="fetch-wikipedia">
          {status === 'loading' ? <span className="spinner" aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
          {status === 'loading' ? 'Asking Wikipedia…' : status === 'found' ? 'Fetch again from Wikipedia' : 'Fetch info from Wikipedia'}
        </button>
        {errors['newShow.imageUrl'] && (
          <p className="field-error" role="alert">
            {errors['newShow.imageUrl']}
          </p>
        )}
        <div aria-live="polite">
          {status === 'missing' && (
            <p className="callout">
              <span className="emoji" aria-hidden="true">
                📚
              </span>
              <span>Wikipedia doesn’t have a musical called “{name}”. No worries — add what you know below, or leave it blank.</span>
            </p>
          )}
          {status === 'error' && message && <p className="callout callout-warning">{message}</p>}
        </div>
        {status === 'found' && value.wikiUrl && (
          <div className="wiki-result" data-testid="wiki-result">
            {value.imageUrl && (
              <div className={`wiki-poster${value.useImage ? '' : ' is-off'}`}>
                <img src={value.imageUrl} alt={`Poster for ${value.wikiTitle ?? name} from Wikipedia`} loading="lazy" />
              </div>
            )}
            <div className="wiki-result-body">
              <p className="wiki-result-eyebrow">Found on Wikipedia</p>
              <p className="wiki-result-title">{value.wikiTitle}</p>
              {blurb && <p className="small muted">{blurb}</p>}
              {value.imageUrl && (
                <label className="checkbox-row">
                  <input type="checkbox" checked={value.useImage} onChange={(e) => set({ useImage: e.target.checked })} data-testid="wiki-use-poster" />
                  <span>Use this poster for the show</span>
                </label>
              )}
              <div className="wiki-result-actions">
                <a className="btn btn-quiet btn-sm" href={value.wikiUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={15} aria-hidden="true" /> View on Wikipedia<span className="visually-hidden"> (opens in a new tab)</span>
                </a>
                <button type="button" className="btn btn-quiet btn-sm" onClick={clearWiki}>
                  <X size={15} aria-hidden="true" /> Don’t use this
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="new-show-fields">
        <Field label="Music by" optional error={errors['newShow.composer']} id="new-show-composer">
          {(p) => (
            <input className="input" id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={value.composer} onChange={(e) => set({ composer: e.target.value })} maxLength={140} autoComplete="off" data-testid="new-show-composer" />
          )}
        </Field>
        <Field label="Lyrics by" optional error={errors['newShow.lyricist']} id="new-show-lyricist">
          {(p) => (
            <input className="input" id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={value.lyricist} onChange={(e) => set({ lyricist: e.target.value })} maxLength={140} autoComplete="off" data-testid="new-show-lyricist" />
          )}
        </Field>
        <Field label="Year" optional error={errors['newShow.year']} id="new-show-year" className="new-show-year">
          {(p) => (
            <input className="input" id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={value.year} onChange={(e) => set({ year: e.target.value })} inputMode="numeric" placeholder="e.g. 2003" maxLength={4} autoComplete="off" data-testid="new-show-year" />
          )}
        </Field>
        <Field
          label="What’s the show about?"
          optional
          error={errors['newShow.description']}
          id="new-show-description"
          className="new-show-desc"
          hint={
            <span className="cluster cluster-between">
              <span>1–3 friendly sentences, no spoilers needed.</span>
              <span className={`char-counter${descLen > SHOW_DESCRIPTION_MAX ? ' is-over' : descLen > SHOW_DESCRIPTION_MAX - 100 ? ' is-near' : ''}`}>
                {descLen}/{SHOW_DESCRIPTION_MAX}
              </span>
            </span>
          }
        >
          {(p) => (
            <textarea className="textarea" id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={value.description} onChange={(e) => set({ description: e.target.value })} rows={3} data-testid="new-show-description" />
          )}
        </Field>
      </div>
    </section>
  );
}

/**
 * "Edit show" modal (owner or admin): name, credits, year, licensor, licensing note (admins),
 * description, Wikipedia link and the poster — upload a file (POST /api/shows/:id/image),
 * fetch it from Wikipedia (sends `imageUrl`), or remove it (`imageUrl: null`).
 * PUT /api/shows/:id is a partial update, so only the shown fields are sent.
 *
 * data-testids: edit-show-modal, edit-show-form, show-name, show-composer, show-lyricist,
 * show-book, show-year, show-licensor, show-licensing-note, show-description, show-wiki-url,
 * show-poster-file, show-poster-wiki, show-poster-remove, save-show.
 */
import { ImagePlus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage, isApiError, lookupWikipedia, updateShow, uploadShowImage } from '../../api';
import { ShowPoster } from '../../components/ArtworkTile';
import { Field } from '../../components/Controls';
import { Modal } from '../../components/Modal';
import { formatBytes } from '../../lib/format';
import { hostOf, isHttpsUrl } from '../../lib/links';
import type { Show, ShowInput } from '../../types';

export const SHOW_LIMITS = { name: 120, credit: 120, licensor: 120, licensingNote: 600, description: 1200, wikiUrl: 500 } as const;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface ShowFormValues {
  name: string;
  composer: string;
  lyricist: string;
  bookWriter: string;
  year: string;
  licensor: string;
  licensingNote: string;
  description: string;
  wikiUrl: string;
}

type PosterAction = { type: 'keep' } | { type: 'upload'; file: File; preview: string } | { type: 'wiki'; url: string } | { type: 'remove' };

export function showToValues(show: Show): ShowFormValues {
  return {
    name: show.name,
    composer: show.composer ?? '',
    lyricist: show.lyricist ?? '',
    bookWriter: show.bookWriter ?? '',
    year: show.year ? String(show.year) : '',
    licensor: show.licensor ?? '',
    licensingNote: show.licensingNote ?? '',
    description: show.description ?? '',
    wikiUrl: show.wikiUrl ?? '',
  };
}

/** Client-side mirror of the server's show validation. */
export function validateShowValues(v: ShowFormValues): Record<string, string> {
  const e: Record<string, string> = {};
  const len = (s: string) => [...s.trim()].length;
  if (!v.name.trim()) e.name = 'The show needs a name.';
  else if (len(v.name) > SHOW_LIMITS.name) e.name = `Keep the name to ${SHOW_LIMITS.name} characters or fewer.`;
  for (const k of ['composer', 'lyricist', 'bookWriter'] as const) if (len(v[k]) > SHOW_LIMITS.credit) e[k] = `Keep it to ${SHOW_LIMITS.credit} characters or fewer.`;
  const y = v.year.trim();
  if (y && (!/^\d{4}$/.test(y) || Number(y) < 1600 || Number(y) > 2100)) e.year = 'Use a 4-digit year between 1600 and 2100.';
  if (len(v.licensor) > SHOW_LIMITS.licensor) e.licensor = `Keep it to ${SHOW_LIMITS.licensor} characters or fewer.`;
  if (len(v.licensingNote) > SHOW_LIMITS.licensingNote) e.licensingNote = `Keep the note to ${SHOW_LIMITS.licensingNote} characters or fewer.`;
  if (len(v.description) > SHOW_LIMITS.description) e.description = `Keep the description to ${SHOW_LIMITS.description} characters or fewer.`;
  const w = v.wikiUrl.trim();
  if (w) {
    const host = hostOf(w);
    if (!isHttpsUrl(w) || !(host === 'wikipedia.org' || host.endsWith('.wikipedia.org'))) e.wikiUrl = 'Use a Wikipedia link, like https://en.wikipedia.org/wiki/Hadestown.';
    else if (w.length > SHOW_LIMITS.wikiUrl) e.wikiUrl = 'That link is too long.';
  }
  return e;
}

export function validateImageFile(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Use a JPEG, PNG, WebP or GIF image.';
  if (file.size > IMAGE_MAX_BYTES) return `That image is ${formatBytes(file.size)} — the limit is 5 MB.`;
  return null;
}

export interface EditShowModalProps {
  open: boolean;
  show: Show;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (show: Show) => void;
}

export function EditShowModal({ open, show, isAdmin, onClose, onSaved }: EditShowModalProps) {
  const formId = useId();
  const [values, setValues] = useState<ShowFormValues>(() => showToValues(show));
  const [poster, setPoster] = useState<PosterAction>({ type: 'keep' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [wikiState, setWikiState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; message?: string }>({ status: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);

  // fresh form every time it opens
  useEffect(() => {
    if (!open) return;
    setValues(showToValues(show));
    setPoster({ type: 'keep' });
    setErrors({});
    setFormError(null);
    setWikiState({ status: 'idle' });
  }, [open, show]);

  // release object URLs
  useEffect(() => {
    if (poster.type !== 'upload') return;
    return () => URL.revokeObjectURL(poster.preview);
  }, [poster]);

  const set = (key: keyof ShowFormValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const n = { ...e };
      delete n[key];
      return n;
    });
  };

  const posterSrc = poster.type === 'upload' ? poster.preview : poster.type === 'wiki' ? poster.url : poster.type === 'remove' ? null : show.imageUrl;
  const posterLabel = useMemo(() => {
    switch (poster.type) {
      case 'upload':
        return `New upload: ${poster.file.name}`;
      case 'wiki':
        return 'New poster from Wikipedia';
      case 'remove':
        return 'The poster will be removed';
      default:
        return show.imageUrl ? 'Current poster' : 'No poster yet — the wall shows a gradient';
    }
  }, [poster, show.imageUrl]);

  const fetchWiki = async () => {
    const name = values.name.trim();
    if (!name) return;
    setWikiState({ status: 'loading' });
    try {
      const res = await lookupWikipedia(name);
      if (!res.found) {
        setWikiState({ status: 'error', message: `Wikipedia doesn’t have a musical called “${name}”.` });
        return;
      }
      const filled: string[] = [];
      if (res.imageUrl) {
        setPoster({ type: 'wiki', url: res.imageUrl });
        filled.push('poster');
      }
      setValues((v) => {
        const next = { ...v };
        if (!v.wikiUrl.trim() && res.wikiUrl) {
          next.wikiUrl = res.wikiUrl;
          filled.push('Wikipedia link');
        }
        if (!v.description.trim() && res.extract) {
          next.description = res.extract.length > SHOW_LIMITS.description ? `${res.extract.slice(0, SHOW_LIMITS.description - 1)}…` : res.extract;
          filled.push('description');
        }
        return next;
      });
      setWikiState({ status: 'done', message: filled.length ? `Found “${res.title ?? name}” — review the ${filled.join(', ')} and save.` : `Found “${res.title ?? name}”, but there was nothing new to fill in.` });
    } catch (e) {
      setWikiState({ status: 'error', message: errorMessage(e) });
    }
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    const err = validateImageFile(file);
    if (err) {
      setErrors((e) => ({ ...e, poster: err }));
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setErrors((e) => {
      const n = { ...e };
      delete n.poster;
      return n;
    });
    setPoster({ type: 'upload', file, preview: URL.createObjectURL(file) });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    const errs = validateShowValues(values);
    if (Object.keys(errs).length) {
      setErrors(errs);
      const first = Object.keys(errs)[0];
      document.getElementById(`show-field-${first}`)?.focus();
      return;
    }
    const clean = (s: string) => s.trim() || null;
    const body: ShowInput = {
      name: values.name.trim(),
      composer: clean(values.composer),
      lyricist: clean(values.lyricist),
      bookWriter: clean(values.bookWriter),
      year: values.year.trim() ? Number(values.year.trim()) : null,
      licensor: clean(values.licensor),
      description: clean(values.description),
      wikiUrl: clean(values.wikiUrl),
    };
    if (isAdmin) body.licensingNote = clean(values.licensingNote);
    if (poster.type === 'wiki') body.imageUrl = poster.url;
    if (poster.type === 'remove') body.imageUrl = null;
    setSaving(true);
    try {
      let saved = await updateShow(show.id, body);
      if (poster.type === 'upload') saved = await uploadShowImage(show.id, poster.file);
      onSaved(saved);
    } catch (err) {
      if (isApiError(err) && (err.status === 400 || err.status === 409)) {
        const mapped: Record<string, string> = {};
        for (const [k, msg] of Object.entries(err.details)) {
          if (k === 'existingId') continue;
          if (k === 'imageUrl' || k === 'file') mapped.poster = msg;
          else mapped[k] = msg;
        }
        setErrors(mapped);
        setFormError(Object.keys(mapped).length ? null : err.message);
      } else if (!(isApiError(err) && err.status === 401)) {
        setFormError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const text = (key: keyof ShowFormValues, label: string, opts: { hint?: ReactNode; max?: number; testId: string; placeholder?: string; inputMode?: 'numeric' | 'url'; optional?: boolean } = { testId: '' }) => (
    <Field label={label} optional={opts.optional ?? true} id={`show-field-${key}`} error={errors[key]} hint={opts.hint}>
      {(p) => (
        <input
          className="input"
          id={p.id}
          aria-describedby={p.describedBy}
          aria-invalid={p.invalid || undefined}
          value={values[key]}
          onChange={(e) => set(key, e.target.value)}
          maxLength={opts.max ? opts.max + 20 : undefined}
          placeholder={opts.placeholder}
          inputMode={opts.inputMode}
          autoComplete="off"
          data-testid={opts.testId}
        />
      )}
    </Field>
  );

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={`Edit “${show.name}”`}
      wide
      closeOnBackdrop={false}
      testId="edit-show-modal"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={saving} data-testid="save-show">
            {saving && <span className="spinner" aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save show'}
          </button>
        </>
      }
    >
      <form id={formId} className="edit-show-form" onSubmit={onSubmit} noValidate data-testid="edit-show-form">
        {formError && (
          <p className="callout callout-danger" role="alert">
            {formError}
          </p>
        )}
        <div className="edit-show-grid">
          <div className="edit-show-poster">
            <div className="edit-show-poster-frame">
              <ShowPoster show={{ name: values.name || show.name, imageUrl: posterSrc }} alt="" key={posterSrc ?? 'none'} />
            </div>
            <p className="tiny muted center" aria-live="polite">
              {posterLabel}
            </p>
            <div className="edit-show-poster-actions">
              <input
                ref={fileRef}
                id="show-poster-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="visually-hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                data-testid="show-poster-file"
                aria-describedby={errors.poster ? 'show-poster-error' : undefined}
              />
              <label htmlFor="show-poster-file" className="btn btn-ghost btn-sm btn-block edit-show-upload">
                <ImagePlus size={16} aria-hidden="true" /> Upload a poster
              </label>
              <button type="button" className="btn btn-quiet btn-sm btn-block" onClick={fetchWiki} disabled={wikiState.status === 'loading' || !values.name.trim()} data-testid="show-poster-wiki">
                {wikiState.status === 'loading' ? <span className="spinner" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />} Fetch from Wikipedia
              </button>
              {poster.type !== 'keep' ? (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm btn-block"
                  onClick={() => {
                    setPoster({ type: 'keep' });
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                >
                  <RotateCcw size={16} aria-hidden="true" /> Undo poster change
                </button>
              ) : (
                show.imageUrl && (
                  <button type="button" className="btn btn-danger-ghost btn-sm btn-block" onClick={() => setPoster({ type: 'remove' })} data-testid="show-poster-remove">
                    <Trash2 size={16} aria-hidden="true" /> Remove poster
                  </button>
                )
              )}
            </div>
            {errors.poster && (
              <p className="field-error" id="show-poster-error" role="alert">
                {errors.poster}
              </p>
            )}
            {wikiState.message && (
              <p className={`tiny ${wikiState.status === 'error' ? 'field-error' : 'muted'}`} role="status">
                {wikiState.message}
              </p>
            )}
            <p className="tiny subtle">JPEG, PNG, WebP or GIF · up to 5 MB. Only upload images you’re allowed to share.</p>
          </div>

          <div className="edit-show-fields">
            {text('name', 'Show name', { testId: 'show-name', max: SHOW_LIMITS.name, optional: false, hint: values.name.trim() !== show.name ? 'Renaming changes the show’s web address.' : undefined })}
            <div className="edit-show-row">
              {text('composer', 'Music by', { testId: 'show-composer', max: SHOW_LIMITS.credit })}
              {text('lyricist', 'Lyrics by', { testId: 'show-lyricist', max: SHOW_LIMITS.credit })}
            </div>
            <div className="edit-show-row">
              {text('bookWriter', 'Book by', { testId: 'show-book', max: SHOW_LIMITS.credit })}
              {text('year', 'Year', { testId: 'show-year', placeholder: 'e.g. 1987', inputMode: 'numeric', hint: 'First major production' })}
            </div>
            {text('licensor', 'Licensor', { testId: 'show-licensor', max: SHOW_LIMITS.licensor, placeholder: 'e.g. Music Theatre International (MTI)' })}
            {isAdmin && (
              <Field label="Licensing note" optional id="show-field-licensingNote" error={errors.licensingNote} hint="Admins only — shown on the show page (e.g. which version can be licensed).">
                {(p) => (
                  <textarea className="textarea" id={p.id} rows={3} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={values.licensingNote} onChange={(e) => set('licensingNote', e.target.value)} data-testid="show-licensing-note" />
                )}
              </Field>
            )}
            <Field label="Description" optional id="show-field-description" error={errors.description} hint={`1–3 friendly sentences · ${[...values.description].length}/${SHOW_LIMITS.description}`}>
              {(p) => (
                <textarea className="textarea" id={p.id} rows={4} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} value={values.description} onChange={(e) => set('description', e.target.value)} data-testid="show-description" />
              )}
            </Field>
            {text('wikiUrl', 'Wikipedia link', { testId: 'show-wiki-url', inputMode: 'url', placeholder: 'https://en.wikipedia.org/wiki/…' })}
          </div>
        </div>
      </form>
    </Modal>
  );
}

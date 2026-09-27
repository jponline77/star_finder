/**
 * Admin → Festivals (SPEC §7b): every festival (hidden ones too) grouped by kind, with
 * Add / Edit (modal form, validated like the server), a "Show in pickers" switch and Delete
 * (confirmed). After each change the site-wide festival list (useFestival) is refreshed.
 */
import { CalendarPlus, Link2, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { adminCreateFestival, adminDeleteFestival, adminUpdateFestival, isApiError } from '../../api';
import { useConfirm } from '../../components/ConfirmDialog';
import { Field, SegmentedControl, Switch } from '../../components/Controls';
import { EmptyState } from '../../components/EmptyState';
import { Modal } from '../../components/Modal';
import {
  draftFromFestival,
  emptyFestivalDraft,
  FESTIVAL_KIND_EMOJI,
  FESTIVAL_KIND_LABEL,
  FESTIVAL_LIMITS,
  FESTIVAL_PARAM,
  festivalDateNote,
  festivalInputFromDraft,
  festivalStatus,
  formatFestivalDate,
  groupFestivals,
  validateFestivalDraft,
  type FestivalDraft,
  type FestivalDraftErrors,
} from '../../lib/festivals';
import { useFestival } from '../../state/FestivalProvider';
import { useToast } from '../../state/ToastProvider';
import type { Festival, FestivalKind } from '../../types';

export interface FestivalsPanelProps {
  festivals: Festival[];
  /** Replace the admin list after a change. */
  onChange: (next: Festival[]) => void;
}

const GROUP_TITLES: Record<FestivalKind, string> = {
  regional: 'Regional festivals',
  online: 'Online',
  national: 'National festivals',
};

type Editing = { mode: 'add' } | { mode: 'edit'; festival: Festival } | null;

export function FestivalsPanel({ festivals, onChange }: FestivalsPanelProps) {
  const toast = useToast();
  const { refreshFestivals } = useFestival();
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState<Editing>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const groups = useMemo(() => groupFestivals(festivals, { includeInactive: true }), [festivals]);
  const hidden = festivals.filter((f) => !f.active).length;

  const syncSite = () => {
    refreshFestivals().catch(() => undefined);
  };

  const upsert = (f: Festival) => {
    const exists = festivals.some((x) => x.id === f.id);
    onChange(exists ? festivals.map((x) => (x.id === f.id ? f : x)) : [...festivals, f]);
    syncSite();
  };

  const toggleActive = async (f: Festival, active: boolean) => {
    setBusyId(f.id);
    try {
      const updated = await adminUpdateFestival(f.id, { active });
      upsert({ ...f, ...updated });
      toast.success(active ? `${f.name} is back in the festival pickers` : `${f.name} is hidden from the pickers`, { id: `festival-${f.id}` });
    } catch (e) {
      toast.error(e, { id: `festival-${f.id}` });
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (f: Festival) => {
    const ok = await confirm({
      title: `Delete ${f.name}?`,
      message: (
        <p>
          Anyone who picked it will be asked to choose again. To take it off the pickers for now, <strong>hide</strong> it instead.
        </p>
      ),
      confirmLabel: 'Delete festival',
    });
    if (!ok) return;
    setBusyId(f.id);
    try {
      await adminDeleteFestival(f.id);
      onChange(festivals.filter((x) => x.id !== f.id));
      syncSite();
      toast.success(`${f.name} deleted`, { id: `festival-${f.id}` });
    } catch (e) {
      toast.error(e, { id: `festival-${f.id}` });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-festivals" data-testid="festivals-panel">
      <div className="admin-toolbar admin-festivals-toolbar">
        <p className="admin-festivals-summary">
          <strong>{festivals.length}</strong> festival{festivals.length === 1 ? '' : 's'}
          {hidden > 0 && <span className="muted"> · {hidden} hidden</span>}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ mode: 'add' })} data-testid="festival-add">
          <CalendarPlus size={18} aria-hidden="true" /> Add festival
        </button>
      </div>

      {festivals.length === 0 ? (
        <EmptyState emoji="📅" title="No festivals yet" level={3}>
          <p>Add this season’s regional festivals so students can pick theirs.</p>
        </EmptyState>
      ) : (
        (['regional', 'online', 'national'] as const).map((kind) =>
          groups[kind].length ? (
            <section key={kind} className="admin-festival-group" aria-labelledby={`admin-festivals-${kind}`}>
              <h3 id={`admin-festivals-${kind}`} className="admin-festival-group-title">
                <span className="emoji" aria-hidden="true">
                  {FESTIVAL_KIND_EMOJI[kind]}
                </span>{' '}
                {GROUP_TITLES[kind]} <span className="chip-count">{groups[kind].length}</span>
              </h3>
              <ul className="admin-festival-list" role="list">
                {groups[kind].map((f) => (
                  <FestivalRow
                    key={f.id}
                    festival={f}
                    busy={busyId === f.id}
                    onToggle={(v) => void toggleActive(f, v)}
                    onEdit={() => setEditing({ mode: 'edit', festival: f })}
                    onDelete={() => void onDelete(f)}
                  />
                ))}
              </ul>
            </section>
          ) : null,
        )
      )}

      <FestivalFormModal
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={(f, created) => {
          upsert(f);
          setEditing(null);
          toast.success(created ? `${f.name} added 🎉` : `${f.name} saved`, { id: `festival-${f.id}` });
        }}
      />
      {dialog}
    </div>
  );
}

function FestivalRow({ festival: f, busy, onToggle, onEdit, onDelete }: { festival: Festival; busy: boolean; onToggle: (active: boolean) => void; onEdit: () => void; onDelete: () => void }) {
  const status = festivalStatus(f);
  const note = festivalDateNote(f);
  const place = [f.venue, [f.city, f.province].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  return (
    <li className={`admin-festival card${f.active ? '' : ' is-hidden'}${busy ? ' is-busy' : ''}`} data-testid="festival-row" data-slug={f.slug}>
      <span className="admin-festival-emoji emoji" aria-hidden="true">
        {FESTIVAL_KIND_EMOJI[f.kind]}
      </span>
      <div className="admin-festival-main">
        <p className="admin-festival-name">
          {f.name}
          <span className="badge badge-outline">{FESTIVAL_KIND_LABEL[f.kind]}</span>
          {!f.active && <span className="badge badge-warning">Hidden</span>}
          <span className={`festival-status admin-festival-status is-${status.state}`}>{status.label}</span>
        </p>
        <p className="admin-festival-meta">
          {formatFestivalDate(f, { weekday: true })}
          {note && <span> · {note}</span>}
        </p>
        {place && <p className="admin-festival-meta">{place}</p>}
        <p className="admin-festival-meta admin-festival-slug">
          {f.kind === 'national' ? (
            // nationals can't be picked as "your festival", so they have no share link
            <span className="subtle">order {f.sortOrder}</span>
          ) : (
            <>
              <Link2 size={13} aria-hidden="true" /> <code>/?{FESTIVAL_PARAM}={f.slug}</code>
              <span className="subtle"> · order {f.sortOrder}</span>
            </>
          )}
        </p>
      </div>
      <div className="admin-festival-actions">
        <Switch checked={f.active} disabled={busy} onChange={onToggle} label={<span>{f.kind === 'national' ? 'Listed' : 'In pickers'}<span className="visually-hidden">: {f.name}</span></span>} testId="festival-active-switch" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit} disabled={busy} data-testid="festival-edit">
          <Pencil size={15} aria-hidden="true" /> Edit<span className="visually-hidden"> {f.name}</span>
        </button>
        <button type="button" className="btn btn-danger-ghost btn-sm" onClick={onDelete} disabled={busy} data-testid="festival-delete">
          {busy ? <span className="spinner" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />} Delete<span className="visually-hidden"> {f.name}</span>
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Add / edit modal
// ---------------------------------------------------------------------------

const FIELD_ORDER: Array<keyof FestivalDraft> = ['name', 'kind', 'startDate', 'endDate', 'dateLabel', 'venue', 'city', 'province', 'infoUrl', 'sortOrder'];

function FestivalFormModal({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: (f: Festival, created: boolean) => void }) {
  const key = editing ? (editing.mode === 'add' ? 'add' : `edit-${editing.festival.id}`) : 'closed';
  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      closeOnBackdrop={false}
      wide
      title={editing?.mode === 'edit' ? `Edit ${editing.festival.name}` : 'Add a festival'}
      testId="festival-modal"
    >
      {editing && <FestivalForm key={key} editing={editing} onCancel={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function FestivalForm({ editing, onCancel, onSaved }: { editing: NonNullable<Editing>; onCancel: () => void; onSaved: (f: Festival, created: boolean) => void }) {
  const original = editing.mode === 'edit' ? editing.festival : null;
  const [draft, setDraft] = useState<FestivalDraft>(() => (original ? draftFromFestival(original) : emptyFestivalDraft()));
  const [errors, setErrors] = useState<FestivalDraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FestivalDraft>(k: K, v: FestivalDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const focusFirst = (e: FestivalDraftErrors) => {
    const first = FIELD_ORDER.find((k) => e[k]);
    if (first) document.getElementById(`festival-${first}`)?.focus();
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    // A half-typed date reads as '' (with validity.badInput) — that must not save as "no date".
    const e = validateFestivalDraft(draft, {
      incompleteDates: { startDate: Boolean(startRef.current?.validity.badInput), endDate: Boolean(endRef.current?.validity.badInput) },
    });
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) {
      focusFirst(e);
      return;
    }
    setBusy(true);
    try {
      const body = festivalInputFromDraft(draft);
      const saved = original ? await adminUpdateFestival(original.id, body) : await adminCreateFestival(body);
      onSaved(saved, !original);
    } catch (err) {
      setBusy(false);
      if (!isApiError(err)) {
        setFormError('Something went wrong backstage. Please try again.');
        return;
      }
      if (err.status === 409) {
        const next = { name: err.field('name') ?? err.field('slug') ?? (err.message || 'A festival with that name already exists') };
        setErrors(next);
        focusFirst(next);
        return;
      }
      const fieldErrors: FestivalDraftErrors = {};
      for (const k of FIELD_ORDER) {
        const m = err.field(k);
        if (m) fieldErrors[k] = m;
      }
      if (Object.keys(fieldErrors).length) {
        setErrors(fieldErrors);
        focusFirst(fieldErrors);
      } else {
        setFormError(err.message);
      }
    }
  };

  const online = draft.kind === 'online';
  const text = (k: 'name' | 'dateLabel' | 'venue' | 'city' | 'province' | 'infoUrl', label: string, extra: { hint?: string; placeholder?: string; max: number; type?: string; optional?: boolean; className?: string }) => (
    <Field label={label} hint={extra.hint} error={errors[k]} optional={extra.optional} id={`festival-${k}`} className={extra.className}>
      {(p) => (
        <input
          id={p.id}
          className="input"
          type={extra.type ?? 'text'}
          value={draft[k]}
          placeholder={extra.placeholder}
          maxLength={extra.max + 20}
          aria-describedby={p.describedBy}
          aria-invalid={p.invalid || undefined}
          onChange={(e) => set(k, e.target.value)}
          data-testid={`festival-input-${k}`}
        />
      )}
    </Field>
  );

  return (
    <form className="admin-festival-form" onSubmit={submit} noValidate data-testid="festival-form">
      {text('name', 'Festival name', {
        max: FESTIVAL_LIMITS.nameMax,
        placeholder: 'Kelowna Regional STAR Fest',
        hint: original ? `Link: /?${FESTIVAL_PARAM}=${original.slug} (stays the same if you rename it)` : 'Its link name (e.g. /?festival=kelowna) is made from this.',
        className: 'span-2',
      })}
      <div className="field span-2">
        <span className="label" aria-hidden="true">
          Kind
        </span>
        <SegmentedControl<FestivalKind>
          label="Kind"
          value={draft.kind}
          onChange={(v) => set('kind', v)}
          options={[
            { value: 'regional', label: '📍 Regional', testId: 'festival-kind-regional' },
            { value: 'online', label: '💻 Online', testId: 'festival-kind-online' },
            { value: 'national', label: '🏆 National', testId: 'festival-kind-national' },
          ]}
        />
        <p className="hint">Students can pick regional and online festivals. National ones are listed on STAR Prep as “after regionals”.</p>
      </div>
      <Field label={online ? 'Opens' : 'Date (first day)'} optional hint={online ? 'The day entries open (usually blank). The countdown still runs to the deadline.' : 'Leave blank if it hasn’t been announced.'} error={errors.startDate} id="festival-startDate">
        {(p) => (
          <input ref={startRef} id={p.id} className="input" type="date" value={draft.startDate} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} onChange={(e) => set('startDate', e.target.value)} data-testid="festival-input-startDate" />
        )}
      </Field>
      <Field label={online ? 'Submission deadline' : 'Last day'} optional hint={online ? 'Students get a countdown to the end of this day.' : 'Only for festivals that run over several days.'} error={errors.endDate} id="festival-endDate">
        {(p) => (
          <input ref={endRef} id={p.id} className="input" type="date" value={draft.endDate} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} onChange={(e) => set('endDate', e.target.value)} data-testid="festival-input-endDate" />
        )}
      </Field>
      {text('dateLabel', 'Date note', { max: FESTIVAL_LIMITS.dateLabel, optional: true, placeholder: 'Date to be announced', hint: 'Shown instead of the date when there isn’t one yet (or next to it).', className: 'span-2' })}
      {text('venue', 'Venue', { max: FESTIVAL_LIMITS.venue, optional: true, placeholder: online ? 'Online' : 'Kelowna Community Theatre', className: 'span-2' })}
      {text('city', 'City', { max: FESTIVAL_LIMITS.city, optional: true })}
      {text('province', 'Province', { max: FESTIVAL_LIMITS.province, optional: true, placeholder: 'BC' })}
      {text('infoUrl', 'Info link', { max: FESTIVAL_LIMITS.infoUrl, optional: true, type: 'url', placeholder: 'https://taeacanada.ca/regional-star-fest/', className: 'span-2' })}
      <Field label="Sort order" optional hint="Lower numbers come first when dates tie." error={errors.sortOrder} id="festival-sortOrder">
        {(p) => (
          <input
            id={p.id}
            className="input"
            inputMode="numeric"
            value={draft.sortOrder}
            placeholder="0"
            aria-describedby={p.describedBy}
            aria-invalid={p.invalid || undefined}
            onChange={(e) => set('sortOrder', e.target.value)}
            data-testid="festival-input-sortOrder"
          />
        )}
      </Field>
      <div className="field admin-festival-visible">
        <Switch checked={draft.active} onChange={(v) => set('active', v)} label={draft.kind === 'national' ? 'List it on STAR Prep' : 'Show in festival pickers'} testId="festival-input-active" />
      </div>
      {formError && (
        <p className="field-error span-2" role="alert" data-testid="festival-form-error">
          {formError}
        </p>
      )}
      <div className="admin-festival-form-actions span-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy} data-testid="festival-save">
          {busy && <span className="spinner" aria-hidden="true" />}
          {original ? 'Save changes' : 'Add festival'}
        </button>
      </div>
    </form>
  );
}

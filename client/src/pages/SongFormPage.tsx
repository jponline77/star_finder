/**
 * Add a song "/add" and edit a song "/songs/:id/edit" (SPEC §7.5). Both routes are inside
 * <RequireAuth>. The edit route shows a friendly locked state unless canEdit(user, song).
 *
 * Flow: Solo/Duet → show combobox (existing shows or "➕ Add new show", with optional
 * "✨ Fetch info from Wikipedia") → title → characters + vocal ranges → genre / mood / mature →
 * length (m:ss, live 6:00 bar) → "🔎 Find a 30-sec preview" (iTunes), audio link, audio upload →
 * notes. Submit → (POST /api/shows first when the new show has details) → POST/PUT /api/songs →
 * optional audio upload → upsertSong → confetti → /songs/:id.
 *
 * data-testids: add-song-form, submit-song, song-kind-solo/duet, song-show (+ ShowCombobox ids),
 * song-title, part-N-character, part-N-range, song-genre, song-genre-other, song-subgenre,
 * subgenre-chip, song-length, song-mature, song-notes, song-audio-link, song-audio-file,
 * find-preview, use-preview-<i>, remove-preview, form-error-summary, duplicate-song,
 * edit-locked, remove-upload, leave-confirm.
 */
import { ArrowLeft, FileAudio, Music2, Save, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { createShow, createSong, deleteSongAudio, errorMessage, isApiError, updateSong, uploadSongAudio } from '../api';
import { AddedBy } from '../components/Ownership';
import { fireConfetti } from '../components/Confetti';
import { Field, SegmentedControl, Switch } from '../components/Controls';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { PlayButton } from '../components/PlayButton';
import { Skeleton } from '../components/Skeletons';
import { TimeLimitBar } from '../components/TimeLimitBar';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { formatBytes, parseLength } from '../lib/format';
import { clearDraft, readDraft, saveDraft } from '../lib/drafts';
import { songPath } from '../lib/links';
import { compareText, equalsLoose, normalizeText } from '../lib/normalize';
import { canEdit } from '../lib/permissions';
import { initials } from '../lib/hash';
import { GENRES, RANGE_INFO, isVocalRange, normalizeVocalRange, rangeSlug, subGenreEmoji, VOCAL_RANGES } from '../lib/vocab';
import { useAuth, useKeepDraftOnSessionEnd } from '../state/AuthProvider';
import { useSong, useSongs } from '../state/SongsProvider';
import { useToast } from '../state/ToastProvider';
import type { Kind, Song } from '../types';
import { FormPreviewCard } from './song-form/FormPreviewCard';
import {
  AUDIO_ACCEPT,
  CHARACTER_MAX,
  EMPTY_NEW_SHOW,
  NOTES_MAX,
  OTHER_GENRE,
  domIdFor,
  effectiveGenre,
  emptyValues,
  hasNewShowDetails,
  mapServerDetails,
  newShowDetailsForName,
  matchShow,
  orderedErrors,
  previewFromSong,
  snapshot,
  toSongInput,
  validateAudioFile,
  validateSongForm,
  valuesFromSong,
  withKind,
  type ChosenPreview,
  type FieldErrors,
  type NewShowDetails,
  type PartValues,
  type SongFormValues,
} from './song-form/model';
import { NewShowPanel } from './song-form/NewShowPanel';
import { PreviewFinder } from './song-form/PreviewFinder';
import { filterShows, ShowCombobox, type ShowOption } from './song-form/ShowCombobox';
import { useUnsavedChangesGuard } from './song-form/useUnsavedChangesGuard';
import './SongFormPage.css';

export default function SongFormPage() {
  const { id } = useParams();
  return id === undefined ? <SongForm mode="add" /> : <EditSongRoute id={id} />;
}

// ============================================================================ edit route
function EditSongRoute({ id }: { id: string }) {
  const { user } = useAuth();
  const { song, loading, notFound, error, reload } = useSong(id);
  useDocumentTitle(song ? `Edit “${song.title}”` : 'Edit song');

  if (notFound) {
    return (
      <div className="container-narrow song-form-page">
        <h1 className="visually-hidden">Edit song</h1>
        <EmptyState
          emoji="🕵️"
          title="We can’t find that song"
          actions={
            <Link to="/songs" className="btn btn-primary">
              Browse songs
            </Link>
          }
        >
          <p>It may have been removed, or the link is mistyped.</p>
        </EmptyState>
      </div>
    );
  }
  if (error && !song) {
    return (
      <div className="container-narrow song-form-page">
        <h1 className="visually-hidden">Edit song</h1>
        <ErrorState onRetry={() => void reload()} />
      </div>
    );
  }
  if (loading || !song) return <FormSkeleton />;
  if (!canEdit(user, song)) return <EditLocked song={song} />;
  return <SongForm mode="edit" song={song} />;
}

function EditLocked({ song }: { song: Song }) {
  const spreadsheet = song.source === 'spreadsheet';
  return (
    <div className="container-narrow song-form-page" data-testid="edit-locked">
      <h1 className="visually-hidden">Edit “{song.title}”</h1>
      <EmptyState
        emoji="🔒"
        title="You can only edit songs you added"
        actions={
          <>
            <Link to={songPath(song.id)} className="btn btn-primary">
              <ArrowLeft size={18} aria-hidden="true" /> Back to the song
            </Link>
            <Link to="/add" className="btn btn-ghost">
              Add a different song
            </Link>
          </>
        }
      >
        {spreadsheet ? (
          <p>
            <strong>“{song.title}”</strong> comes from the official STAR spreadsheet, so only admins can change it. Spotted a mistake? Leave a comment on the song page and an admin will fix it.
          </p>
        ) : (
          <p>
            <strong>“{song.title}”</strong> was added by {song.createdBy?.displayName ?? 'another member'}. If something looks wrong, leave a comment on the song so they (or an admin) can fix it.
          </p>
        )}
      </EmptyState>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="container song-form-page" role="status" aria-live="polite">
      <span className="visually-hidden">Loading the song…</span>
      <div className="stack">
        <Skeleton height={16} width={120} />
        <Skeleton height={48} width="60%" radius={10} />
        <Skeleton height={220} radius={18} />
        <Skeleton height={180} radius={18} />
      </div>
    </div>
  );
}

// ============================================================================ the form
interface SongFormProps {
  mode: 'add' | 'edit';
  song?: Song;
}

interface Duplicate {
  id: number;
  title: string;
}

/** What survives a session ending mid-edit (lib/drafts). A chosen audio File can't be kept. */
interface SongFormDraft {
  values: SongFormValues;
  isNewShow: boolean;
  newShow: NewShowDetails;
  createdShows: ShowOption[];
  preview: ChosenPreview | null;
  previewDirty: boolean;
  removeUpload: boolean;
  hadAudioFile: boolean;
}

function SongForm({ mode, song }: SongFormProps) {
  const isEdit = mode === 'edit' && song !== undefined;
  useDocumentTitle(isEdit ? `Edit “${song.title}”` : 'Add a song');
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { songs, meta, loading: songsLoading, upsertSong, reload } = useSongs();
  const [params] = useSearchParams();
  const isDesktop = useIsDesktop();
  const formId = useId();

  const genreList = useMemo(() => {
    const extra = (meta?.genres ?? []).filter((g) => !(GENRES as readonly string[]).includes(g)).sort(compareText);
    return [...GENRES, ...extra];
  }, [meta]);

  // ---------------------------------------------------------------- state
  const draftKey = isEdit ? `song-form:edit:${song.id}` : 'song-form:add';
  // Work saved when the session ended mid-edit (see useKeepDraftOnSessionEnd below).
  const [restored] = useState(() => (user ? readDraft<SongFormDraft>(draftKey, user.id) : null));
  const [pristine] = useState<SongFormValues>(() => {
    if (song) return valuesFromSong(song, [...GENRES, ...(meta?.genres ?? [])]);
    return emptyValues(params.get('kind') === 'duet' ? 'duet' : 'solo');
  });
  const [values, setValues] = useState<SongFormValues>(() => restored?.values ?? pristine);
  const initial = useRef(snapshot(pristine));
  const part2Stash = useRef<PartValues | null>(null);
  const [isNewShow, setIsNewShow] = useState(() => restored?.isNewShow ?? false);
  const [newShow, setNewShow] = useState<NewShowDetails>(() => restored?.newShow ?? EMPTY_NEW_SHOW);
  const [createdShows, setCreatedShows] = useState<ShowOption[]>(() => restored?.createdShows ?? []);
  const [preview, setPreview] = useState<ChosenPreview | null>(() => (restored ? restored.preview : song ? previewFromSong(song) : null));
  const [previewDirty, setPreviewDirty] = useState(() => restored?.previewDirty ?? false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [removeUpload, setRemoveUpload] = useState(() => restored?.removeUpload ?? false);
  const [autoRange, setAutoRange] = useState<[boolean, boolean]>([false, false]);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The guard is off while saving, so the user can leave during a long upload; the submit keeps
  // running after unmount and must not navigate them back when it finishes.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------- shows for the combobox
  const showOptions = useMemo<ShowOption[]>(() => {
    const byId = new Map<number, ShowOption>();
    for (const s of meta?.shows ?? []) byId.set(s.id, { id: s.id, name: s.name, slug: s.slug, imageUrl: null, songCount: 0 });
    for (const s of songs) {
      const o = byId.get(s.show.id) ?? { id: s.show.id, name: s.show.name, slug: s.show.slug, imageUrl: null, songCount: 0 };
      o.imageUrl = o.imageUrl ?? s.show.imageUrl;
      o.songCount += 1;
      byId.set(o.id, o);
    }
    for (const s of createdShows) if (!byId.has(s.id)) byId.set(s.id, s);
    if (song && !byId.has(song.show.id)) byId.set(song.show.id, { ...song.show, songCount: 1 });
    return [...byId.values()];
  }, [meta, songs, createdShows, song]);

  // ?show=<slug> pre-selects a show on /add (e.g. from a show page) — not over a restored draft
  const prefilledShow = useRef(restored !== null);
  useEffect(() => {
    if (isEdit || prefilledShow.current) return;
    const slug = params.get('show');
    if (!slug) {
      prefilledShow.current = true;
      return;
    }
    const match = showOptions.find((s) => s.slug === slug);
    if (match) {
      prefilledShow.current = true;
      setValues((v) => {
        const next = { ...v, showId: match.id, showText: match.name };
        initial.current = snapshot(next);
        return next;
      });
    } else if (!songsLoading && meta) {
      prefilledShow.current = true;
    }
  }, [isEdit, params, showOptions, songsLoading, meta]);

  const selectedShow = values.showId !== null ? (showOptions.find((s) => s.id === values.showId) ?? null) : null;
  const showName = selectedShow?.name ?? values.showText.trim();
  const creatingShow = values.showId === null && values.showText.trim() !== '';

  // characters already known for the chosen show → suggestions + range auto-fill
  const characterInfo = useMemo(() => {
    const map = new Map<string, { name: string; ranges: Set<string> }>();
    if (values.showId === null) return map;
    for (const s of songs) {
      if (s.show.id !== values.showId || (song && s.id === song.id)) continue;
      for (const p of s.parts) {
        const key = normalizeText(p.character);
        const entry = map.get(key) ?? { name: p.character, ranges: new Set<string>() };
        if (p.vocalRange && isVocalRange(p.vocalRange)) entry.ranges.add(p.vocalRange);
        map.set(key, entry);
      }
    }
    return map;
  }, [songs, values.showId, song]);
  const characterNames = useMemo(() => [...characterInfo.values()].map((c) => c.name).sort(compareText), [characterInfo]);

  const genre = effectiveGenre(values);
  const subGenreOptions = useMemo(() => {
    const all = [...(meta?.subGenres ?? [])].sort((a, b) => b.count - a.count || compareText(a.name, b.name));
    if (!genre) return all;
    const same = all.filter((s) => s.genre && equalsLoose(s.genre, genre));
    return same.length ? same : all;
  }, [meta, genre]);

  const lengthSeconds = parseLength(values.length);
  const newShowForValidation = creatingShow && hasNewShowDetails(newShow) ? newShow : null;
  const clientErrors = validateSongForm(values, { audioFile, newShow: newShowForValidation });

  const errorFor = (key: string): string | undefined => serverErrors[key] ?? (showAll || touched.has(key) ? clientErrors[key] : undefined);
  const visibleErrors: FieldErrors = {};
  for (const key of new Set([...Object.keys(serverErrors), ...Object.keys(clientErrors)])) {
    const msg = errorFor(key);
    if (msg && key !== '_form') visibleErrors[key] = msg;
  }

  const dirty =
    snapshot(values) !== initial.current || previewDirty || audioFile !== null || removeUpload || hasNewShowDetails(newShow);
  const { blocker, allowNavigation } = useUnsavedChangesGuard(dirty && !submitting);

  // Session ended mid-edit → AuthProvider sends them to /login; keep what they typed for when
  // they come back (this tab only, this account only).
  useKeepDraftOnSessionEnd((userId) => {
    if (!dirty) return false;
    const draft: SongFormDraft = { values, isNewShow, newShow, createdShows, preview, previewDirty, removeUpload, hadAudioFile: audioFile !== null };
    return saveDraft(draftKey, userId, draft);
  });
  const restoredNotice = useRef(false);
  useEffect(() => {
    clearDraft(draftKey);
    if (!restored || restoredNotice.current) return;
    restoredNotice.current = true;
    toast.info(
      restored.hadAudioFile ? 'Welcome back! We restored what you typed — please choose your audio file again.' : 'Welcome back! We restored what you typed.',
      { id: 'draft-restored', emoji: '📝' },
    );
  }, [draftKey, restored, toast]);

  // ---------------------------------------------------------------- updaters
  const touch = (key: string) =>
    setTouched((t) => {
      if (t.has(key)) return t;
      const n = new Set(t);
      n.add(key);
      return n;
    });

  const clearServer = (...keys: string[]) =>
    setServerErrors((e) => {
      if (!keys.some((k) => k in e)) return e;
      const n = { ...e };
      for (const k of keys) delete n[k];
      return n;
    });

  const update = (patch: Partial<SongFormValues>, ...errorKeys: string[]) => {
    setValues((v) => ({ ...v, ...patch }));
    if (errorKeys.length) clearServer(...errorKeys);
  };

  const setKind = (kind: Kind) => {
    setValues((v) => {
      if (v.kind === kind) return v;
      if (kind === 'solo' && v.parts[1] && (v.parts[1].character || v.parts[1].vocalRange)) part2Stash.current = v.parts[1];
      return withKind(v, kind, kind === 'duet' ? part2Stash.current : null);
    });
    clearServer('parts', 'kind', 'parts.1.character', 'parts.1.vocalRange');
    if (kind === 'solo') setAutoRange(([a]) => [a, false]);
  };

  const setPart = (index: number, patch: Partial<PartValues>) => {
    setValues((v) => ({ ...v, parts: v.parts.map((p, i) => (i === index ? { ...p, ...patch } : p)) }));
    clearServer(`parts.${index}.character`, `parts.${index}.vocalRange`, 'parts');
  };

  const onCharacterChange = (index: number, character: string) => {
    const part = values.parts[index];
    const known = characterInfo.get(normalizeText(character));
    if (part && known && known.ranges.size === 1 && (!part.vocalRange || autoRange[index])) {
      setPart(index, { character, vocalRange: [...known.ranges][0] ?? '' });
      setAutoRange((a) => (index === 0 ? [true, a[1]] : [a[0], true]));
    } else {
      setPart(index, { character });
    }
  };

  const onShowText = (text: string) => {
    setValues((v) => ({ ...v, showText: text, showId: null }));
    setNewShow((ns) => newShowDetailsForName(ns, text.trim()));
    setIsNewShow(false);
    clearServer('show');
    setDuplicate(null);
  };

  const onSelectExisting = (show: ShowOption) => {
    setValues((v) => ({ ...v, showText: show.name, showId: show.id }));
    setNewShow((ns) => newShowDetailsForName(ns, show.name));
    setIsNewShow(false);
    clearServer('show');
    setDuplicate(null);
  };

  const onSelectNew = (name: string) => {
    setValues((v) => ({ ...v, showText: name, showId: null }));
    setNewShow((ns) => newShowDetailsForName(ns, name.trim()));
    setIsNewShow(true);
    clearServer('show');
    setDuplicate(null);
    touch('show');
  };

  const onLengthBlur = () => {
    const t = values.length.trim();
    // friendly auto-format: "325" → "3:25", "1205" → "12:05"
    if (/^\d{3,4}$/.test(t)) {
      const mm = t.slice(0, -2);
      const ss = t.slice(-2);
      if (Number(ss) < 60) update({ length: `${Number(mm)}:${ss}` }, 'length');
    }
    touch('length');
  };

  // ---------------------------------------------------------------- submit
  const focusFirst = (errors: FieldErrors) => {
    const [first] = orderedErrors(errors);
    if (!first) return;
    const domId = domIdFor(first[0]) ?? 'song-title';
    requestAnimationFrame(() => {
      const el = document.getElementById(domId);
      if (el) {
        el.focus();
        el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      }
    });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setShowAll(true);
    setFormError(null);
    setDuplicate(null);

    // Typed a show name that already exists? Use the existing show.
    let showId = values.showId;
    let current = values;
    if (showId === null) {
      const match = matchShow(values.showText, showOptions);
      if (match) {
        showId = match.id;
        current = { ...values, showId: match.id, showText: match.name };
        setValues(current);
        setIsNewShow(false);
      }
    }
    const needsShowFirst = showId === null && current.showText.trim() !== '' && hasNewShowDetails(newShow);
    const errs = validateSongForm(current, { audioFile, newShow: needsShowFirst ? newShow : null });
    if (Object.keys(errs).length) {
      setServerErrors({});
      focusFirst(errs);
      return;
    }

    setSubmitting(true);
    try {
      // 1) a brand-new show with details → create it first (POST /api/shows)
      if (needsShowFirst) {
        const body = {
          name: current.showText.trim(),
          composer: newShow.composer.trim() || null,
          lyricist: newShow.lyricist.trim() || null,
          year: newShow.year.trim() ? Number(newShow.year.trim()) : null,
          description: newShow.description.trim() || null,
          wikiUrl: newShow.wikiUrl,
          ...(newShow.imageUrl && newShow.useImage ? { imageUrl: newShow.imageUrl } : {}),
        };
        let created: { id: number; name: string; slug: string; imageUrl: string | null } | null = null;
        try {
          created = await createShow(body);
        } catch (err) {
          if (isApiError(err) && err.status === 409 && err.details.existingId) {
            created = { id: Number(err.details.existingId), name: body.name, slug: '', imageUrl: null };
          } else if (isApiError(err) && err.status === 400 && err.details.imageUrl && Object.keys(err.details).length === 1) {
            // The poster couldn't be downloaded — add the show without it.
            const { imageUrl: _drop, ...rest } = body as typeof body & { imageUrl?: string };
            void _drop;
            created = await createShow(rest);
            toast.warning('We couldn’t download the Wikipedia poster — you can add one later on the show page.');
          } else if (isApiError(err) && err.status === 400) {
            const mapped = mapServerDetails(err.details, 'newShow.');
            setServerErrors(mapped);
            if (mapped._form) setFormError(mapped._form);
            focusFirst(mapped);
            return;
          } else {
            throw err;
          }
        }
        if (created) {
          const option: ShowOption = { id: created.id, name: created.name, slug: created.slug, imageUrl: created.imageUrl, songCount: 0 };
          setCreatedShows((list) => [...list.filter((s) => s.id !== option.id), option]);
          showId = created.id;
          current = { ...current, showId: created.id, showText: created.name };
          setValues(current);
          setIsNewShow(false);
          setNewShow(EMPTY_NEW_SHOW);
        }
      }

      // 2) the song
      const previewPayload = isEdit ? (previewDirty ? (preview?.input ?? null) : undefined) : (preview?.input ?? undefined);
      const input = toSongInput(current, { showId, preview: previewPayload });
      let saved: Song;
      try {
        saved = isEdit ? await updateSong(song.id, input) : await createSong(input);
      } catch (err) {
        if (isApiError(err)) {
          if (err.status === 409) {
            const existingId = Number(err.details.existingId);
            if (Number.isFinite(existingId) && existingId > 0) {
              setDuplicate({ id: existingId, title: songs.find((s) => s.id === existingId)?.title ?? current.title.trim() });
              requestAnimationFrame(() => document.getElementById('duplicate-song')?.focus());
            } else {
              setFormError(err.message);
            }
            return;
          }
          if (err.status === 400) {
            const mapped = mapServerDetails(err.details);
            setServerErrors(mapped);
            setFormError(mapped._form ?? (Object.keys(mapped).length ? null : err.message));
            focusFirst(mapped);
            return;
          }
          if (err.status === 401) return; // AuthProvider sends them to /login
          if (err.status === 403) {
            setFormError(err.message);
            return;
          }
        }
        throw err;
      }

      // 3) audio file changes (after the song exists)
      if (audioFile) {
        try {
          setUploadProgress(0);
          saved = await uploadSongAudio(saved.id, audioFile, { onProgress: setUploadProgress });
        } catch (err) {
          toast.warning(`Your song was saved, but the audio upload didn’t work: ${errorMessage(err)}`, { duration: 8000 });
        }
      } else if (removeUpload && saved.media.audioUrl) {
        try {
          saved = await deleteSongAudio(saved.id);
        } catch (err) {
          toast.warning(`Saved, but we couldn’t remove the uploaded audio: ${errorMessage(err)}`);
        }
      }

      upsertSong(saved);
      // A new show / genre / mood changes the shared lists — refresh them in the background.
      if (showId === null || !isEdit || saved.show.id !== song?.show.id) void reload();
      clearDraft(draftKey);
      if (!mountedRef.current) {
        // They moved on while we were saving — confirm quietly instead of pulling them back.
        const savedId = saved.id;
        toast.success(`“${saved.title}” is saved${isEdit ? '' : ' and on the list'}.`, {
          title: isEdit ? 'Encore!' : 'Bravo!',
          emoji: '🎉',
          action: { label: 'View song', onClick: () => navigate(songPath(savedId)) },
        });
        return;
      }
      allowNavigation();
      fireConfetti();
      toast.success(isEdit ? `Your changes to “${saved.title}” are live.` : `“${saved.title}” is now on the list — thanks for sharing!`, {
        title: isEdit ? 'Encore!' : 'Bravo!',
        emoji: '🎉',
      });
      navigate(songPath(saved.id));
    } catch (err) {
      if (isApiError(err) && err.status === 401) return; // AuthProvider saved a draft and sends them to /login
      setFormError(errorMessage(err));
      toast.error(err);
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  // ---------------------------------------------------------------- derived UI bits
  const checklist = [
    { label: 'Title', done: values.title.trim() !== '' },
    { label: 'Show', done: showName !== '' },
    { label: values.kind === 'duet' ? 'Both characters' : 'Character', done: values.parts.every((p) => p.character.trim() !== '') },
  ];
  const previewArt = preview?.input.artworkUrl ?? selectedShow?.imageUrl ?? (creatingShow && newShow.useImage ? newShow.imageUrl : null);
  const previewCard = (
    <FormPreviewCard
      kind={values.kind}
      title={values.title}
      showName={showName}
      artworkUrl={previewArt}
      parts={values.parts}
      genre={genre}
      subGenre={values.subGenre.trim()}
      lengthSeconds={lengthSeconds}
      mature={values.mature}
      audioBadge={preview ? '▶ 0:30' : audioFile || (song?.media.audioUrl && !removeUpload) ? '▶ Audio' : values.audioLink.trim() ? '🔗 Link' : null}
      checklist={checklist}
      compact={!isDesktop}
    />
  );
  const summary = showAll ? orderedErrors(visibleErrors) : [];
  const suggestions = creatingShow && isNewShow ? filterShows(showOptions, values.showText).slice(0, 3) : [];
  const existingUpload = isEdit ? song.media.audioUrl : null;
  const cancelTo = isEdit ? songPath(song.id) : '/songs';
  const submitLabel = submitting
    ? uploadProgress !== null
      ? `Uploading audio… ${Math.round(uploadProgress * 100)}%`
      : 'Saving…'
    : isEdit
      ? 'Save changes'
      : 'Add to the songbook';

  return (
    <div className="container song-form-page">
      <header className="page-header song-form-header">
        <div>
          <Link to={cancelTo} className="back-link">
            <ArrowLeft size={16} aria-hidden="true" /> {isEdit ? 'Back to the song' : 'Back to all songs'}
          </Link>
          <p className="eyebrow">{isEdit ? 'Edit song' : 'Join the songbook'}</p>
          <h1 className="page-title">{isEdit ? <>Edit “{song.title}”</> : 'Add a song'}</h1>
          <p className="page-subtitle">
            {isEdit ? (
              <>Update the details, then save — your changes show up for everyone right away.</>
            ) : (
              <>
                Know a great solo or duet for STAR? Add it for everyone{user ? `, ${user.displayName}` : ''} — it takes about a minute.
              </>
            )}
          </p>
          {isEdit && (
            <p className="song-form-owner">
              <AddedBy item={song} />
            </p>
          )}
        </div>
      </header>

      <div className="song-form-layout">
        <form id={formId} className="song-form" onSubmit={onSubmit} noValidate data-testid="add-song-form" aria-describedby={summary.length ? 'form-error-summary' : undefined}>
          {summary.length > 0 && (
            <div className="callout callout-danger form-error-summary" id="form-error-summary" role="alert" data-testid="form-error-summary">
              <span className="emoji" aria-hidden="true">
                🎬
              </span>
              <div>
                <p className="form-error-summary-title">Almost there! Fix {summary.length === 1 ? 'this' : `these ${summary.length} things`} and try again:</p>
                <ul>
                  {summary.map(([key, msg]) => (
                    <li key={key}>
                      <a
                        href={`#${domIdFor(key) ?? 'song-title'}`}
                        onClick={(ev) => {
                          ev.preventDefault();
                          document.getElementById(domIdFor(key) ?? 'song-title')?.focus();
                        }}
                      >
                        {msg}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {formError && (
            <p className="callout callout-danger" role="alert" data-testid="form-error">
              {formError}
            </p>
          )}

          {/* ------------------------------------------------ Act 1: the song */}
          <FormAct num={1} title="The song" emoji="🎼" id="act-song">
            <div className="field">
              <span className="label" id="kind-label">
                Solo or duet?
              </span>
              <SegmentedControl<Kind>
                label="Solo or duet"
                value={values.kind}
                onChange={setKind}
                className="kind-toggle"
                options={[
                  { value: 'solo', label: <KindLabel emoji="🎤" text="Solo" sub="1 character" />, testId: 'song-kind-solo' },
                  { value: 'duet', label: <KindLabel emoji="👯" text="Duet" sub="2 characters" />, testId: 'song-kind-duet' },
                ]}
              />
              <p className="hint">STAR: a solo is written for one character; a duet has vocal parts for two characters.</p>
            </div>

            <Field
              label="Show"
              id="song-show"
              error={errorFor('show')}
              hint={
                selectedShow ? (
                  <span className="show-picked">
                    <span className="emoji" aria-hidden="true">
                      🎭
                    </span>{' '}
                    On the list already — {selectedShow.songCount ? `${selectedShow.songCount} song${selectedShow.songCount === 1 ? '' : 's'} so far` : 'no songs yet'}.
                  </span>
                ) : (
                  'Pick from the list, or type the name of a musical that isn’t here yet.'
                )
              }
            >
              {(p) => (
                <ShowCombobox
                  id={p.id}
                  shows={showOptions}
                  text={values.showText}
                  selectedId={values.showId}
                  onTextChange={onShowText}
                  onSelectExisting={onSelectExisting}
                  onSelectNew={onSelectNew}
                  describedBy={p.describedBy}
                  invalid={p.invalid}
                  loading={songsLoading && showOptions.length === 0}
                />
              )}
            </Field>

            {creatingShow && isNewShow && (
              <NewShowPanel
                name={values.showText.trim()}
                value={newShow}
                onChange={(next) => {
                  setNewShow(next);
                  clearServer('newShow.composer', 'newShow.lyricist', 'newShow.year', 'newShow.description', 'newShow.imageUrl');
                }}
                errors={visibleErrors}
                suggestions={suggestions}
                onPickSuggestion={onSelectExisting}
              />
            )}

            <Field label="Song title" id="song-title" error={errorFor('title')} hint="As it appears in the score or cast album, e.g. “Defying Gravity”.">
              {(p) => (
                <input
                  className="input input-lg"
                  id={p.id}
                  aria-describedby={p.describedBy}
                  aria-invalid={p.invalid || undefined}
                  value={values.title}
                  onChange={(e) => {
                    update({ title: e.target.value }, 'title');
                    setDuplicate(null);
                  }}
                  onBlur={() => touch('title')}
                  maxLength={140}
                  autoComplete="off"
                  required
                  data-testid="song-title"
                />
              )}
            </Field>

            {duplicate && (
              <div className="callout callout-warning duplicate-callout" id="duplicate-song" tabIndex={-1} role="alert" data-testid="duplicate-song">
                <span className="emoji" aria-hidden="true">
                  👯
                </span>
                <div>
                  <p>
                    <strong>Great minds think alike!</strong> “{duplicate.title}” from {showName} is already on the list as a {values.kind}.
                  </p>
                  <p>
                    <Link to={songPath(duplicate.id)} onClick={() => allowNavigation()}>
                      See the existing song →
                    </Link>{' '}
                    <span className="muted">You can leave a tip in its comments instead.</span>
                  </p>
                </div>
              </div>
            )}
          </FormAct>

          {/* ------------------------------------------------ Act 2: who sings it */}
          <FormAct num={2} title={values.kind === 'duet' ? 'Who sings it? (both parts)' : 'Who sings it?'} emoji="🎭" id="act-cast">
            {errorFor('parts') && (
              <p className="field-error" role="alert">
                {errorFor('parts')}
              </p>
            )}
            <div className={`parts-grid${values.kind === 'duet' ? ' is-duet' : ''}`}>
              {values.parts.map((part, i) => (
                <PartEditor
                  key={i}
                  index={i}
                  kind={values.kind}
                  part={part}
                  names={characterNames}
                  autoFilled={autoRange[i] ?? false}
                  characterError={errorFor(`parts.${i}.character`)}
                  rangeError={errorFor(`parts.${i}.vocalRange`)}
                  onCharacter={(c) => onCharacterChange(i, c)}
                  onRange={(r) => {
                    setPart(i, { vocalRange: r });
                    setAutoRange((a) => (i === 0 ? [false, a[1]] : [a[0], false]));
                  }}
                  onBlur={() => touch(`parts.${i}.character`)}
                />
              ))}
            </div>
          </FormAct>

          {/* ------------------------------------------------ Act 3: the vibe */}
          <FormAct num={3} title="The vibe" emoji="✨" id="act-vibe">
            <div className="form-row">
              <Field label="Genre" optional id="song-genre" error={errorFor('genre')}>
                {(p) => (
                  <select
                    className="select"
                    id={p.id}
                    aria-describedby={p.describedBy}
                    aria-invalid={p.invalid || undefined}
                    value={values.genreChoice}
                    onChange={(e) => update({ genreChoice: e.target.value }, 'genre')}
                    data-testid="song-genre"
                  >
                    <option value="">— Pick a genre —</option>
                    {genreList.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                    <option value={OTHER_GENRE}>Other…</option>
                  </select>
                )}
              </Field>
              {values.genreChoice === OTHER_GENRE && (
                <Field label="Your genre" id="song-genre-other">
                  {(p) => (
                    <input
                      className="input"
                      id={p.id}
                      aria-describedby={p.describedBy}
                      value={values.genreOther}
                      onChange={(e) => update({ genreOther: e.target.value }, 'genre')}
                      maxLength={50}
                      placeholder="e.g. Tragedy"
                      autoComplete="off"
                      data-testid="song-genre-other"
                    />
                  )}
                </Field>
              )}
            </div>

            <Field
              label="Mood (sub-genre)"
              optional
              id="song-subgenre"
              error={errorFor('subGenre')}
              hint={genre ? `Moods other ${genre.toLowerCase()} songs use — tap one or type your own.` : 'Tap a mood or type your own.'}
            >
              {(p) => (
                <>
                  <input
                    className="input"
                    id={p.id}
                    aria-describedby={p.describedBy}
                    aria-invalid={p.invalid || undefined}
                    list="song-subgenre-options"
                    value={values.subGenre}
                    onChange={(e) => update({ subGenre: e.target.value }, 'subGenre')}
                    onBlur={() => touch('subGenre')}
                    maxLength={50}
                    placeholder="e.g. Longing"
                    autoComplete="off"
                    data-testid="song-subgenre"
                  />
                  <datalist id="song-subgenre-options">
                    {subGenreOptions.map((s) => (
                      <option key={s.name} value={s.name} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            {subGenreOptions.length > 0 && (
              <ul className="chip-group mood-chips" role="list" aria-label="Suggested moods">
                {subGenreOptions.slice(0, 10).map((s) => {
                  const on = equalsLoose(values.subGenre, s.name);
                  return (
                    <li key={s.name}>
                      <button
                        type="button"
                        className="chip"
                        aria-pressed={on}
                        onClick={() => update({ subGenre: on ? '' : s.name }, 'subGenre')}
                        data-testid="subgenre-chip"
                      >
                        <span className="emoji" aria-hidden="true">
                          {subGenreEmoji(s.name)}
                        </span>
                        {s.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mature-row">
              <Switch checked={values.mature} onChange={(mature) => update({ mature })} label={<strong>Mature themes</strong>} testId="song-mature" id="song-mature" />
              <p className="hint">Strong language, violence or adult content? Flag it so students and teachers can filter it.</p>
            </div>
          </FormAct>

          {/* ------------------------------------------------ Act 4: timing */}
          <FormAct num={4} title="Timing" emoji="⏱️" id="act-timing">
            <div className="timing-row">
              <Field label="Length" optional id="song-length" error={errorFor('length')} hint="m:ss — e.g. 3:25" className="length-field">
                {(p) => (
                  <input
                    className="input length-input"
                    id={p.id}
                    aria-describedby={p.describedBy}
                    aria-invalid={p.invalid || undefined}
                    value={values.length}
                    onChange={(e) => {
                      const v = e.target.value;
                      update({ length: v }, 'length');
                      if (/:\d\d$/.test(v.trim())) touch('length');
                    }}
                    onBlur={onLengthBlur}
                    inputMode="text"
                    placeholder="m:ss"
                    maxLength={6}
                    autoComplete="off"
                    data-testid="song-length"
                  />
                )}
              </Field>
              <div className="timing-bar">
                <TimeLimitBar seconds={clientErrors.length ? null : lengthSeconds} />
                <p className="hint">STAR’s limit is 6:00 (timing starts after your slate). Over 6:00? You’ll need a cut — note it below.</p>
              </div>
            </div>
          </FormAct>

          {/* ------------------------------------------------ Act 5: hear it */}
          <FormAct num={5} title="Hear it" emoji="🎧" id="act-audio" subtitle="All optional — but a preview helps everyone decide faster.">
            <div className="audio-block">
              <h3 className="audio-block-title">
                <Music2 size={18} aria-hidden="true" /> 30-second preview
              </h3>
              <PreviewFinder
                title={values.title}
                showName={showName}
                chosen={preview}
                onChoose={(p) => {
                  setPreview(p);
                  setPreviewDirty(true);
                  clearServer('preview');
                }}
                onRemove={() => {
                  setPreview(null);
                  setPreviewDirty(true);
                  clearServer('preview');
                }}
                lengthSeconds={lengthSeconds}
                onUseLength={(secs) => update({ length: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` }, 'length')}
                error={errorFor('preview')}
              />
            </div>

            <Field label="Link to a recording" optional id="song-audio-link" error={errorFor('audioLink')} hint="YouTube, Spotify or any https:// link — opens in a new tab.">
              {(p) => (
                <input
                  className="input"
                  id={p.id}
                  type="url"
                  inputMode="url"
                  aria-describedby={p.describedBy}
                  aria-invalid={p.invalid || undefined}
                  value={values.audioLink}
                  onChange={(e) => update({ audioLink: e.target.value }, 'audioLink')}
                  onBlur={() => touch('audioLink')}
                  placeholder="https://www.youtube.com/watch?v=…"
                  maxLength={520}
                  autoComplete="off"
                  data-testid="song-audio-link"
                />
              )}
            </Field>

            <Field
              label="Upload a recording"
              optional
              id="song-audio-file"
              error={errorFor('audioFile')}
              hint="MP3, M4A, AAC, WAV, AIFF or OGG · up to 25 MB. Only share audio you’re allowed to share (like your own practice track)."
            >
              {(p) => (
                <div className="file-picker">
                  {existingUpload && !audioFile && (
                    <div className={`current-upload${removeUpload ? ' is-removed' : ''}`}>
                      <PlayButton song={song} source="upload" size="sm" />
                      <span className="current-upload-text">{removeUpload ? 'The uploaded recording will be removed when you save.' : 'A recording is uploaded for this song.'}</span>
                      <button type="button" className={`btn btn-sm ${removeUpload ? 'btn-ghost' : 'btn-danger-ghost'}`} onClick={() => setRemoveUpload((r) => !r)} data-testid="remove-upload">
                        {removeUpload ? (
                          'Keep it'
                        ) : (
                          <>
                            <Trash2 size={15} aria-hidden="true" /> Remove
                          </>
                        )}
                      </button>
                    </div>
                  )}
                  <div className="file-picker-row">
                    <input
                      ref={fileInputRef}
                      id={p.id}
                      type="file"
                      accept={AUDIO_ACCEPT}
                      className="file-input"
                      aria-describedby={p.describedBy}
                      aria-invalid={p.invalid || undefined}
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setAudioFile(f);
                        clearServer('audioFile');
                        if (f) touch('audioFile');
                      }}
                      data-testid="song-audio-file"
                    />
                    <label htmlFor={p.id} className="btn btn-ghost file-picker-button">
                      <Upload size={17} aria-hidden="true" /> {audioFile ? 'Choose a different file' : existingUpload ? 'Replace with a new file' : 'Choose an audio file'}
                    </label>
                    {audioFile && (
                      <span className={`file-chip${validateAudioFile(audioFile) ? ' is-bad' : ''}`}>
                        <FileAudio size={16} aria-hidden="true" />
                        <span className="truncate">{audioFile.name}</span>
                        <span className="subtle">{formatBytes(audioFile.size)}</span>
                        <button
                          type="button"
                          className="btn-icon btn-icon-sm"
                          aria-label={`Remove ${audioFile.name}`}
                          onClick={() => {
                            setAudioFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </Field>
          </FormAct>

          {/* ------------------------------------------------ Act 6: notes */}
          <FormAct num={6} title="Notes" emoji="📝" id="act-notes">
            <Field
              label="Notes for other students"
              optional
              id="song-notes"
              error={errorFor('notes')}
              hint={
                <span className="cluster cluster-between">
                  <span>Cuts, key changes, which version of the show it’s in, staging ideas…</span>
                  <CharCount value={values.notes} max={NOTES_MAX} />
                </span>
              }
            >
              {(p) => (
                <textarea
                  className="textarea"
                  id={p.id}
                  aria-describedby={p.describedBy}
                  aria-invalid={p.invalid || undefined}
                  value={values.notes}
                  onChange={(e) => update({ notes: e.target.value }, 'notes')}
                  onBlur={() => touch('notes')}
                  rows={4}
                  data-testid="song-notes"
                />
              )}
            </Field>
          </FormAct>

          {!isDesktop && <div className="song-form-mobile-preview">{previewCard}</div>}

          <div className="song-form-actions">
            <button type="submit" className="btn btn-primary btn-lg song-form-submit" disabled={submitting} data-testid="submit-song">
              {submitting ? <span className="spinner" aria-hidden="true" /> : isEdit ? <Save size={20} aria-hidden="true" /> : <Sparkles size={20} aria-hidden="true" />}
              {submitLabel}
            </button>
            <Link to={cancelTo} className="btn btn-ghost btn-lg">
              Cancel
            </Link>
            {uploadProgress !== null && (
              <div className="upload-progress" role="progressbar" aria-label="Uploading audio" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploadProgress * 100)}>
                <span style={{ width: `${Math.round(uploadProgress * 100)}%` }} />
              </div>
            )}
          </div>
        </form>

        {isDesktop && (
          <aside className="song-form-aside" aria-label="Live preview">
            <div className="song-form-aside-inner">{previewCard}</div>
          </aside>
        )}
      </div>

      <Modal
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Leave without saving?"
        testId="leave-confirm"
        alert
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => blocker.reset?.()} autoFocus>
              Keep editing
            </button>
            <button type="button" className="btn btn-danger" onClick={() => blocker.proceed?.()} data-testid="leave-confirm-button">
              Leave page
            </button>
          </>
        }
      >
        <p>You’ve made changes to this song that haven’t been saved yet. If you leave now, they’ll be lost.</p>
      </Modal>
    </div>
  );
}

// ============================================================================ pieces
function FormAct({ num, title, emoji, id, subtitle, children }: { num: number; title: string; emoji: string; id: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="form-act" aria-labelledby={`${id}-title`}>
      <div className="form-act-head">
        <span className="form-act-num" aria-hidden="true">
          {num}
        </span>
        <div>
          <p className="form-act-kicker" aria-hidden="true">
            Act {num}
          </p>
          <h2 id={`${id}-title`} className="form-act-title">
            <span className="visually-hidden">Act {num}: </span>
            {title}{' '}
            <span className="emoji" aria-hidden="true">
              {emoji}
            </span>
          </h2>
          {subtitle && <p className="hint">{subtitle}</p>}
        </div>
      </div>
      <div className="form-act-body">{children}</div>
    </section>
  );
}

function KindLabel({ emoji, text, sub }: { emoji: string; text: string; sub: string }) {
  return (
    <span className="kind-label">
      <span className="emoji" aria-hidden="true">
        {emoji}
      </span>
      <span className="kind-label-text">
        {text}
        <span className="kind-label-sub">{sub}</span>
      </span>
    </span>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  const n = [...value].length;
  return (
    <span className={`char-counter${n > max ? ' is-over' : n > max * 0.9 ? ' is-near' : ''}`} aria-live={n > max * 0.9 ? 'polite' : undefined}>
      {n}/{max}
    </span>
  );
}

interface PartEditorProps {
  index: number;
  kind: Kind;
  part: PartValues;
  names: string[];
  autoFilled: boolean;
  characterError?: string;
  rangeError?: string;
  onCharacter: (value: string) => void;
  onRange: (value: string) => void;
  onBlur: () => void;
}

function PartEditor({ index, kind, part, names, autoFilled, characterError, rangeError, onCharacter, onRange, onBlur }: PartEditorProps) {
  const n = index + 1;
  const listId = `part-${n}-character-options`;
  const range = normalizeVocalRange(part.vocalRange);
  const info = range ? RANGE_INFO[range] : null;
  return (
    <fieldset className={`part-card range-${rangeSlug(part.vocalRange)}`}>
      <legend className="part-card-legend">
        <span className="part-card-avatar" aria-hidden="true">
          {part.character.trim() ? initials(part.character) : n}
        </span>
        {kind === 'duet' ? `Part ${n}` : 'The character'}
      </legend>
      <Field label="Character" id={`part-${n}-character`} error={characterError} hint={names.length ? 'Pick a character from this show or type a new one.' : undefined}>
        {(p) => (
          <>
            <input
              className="input"
              id={p.id}
              aria-describedby={p.describedBy}
              aria-invalid={p.invalid || undefined}
              list={names.length ? listId : undefined}
              value={part.character}
              onChange={(e) => onCharacter(e.target.value)}
              onBlur={onBlur}
              maxLength={CHARACTER_MAX + 10}
              placeholder={kind === 'duet' ? (index === 0 ? 'e.g. Elphaba' : 'e.g. Glinda') : 'e.g. Elphaba'}
              autoComplete="off"
              data-testid={`part-${n}-character`}
            />
            {names.length > 0 && (
              <datalist id={listId}>
                {names.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            )}
          </>
        )}
      </Field>
      <Field
        label="Vocal range"
        optional
        id={`part-${n}-range`}
        error={rangeError}
        hint={autoFilled && range ? `Filled in from other songs this character sings — change it if needed.` : info ? `${info.blurb} ${info.example}` : 'Not sure? Leave it — someone can add it later.'}
      >
        {(p) => (
          <select
            className="select"
            id={p.id}
            aria-describedby={p.describedBy}
            aria-invalid={p.invalid || undefined}
            value={part.vocalRange}
            onChange={(e) => onRange(e.target.value)}
            data-testid={`part-${n}-range`}
          >
            <option value="">Not sure</option>
            {VOCAL_RANGES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </Field>
    </fieldset>
  );
}

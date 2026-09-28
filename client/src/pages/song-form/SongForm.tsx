/**
 * The song form (SPEC §7.5 + §7c) — "/add?catalogSong=<id>" (pre-filled from the catalog), "/add?manual=1"
 * (typed by hand) and "/songs/:id/edit".
 *
 * Six acts: the song (kind, show, title) → who sings it → the vibe → recording & length (RecordingPicker; the
 * chosen recording suggests the length) → notes → album art & backing track (dropzones + audio link).
 * Pre-filled fields carry a SuggestionChip (source + confidence, alternatives, Clear). Submit → (POST /api/shows
 * first when a new show has details) → POST/PUT /api/songs (+ catalogSongId) → album art upload/removal → backing
 * track upload/removal (with progress + cancel) → upsertSong → confetti → /songs/:id.
 *
 * data-testids: add-song-form, submit-song, song-kind-solo/duet, song-show (+ ShowCombobox ids), song-title,
 * part-N-character, part-N-range, song-genre, song-genre-other, song-subgenre, subgenre-chip, song-length,
 * song-mature, song-notes, song-audio-link, form-error-summary, duplicate-song, leave-confirm, catalog-banner,
 * already-on-site, kind-suggestion, kind-note, title-suggestion, show-suggestion-chip, part-N-character-suggestion,
 * part-N-range-suggestion, genre-suggestion, subgenre-suggestion, mature-suggestion, length-suggestion,
 * song-art-* (ArtworkDropzone), song-audio-* (AudioDropzone), recording ids (RecordingPicker).
 */
import { ArrowLeft, Save, Sparkles } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { createShow, createSong, deleteSongArtwork, deleteSongAudio, errorMessage, isApiError, updateSong, uploadSongArtwork, uploadSongAudio } from '../../api';
import { ArtworkTile } from '../../components/ArtworkTile';
import { CatalogCredit, RecordingListCredit } from '../../components/CatalogCredit';
import { fireConfetti } from '../../components/Confetti';
import { Field, SegmentedControl, Switch } from '../../components/Controls';
import { ArtworkDropzone, AudioDropzone, type ArtworkState, type UploadStatus } from '../../components/MediaDropzones';
import { Modal } from '../../components/Modal';
import { AddedBy } from '../../components/Ownership';
import { PlayButton } from '../../components/PlayButton';
import { RecordingPicker, type ChooseHow } from '../../components/RecordingPicker';
import { SuggestionChip, type ChipSuggestion } from '../../components/SuggestionChip';
import { TimeLimitBar } from '../../components/TimeLimitBar';
import { clearCatalogCaches } from '../../hooks/useCatalog';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { addStepKey, formatSingers, kindFitsSong, lengthText, titleWithYear } from '../../lib/catalog';
import { clearDraft, readDraft, saveDraft } from '../../lib/drafts';
import { parseLength } from '../../lib/format';
import { songPath } from '../../lib/links';
import { objectUrlFor, revokeObjectUrl } from '../../lib/media';
import { compareText, equalsLoose, normalizeText } from '../../lib/normalize';
import { artworkSourceOf, recordingArtworkOf, recordingLengthNote, type ChosenPreview } from '../../lib/recordings';
import { GENRES, KIND_LABEL, isVocalRange, subGenreEmoji } from '../../lib/vocab';
import { useAuth, useKeepDraftOnSessionEnd } from '../../state/AuthProvider';
import { useSongs } from '../../state/SongsProvider';
import { useToast } from '../../state/ToastProvider';
import type { Kind, Song } from '../../types';
import { FormPreviewCard } from './FormPreviewCard';
import { CharCount, FormAct, KindLabel, PartEditor } from './FormParts';
import {
  EMPTY_NEW_SHOW,
  NOTES_MAX,
  OTHER_GENRE,
  domIdFor,
  effectiveGenre,
  emptyValues,
  hasNewShowDetails,
  mapServerDetails,
  matchShow,
  newShowDetailsForName,
  orderedErrors,
  previewFromSong,
  snapshot,
  toSongInput,
  validateSongForm,
  valuesFromSong,
  withKind,
  type FieldErrors,
  type NewShowDetails,
  type PartValues,
  type SongFormValues,
} from './model';
import { NewShowPanel } from './NewShowPanel';
import { filterShows, ShowCombobox, type ShowOption } from './ShowCombobox';
import { genreFields, newShowFromCatalog, showMatchesCatalog, withoutCatalogCredits, type CatalogShowLink, type FormSuggestions } from './suggestions';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

export interface SongFormProps {
  mode: 'add' | 'edit';
  song?: Song;
  /** /add?catalogSong=<id>: values + suggestion chips from the catalog. */
  prefill?: { values: SongFormValues; isNewShow: boolean; newShow: NewShowDetails; suggestions: FormSuggestions } | null;
  /** /add?manual=1&catalogShow=<id>: a catalog show (not on the site yet) typed in with its credits. */
  showPrefill?: { values: SongFormValues; isNewShow: boolean; newShow: NewShowDetails; link: CatalogShowLink } | null;
  /** Where "back" goes (the catalog search or show list). */
  backTo?: string;
}

interface Duplicate {
  id: number;
  title: string;
}

/** What survives a session ending mid-edit (lib/drafts). Chosen files can't be kept. */
interface SongFormDraft {
  values: SongFormValues;
  isNewShow: boolean;
  newShow: NewShowDetails;
  createdShows: ShowOption[];
  preview: ChosenPreview | null;
  previewDirty: boolean;
  removeUpload: boolean;
  hadAudioFile: boolean;
  artRemove?: boolean;
  hadArtFile?: boolean;
}

type UploadPhase = UploadStatus & { what: 'art' | 'audio' };

export function SongForm({ mode, song, prefill = null, showPrefill = null, backTo }: SongFormProps) {
  const isEdit = mode === 'edit' && song !== undefined;
  useDocumentTitle(isEdit ? `Edit “${song.title}”` : prefill ? `Add “${prefill.values.title}”` : 'Add a song');
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { songs, meta, loading: songsLoading, upsertSong, reload } = useSongs();
  const [params] = useSearchParams();
  const isDesktop = useIsDesktop();
  const formId = useId();
  const sugg = prefill?.suggestions ?? null;
  const catalogLink: CatalogShowLink | null = sugg?.show ?? showPrefill?.link ?? null;

  const genreList = useMemo(() => {
    const extra = (meta?.genres ?? []).filter((g) => !(GENRES as readonly string[]).includes(g)).sort(compareText);
    return [...GENRES, ...extra];
  }, [meta]);

  // ---------------------------------------------------------------- state
  const draftKey = isEdit ? `song-form:edit:${song.id}` : 'song-form:add';
  const [restored] = useState(() => (user ? readDraft<SongFormDraft>(draftKey, user.id) : null));
  const [pristine] = useState<SongFormValues>(() => {
    if (song) return valuesFromSong(song, [...GENRES, ...(meta?.genres ?? [])]);
    if (prefill) return prefill.values;
    if (showPrefill) return showPrefill.values;
    return emptyValues(params.get('kind') === 'duet' ? 'duet' : 'solo');
  });
  const [values, setValues] = useState<SongFormValues>(() => restored?.values ?? pristine);
  const initial = useRef(snapshot(pristine));
  const part2Stash = useRef<PartValues | null>(null);
  const firstNewShow = prefill?.isNewShow ?? showPrefill?.isNewShow ?? false;
  const firstNewShowDetails = prefill?.newShow ?? showPrefill?.newShow ?? EMPTY_NEW_SHOW;
  const [isNewShow, setIsNewShow] = useState(() => restored?.isNewShow ?? firstNewShow);
  const [newShow, setNewShow] = useState<NewShowDetails>(() => restored?.newShow ?? firstNewShowDetails);
  const initialNewShow = useRef(snapshotShow(firstNewShowDetails));
  const [createdShows, setCreatedShows] = useState<ShowOption[]>(() => restored?.createdShows ?? []);
  const [preview, setPreview] = useState<ChosenPreview | null>(() => (restored ? restored.preview : song ? previewFromSong(song) : null));
  const [previewDirty, setPreviewDirty] = useState(() => restored?.previewDirty ?? false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [removeUpload, setRemoveUpload] = useState(() => restored?.removeUpload ?? false);
  const [artFile, setArtFile] = useState<File | null>(null);
  const [artPreviewUrl, setArtPreviewUrl] = useState<string | null>(null);
  const [artRemove, setArtRemove] = useState(() => restored?.artRemove ?? false);
  const [autoRange, setAutoRange] = useState<[boolean, boolean]>([false, false]);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [lengthSugg, setLengthSugg] = useState<ChipSuggestion<string> | null>(null);
  const [allMoods, setAllMoods] = useState(false);
  const lengthSuggRef = useRef<string | null>(null);
  const uploadCtrl = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // local preview of a chosen album-art file
  useEffect(() => {
    const url = objectUrlFor(artFile);
    setArtPreviewUrl(url);
    return () => revokeObjectUrl(url);
  }, [artFile]);

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
    if (catalogLink?.siteShowId && !byId.has(catalogLink.siteShowId)) {
      byId.set(catalogLink.siteShowId, { id: catalogLink.siteShowId, name: sugg?.showChip.value ?? catalogLink.name, slug: catalogLink.siteShowSlug ?? '', imageUrl: null, songCount: 0 });
    }
    return [...byId.values()];
  }, [meta, songs, createdShows, song, catalogLink, sugg]);

  // ?show=<slug> pre-selects a show on /add?manual=1 (e.g. from a show page) — not over a restored draft
  const prefilledShow = useRef(restored !== null || prefill !== null || showPrefill !== null);
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
  // Still the catalog song's show? (If the student picks another show, the catalog link no longer applies.)
  const catalogShowStill = catalogLink ? showMatchesCatalog(catalogLink, values, selectedShow?.name ?? null) : false;
  const catalogSongId = sugg && catalogShowStill ? sugg.catalogSongId : null;
  const editCatalogId = isEdit && song.catalogSongId && values.showId === song.show.id ? song.catalogSongId : null;
  const pickerCatalogId = catalogSongId ?? editCatalogId;

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
  const characterNames = useMemo(() => {
    const names = [...characterInfo.values()].map((c) => c.name);
    for (const chip of sugg?.characters ?? []) {
      for (const n of chip ? [chip.value, ...(chip.alternatives ?? [])] : []) if (!names.some((x) => equalsLoose(x, n))) names.push(n);
    }
    return names.sort(compareText);
  }, [characterInfo, sugg]);

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
    snapshot(values) !== initial.current ||
    previewDirty ||
    audioFile !== null ||
    removeUpload ||
    artFile !== null ||
    artRemove ||
    (hasNewShowDetails(newShow) && snapshotShow(newShow) !== initialNewShow.current);
  // The find steps live on the same path (/add?…), so compare the step too.
  const { blocker, allowNavigation } = useUnsavedChangesGuard(dirty && !submitting, addStepKey);

  useKeepDraftOnSessionEnd((userId) => {
    if (!dirty) return false;
    const draft: SongFormDraft = {
      values,
      isNewShow,
      newShow,
      createdShows,
      preview,
      previewDirty,
      removeUpload,
      hadAudioFile: audioFile !== null,
      artRemove,
      hadArtFile: artFile !== null,
    };
    return saveDraft(draftKey, userId, draft);
  });
  const restoredNotice = useRef(false);
  useEffect(() => {
    clearDraft(draftKey);
    if (!restored || restoredNotice.current) return;
    restoredNotice.current = true;
    const lost = [restored.hadAudioFile ? 'backing track' : null, restored.hadArtFile ? 'album art' : null].filter(Boolean);
    toast.info(lost.length ? `Welcome back! We restored what you typed — please choose your ${lost.join(' and ')} again.` : 'Welcome back! We restored what you typed.', {
      id: 'draft-restored',
      emoji: '📝',
    });
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

  const suggestedPart = (index: number): PartValues | null => {
    const chip = sugg?.characters[index];
    if (!chip) return null;
    return { character: chip.value, vocalRange: sugg?.ranges.get(normalizeText(chip.value))?.value ?? '' };
  };

  const setKind = (kind: Kind) => {
    setValues((v) => {
      if (v.kind === kind) return v;
      if (kind === 'solo' && v.parts[1] && (v.parts[1].character || v.parts[1].vocalRange)) part2Stash.current = v.parts[1];
      // Switching a catalog song to a duet: bring in the next singer from the song list.
      const second = part2Stash.current ?? (kind === 'duet' ? suggestedPart(1) : null);
      return withKind(v, kind, kind === 'duet' ? second : null);
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

  /** A suggested character chip: also swap in that character's range when the range was a suggestion (or empty). */
  const pickCharacter = (index: number, name: string) => {
    const part = values.parts[index];
    if (!part) return;
    const next = sugg?.ranges.get(normalizeText(name));
    const prev = sugg?.ranges.get(normalizeText(part.character));
    const rangeWasSuggested = !part.vocalRange || (prev && equalsLoose(prev.value, part.vocalRange)) || autoRange[index];
    if (next && rangeWasSuggested) setPart(index, { character: name, vocalRange: next.value });
    else if (!next && prev && rangeWasSuggested) setPart(index, { character: name, vocalRange: '' });
    else onCharacterChange(index, name);
  };

  /** When the show moves away from / back to the catalog show, drop / restore the catalog credits. */
  const syncCatalogCredits = (name: string, existing: boolean) => {
    if (!catalogLink || catalogLink.siteShowId !== null) return;
    setNewShow((ns) => {
      const base = newShowDetailsForName(ns, name.trim());
      if (!existing && equalsLoose(name, catalogLink.name)) {
        const credits = newShowFromCatalog(catalogLink);
        return { ...base, composer: base.composer || credits.composer, lyricist: base.lyricist || credits.lyricist, year: base.year || credits.year };
      }
      return withoutCatalogCredits(base, catalogLink);
    });
  };

  const onShowText = (text: string) => {
    setValues((v) => ({ ...v, showText: text, showId: null }));
    if (catalogLink && catalogLink.siteShowId === null) syncCatalogCredits(text, false);
    else setNewShow((ns) => newShowDetailsForName(ns, text.trim()));
    setIsNewShow(false);
    clearServer('show');
    setDuplicate(null);
  };

  const onSelectExisting = (show: ShowOption) => {
    setValues((v) => ({ ...v, showText: show.name, showId: show.id }));
    if (catalogLink && catalogLink.siteShowId === null) syncCatalogCredits(show.name, true);
    else setNewShow((ns) => newShowDetailsForName(ns, show.name));
    setIsNewShow(false);
    clearServer('show');
    setDuplicate(null);
  };

  const onSelectNew = (name: string) => {
    setValues((v) => ({ ...v, showText: name, showId: null }));
    if (catalogLink && catalogLink.siteShowId === null) syncCatalogCredits(name, false);
    else setNewShow((ns) => newShowDetailsForName(ns, name.trim()));
    setIsNewShow(true);
    clearServer('show');
    setDuplicate(null);
    touch('show');
  };

  const applyCatalogShow = () => {
    if (!catalogLink) return;
    if (catalogLink.siteShowId !== null) {
      const opt = showOptions.find((s) => s.id === catalogLink.siteShowId);
      if (opt) onSelectExisting(opt);
    } else onSelectNew(catalogLink.name);
  };

  const setGenre = (g: string) => update(genreFields(g, genreList), 'genre');

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

  /** A recording was chosen (by the student, or the best match automatically) → preview + length suggestion. */
  const onChooseRecording = (p: ChosenPreview | null, how: ChooseHow) => {
    setPreview(p);
    if (how === 'user') setPreviewDirty(true);
    clearServer('preview');
    const text = lengthText(p?.durationSeconds);
    if (!p || !text) {
      setLengthSugg(null);
      lengthSuggRef.current = null;
      return;
    }
    const prevSuggested = lengthSuggRef.current;
    lengthSuggRef.current = text;
    setLengthSugg({
      value: text,
      source: `from ${p.input.recordingName ?? 'the recording'}`,
      confidence: 'medium',
      note: recordingLengthNote(p),
    });
    setValues((v) => {
      const cur = v.length.trim();
      if (cur && cur !== prevSuggested) return v;
      const next = { ...v, length: text };
      // An automatic pick is part of the pre-fill, not an unsaved change.
      if (how === 'auto' && snapshot(v) === initial.current) initial.current = snapshot(next);
      return next;
    });
    clearServer('length');
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

  const runUpload = async (what: 'art' | 'audio', file: File, fn: (opts: { signal: AbortSignal; onProgress: (p: number) => void }) => Promise<Song>): Promise<Song | 'cancelled' | Error> => {
    const ctrl = new AbortController();
    uploadCtrl.current = ctrl;
    setPhase({ what, label: what === 'art' ? 'Uploading album art' : 'Uploading backing track', name: file.name, size: file.size, progress: 0 });
    try {
      return await fn({ signal: ctrl.signal, onProgress: (p) => setPhase((ph) => (ph && ph.what === what ? { ...ph, progress: p } : ph)) });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      return err instanceof Error ? err : new Error(errorMessage(err));
    } finally {
      if (uploadCtrl.current === ctrl) uploadCtrl.current = null;
      setPhase(null);
    }
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
        const fromCatalog = catalogLink && catalogLink.siteShowId === null && equalsLoose(current.showText, catalogLink.name) ? catalogLink : null;
        const body = {
          name: current.showText.trim(),
          composer: newShow.composer.trim() || null,
          lyricist: newShow.lyricist.trim() || null,
          year: newShow.year.trim() ? Number(newShow.year.trim()) : null,
          description: newShow.description.trim() || null,
          wikiUrl: newShow.wikiUrl,
          ...(newShow.imageUrl && newShow.useImage ? { imageUrl: newShow.imageUrl } : {}),
          ...(fromCatalog ? { catalogShowId: fromCatalog.catalogShowId, ...(fromCatalog.bookWriter ? { bookWriter: fromCatalog.bookWriter } : {}) } : {}),
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
      let linkPayload: number | null | undefined;
      if (isEdit) linkPayload = song.catalogSongId ? (showId === song.show.id ? song.catalogSongId : null) : undefined;
      else linkPayload = catalogSongId ?? undefined;
      const input = toSongInput(current, { showId, preview: previewPayload, catalogSongId: linkPayload });
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

      // 3) album art + backing track (after the song exists), each with progress and a cancel button
      const problems: string[] = [];
      const skipped: string[] = [];
      if (artFile) {
        const r = await runUpload('art', artFile, (o) => uploadSongArtwork(saved.id, artFile, o));
        if (r === 'cancelled') skipped.push('album art');
        else if (r instanceof Error) problems.push(`the album art (${errorMessage(r)})`);
        else saved = r;
      } else if (artRemove && artworkSourceOf(saved) === 'upload') {
        setPhase({ what: 'art', label: 'Removing your album art', progress: null });
        try {
          saved = await deleteSongArtwork(saved.id);
        } catch (err) {
          problems.push(`removing the album art (${errorMessage(err)})`);
        } finally {
          setPhase(null);
        }
      }
      if (audioFile) {
        const r = await runUpload('audio', audioFile, (o) => uploadSongAudio(saved.id, audioFile, o));
        if (r === 'cancelled') skipped.push('backing track');
        else if (r instanceof Error) problems.push(`the backing track (${errorMessage(r)})`);
        else saved = r;
      } else if (removeUpload && saved.media.audioUrl) {
        setPhase({ what: 'audio', label: 'Removing the uploaded track', progress: null });
        try {
          saved = await deleteSongAudio(saved.id);
        } catch (err) {
          problems.push(`removing the uploaded audio (${errorMessage(err)})`);
        } finally {
          setPhase(null);
        }
      }
      if (problems.length) {
        toast.warning(`Your song is saved, but ${problems.join(' and ')} didn’t work. You can try again on the song page.`, { duration: 10000, id: 'media-upload' });
      } else if (skipped.length) {
        toast.info(`Your song is saved — you skipped the ${skipped.join(' and ')}. Add it any time on the song page.`, { id: 'media-upload' });
      }

      upsertSong(saved);
      // "Already in the songbook" / "On the site" flags in the catalog just changed.
      clearCatalogCaches();
      if (showId === null || !isEdit || saved.show.id !== song?.show.id) void reload();
      clearDraft(draftKey);
      if (!mountedRef.current) {
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
      if (isApiError(err) && err.status === 401) return;
      setFormError(errorMessage(err));
      toast.error(err);
    } finally {
      setSubmitting(false);
      setPhase(null);
    }
  };

  // ---------------------------------------------------------------- media (last act)
  const songArtSource = isEdit ? artworkSourceOf(song) : null;
  const hasUploadedArt = songArtSource === 'upload' && !artRemove;
  const recordingArt = preview?.input.artworkUrl ?? (isEdit && !previewDirty ? recordingArtworkOf(song) : null);
  let artState: ArtworkState;
  let artShown: string | null;
  if (artFile) {
    artState = 'pending';
    artShown = artPreviewUrl;
  } else if (hasUploadedArt) {
    artState = 'upload';
    artShown = song?.media.artworkUrl ?? null;
  } else if (preview) {
    artState = 'recording';
    artShown = recordingArt;
  } else {
    artState = 'none';
    artShown = null;
  }
  const canUseRecordingArt = Boolean(preview) && (artFile !== null || hasUploadedArt);
  const useRecordingArt = () => {
    setArtFile(null);
    if (songArtSource === 'upload') setArtRemove(true);
  };
  const artNote =
    artState === 'recording'
      ? 'This art comes with the recording you picked — pick another recording, or upload your own image.'
      : artState === 'none'
        ? 'No recording picked — upload an image, or pick a recording above to use its album art. (Songs without art show the show’s poster.)'
        : artState === 'pending'
          ? 'It uploads when you save.'
          : null;
  const existingUpload = isEdit ? song.media.audioUrl : null;

  // ---------------------------------------------------------------- derived UI bits
  const checklist = [
    { label: 'Title', done: values.title.trim() !== '' },
    { label: 'Show', done: showName !== '' },
    { label: values.kind === 'duet' ? 'Both characters' : 'Character', done: values.parts.every((p) => p.character.trim() !== '') },
  ];
  const previewArt = artShown ?? selectedShow?.imageUrl ?? (creatingShow && newShow.useImage ? newShow.imageUrl : null);
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
      audioBadge={preview ? '▶ 0:30' : audioFile || (existingUpload && !removeUpload) ? '▶ Audio' : values.audioLink.trim() ? '🔗 Link' : null}
      checklist={checklist}
      compact={!isDesktop}
    />
  );
  const summary = showAll ? orderedErrors(visibleErrors) : [];
  const showSuggestions = creatingShow && isNewShow ? filterShows(showOptions, values.showText).slice(0, 3) : [];
  const cancelTo = isEdit ? songPath(song.id) : (backTo ?? '/songs');
  const submitLabel = submitting
    ? phase
      ? `${phase.label}…${phase.progress !== null ? ` ${Math.round(phase.progress * 100)}%` : ''}`
      : 'Saving…'
    : isEdit
      ? 'Save changes'
      : 'Add to the songbook';
  // Already in the songbook? (maybe as a solo AND a duet) — compare against every version, not just the first.
  const existingAll = sugg ? (sugg.existingAll ?? (sugg.existing ? [sugg.existing] : [])) : [];
  const existingDuplicate = existingAll.find((e) => e.kind === values.kind) ?? null;
  const existing = existingDuplicate ?? existingAll[0] ?? null;
  const existingSameKind = existingDuplicate !== null;
  const existingKinds = [...new Set(existingAll.map((e) => e.kind))].map((k) => `a ${KIND_LABEL[k].toLowerCase()}`).join(' and ');
  const otherKind: Kind = values.kind === 'solo' ? 'duet' : 'solo';
  // Only nudge toward the other kind when the song can be sung that way and that version isn't on the site yet.
  const canSwitchKind = sugg ? kindFitsSong(sugg.song, otherKind) && !existingAll.some((e) => e.kind === otherKind) : false;
  const kindFits = sugg ? kindFitsSong(sugg.song, values.kind) : true;
  const singerCount = sugg ? sugg.song.singers.filter((n) => n.trim()).length : 0;
  const catalogCreditsNote =
    catalogLink && catalogLink.siteShowId === null && catalogShowStill && (catalogLink.composer || catalogLink.lyricist || catalogLink.year)
      ? '✨ Credits filled in from the show catalog (Wikidata) — fix anything that looks off.'
      : null;

  return (
    <div className="container song-form-page">
      <header className="page-header song-form-header">
        <div>
          <Link to={cancelTo} className="back-link" data-testid="form-back">
            <ArrowLeft size={16} aria-hidden="true" /> {isEdit ? 'Back to the song' : prefill ? 'Pick a different song' : backTo ? 'Back to the catalog' : 'Back to all songs'}
          </Link>
          <p className="eyebrow">{isEdit ? 'Edit song' : prefill ? 'Step 2 of 3 · Check it' : 'Join the songbook'}</p>
          <h1 className="page-title">{isEdit ? <>Edit “{song.title}”</> : 'Add a song'}</h1>
          <p className="page-subtitle">
            {isEdit ? (
              <>Update the details, then save — your changes show up for everyone right away.</>
            ) : prefill ? (
              <>We filled in what we know. Check the ✨ suggestions, change anything, then add it — album art and a backing track are the last step.</>
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
          {sugg && (
            <CatalogBanner
              sugg={sugg}
              backTo={backTo}
              linked={catalogSongId !== null}
              poster={sugg.show.siteShowId !== null ? (showOptions.find((o) => o.id === sugg.show.siteShowId)?.imageUrl ?? null) : null}
            />
          )}

          {existing && (
            <div className={`callout ${existingSameKind ? 'callout-warning' : 'callout-info'} existing-callout`} data-testid="already-on-site">
              <span className="emoji" aria-hidden="true">
                📖
              </span>
              <div>
                <p>
                  <strong>Already in the songbook!</strong> “{existing.title}” is on the site as {existingKinds}.{' '}
                  <Link to={songPath(existing.id)} data-testid="already-on-site-link">
                    Open it →
                  </Link>
                </p>
                <p className="small" data-testid="already-on-site-advice">
                  {existingSameKind
                    ? `Adding it again as a ${KIND_LABEL[values.kind].toLowerCase()} would be a duplicate — leave a tip in its comments instead${
                        canSwitchKind ? `, or switch to a ${KIND_LABEL[otherKind].toLowerCase()} if that’s the version you sing` : ''
                      }.`
                    : kindFits
                      ? `Adding it as a ${KIND_LABEL[values.kind].toLowerCase()} version? Great — keep going.`
                      : `In the show ${singerCount === 1 ? 'one character sings it' : 'two characters sing it'} — only add a ${KIND_LABEL[values.kind].toLowerCase()} version if that’s really how you’ll perform it.`}
                </p>
              </div>
            </div>
          )}

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
              {sugg?.kind ? (
                <SuggestionChip
                  label="solo or duet"
                  suggestion={sugg.kind}
                  current={values.kind}
                  onApply={setKind}
                  format={(k) => KIND_LABEL[k]}
                  equals={(a, b) => a === b}
                  testId="kind-suggestion"
                />
              ) : sugg?.kindNote ? (
                <p className="kind-note" data-testid="kind-note">
                  <span className="emoji" aria-hidden="true">
                    🎶
                  </span>
                  <span>{sugg.kindNote}</span>
                </p>
              ) : null}
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
                <>
                  <ShowCombobox
                    id={p.id}
                    shows={showOptions}
                    text={values.showText}
                    selectedId={values.showId}
                    onTextChange={onShowText}
                    onSelectExisting={onSelectExisting}
                    onSelectNew={onSelectNew}
                    describedBy={[p.describedBy, sugg ? 'song-show-suggestion' : null].filter(Boolean).join(' ') || undefined}
                    invalid={p.invalid}
                    loading={songsLoading && showOptions.length === 0}
                  />
                  {sugg && (
                    <SuggestionChip
                      label="show"
                      suggestion={sugg.showChip}
                      current={showName}
                      onApply={applyCatalogShow}
                      onClear={() => onShowText('')}
                      equals={(a, b) => equalsLoose(a, b)}
                      id="song-show-suggestion"
                      testId="show-suggestion-chip"
                    />
                  )}
                </>
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
                suggestions={showSuggestions}
                onPickSuggestion={onSelectExisting}
                note={catalogCreditsNote}
              />
            )}

            <Field label="Song title" id="song-title" error={errorFor('title') ?? errorFor('catalogSongId')} hint="As it appears in the score or cast album, e.g. “Defying Gravity”.">
              {(p) => (
                <>
                  <input
                    className="input input-lg"
                    id={p.id}
                    aria-describedby={[p.describedBy, sugg ? 'song-title-suggestion' : null].filter(Boolean).join(' ') || undefined}
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
                  {sugg && (
                    <SuggestionChip
                      label="song title"
                      suggestion={sugg.title}
                      current={values.title}
                      onApply={(t) => {
                        update({ title: t }, 'title');
                        setDuplicate(null);
                      }}
                      onClear={() => update({ title: '' }, 'title')}
                      id="song-title-suggestion"
                      testId="title-suggestion"
                    />
                  )}
                </>
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
                  characterSuggestion={sugg && catalogShowStill ? sugg.characters[i] : null}
                  onPickCharacter={(name) => pickCharacter(i, name)}
                  rangeSuggestion={sugg && catalogShowStill ? (sugg.ranges.get(normalizeText(part.character)) ?? null) : null}
                />
              ))}
            </div>
          </FormAct>

          {/* ------------------------------------------------ Act 3: the vibe */}
          <FormAct num={3} title="The vibe" emoji="✨" id="act-vibe">
            <div className="form-row">
              <Field label="Genre" optional id="song-genre" error={errorFor('genre')}>
                {(p) => (
                  <>
                    <select
                      className="select"
                      id={p.id}
                      aria-describedby={[p.describedBy, sugg?.genre ? 'song-genre-suggestion' : null].filter(Boolean).join(' ') || undefined}
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
                    {sugg?.genre && (
                      <SuggestionChip
                        label="genre"
                        suggestion={sugg.genre}
                        current={genre}
                        onApply={setGenre}
                        onClear={() => update({ genreChoice: '', genreOther: '' }, 'genre')}
                        id="song-genre-suggestion"
                        testId="genre-suggestion"
                      />
                    )}
                  </>
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
                    aria-describedby={[p.describedBy, sugg?.subGenre ? 'song-subgenre-suggestion' : null].filter(Boolean).join(' ') || undefined}
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
                  {sugg?.subGenre && (
                    <SuggestionChip
                      label="mood"
                      suggestion={sugg.subGenre}
                      current={values.subGenre}
                      onApply={(v) => update({ subGenre: v }, 'subGenre')}
                      onClear={() => update({ subGenre: '' }, 'subGenre')}
                      id="song-subgenre-suggestion"
                      testId="subgenre-suggestion"
                    />
                  )}
                </>
              )}
            </Field>
            {/* The toggle stays put (aria-expanded) so keyboard focus isn't lost when the moods open. */}
            {subGenreOptions.length > 0 && sugg?.subGenre && (
              <button
                type="button"
                className="btn btn-quiet btn-sm more-moods"
                onClick={() => setAllMoods((open) => !open)}
                aria-expanded={allMoods}
                aria-controls="mood-chips"
                data-testid="more-moods"
              >
                {allMoods ? 'Fewer moods' : 'More moods…'}
              </button>
            )}
            {subGenreOptions.length > 0 && (!sugg?.subGenre || allMoods) && (
              <ul className="chip-group mood-chips" id="mood-chips" role="list" aria-label="Suggested moods">
                {subGenreOptions.slice(0, 10).map((s) => {
                  const on = equalsLoose(values.subGenre, s.name);
                  return (
                    <li key={s.name}>
                      <button type="button" className="chip" aria-pressed={on} onClick={() => update({ subGenre: on ? '' : s.name }, 'subGenre')} data-testid="subgenre-chip">
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
              {sugg?.mature && (
                <SuggestionChip
                  label="mature themes flag"
                  suggestion={sugg.mature}
                  current={values.mature}
                  onApply={(mature) => update({ mature })}
                  format={(v) => (v ? 'Mature themes' : 'No mature themes')}
                  equals={(a, b) => a === b}
                  testId="mature-suggestion"
                />
              )}
            </div>
          </FormAct>

          {/* ------------------------------------------------ Act 4: recording & length */}
          <FormAct
            num={4}
            title="Recording & length"
            emoji="🎧"
            id="act-recording"
            subtitle={pickerCatalogId ? 'We look for cast recordings of this song — the one you pick gives the 30-sec preview, the album art and the length.' : 'Optional — a 30-sec preview helps everyone decide faster, and it brings album art and the length.'}
          >
            <RecordingPicker
              catalogSongId={pickerCatalogId}
              title={values.title}
              showName={showName}
              chosen={preview}
              onChoose={onChooseRecording}
              autoLoad={!isEdit && catalogSongId !== null}
              autoSelect={!isEdit && catalogSongId !== null && !restored}
              error={errorFor('preview')}
            />

            <div className="timing-row">
              <Field label="Length" optional id="song-length" error={errorFor('length')} hint="m:ss — e.g. 3:25" className="length-field">
                {(p) => (
                  <input
                    className="input length-input"
                    id={p.id}
                    aria-describedby={[p.describedBy, lengthSugg ? 'song-length-suggestion' : null].filter(Boolean).join(' ') || undefined}
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
            {lengthSugg && (
              <SuggestionChip
                label="length"
                suggestion={lengthSugg}
                current={values.length.trim()}
                onApply={(v) => update({ length: v }, 'length')}
                onClear={() => update({ length: '' }, 'length')}
                id="song-length-suggestion"
                testId="length-suggestion"
                className="length-suggestion"
              />
            )}
          </FormAct>

          {/* ------------------------------------------------ Act 5: notes */}
          <FormAct num={5} title="Notes" emoji="📝" id="act-notes">
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

          {/* ------------------------------------------------ Act 6: album art & backing track */}
          <FormAct
            num={6}
            title="Album art & backing track"
            emoji="🖼️"
            id="act-media"
            subtitle={`${prefill ? 'Step 3 of 3 · ' : ''}Optional — both upload when you save, and you can change them later on the song page.`}
          >
            <ArtworkDropzone
              id="song-art"
              testIdPrefix="song-art"
              imageUrl={artShown}
              state={artState}
              seed={showName || values.title || 'STAR'}
              onFile={(f) => {
                setArtFile(f);
                clearServer('artwork');
              }}
              onUseRecording={canUseRecordingArt ? useRecordingArt : undefined}
              onRemove={artFile && !preview && !hasUploadedArt ? () => setArtFile(null) : !artFile && hasUploadedArt && !preview ? () => setArtRemove(true) : undefined}
              undo={
                artFile && hasUploadedArt
                  ? { label: 'Keep my current image', onClick: () => setArtFile(null) }
                  : artFile && !preview
                    ? null
                    : artRemove && !artFile
                      ? { label: 'Keep my image', onClick: () => setArtRemove(false) }
                      : null
              }
              busy={phase?.what === 'art' ? phase : null}
              onCancel={() => uploadCtrl.current?.abort()}
              error={errorFor('artwork')}
              disabled={submitting}
              note={artRemove && !artFile ? 'Your uploaded image will be removed when you save.' : artNote}
            />
            <AudioDropzone
              id="song-audio"
              testIdPrefix="song-audio"
              current={existingUpload ? { play: <PlayButton song={song} source="upload" size="sm" />, label: 'A backing track is uploaded for this song.' } : null}
              pending={audioFile}
              onClearPending={() => setAudioFile(null)}
              markedForRemoval={removeUpload}
              onUndoRemove={() => setRemoveUpload(false)}
              onFile={(f) => {
                setAudioFile(f);
                setRemoveUpload(false);
                clearServer('audioFile');
              }}
              onRemove={() => setRemoveUpload(true)}
              busy={phase?.what === 'audio' ? phase : null}
              onCancel={() => uploadCtrl.current?.abort()}
              error={errorFor('audioFile')}
              disabled={submitting}
            />
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
            {phase && (
              <p className="visually-hidden" role="status">
                {phase.label}
              </p>
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

function snapshotShow(ns: NewShowDetails): string {
  return JSON.stringify(ns);
}

function CatalogBanner({ sugg, backTo, linked, poster }: { sugg: FormSuggestions; backTo?: string; linked: boolean; poster: string | null }) {
  const { song, show } = sugg;
  const singers = formatSingers(song.singers);
  return (
    <section className="catalog-banner" aria-labelledby="catalog-banner-title" data-testid="catalog-banner">
      <div className="catalog-banner-art" aria-hidden="true">
        <ArtworkTile src={poster} seed={show.name} label={show.name} size={72} />
      </div>
      <div className="catalog-banner-body">
        <p className="catalog-banner-eyebrow">
          <span aria-hidden="true">✨</span> {song.source === 'recording' ? 'From the cast album’s track list' : 'From the show catalog'}
        </p>
        <h2 id="catalog-banner-title" className="catalog-banner-title">
          “{song.title}”{song.reprise ? <span className="badge badge-outline catalog-banner-badge">Reprise</span> : null}
        </h2>
        <p className="catalog-banner-meta">
          {titleWithYear(show.name, show.year)}
          {song.act ? ` · Act ${song.act}` : ''}
          {singers ? ` · sung by ${singers}${song.ensemble ? ' + ensemble' : ''}` : song.ensemble ? ' · ensemble number' : ''}
        </p>
        {!linked && <p className="catalog-banner-unlinked small">You picked a different show, so this won’t be linked to the catalog song.</p>}
      </div>
      <div className="catalog-banner-side">
        {backTo && (
          <Link to={backTo} className="btn btn-quiet btn-sm" data-testid="catalog-back">
            <ArrowLeft size={15} aria-hidden="true" /> Different song
          </Link>
        )}
        {song.source === 'recording' ? <RecordingListCredit /> : <CatalogCredit wikiTitle={show.wikiTitle} />}
      </div>
    </section>
  );
}

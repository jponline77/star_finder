/**
 * Owner/admin "Album art & audio" panel on the song page (SPEC §7c). Render only when canEdit(user, song).
 *
 *  - Album art: current image (recording art or an upload) with "Upload my own" (drag & drop or click, preview,
 *    type/size checks, progress + cancel), "Use recording art" / "Remove" (DELETE /api/songs/:id/artwork).
 *  - Recording: the 30-sec preview's recording; "Change recording" opens the RecordingPicker and saves the choice
 *    (PUT /api/songs/:id with the song's own fields + the new preview); then offers its length ("3:21 from …").
 *  - Backing track: AudioManager (upload with progress + cancel, remove).
 *
 * data-testids: media-panel, art-* (ArtworkDropzone), recording-manager, change-recording, current-recording,
 * recording-length-suggestion, + AudioManager's.
 */
import { Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { deleteSongArtwork, errorMessage, isApiError, updateSong, uploadSongArtwork } from '../../api';
import { ArtworkTile } from '../../components/ArtworkTile';
import { useConfirm } from '../../components/ConfirmDialog';
import { ArtworkDropzone, type ArtworkState, type UploadStatus } from '../../components/MediaDropzones';
import { PlayButton } from '../../components/PlayButton';
import { RecordingPicker, type ChooseHow } from '../../components/RecordingPicker';
import { SuggestionChip, type ChipSuggestion } from '../../components/SuggestionChip';
import { lengthText } from '../../lib/catalog';
import { formatLength } from '../../lib/format';
import { artworkSourceOf, previewFromSong, recordingArtworkOf, type ChosenPreview } from '../../lib/recordings';
import { useToast } from '../../state/ToastProvider';
import type { Song } from '../../types';
import { inputFromSong } from '../song-form/model';
import { AudioManager } from './AudioManager';

export interface SongMediaPanelProps {
  song: Song;
  onUpdated: (song: Song) => void;
}

export function SongMediaPanel({ song, onUpdated }: SongMediaPanelProps) {
  return (
    <section className="sd-section sd-media" aria-labelledby="sd-media-title" id="media" data-testid="media-panel">
      <h2 id="sd-media-title" className="section-title">
        <span className="emoji" aria-hidden="true">
          🖼️
        </span>
        Album art &amp; audio
      </h2>
      <p className="sd-section-lede sd-media-lede">
        <Wrench size={15} aria-hidden="true" /> Owner tools — only you and admins see this. Changes show up for everyone right away.
      </p>
      <div className="card sd-media-card">
        <ArtworkManager song={song} onUpdated={onUpdated} />
        <RecordingManager song={song} onUpdated={onUpdated} />
        <AudioManager song={song} onUpdated={onUpdated} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// album art
// ---------------------------------------------------------------------------

export function ArtworkManager({ song, onUpdated }: SongMediaPanelProps) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<UploadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const source = artworkSourceOf(song);
  const hasRecording = Boolean(song.media.previewUrl || song.media.recordingName);
  const state: ArtworkState = source === 'upload' ? 'upload' : song.media.artworkUrl ? 'recording' : 'none';

  const upload = async (file: File) => {
    setError(null);
    const c = new AbortController();
    ctrl.current = c;
    setBusy({ label: 'Uploading', name: file.name, size: file.size, progress: 0 });
    try {
      const updated = await uploadSongArtwork(song.id, file, {
        signal: c.signal,
        onProgress: (p) => setBusy((b) => (b ? { ...b, progress: p } : b)),
      });
      onUpdated(updated);
      toast.success('Album art updated — looking sharp!', { emoji: '🖼️', id: 'art-upload' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') toast.info('Upload cancelled', { id: 'art-upload' });
      else if (isApiError(e) && e.status === 413 && !/upload space/i.test(e.message)) setError('That image is too big (max 5 MB). Try a smaller JPG or a screenshot.');
      else setError(errorMessage(e));
    } finally {
      if (ctrl.current === c) ctrl.current = null;
      setBusy(null);
    }
  };

  const removeUpload = async (toRecording: boolean) => {
    const ok = await confirm({
      title: toRecording ? 'Use the recording’s album art?' : 'Remove your album art?',
      message: <p>{toRecording ? 'Your uploaded image will be deleted and the song shows the recording’s album art again.' : 'Your uploaded image will be deleted for everyone. Cards will show the show’s poster instead.'}</p>,
      confirmLabel: toRecording ? 'Use recording art' : 'Remove image',
    });
    if (!ok) return;
    setError(null);
    setBusy({ label: 'Removing your image', progress: null });
    try {
      const updated = await deleteSongArtwork(song.id);
      onUpdated(updated);
      toast.info(toRecording ? 'Back to the recording’s album art.' : 'Album art removed.', { emoji: '🧹', id: 'art-upload' });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sd-media-block">
      <ArtworkDropzone
        id="media-art"
        testIdPrefix="art"
        imageUrl={song.media.artworkUrl}
        state={state}
        seed={song.show.name}
        onFile={(f) => void upload(f)}
        onUseRecording={source === 'upload' && hasRecording ? () => void removeUpload(true) : undefined}
        onRemove={source === 'upload' && !hasRecording ? () => void removeUpload(false) : undefined}
        busy={busy}
        onCancel={() => ctrl.current?.abort()}
        error={error}
        note={
          state === 'recording'
            ? `From ${song.media.recordingName ?? 'the recording'} — upload your own image to replace it.`
            : state === 'none'
              ? 'No art yet, so cards show the show’s poster. Upload an image, or pick a recording below to use its album art.'
              : null
        }
      />
      {dialog}
    </div>
  );
}

// ---------------------------------------------------------------------------
// recording (30-sec preview)
// ---------------------------------------------------------------------------

export function RecordingManager({ song, onUpdated }: SongMediaPanelProps) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lengthSugg, setLengthSugg] = useState<(ChipSuggestion<string> & { seconds: number }) | null>(null);
  const chosen: ChosenPreview | null = previewFromSong(song);
  const m = song.media;
  // Opening / closing the picker swaps the focused button out — move focus along instead of dropping it to <body>.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (open ? pickerRef.current : toggleRef.current)?.focus();
  }, [open]);
  const openPicker = () => {
    moveFocus.current = true;
    setOpen(true);
  };
  const closePicker = () => {
    moveFocus.current = true;
    setOpen(false);
  };

  const save = async (preview: ChosenPreview | null) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSong(song.id, inputFromSong(song, { preview: preview ? preview.input : null }));
      onUpdated(updated);
      const text = lengthText(preview?.durationSeconds);
      if (preview && text && text !== lengthText(song.lengthSeconds)) {
        setLengthSugg({ value: text, seconds: preview.durationSeconds as number, source: `from ${preview.input.recordingName ?? 'the recording'}`, confidence: 'medium' });
      } else setLengthSugg(null);
      toast.success(preview ? 'Recording updated — press ▶ to hear it.' : 'Recording removed.', { emoji: preview ? '🎧' : '🧹', id: 'recording-save' });
      if (preview) closePicker();
    } catch (e) {
      setError(isApiError(e) && e.status === 400 && e.details['preview.artworkUrl'] ? 'We couldn’t use that recording’s album art — try another recording.' : errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const onChoose = async (p: ChosenPreview | null, how: ChooseHow) => {
    if (how !== 'user' || saving) return; // never change a saved song on our own
    if (!p) {
      const ok = await confirm({
        title: 'Remove the recording?',
        message: <p>The 30-second preview goes away{artworkSourceOf(song) === 'recording' ? ', and so does the album art that came with it' : ''}. You can pick a recording again any time.</p>,
        confirmLabel: 'Remove recording',
      });
      if (!ok) return;
    }
    await save(p);
  };

  const applyLength = async (seconds: number) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSong(song.id, inputFromSong(song, { lengthSeconds: seconds }));
      onUpdated(updated);
      setLengthSugg(null);
      toast.success(`Length set to ${formatLength(seconds)}.`, { emoji: '⏱️', id: 'recording-save' });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sd-media-block sd-recording" id="media-recording" data-testid="recording-manager">
      <h3 className="media-drop-title">
        <span className="emoji" aria-hidden="true">
          🎧
        </span>{' '}
        Recording &amp; 30-sec preview
      </h3>
      {m.previewUrl ? (
        <div className="sd-recording-current" data-testid="current-recording">
          <div className="rec-chosen-art">
            <ArtworkTile src={recordingArtworkOf(song)} seed={m.recordingName ?? song.show.name} size={64} />
            <PlayButton song={song} source="preview" size="sm" />
          </div>
          <div className="sd-recording-text">
            <p className="sd-recording-name">{m.recordingName ?? 'Apple Music recording'}</p>
            {m.recordingArtist && <p className="small muted line-clamp-2">{m.recordingArtist}</p>}
          </div>
        </div>
      ) : (
        <p className="small muted" data-testid="current-recording">
          No recording yet — pick one so everyone can hear a 30-second preview (it brings album art and the length too).
        </p>
      )}
      {open ? (
        <>
          <div ref={pickerRef} tabIndex={-1} role="group" aria-label="Choose a recording" className="sd-recording-picker" data-testid="recording-picker-region">
            <RecordingPicker catalogSongId={song.catalogSongId ?? null} title={song.title} showName={song.show.name} chosen={chosen} onChoose={(p, how) => void onChoose(p, how)} autoLoad busy={saving} hideChosen />
          </div>
          <button type="button" className="btn btn-quiet btn-sm sd-recording-close" onClick={closePicker} disabled={saving} data-testid="close-recordings">
            <X size={15} aria-hidden="true" /> Close
          </button>
        </>
      ) : (
        <div className="media-drop-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={openPicker} ref={toggleRef} data-testid="change-recording">
            <span className="emoji" aria-hidden="true">
              🔎
            </span>
            {m.previewUrl ? 'Change recording' : 'Find a recording'}
          </button>
        </div>
      )}
      {saving && (
        <p className="small muted" role="status">
          <span className="spinner" aria-hidden="true" /> Saving…
        </p>
      )}
      {lengthSugg && (
        <SuggestionChip
          label="length"
          suggestion={lengthSugg}
          current={lengthText(song.lengthSeconds) ?? ''}
          onApply={() => void applyLength(lengthSugg.seconds)}
          testId="recording-length-suggestion"
        />
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {dialog}
    </div>
  );
}

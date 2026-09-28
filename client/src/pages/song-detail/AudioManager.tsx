/**
 * Owner/admin backing-track tools on the song page: "Add your backing track (no vocals)" — upload (click or
 * drag & drop, with validation, progress and cancel) and remove the uploaded file. Render only when
 * canEdit(user, song). Uses the shared AudioDropzone.
 *
 * data-testids: audio-manager, audio-file-input, audio-choose, audio-upload-progress, audio-upload-cancel,
 * audio-upload-error, audio-remove.
 */
import { useEffect, useRef, useState } from 'react';
import { deleteSongAudio, errorMessage, isApiError, uploadSongAudio } from '../../api';
import { useConfirm } from '../../components/ConfirmDialog';
import { AudioDropzone, type UploadStatus } from '../../components/MediaDropzones';
import { PlayButton } from '../../components/PlayButton';
import { useAudio } from '../../state/AudioProvider';
import { useToast } from '../../state/ToastProvider';
import type { Song } from '../../types';

export interface AudioManagerProps {
  song: Song;
  /** Called with the updated song after an upload or removal. */
  onUpdated: (song: Song) => void;
}

export function AudioManager({ song, onUpdated }: AudioManagerProps) {
  const toast = useToast();
  const audio = useAudio();
  const { confirm, dialog } = useConfirm();
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<UploadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasUpload = Boolean(song.media.audioUrl);
  const uploadKey = `upload:${song.id}`;

  // Cancel an in-flight upload when leaving the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async (file: File) => {
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy({ label: 'Uploading', name: file.name, size: file.size, progress: 0 });
    try {
      const updated = await uploadSongAudio(song.id, file, {
        signal: ctrl.signal,
        onProgress: (p) => setBusy((b) => (b ? { ...b, progress: p } : b)),
      });
      if (audio.isCurrent(uploadKey)) audio.stop();
      onUpdated(updated);
      toast.success(hasUpload ? 'Backing track replaced — press play to hear the new file.' : 'Backing track uploaded — press play to hear it!', { emoji: '🎧', id: 'audio-upload' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        toast.info('Upload cancelled', { id: 'audio-upload' });
      } else if (isApiError(e) && e.status === 413 && !/upload space/i.test(e.message)) {
        // Too big for one file (the other 413 is "you've used all your upload space" — say that).
        setError('That file is too big (max 25 MB). Try an MP3 or M4A instead.');
      } else {
        setError(errorMessage(e));
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(null);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Remove the uploaded audio?',
      message: <p>The file will be deleted for everyone. The Apple Music preview (if there is one) stays.</p>,
      confirmLabel: 'Remove audio',
    });
    if (!ok) return;
    setError(null);
    setBusy({ label: 'Removing the uploaded track', progress: null });
    try {
      const updated = await deleteSongAudio(song.id);
      if (audio.isCurrent(uploadKey)) audio.stop();
      onUpdated(updated);
      toast.info('Uploaded audio removed', { emoji: '🧹', id: 'audio-upload' });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="sd-media-block" data-testid="audio-manager">
      <AudioDropzone
        id="media-audio"
        testIdPrefix="audio"
        current={hasUpload ? { play: <PlayButton song={song} source="upload" size="sm" />, label: 'A backing track is uploaded — it plays in the mini player.' } : null}
        onFile={(f) => void start(f)}
        onRemove={() => void remove()}
        busy={busy}
        onCancel={() => abortRef.current?.abort()}
        error={error}
      />
      {dialog}
    </div>
  );
}

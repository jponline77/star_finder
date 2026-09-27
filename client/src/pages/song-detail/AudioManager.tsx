/**
 * Owner/admin audio tools on the song page: upload (click or drag & drop, with validation,
 * progress and cancel) and remove the uploaded file. Render only when canEdit(user, song).
 *
 * data-testids: audio-manager, audio-file-input, audio-choose, audio-upload-progress,
 * audio-upload-cancel, audio-upload-error, audio-remove.
 */
import { CloudUpload, Trash2, Wrench, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { deleteSongAudio, errorMessage, isApiError, uploadSongAudio } from '../../api';
import { useConfirm } from '../../components/ConfirmDialog';
import { formatBytes, percent } from '../../lib/format';
import { useAudio } from '../../state/AudioProvider';
import { useToast } from '../../state/ToastProvider';
import type { Song } from '../../types';
import { AUDIO_ACCEPT, AUDIO_FORMATS_TEXT, validateAudioFile } from './helpers';

export interface AudioManagerProps {
  song: Song;
  /** Called with the updated song after an upload or removal. */
  onUpdated: (song: Song) => void;
}

type Phase = { kind: 'idle' } | { kind: 'uploading'; name: string; size: number; progress: number } | { kind: 'removing' };

export function AudioManager({ song, onUpdated }: AudioManagerProps) {
  const toast = useToast();
  const audio = useAudio();
  const { confirm, dialog } = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();
  const errorId = useId();
  const hasUpload = Boolean(song.media.audioUrl);
  const uploadKey = `upload:${song.id}`;
  const busy = phase.kind !== 'idle';

  // Cancel an in-flight upload when leaving the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async (file: File) => {
    setError(null);
    const problem = validateAudioFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase({ kind: 'uploading', name: file.name, size: file.size, progress: 0 });
    try {
      const updated = await uploadSongAudio(song.id, file, {
        signal: ctrl.signal,
        onProgress: (p) => setPhase((ph) => (ph.kind === 'uploading' ? { ...ph, progress: p } : ph)),
      });
      if (audio.isCurrent(uploadKey)) audio.stop();
      onUpdated(updated);
      toast.success(hasUpload ? 'Audio replaced — press play to hear the new file.' : 'Audio uploaded — press play to hear it!', { emoji: '🎧', id: 'audio-upload' });
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
      setPhase({ kind: 'idle' });
      if (inputRef.current) inputRef.current.value = '';
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
    setPhase({ kind: 'removing' });
    try {
      const updated = await deleteSongAudio(song.id);
      if (audio.isCurrent(uploadKey)) audio.stop();
      onUpdated(updated);
      toast.info('Uploaded audio removed', { emoji: '🧹', id: 'audio-upload' });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPhase({ kind: 'idle' });
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void start(file);
  };

  return (
    <div className="sd-manage" data-testid="audio-manager">
      <p className="sd-manage-label">
        <Wrench size={14} aria-hidden="true" /> Owner tools <span className="subtle">· only you and admins see this</span>
      </p>
      <div
        className={`sd-drop${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
        onDragOver={(e) => {
          if (busy) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {phase.kind === 'uploading' ? (
          <div className="sd-upload-progress" data-testid="audio-upload-progress">
            <div className="sd-upload-progress-head">
              <span className="truncate">
                Uploading <strong>{phase.name}</strong> <span className="subtle">({formatBytes(phase.size)})</span>
              </span>
              <span className="sd-upload-pct" aria-hidden="true">
                {percent(phase.progress)}
              </span>
            </div>
            <div
              className="sd-meter"
              role="progressbar"
              aria-label={`Uploading ${phase.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(phase.progress * 100)}
            >
              <span style={{ width: percent(phase.progress) }} />
            </div>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => abortRef.current?.abort()} data-testid="audio-upload-cancel">
              <X size={16} aria-hidden="true" /> Cancel
            </button>
          </div>
        ) : (
          <>
            <CloudUpload className="sd-drop-icon" size={28} aria-hidden="true" />
            <div className="sd-drop-text">
              <p className="sd-drop-title">{hasUpload ? 'Replace the uploaded audio' : 'Upload an audio file'}</p>
              <p className="sd-drop-hint" id={hintId}>
                Drop a file here or choose one · {AUDIO_FORMATS_TEXT} · up to 25 MB. Only share audio you have the right to share.
              </p>
            </div>
            <div className="sd-drop-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`}
                data-testid="audio-choose"
              >
                <CloudUpload size={16} aria-hidden="true" /> {hasUpload ? 'Choose a new file' : 'Choose a file'}
              </button>
              {hasUpload && (
                <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => void remove()} disabled={busy} data-testid="audio-remove">
                  {phase.kind === 'removing' ? <span className="spinner" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />} Remove uploaded audio
                </button>
              )}
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={AUDIO_ACCEPT}
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void start(file);
          }}
          data-testid="audio-file-input"
        />
      </div>
      {error && (
        <p className="field-error sd-manage-error" role="alert" id={errorId} data-testid="audio-upload-error">
          {error}
        </p>
      )}
      {dialog}
    </div>
  );
}

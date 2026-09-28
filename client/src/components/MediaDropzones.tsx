/**
 * Album art + backing-track dropzones (SPEC §7c) — used by the song form's last step (files are uploaded after
 * the song is saved) and by the owner/admin media panel on the song page (uploaded straight away).
 * Both are presentational: the parent owns the files, uploads and errors; these handle drag & drop, click to
 * choose, client-side checks, previews, progress + cancel and the action buttons.
 *
 * data-testids (prefix defaults: 'art' / 'audio'):
 *   <p>-dropzone, <p>-file-input, <p>-choose, <p>-remove, <p>-upload-progress, <p>-upload-cancel, <p>-upload-error
 *   art only: art-preview, art-use-recording, art-undo · audio only: audio-pending, audio-pending-clear, audio-undo
 */
import { CloudUpload, Disc3, FileAudio, ImagePlus, Trash2, Undo2, X } from 'lucide-react';
import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { formatBytes, percent } from '../lib/format';
import { AUDIO_ACCEPT, AUDIO_FORMATS_TEXT, IMAGE_ACCEPT, IMAGE_FORMATS_TEXT, validateAudioFile, validateImageFile } from '../lib/media';
import { ArtworkTile } from './ArtworkTile';
import './media.css';

// ---------------------------------------------------------------------------
// drag & drop
// ---------------------------------------------------------------------------

function carriesFiles(e: DragEvent<HTMLElement>): boolean {
  const types = e.dataTransfer?.types;
  if (!types || types.length === undefined) return true;
  return Array.from(types).includes('Files');
}

/** Drag-and-drop wiring for a drop target. `onFile` gets the first dropped file. */
export function useFileDrop(onFile: (file: File) => void, disabled = false) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const dropProps = {
    onDragEnter: (e: DragEvent<HTMLElement>) => {
      if (disabled || !carriesFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (disabled || !carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (disabled) return;
      const file = e.dataTransfer?.files?.[0];
      if (file) onFile(file);
    },
  };
  return { dragging, dropProps };
}

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------

export interface UploadStatus {
  /** "Uploading album art", "Removing…" */
  label: string;
  name?: string | null;
  size?: number | null;
  /** 0..1, or null for an indeterminate step (removing, saving). */
  progress: number | null;
}

export function UploadProgress({ status, onCancel, testIdPrefix }: { status: UploadStatus; onCancel?: () => void; testIdPrefix: string }) {
  const pct = status.progress === null ? null : Math.round(Math.max(0, Math.min(1, status.progress)) * 100);
  return (
    <div className="media-progress" data-testid={`${testIdPrefix}-upload-progress`}>
      <div className="media-progress-head">
        <span className="truncate">
          {status.label}
          {status.name ? (
            <>
              {' '}
              <strong>{status.name}</strong>
            </>
          ) : null}
          {status.size ? <span className="subtle"> ({formatBytes(status.size)})</span> : null}
        </span>
        {pct !== null && (
          <span className="media-progress-pct" aria-hidden="true">
            {percent(pct / 100)}
          </span>
        )}
      </div>
      <div
        className={`media-meter${pct === null ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-label={`${status.label}${status.name ? ` ${status.name}` : ''}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
      >
        <span style={{ width: pct === null ? undefined : `${pct}%` }} />
      </div>
      {onCancel && (
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} data-testid={`${testIdPrefix}-upload-cancel`}>
          <X size={16} aria-hidden="true" /> Cancel
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// album art
// ---------------------------------------------------------------------------

export type ArtworkState = 'upload' | 'pending' | 'recording' | 'none';

export interface ArtworkDropzoneProps {
  /** The image shown now (an uploaded/recording art URL, or a local preview of a chosen file). */
  imageUrl: string | null;
  state: ArtworkState;
  /** Gradient fallback seed (the show name). */
  seed: string;
  /** Shows "Use recording art". */
  onUseRecording?: () => void;
  /** Shows "Remove". */
  onRemove?: () => void;
  /** e.g. { label: 'Keep my image', onClick } after the owner marked their image for removal. */
  undo?: { label: string; onClick: () => void } | null;
  onFile: (file: File) => void;
  busy?: UploadStatus | null;
  onCancel?: () => void;
  error?: string | null;
  disabled?: boolean;
  /** Extra line under the buttons. */
  note?: ReactNode;
  /** Anchor id for "Add album art" links; the choose button gets `${id}-choose`. */
  id?: string;
  testIdPrefix?: string;
  headingLevel?: 3 | 4;
}

const ART_CAPTION: Record<ArtworkState, string> = {
  upload: 'Your image',
  pending: 'Ready to upload',
  recording: 'From the recording',
  none: 'No album art yet',
};

export function ArtworkDropzone({
  imageUrl,
  state,
  seed,
  onUseRecording,
  onRemove,
  undo,
  onFile,
  busy,
  onCancel,
  error,
  disabled = false,
  note,
  id,
  testIdPrefix = 'art',
  headingLevel = 3,
}: ArtworkDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const hintId = useId();
  const errorId = useId();
  const locked = disabled || Boolean(busy);
  const pick = (file: File) => {
    const problem = validateImageFile(file);
    setLocalError(problem);
    if (!problem) onFile(file);
    if (inputRef.current) inputRef.current.value = '';
  };
  const { dragging, dropProps } = useFileDrop(pick, locked);
  const shownError = localError ?? error ?? null;
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  const hasOwn = state === 'upload' || state === 'pending';

  return (
    <div className={`media-drop art-drop${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''} is-${state}`} id={id} {...dropProps} data-testid={`${testIdPrefix}-dropzone`}>
      <div className="art-drop-preview" data-testid={`${testIdPrefix}-preview`} data-state={state}>
        <ArtworkTile src={imageUrl} seed={seed} size={148} alt={state === 'none' ? '' : `${ART_CAPTION[state]} — album art preview`} />
        <span className={`art-drop-caption is-${state}`}>{ART_CAPTION[state]}</span>
      </div>
      <div className="media-drop-body">
        <Heading className="media-drop-title">
          <span className="emoji" aria-hidden="true">
            🖼️
          </span>{' '}
          {state === 'none' ? 'Add album art' : 'Album art'}
        </Heading>
        <p className="media-drop-hint" id={hintId}>
          Drop an image here or choose one · {IMAGE_FORMATS_TEXT} · up to 5 MB · square looks best.
        </p>
        {busy ? (
          <UploadProgress status={busy} onCancel={onCancel} testIdPrefix={testIdPrefix} />
        ) : (
          <div className="media-drop-actions">
            <button
              type="button"
              id={id ? `${id}-choose` : undefined}
              className="btn btn-secondary btn-sm"
              onClick={() => inputRef.current?.click()}
              disabled={locked}
              aria-describedby={`${hintId}${shownError ? ` ${errorId}` : ''}`}
              data-testid={`${testIdPrefix}-choose`}
            >
              <ImagePlus size={16} aria-hidden="true" /> {hasOwn ? 'Upload a different image' : 'Upload my own'}
            </button>
            {onUseRecording && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onUseRecording} disabled={locked} data-testid={`${testIdPrefix}-use-recording`}>
                <Disc3 size={16} aria-hidden="true" /> Use recording art
              </button>
            )}
            {onRemove && (
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={onRemove} disabled={locked} data-testid={`${testIdPrefix}-remove`}>
                <Trash2 size={16} aria-hidden="true" /> Remove
              </button>
            )}
            {undo && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={undo.onClick} disabled={locked} data-testid={`${testIdPrefix}-undo`}>
                <Undo2 size={16} aria-hidden="true" /> {undo.label}
              </button>
            )}
          </div>
        )}
        {note && <div className="media-drop-note">{note}</div>}
        {shownError && (
          <p className="field-error" role="alert" id={errorId} data-testid={`${testIdPrefix}-upload-error`}>
            {shownError}
          </p>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pick(file);
        }}
        data-testid={`${testIdPrefix}-file-input`}
      />
      {dragging && (
        <div className="media-drop-overlay" aria-hidden="true">
          <ImagePlus size={28} /> Drop to use this image
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// backing track
// ---------------------------------------------------------------------------

export interface AudioDropzoneProps {
  /** The uploaded track on the song now (null = none). `play` is e.g. a <PlayButton>. */
  current: { play?: ReactNode; label?: string } | null;
  /** A chosen file that will upload when the form is saved. */
  pending?: File | null;
  onClearPending?: () => void;
  /** The current upload is marked for removal on save. */
  markedForRemoval?: boolean;
  onUndoRemove?: () => void;
  onFile: (file: File) => void;
  onRemove?: () => void;
  busy?: UploadStatus | null;
  onCancel?: () => void;
  error?: string | null;
  disabled?: boolean;
  /** Anchor id; the choose button gets `${id}-choose`. */
  id?: string;
  testIdPrefix?: string;
  headingLevel?: 3 | 4;
}

export function AudioDropzone({
  current,
  pending = null,
  onClearPending,
  markedForRemoval = false,
  onUndoRemove,
  onFile,
  onRemove,
  busy,
  onCancel,
  error,
  disabled = false,
  id,
  testIdPrefix = 'audio',
  headingLevel = 3,
}: AudioDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const hintId = useId();
  const errorId = useId();
  const locked = disabled || Boolean(busy);
  const pick = (file: File) => {
    const problem = validateAudioFile(file);
    setLocalError(problem);
    if (!problem) onFile(file);
    if (inputRef.current) inputRef.current.value = '';
  };
  const { dragging, dropProps } = useFileDrop(pick, locked);
  const shownError = localError ?? error ?? null;
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  const has = Boolean(current) && !markedForRemoval;

  return (
    <div className={`media-drop audio-drop${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`} id={id} {...dropProps} data-testid={`${testIdPrefix}-dropzone`}>
      <span className="audio-drop-icon" aria-hidden="true">
        <CloudUpload size={26} />
      </span>
      <div className="media-drop-body">
        <Heading className="media-drop-title">
          <span className="emoji" aria-hidden="true">
            🎹
          </span>{' '}
          {has || pending ? 'Your backing track' : 'Add your backing track (no vocals)'}
        </Heading>
        <p className="media-drop-hint" id={hintId}>
          STAR performers sing over a track with <strong>no vocals</strong>. Drop a file here or choose one · {AUDIO_FORMATS_TEXT} · up to 25 MB. Only
          share audio you have the right to share.
        </p>

        {current && (
          <div className={`audio-drop-current${markedForRemoval ? ' is-removed' : ''}`}>
            {current.play}
            <span className="audio-drop-current-text">
              {markedForRemoval ? 'The uploaded track will be removed when you save.' : (current.label ?? 'A backing track is uploaded for this song.')}
            </span>
            {markedForRemoval && onUndoRemove && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={onUndoRemove} disabled={locked} data-testid={`${testIdPrefix}-undo`}>
                <Undo2 size={16} aria-hidden="true" /> Keep it
              </button>
            )}
          </div>
        )}

        {pending && !busy && (
          <p className="file-chip audio-drop-pending" data-testid={`${testIdPrefix}-pending`}>
            <FileAudio size={16} aria-hidden="true" />
            <span className="truncate">{pending.name}</span>
            <span className="subtle">{formatBytes(pending.size)}</span>
            <span className="subtle">· uploads when you save</span>
            {onClearPending && (
              <button type="button" className="btn-icon btn-icon-sm" aria-label={`Don’t upload ${pending.name}`} onClick={onClearPending} data-testid={`${testIdPrefix}-pending-clear`}>
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </p>
        )}

        {busy ? (
          <UploadProgress status={busy} onCancel={onCancel} testIdPrefix={testIdPrefix} />
        ) : (
          <div className="media-drop-actions">
            <button
              type="button"
              id={id ? `${id}-choose` : undefined}
              className="btn btn-secondary btn-sm"
              onClick={() => inputRef.current?.click()}
              disabled={locked}
              aria-describedby={`${hintId}${shownError ? ` ${errorId}` : ''}`}
              data-testid={`${testIdPrefix}-choose`}
            >
              <CloudUpload size={16} aria-hidden="true" /> {has || pending ? 'Choose a different file' : 'Choose a file'}
            </button>
            {has && onRemove && (
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={onRemove} disabled={locked} data-testid={`${testIdPrefix}-remove`}>
                <Trash2 size={16} aria-hidden="true" /> Remove uploaded audio
              </button>
            )}
          </div>
        )}
        {shownError && (
          <p className="field-error" role="alert" id={errorId} data-testid={`${testIdPrefix}-upload-error`}>
            {shownError}
          </p>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={AUDIO_ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pick(file);
        }}
        data-testid={`${testIdPrefix}-file-input`}
      />
      {dragging && (
        <div className="media-drop-overlay" aria-hidden="true">
          <CloudUpload size={28} /> Drop to add this track
        </div>
      )}
    </div>
  );
}

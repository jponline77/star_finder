/**
 * Ownership UI (SPEC §7.17).
 *  - <AddedBy item={song} />      "Added by <name>" (community) / "From the STAR spreadsheet"
 *  - <OwnerControls item={song} editTo={`/songs/${id}/edit`} onDelete={…} noun="song" />
 *    Edit/Delete render only when canEdit(user, item) (admin or creator).
 */
import { Pencil, Sparkles, Trash2, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CreatedBy, Source } from '../types';
import { canEdit } from '../lib/permissions';
import { useAuth } from '../state/AuthProvider';
import { ConfirmDialog } from './ConfirmDialog';

export interface AddedByProps {
  item: { source: Source; createdBy: CreatedBy | null };
  className?: string;
}

export function AddedBy({ item, className = '' }: AddedByProps) {
  if (item.source === 'spreadsheet') {
    return (
      <span className={`added-by ${className}`.trim()} data-testid="added-by">
        <Sparkles size={14} aria-hidden="true" />
        From the STAR spreadsheet
      </span>
    );
  }
  return (
    <span className={`added-by ${className}`.trim()} data-testid="added-by">
      <Users size={14} aria-hidden="true" />
      Added by <strong>{item.createdBy ? <bdi>{item.createdBy.displayName}</bdi> : 'a former member'}</strong>
    </span>
  );
}

export interface OwnerControlsProps {
  item: { createdBy: CreatedBy | null };
  /** Link for the Edit button (or use onEdit). */
  editTo?: string;
  onEdit?: () => void;
  /** Delete handler; the confirm dialog shows errors if it throws. Omit to hide Delete. */
  onDelete?: () => Promise<void> | void;
  /** "song" | "show" — used in labels */
  noun?: string;
  confirmTitle?: ReactNode;
  confirmBody?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}

/** Edit / Delete buttons, visible only to the creator or an admin. data-testid: edit-button, delete-button. */
export function OwnerControls({ item, editTo, onEdit, onDelete, noun = 'song', confirmTitle, confirmBody, size = 'md', className = '' }: OwnerControlsProps) {
  const { user } = useAuth();
  const [confirming, setConfirming] = useState(false);
  if (!canEdit(user, item)) return null;
  const btn = size === 'sm' ? ' btn-sm' : '';
  return (
    <div className={`owner-controls ${className}`.trim()}>
      {editTo ? (
        <Link to={editTo} className={`btn btn-ghost${btn}`} data-testid="edit-button">
          <Pencil size={16} aria-hidden="true" /> Edit {noun}
        </Link>
      ) : onEdit ? (
        <button type="button" className={`btn btn-ghost${btn}`} onClick={onEdit} data-testid="edit-button">
          <Pencil size={16} aria-hidden="true" /> Edit {noun}
        </button>
      ) : null}
      {onDelete && (
        <>
          <button type="button" className={`btn btn-danger-ghost${btn}`} onClick={() => setConfirming(true)} data-testid="delete-button">
            <Trash2 size={16} aria-hidden="true" /> Delete
          </button>
          <ConfirmDialog
            open={confirming}
            title={confirmTitle ?? `Delete this ${noun}?`}
            confirmLabel={`Delete ${noun}`}
            onConfirm={async () => {
              await onDelete();
            }}
            onCancel={() => setConfirming(false)}
          >
            {confirmBody ?? <p>This can’t be undone — the {noun} and its comments will be removed for everyone.</p>}
            {user?.role !== 'admin' && (
              <p className="tiny subtle" data-testid="delete-others-comments-note">
                If other people have commented on this {noun}, only an admin can delete it.
              </p>
            )}
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}

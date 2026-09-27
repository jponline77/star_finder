/**
 * Confirmation dialog (e.g. delete). Two ways to use it:
 *
 * 1) Controlled:
 *    <ConfirmDialog open={open} title="Delete this song?" confirmLabel="Delete"
 *      onConfirm={async () => { await deleteSong(id); }} onCancel={() => setOpen(false)}>
 *      This can't be undone.
 *    </ConfirmDialog>
 *    (After onConfirm resolves the dialog calls onCancel() to close; if it throws, it stays open
 *    and shows the error.)
 *
 * 2) Promise hook:
 *    const { confirm, dialog } = useConfirm();
 *    if (await confirm({ title: 'Remove comment?', confirmLabel: 'Remove' })) { … }
 *    return <>{…}{dialog}</>;
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../api';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger (red, default) or primary (gold) */
  tone?: 'danger' | 'primary';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  testId?: string;
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Delete', cancelLabel = 'Cancel', tone = 'danger', onConfirm, onCancel, testId = 'confirm-dialog' }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onCancel();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) {
          setError(null);
          onCancel();
        }
      }}
      title={title}
      alert
      testId={testId}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={handleConfirm} disabled={busy} data-testid="confirm-button" autoFocus>
            {busy && <span className="spinner" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
      {error && (
        <p className="field-error" role="alert" style={{ marginTop: 'var(--space-sm)' }}>
          {error}
        </p>
      )}
    </Modal>
  );
}

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

/** Promise-based confirm. Render `dialog` somewhere in your component. */
export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    resolver.current?.(false);
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOptions(null);
  };

  const dialog = (
    <ConfirmDialog
      open={options !== null}
      title={options?.title ?? ''}
      confirmLabel={options?.confirmLabel}
      cancelLabel={options?.cancelLabel}
      tone={options?.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    >
      {options?.message}
    </ConfirmDialog>
  );
  return { confirm, dialog };
}

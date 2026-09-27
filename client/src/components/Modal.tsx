/**
 * Accessible modal built on the native <dialog> (focus trap, Esc, inert background for free).
 *
 *   <Modal open={open} onClose={() => setOpen(false)} title="Reset password" footer={<button …/>}>…</Modal>
 */
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Close when clicking the dimmed backdrop (default true). */
  closeOnBackdrop?: boolean;
  /** Hide the × button. */
  hideClose?: boolean;
  className?: string;
  testId?: string;
  /** role="alertdialog" for confirmations. */
  alert?: boolean;
}

export function Modal({ open, onClose, title, children, footer, wide = false, closeOnBackdrop = true, hideClose = false, className = '', testId, alert = false }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal-wide' : ''} ${className}`.trim()}
      aria-labelledby={titleId}
      role={alert ? 'alertdialog' : undefined}
      data-testid={testId}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="modal-header">
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            {!hideClose && (
              <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>
                <X size={20} aria-hidden="true" />
              </button>
            )}
          </div>
          {children !== undefined && <div className="modal-body">{children}</div>}
          {footer && <div className="modal-footer">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/**
 * Slide-over drawer (native <dialog>): used for the Browse filters on mobile.
 *
 *   <Drawer open={open} onClose={close} title="Filters" footer={<button …>Show 12 songs</button>}>…</Drawer>
 */
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'right' | 'left';
  id?: string;
  className?: string;
  testId?: string;
}

export function Drawer({ open, onClose, title, children, footer, side = 'right', id, className = '', testId }: DrawerProps) {
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
      id={id}
      className={`drawer${side === 'left' ? ' drawer-left' : ''} ${className}`.trim()}
      aria-labelledby={titleId}
      data-testid={testId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="drawer-header">
            <h2 id={titleId} className="drawer-title">
              {title}
            </h2>
            <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>
              <X size={22} aria-hidden="true" />
            </button>
          </div>
          <div className="drawer-body">{children}</div>
          {footer && <div className="drawer-footer">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

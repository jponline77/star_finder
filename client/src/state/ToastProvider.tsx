/**
 * Toast notifications.
 *
 *   const toast = useToast();
 *   toast.success('Added to your setlist ♥');
 *   toast.error(err);                 // accepts an Error/ApiError/unknown → friendly message
 *   toast.show('Heads up', { tone: 'warning', title: 'Almost!', action: { label: 'Undo', onClick } });
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { errorMessage } from '../api';

export type ToastTone = 'info' | 'success' | 'error' | 'warning';

export interface ToastOptions {
  title?: string;
  tone?: ToastTone;
  /**
   * ms before auto-dismiss (default 4500; errors 7000). 0 = stay until dismissed — the default for
   * toasts with an `action` (e.g. Undo), which keyboard users may need a while to reach.
   */
  duration?: number;
  action?: { label: string; onClick: () => void };
  /** Re-using an id replaces the existing toast (e.g. progress updates). */
  id?: string;
  /** Emoji shown instead of the tone icon. */
  emoji?: string;
}

export interface ToastItem extends Required<Pick<ToastOptions, 'tone' | 'duration'>> {
  id: string;
  message: string;
  title?: string;
  action?: ToastOptions['action'];
  emoji?: string;
}

export interface ToastApi {
  show: (message: string, options?: ToastOptions) => string;
  success: (message: string, options?: Omit<ToastOptions, 'tone'>) => string;
  info: (message: string, options?: Omit<ToastOptions, 'tone'>) => string;
  warning: (message: string, options?: Omit<ToastOptions, 'tone'>) => string;
  /** Accepts a string or any thrown value (uses errorMessage()). */
  error: (messageOrError: unknown, options?: Omit<ToastOptions, 'tone'>) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const MAX_TOASTS = 4;
let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    const tone = options.tone ?? 'info';
    const id = options.id ?? `t${++counter}`;
    const item: ToastItem = {
      id,
      message,
      tone,
      title: options.title,
      action: options.action,
      emoji: options.emoji,
      duration: options.duration ?? (options.action ? 0 : tone === 'error' ? 7000 : 4500),
    };
    setToasts((list) => {
      const without = list.filter((t) => t.id !== id);
      return [...without, item].slice(-MAX_TOASTS);
    });
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (m, o) => show(m, { ...o, tone: 'success' }),
      info: (m, o) => show(m, { ...o, tone: 'info' }),
      warning: (m, o) => show(m, { ...o, tone: 'warning' }),
      error: (e, o) => show(typeof e === 'string' ? e : errorMessage(e), { ...o, tone: 'error' }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: XCircle,
} as const;

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toast-region" aria-label="Notifications" role="region">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    remaining.current = toast.duration;
  }, [toast.duration, toast.message]);

  useEffect(() => {
    if (!toast.duration || paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, toast.duration, toast.id, toast.message, onDismiss]);

  const Icon = ICONS[toast.tone];
  return (
    <div
      className={`toast toast-${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-testid="toast"
    >
      <span className="toast-icon" aria-hidden="true">
        {toast.emoji ? <span className="toast-emoji">{toast.emoji}</span> : <Icon size={20} />}
      </span>
      <div className="toast-body">
        {toast.title && <p className="toast-title">{toast.title}</p>}
        <p className="toast-message">{toast.message}</p>
      </div>
      {toast.action && (
        <button
          type="button"
          className="btn btn-ghost btn-sm toast-action"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="btn-icon btn-icon-sm toast-close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../state/ToastProvider';

export interface CopyButtonProps {
  /** Text to copy (or a function returning it at click time). */
  text: string | (() => string);
  label?: string;
  copiedLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
  testId?: string;
}

/** Copies text to the clipboard (with a fallback) and confirms with ✓ + toast. */
export function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied!', className = '', size = 'md', testId = 'copy-button' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const onClick = async () => {
    const value = typeof text === 'function' ? text() : text;
    const ok = await copyText(value, buttonRef.current);
    if (ok) {
      setCopied(true);
      toast.success('Copied to your clipboard', { id: 'copy', emoji: '📋', duration: 2500 });
    } else {
      toast.error('Couldn’t copy — select the text and copy it yourself.', { id: 'copy' });
    }
  };

  return (
    <button ref={buttonRef} type="button" className={`btn ${size === 'sm' ? 'btn-sm ' : ''}btn-ghost ${className}`.trim()} onClick={() => void onClick()} data-testid={testId}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}

/**
 * Clipboard write with a textarea/execCommand fallback (navigator.clipboard is missing on plain-http
 * origins, e.g. a school LAN server). Resolves true only when the text really went to the clipboard.
 * `anchor` (the clicked button) tells the fallback which open modal <dialog> it's in: everything
 * outside a modal dialog is inert, so the helper textarea has to live inside it.
 */
export async function copyText(value: string, anchor?: Element | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  return legacyCopy(value, anchor);
}

function legacyCopy(value: string, anchor?: Element | null): boolean {
  const host = anchor?.closest('dialog[open]') ?? document.activeElement?.closest('dialog[open]') ?? document.body;
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.tabIndex = -1;
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  // Put the text on the clipboard ourselves from the copy event, so the result never depends on
  // what the browser managed to select.
  let handled = false;
  const onCopy = (e: ClipboardEvent) => {
    handled = true;
    if (!e.clipboardData) return; // very old browsers: the selection is what gets copied
    e.clipboardData.setData('text/plain', value);
    e.preventDefault();
  };
  // select() can move focus into the helper textarea; put it back afterwards (keyboard users).
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.addEventListener('copy', onCopy);
  try {
    host.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    return ok && handled;
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', onCopy);
    ta.remove();
    if (previouslyFocused?.isConnected && document.activeElement !== previouslyFocused) previouslyFocused.focus({ preventScroll: true });
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render';
import { CopyButton } from '../CopyButton';

// A plain-http origin: no async clipboard API, so the textarea + execCommand fallback runs.
let realClipboard: PropertyDescriptor | undefined;
let realExec: typeof document.execCommand;
beforeEach(() => {
  realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  realExec = document.execCommand;
});
afterEach(() => {
  if (realClipboard) Object.defineProperty(navigator, 'clipboard', realClipboard);
  else delete (navigator as unknown as Record<string, unknown>).clipboard;
  document.execCommand = realExec;
});

/** execCommand('copy') that behaves like a browser: fires a cancellable copy event. */
function fakeExecCommand(options: { withClipboardData: boolean; fireEvent?: boolean }) {
  const written: string[] = [];
  const hosts: Array<string | undefined> = [];
  document.execCommand = vi.fn((cmd: string) => {
    if (cmd !== 'copy') return false;
    const ta = document.querySelector<HTMLTextAreaElement>('textarea[readonly]');
    hosts.push(ta?.parentElement?.tagName);
    ta?.focus(); // like Chrome, where select() moves focus into the textarea
    if (options.fireEvent === false) return true;
    const e = new Event('copy', { cancelable: true });
    if (options.withClipboardData) Object.defineProperty(e, 'clipboardData', { value: { setData: (_t: string, v: string) => written.push(v) } });
    document.dispatchEvent(e);
    return true;
  }) as typeof document.execCommand;
  return { written, hosts };
}

describe('CopyButton fallback', () => {
  it('copies from inside an open modal dialog (the rest of the page is inert)', async () => {
    const { written, hosts } = fakeExecCommand({ withClipboardData: true });
    renderWithProviders(
      <dialog open>
        <p>Temporary password: Tmp-Pass-1234</p>
        <CopyButton text="Tmp-Pass-1234" label="Copy password" testId="copy-temp-password" />
      </dialog>,
    );
    const button = screen.getByTestId('copy-temp-password');
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByText('Copied to your clipboard')).toBeInTheDocument();
    expect(hosts).toEqual(['DIALOG']);
    expect(button).toHaveFocus(); // the helper textarea doesn't steal keyboard focus
    expect(written).toEqual(['Tmp-Pass-1234']);
    expect(document.querySelector('textarea[readonly]')).toBeNull();
  });

  it('reports failure instead of a false “Copied” when nothing reached the clipboard', async () => {
    fakeExecCommand({ withClipboardData: true, fireEvent: false });
    renderWithProviders(<CopyButton text="secret" label="Copy password" testId="copy" />);
    fireEvent.click(screen.getByTestId('copy'));
    await waitFor(() => expect(screen.getByText(/Couldn’t copy/)).toBeInTheDocument());
    expect(screen.queryByText('Copied to your clipboard')).toBeNull();
  });

  it('uses the page body outside dialogs', async () => {
    const { written, hosts } = fakeExecCommand({ withClipboardData: true });
    renderWithProviders(<CopyButton text="https://example.test/setlist?ids=1,2" label="Copy share link" testId="copy" />);
    fireEvent.click(screen.getByTestId('copy'));
    expect(await screen.findByText('Copied to your clipboard')).toBeInTheDocument();
    expect(hosts).toEqual(['BODY']);
    expect(written).toEqual(['https://example.test/setlist?ids=1,2']);
  });
});

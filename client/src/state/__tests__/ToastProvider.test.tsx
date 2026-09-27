import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '../ToastProvider';

afterEach(() => vi.useRealTimers());

function Buttons({ onUndo }: { onUndo: () => void }) {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.info('Removed from your setlist', { action: { label: 'Undo', onClick: onUndo } })}>
        with undo
      </button>
      <button type="button" onClick={() => toast.info('Saved')}>
        plain
      </button>
    </>
  );
}

describe('ToastProvider', () => {
  it('keeps toasts with an action (Undo) until dismissed, but plain ones time out', () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Buttons onUndo={onUndo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'with undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'plain' }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByText('Removed from your setlist')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Removed from your setlist')).toBeNull();
  });
});

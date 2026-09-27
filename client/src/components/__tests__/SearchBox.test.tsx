import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { isSearchShortcut, SearchBox } from '../SearchBox';

describe('SearchBox shortcut', () => {
  it('is a modifier shortcut (Ctrl+K / ⌘K), never a bare printable key (WCAG 2.1.4)', () => {
    const k = (over: Partial<KeyboardEvent>) => ({ key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });
    expect(isSearchShortcut(k({ key: '/' }), false)).toBe(false);
    expect(isSearchShortcut(k({}), false)).toBe(false);
    expect(isSearchShortcut(k({ ctrlKey: true }), false)).toBe(true);
    expect(isSearchShortcut(k({ key: 'K', ctrlKey: true }), false)).toBe(true);
    expect(isSearchShortcut(k({ metaKey: true }), true)).toBe(true);
    expect(isSearchShortcut(k({ ctrlKey: true }), true)).toBe(false); // Ctrl+K edits text on a Mac
    expect(isSearchShortcut(k({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
  });

  it('a bare "/" no longer steals focus from a button', () => {
    render(
      <>
        <button type="button">Heart</button>
        <SearchBox value="" onChange={() => undefined} />
      </>,
    );
    const button = screen.getByRole('button', { name: 'Heart' });
    button.focus();
    fireEvent.keyDown(button, { key: '/' });
    expect(button).toHaveFocus();
    fireEvent.keyDown(button, { key: 'k', ctrlKey: true, metaKey: true });
    expect(button).toHaveFocus();
    fireEvent.keyDown(button, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(button, { key: 'k', metaKey: true });
    expect(screen.getByTestId('search-input')).toHaveFocus();
  });
});

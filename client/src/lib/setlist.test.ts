import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  __resetSetlistCacheForTests,
  addToSetlist,
  clearSetlist,
  getSetlist,
  importSetlist,
  isInSetlist,
  moveInSetlist,
  parseSetlistParam,
  removeFromSetlist,
  sanitizeIds,
  SETLIST_MAX,
  SETLIST_STORAGE_KEY,
  setlistShareUrl,
  subscribeSetlist,
  toggleSetlist,
  useSetlist,
} from './setlist';

beforeEach(() => {
  window.localStorage.clear();
  __resetSetlistCacheForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('sanitizeIds', () => {
  it('keeps unique positive integers in order', () => {
    expect(sanitizeIds([3, 1, 3, -1, 0, 2.5, '4', 'x', null, 1])).toEqual([3, 1, 4]);
    expect(sanitizeIds('5, 6,,7 5')).toEqual([5, 6, 7]);
    expect(sanitizeIds(9)).toEqual([9]);
    expect(sanitizeIds({})).toEqual([]);
  });
  it('caps the list length', () => {
    const many = Array.from({ length: SETLIST_MAX + 50 }, (_, i) => i + 1);
    expect(sanitizeIds(many)).toHaveLength(SETLIST_MAX);
  });
});

describe('setlist storage', () => {
  it('adds, toggles, removes, persists', () => {
    addToSetlist(5);
    addToSetlist(5);
    addToSetlist(2);
    expect(getSetlist()).toEqual([5, 2]);
    expect(JSON.parse(window.localStorage.getItem(SETLIST_STORAGE_KEY)!)).toEqual([5, 2]);
    expect(toggleSetlist(2)).toBe(false);
    expect(toggleSetlist(9)).toBe(true);
    expect(isInSetlist(9)).toBe(true);
    removeFromSetlist(5);
    expect(getSetlist()).toEqual([9]);
    clearSetlist();
    expect(getSetlist()).toEqual([]);
  });
  it('returns a stable reference between changes', () => {
    addToSetlist(1);
    expect(getSetlist()).toBe(getSetlist());
  });
  it('reads existing storage and ignores garbage', () => {
    window.localStorage.setItem(SETLIST_STORAGE_KEY, '[4, "x", 4, 8]');
    __resetSetlistCacheForTests();
    expect(getSetlist()).toEqual([4, 8]);
    window.localStorage.setItem(SETLIST_STORAGE_KEY, '{not json');
    __resetSetlistCacheForTests();
    expect(getSetlist()).toEqual([]);
  });
  it('moves items', () => {
    importSetlist([1, 2, 3, 4], 'replace');
    moveInSetlist(0, 2);
    expect(getSetlist()).toEqual([2, 3, 1, 4]);
    moveInSetlist(3, 0);
    expect(getSetlist()).toEqual([4, 2, 3, 1]);
    moveInSetlist(9, 0);
    moveInSetlist(-1, 0);
    expect(getSetlist()).toEqual([4, 2, 3, 1]);
  });
  it('imports by merging or replacing', () => {
    importSetlist([1, 2], 'replace');
    expect(importSetlist('2,3,4')).toBe(2);
    expect(getSetlist()).toEqual([1, 2, 3, 4]);
    expect(importSetlist([9], 'replace')).toBe(1);
    expect(getSetlist()).toEqual([9]);
    expect(importSetlist('')).toBe(0);
  });
  it('notifies subscribers', () => {
    const fn = vi.fn();
    const unsub = subscribeSetlist(fn);
    addToSetlist(1);
    addToSetlist(1); // no change → no notify
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    addToSetlist(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('keeps working in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    __resetSetlistCacheForTests();
    expect(getSetlist()).toEqual([]);
    addToSetlist(3);
    expect(getSetlist()).toEqual([3]);
    __resetSetlistCacheForTests();
    expect(getSetlist()).toEqual([]);
  });
  it('share URLs and params', () => {
    expect(setlistShareUrl([1, 2, 3], 'https://x.test')).toBe('https://x.test/setlist?ids=1,2,3');
    expect(setlistShareUrl([], 'https://x.test')).toBe('https://x.test/setlist');
    expect(parseSetlistParam('1,2,abc,2')).toEqual([1, 2]);
    expect(parseSetlistParam(null)).toEqual([]);
  });
});

describe('useSetlist', () => {
  it('re-renders on change', () => {
    const { result } = renderHook(() => useSetlist());
    expect(result.current.count).toBe(0);
    act(() => {
      result.current.toggle(7);
    });
    expect(result.current.ids).toEqual([7]);
    expect(result.current.has(7)).toBe(true);
    act(() => {
      addToSetlist(8);
    });
    expect(result.current.count).toBe(2);
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });
  it('picks up changes from other tabs (storage event)', () => {
    const { result } = renderHook(() => useSetlist());
    act(() => {
      window.localStorage.setItem(SETLIST_STORAGE_KEY, '[11,12]');
      window.dispatchEvent(new StorageEvent('storage', { key: SETLIST_STORAGE_KEY }));
    });
    expect(result.current.ids).toEqual([11, 12]);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { clearAllDrafts, clearDraft, DRAFT_MAX_AGE_MS, readDraft, saveDraft } from './drafts';

afterEach(() => window.sessionStorage.clear());

describe('drafts', () => {
  it('saves to sessionStorage and reads back for the same account only', () => {
    expect(saveDraft('song-form:add', 7, { title: 'Draft' }, 1_000)).toBe(true);
    expect(window.localStorage.length).toBe(0);
    expect(readDraft('song-form:add', 7, 2_000)).toEqual({ title: 'Draft' });
    expect(readDraft('song-form:add', 7, 2_000)).toEqual({ title: 'Draft' }); // reading is pure
    expect(readDraft('song-form:add', 8, 2_000)).toBeNull();
    clearDraft('song-form:add');
    expect(readDraft('song-form:add', 7, 2_000)).toBeNull();
  });
  it('ignores expired or malformed drafts', () => {
    saveDraft('a', 1, 'x', 0);
    expect(readDraft('a', 1, DRAFT_MAX_AGE_MS + 1)).toBeNull();
    window.sessionStorage.setItem('star.draft.v1:b', '{nope');
    expect(readDraft('b', 1)).toBeNull();
  });
  it('clearAllDrafts removes only drafts', () => {
    saveDraft('a', 1, 'x');
    saveDraft('b', 1, 'y');
    window.sessionStorage.setItem('other', 'keep');
    clearAllDrafts();
    expect(readDraft('a', 1)).toBeNull();
    expect(readDraft('b', 1)).toBeNull();
    expect(window.sessionStorage.getItem('other')).toBe('keep');
  });
});

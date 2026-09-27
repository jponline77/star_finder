import { describe, expect, it } from 'vitest';
import { makeComment, makeSong, makeUser } from '../test/fixtures';
import { canContribute, canDeleteComment, canEdit, canEditComment, isAdmin, isOwner } from './permissions';

const me = makeUser({ id: 7 });
const admin = makeUser({ id: 1, role: 'admin' });
const other = makeUser({ id: 8 });
const mine = makeSong({ source: 'community', createdBy: { id: 7, displayName: 'Stage Kid' } });
const spreadsheet = makeSong({ source: 'spreadsheet', createdBy: null });

describe('permissions', () => {
  it('isAdmin', () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(me)).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
  it('owners can edit their own rows', () => {
    expect(isOwner(me, mine)).toBe(true);
    expect(canEdit(me, mine)).toBe(true);
    expect(canEdit(other, mine)).toBe(false);
  });
  it('admins can edit anything, including spreadsheet rows', () => {
    expect(canEdit(admin, mine)).toBe(true);
    expect(canEdit(admin, spreadsheet)).toBe(true);
    expect(canEdit(me, spreadsheet)).toBe(false);
    expect(isOwner(me, spreadsheet)).toBe(false);
  });
  it('logged-out users can edit nothing', () => {
    expect(canEdit(null, mine)).toBe(false);
    expect(canEdit(me, null)).toBe(false);
    expect(canContribute(null)).toBe(false);
    expect(canContribute(me)).toBe(true);
  });
  it('comments: author or admin', () => {
    const c = makeComment({ author: { id: 7, displayName: 'Stage Kid', role: 'user' } });
    expect(canEditComment(me, c)).toBe(true);
    expect(canDeleteComment(me, c)).toBe(true);
    expect(canEditComment(other, c)).toBe(false);
    expect(canDeleteComment(other, c)).toBe(false);
    expect(canDeleteComment(admin, c)).toBe(true);
    expect(canEditComment(admin, c)).toBe(true);
    expect(canDeleteComment(null, c)).toBe(false);
  });
});

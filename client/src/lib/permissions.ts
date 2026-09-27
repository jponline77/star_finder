/**
 * Client-side permission checks (SPEC §5a / §7.17). The server enforces the real rules — these
 * only decide which controls to show.
 */
import type { Comment, CreatedBy, User } from '../types';

type MaybeUser = Pick<User, 'id' | 'role'> | null | undefined;

export function isAdmin(user: MaybeUser): boolean {
  return !!user && user.role === 'admin';
}

/** Anything that records who created it (Song, Show). */
export interface Ownable {
  createdBy: Pick<CreatedBy, 'id'> | null;
}

/** The logged-in user created this row. */
export function isOwner(user: MaybeUser, item: Ownable | null | undefined): boolean {
  return !!user && !!item && !!item.createdBy && item.createdBy.id === user.id;
}

/**
 * Edit/Delete/upload allowed: `user && (user.role === 'admin' || user.id === item.createdBy?.id)`.
 * Spreadsheet rows (createdBy null) are editable by admins only.
 */
export function canEdit(user: MaybeUser, item: Ownable | null | undefined): boolean {
  if (!user || !item) return false;
  return isAdmin(user) || isOwner(user, item);
}

/** Any logged-in user may add songs/shows and comment. */
export function canContribute(user: MaybeUser): boolean {
  return !!user;
}

/** Comment authors and admins may edit a comment. */
export function canEditComment(user: MaybeUser, comment: Pick<Comment, 'author'> | null | undefined): boolean {
  if (!user || !comment) return false;
  return isAdmin(user) || comment.author.id === user.id;
}

/** Comment authors and admins may delete a comment. */
export function canDeleteComment(user: MaybeUser, comment: Pick<Comment, 'author'> | null | undefined): boolean {
  return canEditComment(user, comment);
}

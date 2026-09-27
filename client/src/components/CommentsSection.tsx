/**
 * "Backstage Chatter" — comments for a song or a show (SPEC §5b, §7.16).
 *
 *   <CommentsSection target={{ type: 'song', id: song.id }} />
 *   <CommentsSection target={{ type: 'show', id: show.slug }} onCountChange={(n) => …} />
 *
 * - Public list (oldest first) with tag chips, author + Admin badge, relative time, "edited".
 * - Logged in: composer (1000-char counter + tag picker). Logged out: "Log in to join" prompt.
 * - Authors edit/delete their own; admins can edit/delete any (delete asks for confirmation).
 * - Keeps the cached song's commentCount in sync (SongsProvider) for song targets.
 *
 * data-testids: comments-section, comment, comment-body, comment-input, comment-tag-<tag>,
 * comment-submit, comment-edit, comment-delete, comment-save, comment-login-prompt, comment-filter-<tag|all>.
 */
import { MessageSquarePlus, Pencil, Send, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { deleteComment, errorMessage, isApiError, listComments, postComment, updateComment } from '../api';
import type { Comment, CommentTag, CommentTarget } from '../types';
import { formatDate, relativeTime } from '../lib/format';
import { loginHref, signupHref } from '../lib/links';
import { clearDraft, readDraft, saveDraft } from '../lib/drafts';
import { canDeleteComment, canEditComment } from '../lib/permissions';
import { charCount } from '../lib/validation';
import { COMMENT_MAX_LENGTH, COMMENT_TAG_EMOJI, COMMENT_TAG_LABEL, COMMENT_TAGS } from '../lib/vocab';
import { useApiData } from '../hooks/useApiData';
import { useAuth, useKeepDraftOnSessionEnd } from '../state/AuthProvider';
import { useSongs } from '../state/SongsProvider';
import { useToast } from '../state/ToastProvider';
import { useConfirm } from './ConfirmDialog';
import { UserAvatar } from './CharacterAvatar';
import { EmptyState, ErrorState } from './EmptyState';
import { Skeleton } from './Skeletons';

export interface CommentsSectionProps {
  target: CommentTarget;
  /** Section heading (default "Backstage Chatter"). */
  title?: string;
  /** Called whenever the number of comments changes (after load, post, delete). */
  onCountChange?: (count: number) => void;
  className?: string;
}

type TagFilter = 'all' | CommentTag;

/** Draft keys (lib/drafts) for a session that ends while typing. */
const newCommentDraftKey = (targetKey: string) => `comment:${targetKey}`;
const editCommentDraftKey = (id: number) => `comment-edit:${id}`;

interface CommentDraft {
  body: string;
  tag: CommentTag;
}

export function CommentsSection({ target, title = 'Backstage Chatter', onCountChange, className = '' }: CommentsSectionProps) {
  const { user } = useAuth();
  const toast = useToast();
  const { patchSong } = useSongs();
  const location = useLocation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const { confirm, dialog } = useConfirm();
  const [filter, setFilter] = useState<TagFilter>('all');
  const [editingId, setEditingId] = useState<number | null>(null);
  const targetKey = `${target.type}:${target.id}`;

  const { data, loading, error, reload, setData } = useApiData((signal) => listComments(target, signal), [targetKey]);
  const comments = useMemo(() => data?.comments ?? [], [data]);

  // keep counts in sync
  const onCountRef = useRef(onCountChange);
  useEffect(() => {
    onCountRef.current = onCountChange;
  });
  const count = data ? comments.length : null;
  useEffect(() => {
    if (count === null) return;
    onCountRef.current?.(count);
    if (target.type === 'song' && typeof target.id === 'number') patchSong(target.id, { commentCount: count });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, targetKey]);

  const setComments = (fn: (list: Comment[]) => Comment[]) => setData((prev) => ({ comments: fn(prev?.comments ?? []) }));

  const tagCounts = useMemo(() => {
    const c: Record<CommentTag, number> = { general: 0, tip: 0, question: 0, performed: 0 };
    for (const cm of comments) c[cm.tag] += 1;
    return c;
  }, [comments]);
  // A tag filter only makes sense while its chip is shown (2+ comments, and some with that tag).
  // After a delete/edit empties it, fall back to "All" instead of hiding the remaining comments.
  const activeFilter: TagFilter = filter !== 'all' && comments.length > 1 && tagCounts[filter] > 0 ? filter : 'all';
  useEffect(() => {
    if (filter !== activeFilter && data) setFilter('all');
  }, [filter, activeFilter, data]);
  const visible = activeFilter === 'all' ? comments : comments.filter((c) => c.tag === activeFilter);

  // Back from logging in after the session ended mid-edit? Re-open the comment being edited.
  const reopenedEdit = useRef(false);
  useEffect(() => {
    if (reopenedEdit.current || !user || !data) return;
    reopenedEdit.current = true;
    const draft = data.comments.find((c) => readDraft(editCommentDraftKey(c.id), user.id) !== null);
    if (draft) setEditingId(draft.id);
  }, [data, user]);

  const handlePost = async (body: string, tag: CommentTag) => {
    const created = await postComment(target, { body, tag });
    setComments((list) => [...list, created]);
    setFilter((f) => (f === 'all' || f === created.tag ? f : 'all'));
    toast.success('Your comment is live — thanks for sharing!', { emoji: '🎤', id: 'comment' });
  };

  const handleSave = async (comment: Comment, body: string, tag: CommentTag) => {
    const updated = await updateComment(comment.id, { body, tag });
    setComments((list) => list.map((c) => (c.id === updated.id ? updated : c)));
    setEditingId(null);
    toast.success('Comment updated', { id: 'comment' });
  };

  const handleDelete = async (comment: Comment) => {
    const mine = user?.id === comment.author.id;
    const ok = await confirm({
      title: mine ? 'Delete your comment?' : `Remove ${comment.author.displayName}’s comment?`,
      message: <p>This can’t be undone.</p>,
      confirmLabel: mine ? 'Delete' : 'Remove',
    });
    if (!ok) return;
    // The focused Delete button disappears with its comment — move focus somewhere sensible:
    // the next comment's first control, else the previous one's, else the section heading.
    const refocus = () =>
      requestAnimationFrame(() => {
        const items = [...(sectionRef.current?.querySelectorAll<HTMLElement>('[data-comment-id]') ?? [])];
        const at = visible.findIndex((c) => c.id === comment.id);
        const neighbour = visible[at + 1] ?? visible[at - 1];
        const item = neighbour ? items.find((el) => el.dataset.commentId === String(neighbour.id)) : undefined;
        const control = item?.querySelector<HTMLElement>('button, a[href]');
        (control ?? headingRef.current)?.focus();
      });
    try {
      await deleteComment(comment.id);
      setComments((list) => list.filter((c) => c.id !== comment.id));
      refocus();
      toast.info(mine ? 'Comment deleted' : 'Comment removed', { id: 'comment' });
    } catch (e) {
      if (isApiError(e) && e.status === 404) {
        setComments((list) => list.filter((c) => c.id !== comment.id));
        refocus();
        return;
      }
      toast.error(e);
    }
  };

  const here = `${location.pathname}${location.search}`;

  return (
    <section id="comments" ref={sectionRef} className={`comments-section ${className}`.trim()} aria-labelledby={headingId} data-testid="comments-section">
      <div className="comments-header">
        <h2 id={headingId} className="section-title" ref={headingRef} tabIndex={-1}>
          <span className="emoji" aria-hidden="true">
            🎭
          </span>
          {title}
          {count !== null && (
            <span className="chip-count" aria-label={`${count} comments`}>
              {count}
            </span>
          )}
        </h2>
        {comments.length > 1 && (
          <div className="comments-filters chip-group" role="group" aria-label="Filter comments by tag">
            <button type="button" className="chip" aria-pressed={activeFilter === 'all'} onClick={() => setFilter('all')} data-testid="comment-filter-all">
              All
            </button>
            {COMMENT_TAGS.filter((t) => tagCounts[t] > 0).map((t) => (
              <button key={t} type="button" className="chip" aria-pressed={activeFilter === t} onClick={() => setFilter(t)} data-testid={`comment-filter-${t}`}>
                <span aria-hidden="true">{COMMENT_TAG_EMOJI[t]}</span> {COMMENT_TAG_LABEL[t]}
                <span className="chip-count">{tagCounts[t]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && !data ? (
        <div className="stack" role="status" aria-live="polite">
          <span className="visually-hidden">Loading comments…</span>
          {[0, 1].map((i) => (
            <div key={i} className="comment" aria-hidden="true">
              <Skeleton width={36} height={36} radius="50%" />
              <div className="stack stack-sm" style={{ flex: 1 }}>
                <Skeleton width="40%" height={14} />
                <Skeleton height={14} />
              </div>
            </div>
          ))}
        </div>
      ) : error && !data ? (
        <ErrorState title="Comments missed their cue" message={errorMessage(error)} onRetry={reload} />
      ) : comments.length === 0 ? (
        <EmptyState emoji="🦗" title="Crickets in the wings…" level={3} className="comments-empty">
          <p>No one has said anything yet. Share a tip, ask a question, or tell us how your performance went!</p>
        </EmptyState>
      ) : (
        <ol className="comment-list" role="list">
          {visible.map((c) =>
            editingId === c.id ? (
              <li key={c.id} className="comment is-editing" data-testid="comment">
                <UserAvatar name={c.author.displayName} size="sm" />
                <div className="comment-main">
                  <CommentComposer
                    initialBody={c.body}
                    initialTag={c.tag}
                    submitLabel="Save"
                    submitTestId="comment-save"
                    draftKey={editCommentDraftKey(c.id)}
                    autoFocus
                    onSubmit={(body, tag) => handleSave(c, body, tag)}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              </li>
            ) : (
              <CommentItem
                key={c.id}
                comment={c}
                mine={user?.id === c.author.id}
                canEdit={canEditComment(user, c)}
                canDelete={canDeleteComment(user, c)}
                onEdit={() => setEditingId(c.id)}
                onDelete={() => void handleDelete(c)}
              />
            ),
          )}
        </ol>
      )}

      <div className="comment-composer-wrap">
        {user ? (
          <div className="comment-new">
            <UserAvatar name={user.displayName} size="sm" />
            <div className="comment-main">
              <p className="comment-as small muted">
                Posting as <strong><bdi>{user.displayName}</bdi></strong>
              </p>
              <CommentComposer submitLabel="Post comment" submitTestId="comment-submit" onSubmit={handlePost} resetOnSubmit draftKey={newCommentDraftKey(targetKey)} />
            </div>
          </div>
        ) : (
          <div className="comment-login callout" data-testid="comment-login-prompt">
            <MessageSquarePlus aria-hidden="true" />
            <div className="stack stack-sm">
              <p>
                <strong>Log in to join the conversation.</strong> Share tips, ask questions, or tell everyone you performed it!
              </p>
              <div className="cluster">
                <Link className="btn btn-primary btn-sm" to={loginHref(`${here}#comments`)}>
                  Log in
                </Link>
                <Link className="btn btn-ghost btn-sm" to={signupHref(`${here}#comments`)}>
                  Get a backstage pass
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
      {dialog}
    </section>
  );
}

// ---------------------------------------------------------------------------

interface CommentItemProps {
  comment: Comment;
  mine: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function CommentItem({ comment: c, mine, canEdit, canDelete, onEdit, onDelete }: CommentItemProps) {
  return (
    <li className={`comment${mine ? ' is-mine' : ''}`} data-testid="comment" data-comment-id={c.id}>
      <UserAvatar name={c.author.displayName} size="sm" />
      <div className="comment-main">
        <div className="comment-meta">
          <strong className="comment-author">
            <bdi>{c.author.displayName}</bdi>
          </strong>
          {c.author.role === 'admin' && (
            <span className="badge badge-gold" title="Site admin">
              <span aria-hidden="true">👑</span> Admin
            </span>
          )}
          {mine && <span className="badge badge-outline">You</span>}
          <span className={`comment-tag comment-tag-${c.tag}`}>
            <span aria-hidden="true">{COMMENT_TAG_EMOJI[c.tag]}</span> {COMMENT_TAG_LABEL[c.tag]}
          </span>
          <span className="comment-time">
            <time dateTime={c.createdAt} title={formatDate(c.createdAt)}>
              {relativeTime(c.createdAt)}
            </time>
            {c.edited && (
              <span className="comment-edited" title={`Edited ${formatDate(c.updatedAt)}`}>
                {' '}
                · edited
              </span>
            )}
          </span>
        </div>
        <p className="comment-body" data-testid="comment-body">
          {c.body}
        </p>
        {(canEdit || canDelete) && (
          <div className="comment-actions">
            {canEdit && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={onEdit} data-testid="comment-edit">
                <Pencil size={14} aria-hidden="true" /> Edit
              </button>
            )}
            {canDelete && (
              <button type="button" className="btn btn-quiet btn-sm comment-delete" onClick={onDelete} data-testid="comment-delete">
                <Trash2 size={14} aria-hidden="true" /> {mine ? 'Delete' : 'Remove'}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

export interface CommentComposerProps {
  initialBody?: string;
  initialTag?: CommentTag;
  submitLabel: string;
  submitTestId?: string;
  onSubmit: (body: string, tag: CommentTag) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Clear the form after a successful submit. */
  resetOnSubmit?: boolean;
  /** Keep the text (lib/drafts) if the session ends before it's sent, and restore it on return. */
  draftKey?: string;
}

/** Textarea + 1000-char counter + tag picker. Shows server errors inline. */
export function CommentComposer({ initialBody = '', initialTag = 'general', submitLabel, submitTestId, onSubmit, onCancel, autoFocus, resetOnSubmit, draftKey }: CommentComposerProps) {
  const { user } = useAuth();
  const [restored] = useState(() => (draftKey && user ? readDraft<CommentDraft>(draftKey, user.id) : null));
  const [body, setBody] = useState(() => (typeof restored?.body === 'string' ? restored.body : initialBody));
  const [tag, setTag] = useState<CommentTag>(() => (restored && COMMENT_TAGS.includes(restored.tag) ? restored.tag : initialTag));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const trimmed = body.trim();
  // counted like the server does (code points), so emoji aren't counted twice
  const len = charCount(trimmed);
  const over = len > COMMENT_MAX_LENGTH;
  const near = !over && len > COMMENT_MAX_LENGTH * 0.9;
  // Screen readers hear the limit only when crossing a threshold, not "1/1000, 2/1000…" per key.
  const limitMessage = over
    ? `Your comment is over the ${COMMENT_MAX_LENGTH}-character limit.`
    : near
      ? `${COMMENT_MAX_LENGTH - Math.floor(COMMENT_MAX_LENGTH * 0.9)} characters or fewer left.`
      : '';

  useEffect(() => {
    if (draftKey) clearDraft(draftKey);
  }, [draftKey]);
  useKeepDraftOnSessionEnd((userId) => (draftKey && trimmed && body !== initialBody ? saveDraft<CommentDraft>(draftKey, userId, { body, tag }) : false));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || over || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(trimmed, tag);
      if (resetOnSubmit) {
        setBody('');
        setTag('general');
      }
    } catch (e2) {
      setErr(isApiError(e2) ? e2.field('body') ?? e2.message : errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="comment-composer" onSubmit={submit} noValidate>
      <label htmlFor={`${id}-body`} className="visually-hidden">
        Your comment
      </label>
      <textarea
        id={`${id}-body`}
        className="textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Share a tip, ask a question, or tell us how it went…"
        rows={3}
        autoFocus={autoFocus}
        aria-invalid={over || undefined}
        aria-describedby={`${id}-count${err ? ` ${id}-err` : ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(e);
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
        data-testid="comment-input"
      />
      <div className="comment-composer-row">
        <fieldset className="fieldset comment-tag-picker">
          <legend className="visually-hidden">Tag</legend>
          {COMMENT_TAGS.map((t) => (
            <label key={t} className="chip chip-radio" data-testid={`comment-tag-${t}`}>
              <input type="radio" name={`${id}-tag`} value={t} checked={tag === t} onChange={() => setTag(t)} className="visually-hidden" />
              <span aria-hidden="true">{COMMENT_TAG_EMOJI[t]}</span> {COMMENT_TAG_LABEL[t]}
            </label>
          ))}
        </fieldset>
        <span id={`${id}-count`} className={`char-counter${over ? ' is-over' : near ? ' is-near' : ''}`}>
          {len}/{COMMENT_MAX_LENGTH}
          {over && <span className="visually-hidden"> — too long</span>}
        </span>
        <span className="visually-hidden" aria-live="polite" data-testid="comment-limit-status">
          {limitMessage}
        </span>
      </div>
      {err && (
        <p id={`${id}-err`} className="field-error" role="alert">
          {err}
        </p>
      )}
      <div className="comment-composer-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary btn-sm" disabled={!trimmed || over || busy} data-testid={submitTestId}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

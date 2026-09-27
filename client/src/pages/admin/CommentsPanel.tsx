/**
 * Admin → Comments: moderation feed (GET /api/admin/comments, newest first) with tag filter,
 * text filter, target links, Remove (confirm → DELETE /api/comments/:id) and "Load more".
 */
import { Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { deleteComment, isApiError } from '../../api';
import { UserAvatar } from '../../components/CharacterAvatar';
import { useConfirm } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { formatDate, relativeTime } from '../../lib/format';
import { normalizeText } from '../../lib/normalize';
import { COMMENT_TAG_EMOJI, COMMENT_TAG_LABEL, COMMENT_TAGS } from '../../lib/vocab';
import { useSongs } from '../../state/SongsProvider';
import { useToast } from '../../state/ToastProvider';
import type { Comment, CommentTag } from '../../types';
import { commentTargetHref, excerpt } from '../me/Contributions';

export interface CommentsPanelProps {
  comments: Comment[];
  /** true when the server may have older comments (the page was full). */
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRemoved: (id: number) => void;
}

export function CommentsPanel({ comments, hasMore, loadingMore, onLoadMore, onRemoved }: CommentsPanelProps) {
  const [tag, setTag] = useState<'all' | CommentTag>('all');
  const [q, setQ] = useState('');
  const { confirm, dialog } = useConfirm();
  const { getSong, patchSong } = useSongs();
  const toast = useToast();

  const visible = useMemo(() => {
    const needle = normalizeText(q);
    return comments.filter((c) => (tag === 'all' || c.tag === tag) && (!needle || normalizeText(`${c.body} ${c.author.displayName} ${c.target.title}`).includes(needle)));
  }, [comments, tag, q]);

  const remove = async (c: Comment) => {
    const ok = await confirm({
      title: `Remove ${c.author.displayName}’s comment?`,
      message: (
        <>
          <blockquote className="admin-quote">{excerpt(c.body, 180)}</blockquote>
          <p>It will disappear from “{c.target.title}” for everyone. This can’t be undone.</p>
        </>
      ),
      confirmLabel: 'Remove comment',
    });
    if (!ok) return;
    try {
      await deleteComment(c.id);
    } catch (e) {
      if (!(isApiError(e) && e.status === 404)) {
        toast.error(e);
        return;
      }
    }
    onRemoved(c.id);
    if (c.target.type === 'song') {
      const cached = getSong(c.target.id);
      if (cached) patchSong(c.target.id, { commentCount: Math.max(0, cached.commentCount - 1) });
    }
    toast.info('Comment removed', { emoji: '🧹', id: 'admin-comment' });
  };

  if (comments.length === 0) {
    return (
      <EmptyState emoji="🦗" title="All quiet backstage" level={3}>
        <p>No one has commented yet. New comments will show up here, newest first.</p>
      </EmptyState>
    );
  }

  return (
    <div className="admin-comments">
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search size={18} aria-hidden="true" />
          <span className="visually-hidden">Search comments</span>
          <input type="search" className="input" placeholder="Search text, author or song…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="comment-search" />
        </label>
        <div className="chip-group" role="group" aria-label="Filter by tag">
          <button type="button" className="chip" aria-pressed={tag === 'all'} onClick={() => setTag('all')} data-testid="admin-tag-all">
            All
          </button>
          {COMMENT_TAGS.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={tag === t} onClick={() => setTag(t)} data-testid={`admin-tag-${t}`}>
              <span aria-hidden="true">{COMMENT_TAG_EMOJI[t]}</span> {COMMENT_TAG_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <p className="visually-hidden" role="status" aria-live="polite">
        {visible.length} comments shown
      </p>

      {visible.length === 0 ? (
        <EmptyState emoji="🔍" title="No comments match" level={3}>
          <p>Try another tag or search.</p>
        </EmptyState>
      ) : (
        <ol className="admin-feed" role="list" data-testid="admin-comments">
          {visible.map((c) => (
            <li key={c.id} className="admin-feed-item card" data-testid="admin-comment">
              <UserAvatar name={c.author.displayName} size="sm" />
              <div className="admin-feed-main">
                <div className="admin-feed-meta">
                  <strong>
                    <bdi>{c.author.displayName}</bdi>
                  </strong>
                  {c.author.role === 'admin' && (
                    <span className="badge badge-gold">
                      <span aria-hidden="true">👑</span> Admin
                    </span>
                  )}
                  <span className={`comment-tag comment-tag-${c.tag}`}>
                    <span aria-hidden="true">{COMMENT_TAG_EMOJI[c.tag]}</span> {COMMENT_TAG_LABEL[c.tag]}
                  </span>
                  <span className="admin-feed-on">
                    on{' '}
                    <Link to={commentTargetHref(c)} className="admin-feed-target">
                      {c.target.title}
                    </Link>
                    <span className="subtle"> ({c.target.type})</span>
                  </span>
                  <span className="admin-feed-time subtle">
                    <time dateTime={c.createdAt} title={formatDate(c.createdAt)}>
                      {relativeTime(c.createdAt)}
                    </time>
                    {c.edited && ' · edited'}
                  </span>
                </div>
                <p className="admin-feed-body">{c.body}</p>
              </div>
              <button type="button" className="btn btn-danger-ghost btn-sm admin-feed-remove" onClick={() => void remove(c)} data-testid="admin-remove-comment">
                <Trash2 size={15} aria-hidden="true" /> Remove
                <span className="visually-hidden"> comment by {c.author.displayName}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {hasMore && (
        <div className="admin-more">
          <button type="button" className="btn btn-ghost" onClick={onLoadMore} disabled={loadingMore} data-testid="load-more-comments">
            {loadingMore && <span className="spinner" aria-hidden="true" />}
            Load older comments
          </button>
        </div>
      )}
      {dialog}
    </div>
  );
}

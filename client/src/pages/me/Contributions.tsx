/**
 * /me "My songs", "My shows" and "My comments" lists (data from GET /api/me/contributions).
 */
import { ExternalLink, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { deleteComment, deleteShow, isApiError, updateComment } from '../../api';
import { ArtworkTile } from '../../components/ArtworkTile';
import { CommentComposer } from '../../components/CommentsSection';
import { useConfirm } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { KindTag } from '../../components/GenreTag';
import { LengthBadge } from '../../components/LengthBadge';
import { MatureBadge } from '../../components/MatureBadge';
import { OwnerControls } from '../../components/Ownership';
import { PlayButton } from '../../components/PlayButton';
import { RangeBadge } from '../../components/RangeBadge';
import { formatDate, plural, relativeTime } from '../../lib/format';
import { showPath, songEditPath, songPath } from '../../lib/links';
import { COMMENT_TAG_EMOJI, COMMENT_TAG_LABEL } from '../../lib/vocab';
import { useSongs } from '../../state/SongsProvider';
import { useToast } from '../../state/ToastProvider';
import { useDeleteSong } from '../../state/useDeleteSong';
import type { Comment, CommentTag, Show, Song } from '../../types';

// ---------------------------------------------------------------- songs

export function MySongs({ songs, onDeleted }: { songs: Song[]; onDeleted: (id: number) => void }) {
  const deleteSong = useDeleteSong();
  const toast = useToast();

  if (songs.length === 0) {
    return (
      <EmptyState
        emoji="🎼"
        title="No songs yet"
        level={3}
        actions={
          <Link to="/add" className="btn btn-primary" data-testid="add-first-song">
            <Plus size={18} aria-hidden="true" /> Add your first song
          </Link>
        }
      >
        <p>Know a great solo or duet that’s missing from the list? Add it and it’ll show up here.</p>
      </EmptyState>
    );
  }

  return (
    <ul className="me-list" role="list" data-testid="my-songs">
      {songs.map((s) => (
        <li key={s.id} className="me-row card" data-testid="my-song">
          <div className="me-row-art">
            <ArtworkTile src={s.media.artworkUrl ?? s.show.imageUrl} seed={s.show.name} size={72} />
          </div>
          <div className="me-row-main">
            <h3 className="me-row-title">
              <Link to={songPath(s.id)}>{s.title}</Link>
            </h3>
            <p className="me-row-sub">
              from{' '}
              <Link to={showPath(s.show.slug)} className="me-row-show">
                {s.show.name}
              </Link>
              <span aria-hidden="true"> · </span>
              <span title={formatDate(s.createdAt)}>added {relativeTime(s.createdAt)}</span>
            </p>
            <div className="me-row-tags">
              <KindTag kind={s.kind} />
              {s.parts.map((p) => (
                <span key={p.position} className="me-part">
                  <RangeBadge range={p.vocalRange} />
                  <span>{p.character}</span>
                </span>
              ))}
              <LengthBadge seconds={s.lengthSeconds} />
              <MatureBadge mature={s.mature} variant="compact" />
              {s.commentCount > 0 && (
                <Link to={`${songPath(s.id)}#comments`} className="me-count-link" aria-label={plural(s.commentCount, 'comment')}>
                  <MessageCircle size={14} aria-hidden="true" /> {s.commentCount}
                </Link>
              )}
            </div>
          </div>
          <div className="me-row-actions">
            <PlayButton song={s} size="sm" />
            <OwnerControls
              item={s}
              size="sm"
              noun="song"
              editTo={songEditPath(s.id)}
              confirmTitle={`Delete “${s.title}”?`}
              onDelete={async () => {
                await deleteSong(s); // stops the player if it's this song, updates setlist + counts
                onDeleted(s.id);
                toast.info(`“${s.title}” was deleted`, { emoji: '🗑️', id: 'my-delete' });
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- shows

/** The server also sends createdAt on shows (not in the shared Show type). */
const createdAtOf = (sh: Show) => (sh as Show & { createdAt?: string }).createdAt ?? null;

export function MyShows({ shows, onDeleted }: { shows: Show[]; onDeleted: (id: number) => void }) {
  const { reload } = useSongs();
  const toast = useToast();

  if (shows.length === 0) {
    return (
      <EmptyState
        emoji="🎟️"
        title="No shows yet"
        level={3}
        actions={
          <Link to="/add" className="btn btn-primary">
            <Plus size={18} aria-hidden="true" /> Add a song from a new show
          </Link>
        }
      >
        <p>When you add a song from a musical that isn’t on the list yet, its new show page lands here.</p>
      </EmptyState>
    );
  }

  return (
    <ul className="me-list" role="list" data-testid="my-shows">
      {shows.map((sh) => (
        <li key={sh.id} className="me-row card" data-testid="my-show">
          <div className="me-row-art is-poster">
            <ArtworkTile src={sh.imageUrl} seed={sh.name} size={72} />
          </div>
          <div className="me-row-main">
            <h3 className="me-row-title">
              <Link to={showPath(sh.slug)}>{sh.name}</Link>
            </h3>
            <p className="me-row-sub">
              {[sh.year, sh.composer].filter(Boolean).join(' · ') || 'Community show'}
              <span aria-hidden="true"> · </span>
              <span title={formatDate(createdAtOf(sh))}>added {relativeTime(createdAtOf(sh)) || 'recently'}</span>
            </p>
            <div className="me-row-tags">
              <span className="badge badge-outline">{plural(sh.songCount, 'song')}</span>
              {sh.soloCount > 0 && <span className="badge">🎤 {plural(sh.soloCount, 'solo')}</span>}
              {sh.duetCount > 0 && <span className="badge">👯 {plural(sh.duetCount, 'duet')}</span>}
              {sh.commentCount > 0 && (
                <span className="badge">
                  <MessageCircle size={12} aria-hidden="true" /> {sh.commentCount}
                </span>
              )}
            </div>
          </div>
          <div className="me-row-actions">
            <Link to={showPath(sh.slug)} className="btn btn-ghost btn-sm">
              <ExternalLink size={16} aria-hidden="true" /> Open
            </Link>
            {sh.songCount === 0 ? (
              <OwnerControls
                item={sh}
                size="sm"
                noun="show"
                confirmTitle={`Delete “${sh.name}”?`}
                confirmBody={<p>The show page and its comments will be removed for everyone. This can’t be undone.</p>}
                onDelete={async () => {
                  await deleteShow(sh.id);
                  onDeleted(sh.id);
                  void reload();
                  toast.info(`“${sh.name}” was deleted`, { emoji: '🗑️', id: 'my-delete' });
                }}
              />
            ) : (
              <span className="me-row-note small subtle">Shows with songs can’t be deleted</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- comments

type CommentTargetWithSlug = Comment['target'] & { slug?: string };

export function commentTargetHref(c: Comment): string {
  const t = c.target as CommentTargetWithSlug;
  return t.type === 'song' ? `${songPath(t.id)}#comments` : `${showPath(t.slug ?? String(t.id))}#comments`;
}

export function MyComments({ comments, onChange }: { comments: Comment[]; onChange: (next: Comment[]) => void }) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const { confirm, dialog } = useConfirm();
  const { getSong, patchSong } = useSongs();
  const toast = useToast();

  if (comments.length === 0) {
    return (
      <EmptyState
        emoji="🦗"
        title="You haven’t said anything yet"
        level={3}
        actions={
          <Link to="/songs" className="btn btn-primary">
            Find a song to chat about
          </Link>
        }
      >
        <p>Leave a tip, ask a question, or tell everyone “I performed this!” on any song or show page.</p>
      </EmptyState>
    );
  }

  const save = async (c: Comment, body: string, tag: CommentTag) => {
    const updated = await updateComment(c.id, { body, tag });
    onChange(comments.map((x) => (x.id === c.id ? updated : x)));
    setEditingId(null);
    toast.success('Comment updated', { id: 'comment' });
  };

  const remove = async (c: Comment) => {
    const ok = await confirm({ title: 'Delete your comment?', message: <p>“{excerpt(c.body, 90)}” will be removed for everyone. This can’t be undone.</p>, confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await deleteComment(c.id);
    } catch (e) {
      if (!(isApiError(e) && e.status === 404)) {
        toast.error(e);
        return;
      }
    }
    onChange(comments.filter((x) => x.id !== c.id));
    if (c.target.type === 'song') {
      const cached = getSong(c.target.id);
      if (cached) patchSong(c.target.id, { commentCount: Math.max(0, cached.commentCount - 1) });
    }
    toast.info('Comment deleted', { id: 'comment' });
  };

  return (
    <>
      <ol className="me-list" role="list" data-testid="my-comments">
        {comments.map((c) => (
          <li key={c.id} className="me-comment card" data-testid="my-comment">
            <div className="me-comment-meta">
              <span className={`comment-tag comment-tag-${c.tag}`}>
                <span aria-hidden="true">{COMMENT_TAG_EMOJI[c.tag]}</span> {COMMENT_TAG_LABEL[c.tag]}
              </span>
              <span className="me-comment-on">
                on{' '}
                <Link to={commentTargetHref(c)} className="me-comment-target">
                  {c.target.title}
                </Link>
                <span className="subtle"> ({c.target.type})</span>
              </span>
              <span className="me-comment-time subtle">
                <time dateTime={c.createdAt} title={formatDate(c.createdAt)}>
                  {relativeTime(c.createdAt)}
                </time>
                {c.edited && ' · edited'}
              </span>
            </div>
            {editingId === c.id ? (
              <CommentComposer
                initialBody={c.body}
                initialTag={c.tag}
                submitLabel="Save"
                submitTestId="comment-save"
                autoFocus
                onSubmit={(body, tag) => save(c, body, tag)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <p className="me-comment-body" data-testid="my-comment-body">
                  {c.body}
                </p>
                <div className="me-comment-actions">
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditingId(c.id)} data-testid="comment-edit">
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm me-danger" onClick={() => void remove(c)} data-testid="comment-delete">
                    <Trash2 size={14} aria-hidden="true" /> Delete
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ol>
      {dialog}
    </>
  );
}

export function excerpt(text: string, max = 140): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

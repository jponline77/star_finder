/**
 * /setlist — My Setlist (SPEC §7.8).
 * Saved song ids (localStorage via useSetlist) → ordered rows with up/down reordering, remove (undo),
 * clear all (confirm), running time + counts, a share link (/setlist?ids=1,2,3) and print styles.
 * Visiting a share link shows a banner — the shared songs are only saved when the visitor says so.
 */
import { ArrowDown, ArrowUp, Compass, Dices, Heart, Music, Printer, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArtworkTile } from '../components/ArtworkTile';
import { useConfirm } from '../components/ConfirmDialog';
import { CopyButton } from '../components/CopyButton';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { GenreTag, KindTag, SubGenreTag } from '../components/GenreTag';
import { LengthBadge } from '../components/LengthBadge';
import { MatureBadge } from '../components/MatureBadge';
import { PlayButton } from '../components/PlayButton';
import { RangeBadge } from '../components/RangeBadge';
import { Skeleton } from '../components/Skeletons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { formatDate, formatLength, formatLengthLong } from '../lib/format';
import { songPath, showPath } from '../lib/links';
import { parseSetlistParam, setlistShareUrl, useSetlist } from '../lib/setlist';
import { KIND_LABEL, normalizeVocalRange, TIME_LIMIT_SECONDS } from '../lib/vocab';
import { useSongs } from '../state/SongsProvider';
import { useToast } from '../state/ToastProvider';
import type { Song } from '../types';
import { setlistTotals } from './setlist/totals';
import './SetlistPage.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function partsText(song: Song): string {
  return song.parts.map((p) => `${p.character} (${normalizeVocalRange(p.vocalRange) ?? 'range unknown'})`).join(' & ');
}

// ---------------------------------------------------------------- shared-link banner
function SharedBanner({ sharedIds, onDone }: { sharedIds: number[]; onDone: () => void }) {
  const setlist = useSetlist();
  const { songsById, loading } = useSongs();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const known = sharedIds.map((id) => songsById.get(id)).filter((s): s is Song => Boolean(s));
  const missing = loading ? 0 : sharedIds.length - known.length;
  const fresh = known.filter((s) => !setlist.has(s.id));
  const totals = setlistTotals(known);
  const sameAsMine = known.length === setlist.count && known.every((s, i) => setlist.ids[i] === s.id);

  const save = () => {
    const added = setlist.import(
      fresh.map((s) => s.id),
      'merge',
    );
    toast.success(added ? `Added ${plural(added, 'song')} to your setlist` : 'Those songs were already in your setlist', { emoji: '💖', id: 'setlist-import' });
    onDone();
  };

  const replace = async () => {
    if (setlist.count > 0) {
      const ok = await confirm({
        title: 'Replace your setlist?',
        message: `Your ${plural(setlist.count, 'saved song')} will be swapped for the ${plural(known.length, 'song')} in this link.`,
        confirmLabel: 'Replace my setlist',
      });
      if (!ok) return;
    }
    const previous = [...setlist.ids];
    setlist.replace(known.map((s) => s.id));
    toast.success('Your setlist now matches the shared one', {
      emoji: '🔁',
      id: 'setlist-import',
      action: previous.length ? { label: 'Undo', onClick: () => setlist.replace(previous) } : undefined,
    });
    onDone();
  };

  return (
    <section className="setlist-shared" aria-labelledby="setlist-shared-title" data-testid="setlist-shared-banner">
      <div className="setlist-shared-head">
        <span className="setlist-shared-emoji emoji" aria-hidden="true">
          💌
        </span>
        <div>
          <h2 id="setlist-shared-title" className="setlist-shared-title">
            Someone shared a setlist with you
          </h2>
          <p className="muted">
            {loading
              ? 'Loading the shared songs…'
              : known.length === 0
                ? 'None of the songs in this link are on the site any more.'
                : `${plural(known.length, 'song')} · ${formatLength(totals.seconds)} total${fresh.length < known.length ? ` · ${known.length - fresh.length} already in yours` : ''}`}
            {missing > 0 && known.length > 0 && ` · ${plural(missing, 'song')} no longer available`}
          </p>
        </div>
        <button type="button" className="btn-icon setlist-shared-close" onClick={onDone} aria-label="Dismiss the shared setlist" data-testid="setlist-dismiss">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      {known.length > 0 && (
        <ol className="setlist-shared-list">
          {known.map((s) => (
            <li key={s.id} className={setlist.has(s.id) ? 'is-mine' : undefined}>
              <Link to={songPath(s.id)}>{s.title}</Link> <span className="muted">· {s.show.name}</span>
              {setlist.has(s.id) && (
                <span className="setlist-shared-mine">
                  <Heart size={12} aria-hidden="true" /> saved
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="setlist-shared-actions">
        {fresh.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={save} data-testid="setlist-import">
            <Heart size={18} aria-hidden="true" /> Save {fresh.length === known.length ? 'to my setlist' : `${plural(fresh.length, 'new song')} to my setlist`}
          </button>
        )}
        {known.length > 0 && setlist.count > 0 && !sameAsMine && (
          <button type="button" className="btn btn-ghost" onClick={() => void replace()} data-testid="setlist-replace">
            Replace mine with this list
          </button>
        )}
        {known.length > 0 && fresh.length === 0 && <p className="setlist-shared-done">🎉 You already have every song from this list.</p>}
        <button type="button" className="btn btn-quiet" onClick={onDone}>
          No thanks
        </button>
      </div>
      {dialog}
    </section>
  );
}

// ---------------------------------------------------------------- row
interface RowProps {
  song: Song;
  index: number;
  total: number;
  onMove: (from: number, to: number, button: 'up' | 'down') => void;
  onRemove: (song: Song, index: number) => void;
}

function SetlistRow({ song, index, total, onMove, onRemove }: RowProps) {
  return (
    <li className="setlist-row card" data-testid="setlist-row" data-setlist-id={song.id}>
      <span className="setlist-pos" aria-hidden="true">
        {index + 1}
      </span>
      <div className="setlist-art no-print">
        <ArtworkTile src={song.media.artworkUrl ?? song.show.imageUrl} seed={song.show.name} size={72} />
        <PlayButton song={song} size="sm" />
      </div>
      <div className="setlist-main">
        <h3 className="setlist-title">
          <span className="visually-hidden">{index + 1}. </span>
          <Link to={songPath(song.id)}>{song.title}</Link>
        </h3>
        <p className="setlist-show">
          <Link to={showPath(song.show.slug)}>{song.show.name}</Link>
        </p>
        <ul className="setlist-parts no-print-inline" aria-label={song.kind === 'duet' ? 'Characters' : 'Character'}>
          {song.parts.map((p) => (
            <li key={p.position}>
              <RangeBadge range={p.vocalRange} />
              <span>{p.character}</span>
            </li>
          ))}
        </ul>
        <p className="setlist-print-line">
          {partsText(song)} · {KIND_LABEL[song.kind]}
          {song.genre ? ` · ${song.genre}` : ''}
          {song.subGenre ? ` (${song.subGenre})` : ''} · {formatLength(song.lengthSeconds, '?:??')}
          {song.mature ? ' · Mature themes' : ''}
        </p>
        <div className="setlist-tags">
          <KindTag kind={song.kind} />
          <GenreTag genre={song.genre} />
          <SubGenreTag subGenre={song.subGenre} />
          <MatureBadge mature={song.mature} variant="compact" />
        </div>
      </div>
      <div className="setlist-side">
        <LengthBadge seconds={song.lengthSeconds} />
        <div className="setlist-controls no-print" role="group" aria-label={`Reorder or remove “${song.title}”`}>
          <button
            type="button"
            className="btn-icon btn-icon-sm is-filled"
            onClick={() => onMove(index, index - 1, 'up')}
            disabled={index === 0}
            aria-label={`Move “${song.title}” up`}
            data-action="up"
            data-testid="setlist-move-up"
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon btn-icon-sm is-filled"
            onClick={() => onMove(index, index + 1, 'down')}
            disabled={index === total - 1}
            aria-label={`Move “${song.title}” down`}
            data-action="down"
            data-testid="setlist-move-down"
          >
            <ArrowDown size={16} aria-hidden="true" />
          </button>
          <button type="button" className="btn-icon btn-icon-sm setlist-remove" onClick={() => onRemove(song, index)} aria-label={`Remove “${song.title}” from your setlist`} data-action="remove" data-testid="setlist-remove">
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- page
export default function SetlistPage() {
  useDocumentTitle('My Setlist');
  const setlist = useSetlist();
  const { songsById, loading, error, reload } = useSongs();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const sharedIds = useMemo(() => parseSetlistParam(params.get('ids')), [params]);
  const [announcement, setAnnouncement] = useState('');
  const [focusTarget, setFocusTarget] = useState<{ id: number; action: 'up' | 'down' | 'remove' | 'heading' } | null>(null);

  const songs = useMemo(() => setlist.ids.map((id) => songsById.get(id)).filter((s): s is Song => Boolean(s)), [setlist.ids, songsById]);
  const missingIds = loading ? [] : setlist.ids.filter((id) => !songsById.has(id));
  const totals = setlistTotals(songs);
  const dismissShared = () => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('ids');
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  // Keep keyboard focus on the moved row's button.
  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget.action === 'heading') {
      document.getElementById('setlist-songs-title')?.focus();
    } else {
      const row = document.querySelector<HTMLElement>(`[data-setlist-id="${focusTarget.id}"]`);
      const wanted = row?.querySelector<HTMLButtonElement>(`[data-action="${focusTarget.action}"]`);
      const other = row?.querySelector<HTMLButtonElement>(`[data-action="${focusTarget.action === 'up' ? 'down' : 'up'}"]`);
      (wanted && !wanted.disabled ? wanted : other)?.focus();
    }
    setFocusTarget(null);
  }, [focusTarget]);

  const onMove = (from: number, to: number, button: 'up' | 'down') => {
    const song = songs[from];
    if (!song || to < 0 || to >= songs.length) return;
    // indexes are in the (possibly filtered) `songs` list — translate to raw ids positions
    const rawFrom = setlist.ids.indexOf(song.id);
    const other = songs[to];
    const rawTo = other ? setlist.ids.indexOf(other.id) : -1;
    if (rawFrom < 0 || rawTo < 0) return;
    setlist.move(rawFrom, rawTo);
    setAnnouncement(`Moved “${song.title}” to position ${to + 1} of ${songs.length}.`);
    setFocusTarget({ id: song.id, action: button });
  };

  const onRemove = (song: Song, index: number) => {
    const before = [...setlist.ids];
    setlist.remove(song.id);
    setAnnouncement(`Removed “${song.title}”.`);
    toast.info(`“${song.title}” removed from your setlist`, {
      emoji: '💔',
      id: 'setlist',
      action: { label: 'Undo', onClick: () => setlist.replace(before) },
    });
    const next = songs[index + 1] ?? songs[index - 1];
    setFocusTarget(next ? { id: next.id, action: 'remove' } : { id: 0, action: 'heading' });
  };

  const onClear = async () => {
    const ok = await confirm({
      title: 'Clear your whole setlist?',
      message: `This removes all ${plural(setlist.count, 'song')} from this device.`,
      confirmLabel: 'Clear setlist',
    });
    if (!ok) return;
    const before = [...setlist.ids];
    setlist.clear();
    toast.info('Setlist cleared', { emoji: '🧹', id: 'setlist', action: { label: 'Undo', onClick: () => setlist.replace(before) } });
  };

  const removeMissing = () => {
    setlist.replace(setlist.ids.filter((id) => songsById.has(id)));
    toast.success(`Tidied up ${plural(missingIds.length, 'missing song')}`, { id: 'setlist' });
  };

  const hasSongs = setlist.count > 0;

  return (
    <div className="container setlist-page">
      <header className="page-header setlist-header">
        <div>
          <p className="eyebrow no-print">
            <Heart size={14} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px' }} /> My Setlist
          </p>
          <h1 className="page-title">
            <span className="setlist-screen-title">Your setlist</span>
            <span className="setlist-print-title">My STAR Setlist</span>
          </h1>
          <p className="page-subtitle no-print">Your shortlist of favourites. Put them in order, check the running time, and share it with your teacher or duet partner.</p>
          <p className="setlist-print-meta">
            Printed {formatDate(new Date().toISOString())} · {plural(totals.count, 'song')} · {formatLength(totals.seconds)} total · STAR time limit {formatLength(TIME_LIMIT_SECONDS)} per song
          </p>
        </div>
        {hasSongs && (
          <div className="setlist-toolbar no-print">
            <CopyButton text={() => setlistShareUrl(setlist.ids)} label="Copy share link" copiedLabel="Link copied!" testId="setlist-share" />
            <button type="button" className="btn btn-ghost" onClick={() => window.print()} data-testid="setlist-print">
              <Printer size={18} aria-hidden="true" /> Print
            </button>
            <button type="button" className="btn btn-danger-ghost" onClick={() => void onClear()} data-testid="setlist-clear">
              <Trash2 size={18} aria-hidden="true" /> Clear all
            </button>
          </div>
        )}
      </header>

      {sharedIds.length > 0 && <SharedBanner sharedIds={sharedIds} onDone={dismissShared} />}

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {error && !songsById.size && hasSongs ? (
        <ErrorState message="We couldn’t load your saved songs. Check your connection and try again." onRetry={() => void reload()} />
      ) : !hasSongs ? (
        <EmptyState
          emoji="💖"
          title="Your setlist is empty"
          className="setlist-empty"
          actions={
            <>
              <Link to="/songs" className="btn btn-primary">
                <Music size={18} aria-hidden="true" /> Browse songs
              </Link>
              <Link to="/match" className="btn btn-pink">
                <Sparkles size={18} aria-hidden="true" /> Take the Matchmaker quiz
              </Link>
              <Link to="/spin" className="btn btn-ghost">
                <Dices size={18} aria-hidden="true" /> Spin the Spotlight
              </Link>
            </>
          }
        >
          <p>
            Tap the <Heart size={15} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px' }} /> on any song to save it here. Your setlist lives in this
            browser, so no account is needed.
          </p>
        </EmptyState>
      ) : (
        <>
          <ul className="setlist-stats" role="list" aria-label="Setlist summary">
            <li className="setlist-stat" data-testid="setlist-count">
              <span className="setlist-stat-value">{loading && !songs.length ? '…' : totals.count}</span>
              <span className="setlist-stat-label">{totals.count === 1 ? 'song' : 'songs'}</span>
            </li>
            <li className="setlist-stat is-time" data-testid="setlist-total">
              <span className="setlist-stat-value">
                <span aria-hidden="true">{formatLength(totals.seconds)}</span>
                <span className="visually-hidden">{formatLengthLong(totals.seconds)}</span>
              </span>
              <span className="setlist-stat-label">total running time{totals.unknown ? ` (+${totals.unknown} unknown)` : ''}</span>
            </li>
            <li className="setlist-stat">
              <span className="setlist-stat-value">
                {totals.solos}
                <span className="setlist-stat-sep" aria-hidden="true">
                  /
                </span>
                {totals.duets}
              </span>
              <span className="setlist-stat-label">
                {plural(totals.solos, 'solo')} · {plural(totals.duets, 'duet')}
              </span>
            </li>
            {totals.over > 0 && (
              <li className="setlist-stat is-over">
                <span className="setlist-stat-value">{totals.over}</span>
                <span className="setlist-stat-label">over 6:00 (needs a cut)</span>
              </li>
            )}
          </ul>

          <h2 id="setlist-songs-title" className="visually-hidden" tabIndex={-1}>
            Songs in your setlist
          </h2>
          {loading && !songs.length ? (
            <ol className="setlist-list" aria-busy="true">
              {setlist.ids.slice(0, 4).map((id) => (
                <li key={id} className="setlist-row card" aria-hidden="true">
                  <Skeleton width={72} height={72} radius={12} />
                  <div className="stack stack-sm" style={{ flex: 1 }}>
                    <Skeleton height={20} width="60%" />
                    <Skeleton height={14} width="35%" />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <ol className="setlist-list">
              {songs.map((s, i) => (
                <SetlistRow key={s.id} song={s} index={i} total={songs.length} onMove={onMove} onRemove={onRemove} />
              ))}
            </ol>
          )}

          {missingIds.length > 0 && (
            <div className="callout callout-warning setlist-missing no-print" data-testid="setlist-missing">
              <span>
                {plural(missingIds.length, 'saved song')} {missingIds.length === 1 ? 'is' : 'are'} no longer on the site (maybe it was removed).
              </span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={removeMissing}>
                Remove {missingIds.length === 1 ? 'it' : 'them'}
              </button>
            </div>
          )}

          <aside className="setlist-tip no-print">
            <Compass size={20} aria-hidden="true" />
            <p>
              <strong>Saved on this device only.</strong> Use <em>Copy share link</em> to move your list to another device, or send it to your teacher. Want more ideas?{' '}
              <Link to="/match">Take the Matchmaker quiz</Link> or <Link to="/spin">spin the spotlight</Link>.
            </p>
          </aside>
        </>
      )}
      {dialog}
    </div>
  );
}

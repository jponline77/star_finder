/**
 * Admin → Cast albums (SPEC §7c): what users saved for catalog shows from Apple Music — a show's cast album and the
 * song list made from its track names ("Load songs from the cast album"), newest first, with who saved it. Remove
 * (DELETE /api/admin/catalog/shows/:id/recording) takes the album and its songs off the show for everyone — e.g. the
 * wrong album or rude track names; by default that album is never picked for the show again.
 *
 * data-testids: admin-recordings, admin-recording, admin-remove-recording, recording-allow-again.
 */
import { Disc3, ExternalLink, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { adminRemoveCatalogRecording, isApiError } from '../../api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { addHref } from '../../lib/catalog';
import { formatDate, relativeTime } from '../../lib/format';
import { normalizeText } from '../../lib/normalize';
import { useToast } from '../../state/ToastProvider';
import type { AdminCatalogRecording } from '../../types';

export interface CatalogRecordingsPanelProps {
  shows: AdminCatalogRecording[];
  onRemoved: (id: number) => void;
}

const appleAlbumUrl = (collectionId: number) => `https://music.apple.com/ca/album/${collectionId}`;

export function CatalogRecordingsPanel({ shows, onRemoved }: CatalogRecordingsPanelProps) {
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<AdminCatalogRecording | null>(null);
  const [allowAgain, setAllowAgain] = useState(false);
  const toast = useToast();

  const visible = useMemo(() => {
    const needle = normalizeText(q);
    if (!needle) return shows;
    return shows.filter((s) => normalizeText(`${s.title} ${s.castAlbum?.collectionName ?? ''} ${s.savedBy?.displayName ?? ''}`).includes(needle));
  }, [shows, q]);

  const remove = async () => {
    if (!target) return;
    try {
      const r = await adminRemoveCatalogRecording(target.id, { allowAgain });
      toast.info(`Removed the cast album of ${target.title}${r.removedSongs ? ` and ${r.removedSongs} song${r.removedSongs === 1 ? '' : 's'}` : ''}`, { emoji: '🧹', id: 'admin-recording' });
    } catch (e) {
      if (!(isApiError(e) && e.status === 404)) throw e; // the dialog shows the error and stays open
    }
    onRemoved(target.id);
  };

  if (shows.length === 0) {
    return (
      <EmptyState emoji="💿" title="No cast albums saved yet" level={3}>
        <p>When someone loads a show’s songs from its cast album, or a cast album is found for a show, it shows up here so you can check it.</p>
      </EmptyState>
    );
  }

  return (
    <div className="admin-recordings">
      <p className="admin-panel-intro">
        Song lists and cast albums people found on Apple Music for catalog shows that have no Wikipedia song list. They’re shared with everyone — remove one if it’s the
        wrong album or its track names aren’t OK.
      </p>
      <div className="admin-toolbar">
        <label className="admin-search">
          <Search size={18} aria-hidden="true" />
          <span className="visually-hidden">Search cast albums</span>
          <input type="search" className="input" placeholder="Search show, album or person…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="recording-search" />
        </label>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {visible.length} shows listed
      </p>
      {visible.length === 0 ? (
        <EmptyState emoji="🔍" title="Nothing matches" level={3}>
          <p>Try another search.</p>
        </EmptyState>
      ) : (
        <ol className="admin-feed" role="list" data-testid="admin-recordings">
          {visible.map((s) => (
            <li key={s.id} className="admin-feed-item admin-recording card" data-testid="admin-recording">
              <span className="admin-recording-icon" aria-hidden="true">
                <Disc3 size={22} />
              </span>
              <div className="admin-feed-main">
                <div className="admin-feed-meta">
                  <strong>
                    <Link to={addHref({ catalogShow: s.id })} className="admin-feed-target">
                      <bdi>{s.title}</bdi>
                    </Link>
                    {s.year ? <span className="subtle"> ({s.year})</span> : null}
                  </strong>
                  {s.retired && <span className="badge">No longer in the catalog</span>}
                </div>
                <p className="admin-feed-body">
                  {s.castAlbum ? (
                    <a href={appleAlbumUrl(s.castAlbum.collectionId)} target="_blank" rel="noopener noreferrer">
                      {s.castAlbum.collectionName ?? `Apple album ${s.castAlbum.collectionId}`}
                      <ExternalLink size={13} aria-hidden="true" className="admin-recording-ext" />
                      <span className="visually-hidden"> (opens Apple Music)</span>
                    </a>
                  ) : (
                    'No album (songs only)'
                  )}
                  <span className="subtle">
                    {' · '}
                    {s.recordingSongs ? `${s.recordingSongs} song${s.recordingSongs === 1 ? '' : 's'} from its track list` : 'album only (used to find recordings)'}
                  </span>
                </p>
                <p className="admin-feed-time subtle">
                  {!s.savedAt && !s.savedBy ? (
                    'Saved before the site kept track of who and when'
                  ) : s.savedAt ? (
                    <>
                      Saved{' '}
                      <time dateTime={s.savedAt} title={formatDate(s.savedAt)}>
                        {relativeTime(s.savedAt)}
                      </time>
                    </>
                  ) : (
                    'Saved'
                  )}
                  {s.savedBy ? (
                    <>
                      {' '}
                      by <bdi>{s.savedBy.displayName ?? `user #${s.savedBy.id}`}</bdi>
                    </>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-danger-ghost btn-sm admin-feed-remove"
                onClick={() => {
                  setAllowAgain(false);
                  setTarget(s);
                }}
                data-testid="admin-remove-recording"
              >
                <Trash2 size={15} aria-hidden="true" /> Remove
                <span className="visually-hidden"> the cast album of {s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <ConfirmDialog
        open={target !== null}
        title={target ? `Remove the cast album of ${target.title}?` : ''}
        confirmLabel="Remove"
        onConfirm={remove}
        onCancel={() => setTarget(null)}
        testId="confirm-remove-recording"
      >
        {target && (
          <>
            <p>
              {target.recordingSongs
                ? `Its ${target.recordingSongs} song${target.recordingSongs === 1 ? '' : 's'} from the track list disappear from the catalog for everyone. Songs on the site that were picked from them stay, without the link.`
                : 'The show forgets this album; recordings are looked up again from scratch.'}
            </p>
            <label className="admin-recording-allow">
              <input type="checkbox" checked={allowAgain} onChange={(e) => setAllowAgain(e.target.checked)} data-testid="recording-allow-again" />
              <span>It’s the right album — let it be found again (e.g. only the track names were wrong)</span>
            </label>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

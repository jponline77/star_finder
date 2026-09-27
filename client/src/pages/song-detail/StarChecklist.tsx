/**
 * "STAR checklist" for one song (SPEC §1 rules + §7.3): time, solo/duet fit, backing track,
 * licensing (with the "confirm with your teacher" caveat), content, dress & set pieces, slate.
 */
import { Check, ClipboardCheck, Info, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '../../components/Skeletons';
import type { Show, Song } from '../../types';
import { licensingStatus } from '../show-detail/licensing';
import { characterNames, setPieces, timeMessage } from './helpers';

export type CheckStatus = 'ok' | 'warn' | 'bad' | 'info';

interface CheckItem {
  id: string;
  status: CheckStatus;
  title: string;
  body: ReactNode;
}

const STATUS_TEXT: Record<CheckStatus, string> = {
  ok: 'Looks good',
  warn: 'Check this',
  bad: 'Problem',
  info: 'Reminder',
};

function StatusIcon({ status }: { status: CheckStatus }) {
  const Icon = status === 'ok' ? Check : status === 'warn' ? TriangleAlert : status === 'bad' ? X : Info;
  return (
    <span className={`sd-check-icon is-${status}`} role="img" aria-label={STATUS_TEXT[status]}>
      <Icon size={16} strokeWidth={3} aria-hidden="true" />
    </span>
  );
}

export interface StarChecklistProps {
  song: Song;
  show: Show | null;
  showLoading: boolean;
  showFailed: boolean;
}

export function StarChecklist({ song, show, showLoading, showFailed }: StarChecklistProps) {
  const time = timeMessage(song.lengthSeconds);
  const wanted = song.kind === 'duet' ? 2 : 1;
  const partsOk = song.parts.length === wanted;
  const names = characterNames(song.parts);

  const licensing: CheckItem = (() => {
    if (showLoading && !show)
      return {
        id: 'licensing',
        status: 'info',
        title: 'Licensing',
        body: <Skeleton height={14} width="80%" />,
      };
    if (!show)
      return {
        id: 'licensing',
        status: 'warn',
        title: 'Licensing',
        body: <>{showFailed ? 'Couldn’t load the show’s licensing info.' : 'Licensing info unknown.'} Confirm with your teacher that it’s from an approved publisher.</>,
      };
    if (!show.licensor && !show.licensingNote)
      return {
        id: 'licensing',
        status: 'warn',
        title: 'Licensing not listed',
        body: <>We don’t have licensing info for this show yet. Confirm with your teacher that it comes from an approved publisher.</>,
      };
    // Green only for a licensor on STAR's approved list with no caveat. A licensing note always
    // means "read this first" (Teen Edition only, a play not a musical, not in the NA catalogue…).
    const approved = licensingStatus(show.licensor).kind === 'approved';
    const hasNote = Boolean(show.licensingNote?.trim());
    const title = !show.licensor
      ? 'No approved licensor found'
      : !approved
        ? `Licensed by ${show.licensor} — not on STAR’s approved list`
        : hasNote
          ? `Licensed by ${show.licensor} — read the note`
          : `Licensed by ${show.licensor}`;
    return {
      id: 'licensing',
      status: show.licensor && approved && !hasNote ? 'ok' : 'warn',
      title,
      body: (
        <>
          {show.licensingNote && <span className="sd-check-note">{show.licensingNote} </span>}
          <strong className="sd-check-caveat">Always confirm with your teacher.</strong>
        </>
      ),
    };
  })();

  const items: CheckItem[] = [
    {
      id: 'time',
      status: time.status === 'ok' ? 'ok' : time.status === 'close' || time.status === 'unknown' ? 'warn' : 'bad',
      title: 'Time limit 6:00',
      body: time.short,
    },
    {
      id: 'fit',
      status: partsOk ? 'ok' : 'warn',
      title: song.kind === 'duet' ? 'Duet = two characters' : 'Solo = one character',
      body: partsOk ? (
        <>
          Written for <strong>{names}</strong>.
          {song.notes ? ' See the director’s note for details.' : ''}
        </>
      ) : (
        <>This entry lists {song.parts.length} part{song.parts.length === 1 ? '' : 's'} — check with your teacher.</>
      ),
    },
    {
      id: 'track',
      status: 'info',
      title: 'Backing track — no vocals',
      body: 'Perform to a pre-recorded track with NO vocals, downloaded to your device (MP3, M4A, WAV or AIFF). No live accompaniment.',
    },
    licensing,
    {
      id: 'content',
      status: song.mature ? 'warn' : 'ok',
      title: song.mature ? 'Mature themes' : 'No mature-content flag',
      body: song.mature ? 'Get your teacher’s OK before you choose it.' : 'Still, read the lyrics and make sure you’re comfortable with them.',
    },
    {
      id: 'stage',
      status: 'info',
      title: 'All-black dress & set pieces',
      body: `All black, minimal accessories — no costumes, props or theatrical makeup. Set: ${setPieces(song.kind)}.`,
    },
    {
      id: 'slate',
      status: 'info',
      title: 'Start with your slate',
      body: (
        <>
          The clock starts after it, and you finish with “Thank you.” <a href="#slate">Build your slate ↓</a>
        </>
      ),
    },
  ];

  return (
    <section className="card sd-checklist" aria-labelledby="sd-checklist-title" data-testid="star-checklist">
      <div className="sd-checklist-clip" aria-hidden="true" />
      <h2 id="sd-checklist-title" className="sd-checklist-title">
        <ClipboardCheck size={22} aria-hidden="true" /> STAR checklist
      </h2>
      <p className="sd-checklist-sub">Musical Theatre {song.kind === 'duet' ? 'Duet' : 'Solo'} · 2026 program guide</p>
      <ul className="sd-check-list" role="list">
        {items.map((item) => (
          <li key={item.id} className={`sd-check is-${item.status}`} data-testid={`check-${item.id}`} data-status={item.status}>
            <StatusIcon status={item.status} />
            <div className="sd-check-text">
              <p className="sd-check-title">{item.title}</p>
              <div className="sd-check-body">{item.body}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="sd-checklist-foot">
        Not an official TAEA tool. <Link to="/star-prep">All the STAR rules &amp; a rehearsal timer →</Link>
      </p>
    </section>
  );
}

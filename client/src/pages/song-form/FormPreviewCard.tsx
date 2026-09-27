/**
 * Live "playbill" preview of the song being added/edited, plus a must-haves checklist.
 * Purely visual (no links / test ids) — the real card appears on the song page after saving.
 */
import { Check, Circle } from 'lucide-react';
import { ArtworkTile } from '../../components/ArtworkTile';
import { GenreTag, KindTag, SubGenreTag } from '../../components/GenreTag';
import { LengthBadge } from '../../components/LengthBadge';
import { MatureBadge } from '../../components/MatureBadge';
import { RangeBadge } from '../../components/RangeBadge';
import type { Kind } from '../../types';

export interface FormPreviewCardProps {
  kind: Kind;
  title: string;
  showName: string;
  artworkUrl: string | null;
  parts: Array<{ character: string; vocalRange: string }>;
  genre: string;
  subGenre: string;
  lengthSeconds: number | null;
  mature: boolean;
  /** Badge on the art when there's something to listen to (e.g. "▶ 0:30"). */
  audioBadge: string | null;
  checklist: Array<{ label: string; done: boolean }>;
  compact?: boolean;
}

export function FormPreviewCard({ kind, title, showName, artworkUrl, parts, genre, subGenre, lengthSeconds, mature, audioBadge, checklist, compact = false }: FormPreviewCardProps) {
  const done = checklist.filter((c) => c.done).length;
  const ready = done === checklist.length;
  return (
    <div className={`playbill${compact ? ' is-compact' : ''}`}>
      <div className="playbill-band" aria-hidden="true">
        <span>★ Now playing ★</span>
      </div>
      <div className="playbill-card" aria-hidden="true">
        <div className="playbill-art">
          <ArtworkTile src={artworkUrl} seed={showName || title || 'STAR'} label={showName || title || '?'} size={84} />
          {audioBadge && <span className="playbill-audio">{audioBadge}</span>}
        </div>
        <div className="playbill-head">
          <p className={`playbill-title${title.trim() ? '' : ' is-empty'}`}>{title.trim() || 'Your song title'}</p>
          <p className={`playbill-show${showName.trim() ? '' : ' is-empty'}`}>
            <span className="emoji">🎭</span> {showName.trim() || 'Which show?'}
          </p>
          <ul className="playbill-parts">
            {parts.map((p, i) => (
              <li key={i}>
                <RangeBadge range={p.vocalRange || null} />
                <span className={p.character.trim() ? '' : 'is-empty'}>{p.character.trim() || (kind === 'duet' ? `Character ${i + 1}` : 'Character')}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="playbill-tags">
          <KindTag kind={kind} />
          <GenreTag genre={genre || null} />
          <SubGenreTag subGenre={subGenre || null} />
        </div>
        <div className="playbill-foot">
          <LengthBadge seconds={lengthSeconds} showText="always" />
          <MatureBadge mature={mature} variant="compact" />
        </div>
      </div>
      <div className="playbill-checklist">
        <p className="playbill-checklist-title">
          {ready ? (
            <>
              <span className="emoji" aria-hidden="true">
                🌟
              </span>{' '}
              Ready for curtain up!
            </>
          ) : (
            <>
              Must-haves: {done} of {checklist.length}
            </>
          )}
        </p>
        <ul>
          {checklist.map((c) => (
            <li key={c.label} className={c.done ? 'is-done' : ''}>
              {c.done ? <Check size={15} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}
              <span>{c.label}</span>
              <span className="visually-hidden">{c.done ? ' — done' : ' — still needed'}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

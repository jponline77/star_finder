/**
 * Song detail building blocks: cast (parts), running time, director's note, mature note,
 * rehearsal kit (external resource links) and the "About the show" card.
 */
import { ArrowRight, Ban, CircleCheck, CircleHelp, Clapperboard, ExternalLink, FileMusic, Info, KeyboardMusic, MonitorPlay, Timer, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'react-router';
import { ShowPoster } from '../../components/ArtworkTile';
import { CharacterAvatar } from '../../components/CharacterAvatar';
import { RangeBadge } from '../../components/RangeBadge';
import { Skeleton, TextSkeleton } from '../../components/Skeletons';
import { TimeLimitBar } from '../../components/TimeLimitBar';
import { VoiceLadder } from '../../components/VoiceLadder';
import { browseHref } from '../../lib/filters';
import { formatLength, plural } from '../../lib/format';
import { backingTrackUrl, performancesUrl, sheetMusicUrl, showPath } from '../../lib/links';
import { KIND_PLURAL, normalizeVocalRange, RANGE_INFO, rangeSlug, TIME_LIMIT_SECONDS, WARN_SECONDS } from '../../lib/vocab';
import type { Show, Song } from '../../types';
import { creditLines, timeMessage } from './helpers';

// ---------------------------------------------------------------------------
// Cast
// ---------------------------------------------------------------------------

export function CastSection({ song }: { song: Song }) {
  const duet = song.kind === 'duet';
  return (
    <section className="sd-section" aria-labelledby="sd-cast-title">
      <h2 id="sd-cast-title" className="section-title">
        <span className="emoji" aria-hidden="true">
          🎭
        </span>
        {duet ? 'Who sings it — two parts' : 'Who sings it'}
      </h2>
      <div className={`sd-cast${duet ? ' is-duet' : ''}`}>
        {song.parts.map((p, i) => {
          const range = normalizeVocalRange(p.vocalRange);
          return (
            <Fragment key={p.position}>
              {i > 0 && (
                <span className="sd-cast-amp" aria-hidden="true">
                  &amp;
                </span>
              )}
              <article className={`card sd-part range-${rangeSlug(p.vocalRange)}`} data-testid="song-part">
                <div className="sd-part-grid">
                <div className="sd-part-head">
                  <CharacterAvatar name={p.character} range={p.vocalRange} size="lg" labelRange={false} />
                  <div className="sd-part-id">
                    <p className="sd-part-label">{duet ? `Part ${p.position}` : 'Solo character'}</p>
                    <h3 className="sd-part-name">{p.character}</h3>
                    <RangeBadge range={p.vocalRange} variant="full" size="lg" />
                  </div>
                </div>
                <p className="sd-part-blurb">
                  {range ? RANGE_INFO[range].blurb : 'Vocal range not listed yet — listen to a recording to hear where it sits.'}
                </p>
                <VoiceLadder ranges={[p.vocalRange]} className="sd-part-ladder" />
                {range && (
                  <Link to={browseHref({ ranges: [range], kind: song.kind })} className="sd-part-more">
                    More {range} {KIND_PLURAL[song.kind].toLowerCase()} <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                )}
                </div>
              </article>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Running time
// ---------------------------------------------------------------------------

const TIME_ICON: Record<string, LucideIcon> = { ok: CircleCheck, close: TriangleAlert, over: Ban, unknown: CircleHelp };

export function TimingCard({ seconds }: { seconds: number | null }) {
  const msg = timeMessage(seconds);
  const Icon = TIME_ICON[msg.status] ?? CircleHelp;
  // same scale as <TimeLimitBar> (runs to 7:00, or further for very long songs)
  const max = Math.max(TIME_LIMIT_SECONDS + 60, seconds ?? 0);
  const pos = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <section className="sd-section" aria-labelledby="sd-time-title">
      <h2 id="sd-time-title" className="section-title">
        <span className="emoji" aria-hidden="true">
          ⏱️
        </span>
        Running time
      </h2>
      <div className={`card sd-timing is-${msg.status}`} data-testid="timing-card" data-status={msg.status}>
        <div className="sd-timing-top">
          <p className="sd-timing-clock">
            <span className="sd-timing-value">{formatLength(seconds, '?:??')}</span>
            <span className="sd-timing-of">of {formatLength(TIME_LIMIT_SECONDS)}</span>
          </p>
          <p className="sd-timing-headline" data-testid="timing-headline">
            <Icon size={20} aria-hidden="true" />
            {msg.headline}
          </p>
        </div>
        <div className="sd-timing-bar">
          <TimeLimitBar seconds={seconds} caption={false} />
          <div className="sd-timing-scale" aria-hidden="true">
            <span style={{ left: 0 }}>0:00</span>
            <span style={{ left: pos(WARN_SECONDS) }} className="is-warn">
              {formatLength(WARN_SECONDS)}
            </span>
            <span style={{ left: pos(TIME_LIMIT_SECONDS) }} className="is-limit">
              {formatLength(TIME_LIMIT_SECONDS)}
            </span>
          </div>
        </div>
        <p className="sd-timing-detail">{msg.detail}</p>
        <Link to="/star-prep" className="sd-inline-link">
          <Timer size={16} aria-hidden="true" /> Practise with the rehearsal timer
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Director's note (song.notes) + mature explanation
// ---------------------------------------------------------------------------

/** Community notes are signed by whoever added the song; spreadsheet notes by the research crew. */
export function DirectorsNote({ notes, signature = '— the STAR Song Finder research crew' }: { notes: string; signature?: string }) {
  return (
    <section className="sd-note" aria-labelledby="sd-note-title" data-testid="directors-note">
      <div className="sd-note-clapper" aria-hidden="true" />
      <div className="sd-note-body">
        <h2 id="sd-note-title" className="sd-note-title">
          <Clapperboard size={20} aria-hidden="true" /> Director’s note
        </h2>
        <p className="sd-note-text">{notes}</p>
        <p className="sd-note-sign">{signature}</p>
      </div>
    </section>
  );
}

export function MatureNote() {
  return (
    <div className="callout callout-warning sd-mature" role="note" data-testid="mature-note">
      <TriangleAlert size={22} aria-hidden="true" className="sd-mature-icon" />
      <div>
        <p className="sd-mature-title">Heads up: mature themes</p>
        <p>
          This song — or the scene it comes from — deals with grown-up subject matter or language. STAR audiences include younger students and
          families, so talk it over with your teacher (and a parent or guardian) before you choose it.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rehearsal kit
// ---------------------------------------------------------------------------

interface KitLinkProps {
  href: string;
  icon: LucideIcon;
  title: string;
  sub: string;
  tone: 'gold' | 'pink' | 'teal';
  testId: string;
}

function KitLink({ href, icon: Icon, title, sub, tone, testId }: KitLinkProps) {
  return (
    <a className={`sd-kit-tile tone-${tone}`} href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>
      <span className="sd-kit-icon" aria-hidden="true">
        <Icon size={24} />
      </span>
      <span className="sd-kit-text">
        <span className="sd-kit-title">{title}</span>
        <span className="sd-kit-sub">{sub}</span>
      </span>
      <ExternalLink className="sd-kit-ext" size={16} aria-hidden="true" />
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

export function RehearsalKit({ song }: { song: Song }) {
  return (
    <section className="sd-section" aria-labelledby="sd-kit-title">
      <h2 id="sd-kit-title" className="section-title">
        <span className="emoji" aria-hidden="true">
          🧰
        </span>
        Rehearsal kit
      </h2>
      <ul className="sd-kit" role="list">
        <li>
          <KitLink href={backingTrackUrl(song)} icon={KeyboardMusic} title="Find a backing track (no vocals)" sub="YouTube · karaoke / instrumental versions" tone="gold" testId="link-backing-track" />
        </li>
        <li>
          <KitLink href={performancesUrl(song)} icon={MonitorPlay} title="Watch performances" sub="YouTube search · get ideas" tone="pink" testId="link-performances" />
        </li>
        <li>
          <KitLink href={sheetMusicUrl(song)} icon={FileMusic} title="Sheet music" sub="Musicnotes search · find your key" tone="teal" testId="link-sheet-music" />
        </li>
      </ul>
      <p className="sd-kit-tip">
        <Info size={16} aria-hidden="true" />
        <span>
          STAR performances use a backing track with <strong>no vocals</strong>. Search results vary — listen all the way through and check the key
          and length before you download.
        </span>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// About the show
// ---------------------------------------------------------------------------

export interface AboutShowCardProps {
  song: Song;
  show: Show | null;
  loading: boolean;
}

export function AboutShowCard({ song, show, loading }: AboutShowCardProps) {
  const credits = creditLines(show, { withBook: true });
  const name = show?.name ?? song.show.name;
  return (
    <section className="card sd-about" aria-labelledby="sd-about-title" data-testid="about-show">
      <p className="eyebrow">About the show</p>
      <div className="sd-about-head">
        <div className="sd-about-poster">
          <ShowPoster show={{ name, imageUrl: show?.imageUrl ?? song.show.imageUrl }} alt="" />
        </div>
        <div className="sd-about-id">
          <h2 id="sd-about-title" className="sd-about-name">
            <Link to={showPath(song.show.slug)}>{name}</Link>
          </h2>
          {show?.year ? <p className="sd-about-year">Premiered {show.year}</p> : null}
          {loading && !show && <Skeleton height={14} width="50%" />}
        </div>
      </div>
      {loading && !show ? (
        <TextSkeleton lines={3} />
      ) : (
        <>
          {credits.length > 0 && (
            <dl className="sd-about-credits">
              {credits.map((c) => (
                <div key={c.role}>
                  <dt>{c.role}</dt>
                  <dd>{c.names}</dd>
                </div>
              ))}
            </dl>
          )}
          {show?.description && <p className="sd-about-desc">{show.description}</p>}
        </>
      )}
      <Link to={showPath(song.show.slug)} className="btn btn-ghost btn-sm sd-about-cta">
        {show && show.songCount > 1 ? `All ${plural(show.songCount, 'song')} from this show` : 'Visit the show page'}
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </section>
  );
}

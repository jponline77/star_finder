/**
 * The festival part of the Home marquee (SPEC §7b): a countdown for the visitor's festival —
 * or "Where are you performing?" chips when none is chosen yet.
 *
 *   selected + upcoming  → "Curtain up at <venue> in…" + countdown   (online: "Online entries close in…")
 *   today / on now       → "Curtain up today!"                        (online: "…close today!" + hours left)
 *   over                 → "That's a wrap! 🎉" + a nudge toward national festivals still to come
 *   no date yet          → "Date to be announced — check with your teacher"
 * An online festival's end date is its deadline, even when it also has an opening day ("Opens").
 * The phase is re-checked at every local midnight (useLocalDay), in step with the countdown.
 */
import { ArrowRight, MapPin } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Countdown } from '../../components/Countdown';
import { FestivalChips } from '../../components/FestivalPicker';
import { useLocalDay } from '../../hooks/useLocalDay';
import {
  countdownTarget,
  entriesOpenOn,
  festivalPhaseOf,
  festivalShortName,
  formatDay,
  formatFestivalDate,
  isDeadlineFestival,
  isOpeningOnly,
  upcomingNationals,
  type FestivalPhase,
} from '../../lib/festivals';
import { isHttpsUrl } from '../../lib/links';
import { useFestival } from '../../state/FestivalProvider';
import type { Festival } from '../../types';

/** "Surrey Regional STAR Fest · Friday, January 29, 2027" for the hero eyebrow. */
export function heroEyebrow(f: Festival | null): string {
  if (!f) return 'STAR Fest · Musical Theatre Solo & Duet';
  const date = f.startDate && !isDeadlineFestival(f) ? formatFestivalDate(f, { weekday: true }) : formatFestivalDate(f, { month: 'short' });
  return `${f.name} · ${date}`;
}

export function FestivalHero() {
  const { selected, ready, loadError, regionalChoices } = useFestival();
  const [changing, setChanging] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const now = useLocalDay();

  // (If the festivals couldn't be loaded at all, show nothing rather than a placeholder forever.)
  if (!ready) return loadError ? null : <div className="home-countdown home-countdown-pending" aria-hidden="true" />;

  if (!selected) {
    if (!regionalChoices.length) return null;
    return (
      <div className="home-where" data-testid="festival-where">
        <h2 id="home-where-title" className="home-where-title">
          Where are you performing?
        </h2>
        <p className="home-where-hint">Pick your festival and we’ll count down to curtain up.</p>
        <FestivalChips labelledBy="home-where-title" className="is-marquee" />
      </div>
    );
  }

  return (
    <div className="home-countdown" data-testid="home-festival" data-phase={festivalPhaseOf(selected, now)}>
      <FestivalMoment festival={selected} now={now} />
      <div className="home-change">
        <button
          ref={toggleRef}
          type="button"
          className="home-change-button"
          aria-expanded={changing}
          aria-controls="home-change-panel"
          onClick={() => setChanging((c) => !c)}
          data-testid="home-change-festival"
        >
          <MapPin size={15} aria-hidden="true" />
          {changing ? 'Keep ' + festivalShortName(selected) : 'Not your festival? Change it'}
        </button>
        {changing && (
          <div id="home-change-panel" className="home-change-panel">
            <p id="home-change-title" className="visually-hidden">
              Choose your festival
            </p>
            <FestivalChips
              labelledBy="home-change-title"
              className="is-marquee"
              onPicked={() => {
                setChanging(false);
                toggleRef.current?.focus(); // the chip that was pressed goes away with the panel
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Venue({ festival, prefix }: { festival: Festival; prefix: string }) {
  if (!festival.venue || festival.kind === 'online') return null;
  return (
    <>
      {prefix}
      <strong>{festival.venue}</strong>
    </>
  );
}

function FestivalMoment({ festival, now }: { festival: Festival; now: Date }) {
  const { nationals } = useFestival();
  const phase: FestivalPhase = festivalPhaseOf(festival, now);
  const deadline = isDeadlineFestival(festival);
  const online = festival.kind === 'online';
  const target = countdownTarget(festival);

  if (phase === 'tbd' || !target) {
    return (
      <>
        <p className="home-tbd marquee-text" data-testid="festival-tbd">
          Date to be announced
        </p>
        <p className="home-countdown-label">
          Check with your teacher for the date
          {isHttpsUrl(festival.infoUrl) && (
            <>
              {' '}
              or the{' '}
              <a href={festival.infoUrl} target="_blank" rel="noopener noreferrer" className="home-hero-link">
                festival page<span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </>
          )}
          .
        </p>
      </>
    );
  }

  if (phase === 'over') {
    // only national festivals that are still to come
    const next = upcomingNationals(nationals, now);
    return (
      <div className="home-wrap" data-testid="festival-wrap">
        <p className="home-wrap-title marquee-text">{deadline ? 'Submissions are in — that’s a wrap! 🎉' : 'That’s a wrap! 🎉'}</p>
        {next.length > 0 ? (
          <>
            <p className="home-countdown-label">Heading to nationals? Next stop:</p>
            <ul className="home-nationals" role="list" data-testid="nationals-nudge">
              {next.map((n) => (
                <li key={n.slug}>
                  <span className="emoji" aria-hidden="true">
                    🏆
                  </span>{' '}
                  <strong>{n.name}</strong> · {formatFestivalDate(n)}
                  {n.venue && <span className="home-nationals-venue"> · {n.venue}</span>}
                </li>
              ))}
            </ul>
            <Link to="/star-prep#nationals" className="home-hero-link">
              About the national festivals <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </>
        ) : (
          <p className="home-countdown-label">Hope it was magic. See you next season!</p>
        )}
      </div>
    );
  }

  const entries = online ? 'Online entries' : 'Entries';

  if (deadline) {
    const opensOn = entriesOpenOn(festival, now);
    return (
      <>
        <p className="home-countdown-label">
          {phase === 'today' ? (
            <>
              {entries} close <strong>today</strong>!
            </>
          ) : opensOn ? (
            <>
              {entries} open <strong>{formatDay(opensOn, { weekday: true, year: false })}</strong> and close in…
            </>
          ) : (
            `${entries} close in…`
          )}
        </p>
        <Countdown date={target.date} deadline label={festival.name} />
      </>
    );
  }

  if (isOpeningOnly(festival)) {
    // online, with the day entries open but no deadline yet
    return phase === 'upcoming' ? (
      <>
        <p className="home-countdown-label">Online entries open in…</p>
        <Countdown date={target.date} label={festival.name} />
      </>
    ) : (
      <>
        <p className="home-countdown-label">{phase === 'today' ? 'Online entries open today!' : 'Online entries are open now!'}</p>
        <p className="countdown-done marquee-text">🎬 Check with your teacher for the deadline.</p>
      </>
    );
  }

  if (phase === 'ongoing') {
    return (
      <>
        <p className="home-countdown-label">
          The festival is on now
          <Venue festival={festival} prefix=" at " />!
        </p>
        <p className="countdown-done marquee-text">🎉 It’s showtime! Break a leg!</p>
      </>
    );
  }

  return (
    <>
      <p className="home-countdown-label">
        {phase === 'today' ? (
          <>
            Curtain up today
            <Venue festival={festival} prefix=" at " />!
          </>
        ) : festival.venue && !online ? (
          <>
            Curtain up at <strong>{festival.venue}</strong> in…
          </>
        ) : (
          'Curtain up in…'
        )}
      </p>
      <Countdown date={target.date} label={festival.name} />
    </>
  );
}

/**
 * STAR Prep festival pieces (SPEC §7b), all from the API (nothing hardcoded):
 *  - <PrepCountdown/>   hero countdown for the chosen festival, or a picker when none is chosen
 *  - <FestivalDates/>   regional + online festivals with "Your festival" / "Make this mine",
 *                       a share link for teachers, the caveat, the national festivals, TAEA link
 */
import { CalendarDays, ExternalLink, Link2, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { Countdown } from '../../components/Countdown';
import { CopyButton } from '../../components/CopyButton';
import { FestivalPicker } from '../../components/FestivalPicker';
import { Skeleton } from '../../components/Skeletons';
import { useLocalDay } from '../../hooks/useLocalDay';
import {
  calendarParts,
  countdownTarget,
  entriesOpenOn,
  FESTIVAL_KIND_EMOJI,
  festivalDateNote,
  festivalPhaseOf,
  festivalSeason,
  festivalShareUrl,
  festivalShortName,
  festivalStatus,
  festivalTileDate,
  formatDay,
  formatFestivalDate,
  groupFestivals,
  isOpeningOnly,
  upcomingNationals,
} from '../../lib/festivals';
import { isHttpsUrl } from '../../lib/links';
import { TAEA_URL } from '../../lib/vocab';
import { useFestival } from '../../state/FestivalProvider';
import { useToast } from '../../state/ToastProvider';
import type { Festival } from '../../types';

// ---------------------------------------------------------------------------
// Hero countdown
// ---------------------------------------------------------------------------

export function PrepCountdown() {
  const { selected, ready, loadError, regionalChoices, nationals } = useFestival();
  const now = useLocalDay();
  if (!ready) return loadError ? null : <div className="prep-countdown prep-countdown-pending" aria-hidden="true" />;
  if (!selected) {
    if (!regionalChoices.length) return null;
    return (
      <div className="prep-countdown" data-testid="prep-festival">
        <p className="prep-countdown-label">Pick your festival to see your countdown and dates.</p>
        <FestivalPicker tone="marquee" align="center" testId="prep-festival-picker" />
      </div>
    );
  }
  const phase = festivalPhaseOf(selected, now);
  const target = countdownTarget(selected);
  const opensOn = entriesOpenOn(selected, now);
  const openingOnly = isOpeningOnly(selected);
  return (
    <div className="prep-countdown" data-testid="prep-festival" data-phase={phase}>
      <p className="prep-countdown-label">
        {selected.name} · <strong>{formatFestivalDate(selected, { weekday: true })}</strong>
      </p>
      {phase === 'tbd' || !target ? (
        <p className="prep-countdown-note">Date to be announced — check with your teacher.</p>
      ) : phase === 'over' ? (
        <p className="countdown-done marquee-text">
          That’s a wrap! 🎉{' '}
          {upcomingNationals(nationals, now).length > 0 ? (
            <a href="#nationals" className="prep-hero-link">
              Nationals are next →
            </a>
          ) : (
            'See you next season!'
          )}
        </p>
      ) : openingOnly && phase !== 'upcoming' ? (
        <p className="countdown-done marquee-text">{phase === 'today' ? 'Online entries open today!' : 'Online entries are open now!'} Check with your teacher for the deadline.</p>
      ) : phase === 'ongoing' ? (
        <p className="countdown-done marquee-text">🎉 It’s on now — break a leg!</p>
      ) : (
        <>
          {opensOn && <p className="prep-countdown-note">Entries open {formatDay(opensOn, { weekday: true, year: false })}.</p>}
          <Countdown date={target.date} deadline={target.kind === 'deadline'} label={selected.name} hideSeconds compact />
        </>
      )}
      <FestivalPicker tone="marquee" align="center" testId="prep-festival-picker" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dates section
// ---------------------------------------------------------------------------

function CalendarTile({ festival }: { festival: Festival }) {
  const parts = calendarParts(festivalTileDate(festival));
  return (
    <span className="prep-date-cal" aria-hidden="true">
      <span className="prep-date-month">{parts ? parts.month : 'TBA'}</span>
      <span className="prep-date-day">{parts ? parts.day : '?'}</span>
    </span>
  );
}

function FestivalCard({ festival, now, mine, onMakeMine }: { festival: Festival; now: Date; mine?: boolean; onMakeMine?: (f: Festival) => void }) {
  const status = festivalStatus(festival, now);
  const note = festivalDateNote(festival);
  const short = festivalShortName(festival);
  // skip what the card already says: "Online" under the Online card, "Vancouver" after "(UBC Vancouver)"
  const venue = festival.venue && festival.venue.toLowerCase() !== short.toLowerCase() ? festival.venue : null;
  const city = festival.city && festival.city.toLowerCase() !== short.toLowerCase() && !venue?.toLowerCase().includes(festival.city.toLowerCase()) ? festival.city : null;
  return (
    <li className={`prep-date is-${status.state}${mine ? ' is-home' : ''} kind-${festival.kind}`} data-testid="festival-card" data-slug={festival.slug}>
      <CalendarTile festival={festival} />
      <span className="prep-date-body">
        <span className="prep-date-city">
          {festival.kind === 'online' && (
            <span className="emoji" aria-hidden="true">
              {FESTIVAL_KIND_EMOJI.online}
            </span>
          )}
          {short}
          <span className="prep-date-status">{status.label}</span>
        </span>
        <span className="prep-date-meta">
          <CalendarDays size={14} aria-hidden="true" /> {formatFestivalDate(festival, { weekday: true })}
        </span>
        {note && <span className="prep-date-meta prep-date-note">{note}</span>}
        {(venue || city) && (
          <span className="prep-date-meta">
            <MapPin size={14} aria-hidden="true" /> {[venue, city].filter(Boolean).join(' · ')}
          </span>
        )}
        {(onMakeMine || (festival.kind === 'national' && isHttpsUrl(festival.infoUrl))) && (
          <span className="prep-date-actions">
            {onMakeMine && (
              // One button that turns into the "Your festival" badge, so keyboard focus stays put.
              <button
                type="button"
                className={`btn btn-sm prep-date-mine${mine ? ' is-mine' : ' btn-ghost'}`}
                aria-disabled={mine || undefined}
                onClick={() => {
                  if (!mine) onMakeMine(festival);
                }}
                data-testid="make-mine"
              >
                <span className="emoji" aria-hidden="true">
                  {mine ? '⭐' : '📍'}
                </span>{' '}
                {mine ? 'Your festival' : 'Make this mine'}
                <span className="visually-hidden">: {festival.name}</span>
              </button>
            )}
            {festival.kind === 'national' && isHttpsUrl(festival.infoUrl) && (
              <a href={festival.infoUrl} className="btn btn-quiet btn-sm" target="_blank" rel="noopener noreferrer">
                Details <ExternalLink size={14} aria-hidden="true" />
                <span className="visually-hidden"> about {festival.name} (opens in a new tab)</span>
              </a>
            )}
          </span>
        )}
      </span>
    </li>
  );
}

function DatesSkeleton() {
  return (
    <div className="prep-dates" role="status" aria-live="polite">
      <span className="visually-hidden">Loading festival dates…</span>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={96} radius={18} />
      ))}
    </div>
  );
}

export function FestivalDates() {
  const { festivals, selected, setFestival, ready, loadError, retryLoad } = useFestival();
  const toast = useToast();
  const now = useLocalDay();
  const groups = useMemo(() => groupFestivals(festivals), [festivals]);
  const season = festivalSeason(festivals);
  const choices = [...groups.regional, ...groups.online];
  const shareUrl = selected ? festivalShareUrl(selected.slug) : '';

  const makeMine = (f: Festival) => {
    void setFestival(f.slug).then((ok) => {
      if (ok) toast.success(`${festivalShortName(f)} is your festival now — break a leg!`, { emoji: '📍', id: 'festival-set', duration: 3000 });
    });
  };

  return (
    <section className="section" id="dates" aria-labelledby="dates-title">
      <h2 id="dates-title" className="section-title">
        <span className="emoji" aria-hidden="true">
          📅
        </span>
        {season ? `${season} ` : ''}Regional STAR Fests
      </h2>
      <p className="prep-section-lede">Find yours and tap “Make this mine” — we’ll count down to it here and on the home page.</p>

      {!ready && loadError ? (
        <div className="callout callout-warning prep-dates-error" data-testid="festival-dates-error">
          <span aria-hidden="true">⚠️</span>
          <p role="alert">We couldn’t load the festival dates. Check your connection and try again.</p>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void retryLoad()} data-testid="festival-dates-retry">
            Try again
          </button>
        </div>
      ) : !ready ? (
        <DatesSkeleton />
      ) : choices.length === 0 ? (
        <p className="muted">Festival dates haven’t been posted yet — check the official TAEA page below.</p>
      ) : (
        <ol className="prep-dates" role="list" data-testid="regional-dates">
          {choices.map((f) => (
            <FestivalCard key={f.slug} festival={f} now={now} mine={f.slug === selected?.slug} onMakeMine={makeMine} />
          ))}
        </ol>
      )}

      {selected && (
        <div className="prep-share" data-testid="festival-share">
          <span className="prep-share-icon" aria-hidden="true">
            <Link2 size={22} />
          </span>
          <div className="prep-share-text">
            <p className="prep-share-title">Teachers: send your class straight to {festivalShortName(selected)}</p>
            <p className="prep-share-hint">Anyone who opens this link gets {selected.name} picked for them.</p>
            <code className="prep-share-url" data-testid="festival-share-url">
              {shareUrl}
            </code>
          </div>
          <CopyButton text={shareUrl} label="Copy a link for this festival" copiedLabel="Link copied!" testId="copy-festival-link" className="prep-share-copy" />
        </div>
      )}

      <div className="callout callout-info prep-caveat">
        <span aria-hidden="true">ℹ️</span>
        <p>
          Dates come from the festival organizers and can change. <strong>Always confirm with your teacher</strong> and the official TAEA page.
        </p>
      </div>

      {groups.national.length > 0 && (
        <div className="prep-nationals" id="nationals" aria-labelledby="nationals-title" role="group">
          <h3 id="nationals-title" className="prep-nationals-title">
            <span className="emoji" aria-hidden="true">
              🏆
            </span>{' '}
            After regionals: National STAR Festivals
          </h3>
          <p className="prep-nationals-lede">After regionals, some performers go on to a national STAR Festival — ask your teacher how it works this season.</p>
          <ol className="prep-dates" role="list" data-testid="national-dates">
            {groups.national.map((f) => (
              <FestivalCard key={f.slug} festival={f} now={now} />
            ))}
          </ol>
        </div>
      )}

      <p className="prep-official">
        <a href={TAEA_URL} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
          Official TAEA Regional STAR Fest page <ExternalLink size={16} aria-hidden="true" />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </p>
    </section>
  );
}

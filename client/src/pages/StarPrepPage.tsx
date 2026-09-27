/**
 * /star-prep — STAR Prep (SPEC §7.9, facts from SPEC §1).
 * Rules in plain English (time limit, backing track, song rules, dress & set pieces), the slate
 * (format, examples, generic SlateBuilder), a rehearsal timer (./star-prep/RehearsalTimer), the
 * rubric, the "not a competition" note, and the 2026–27 BC regional dates.
 */
import { ArrowRight, Ban, CalendarDays, Check, ExternalLink, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Countdown } from '../components/Countdown';
import { Marquee } from '../components/Marquee';
import { SlateBuilder } from '../components/SlateBuilder';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { browseHref } from '../lib/filters';
import { daysUntil, formatLongDate, parseLocalDate } from '../lib/format';
import { DEFAULT_FESTIVAL, RUBRIC_CATEGORIES, RUBRIC_LEVELS, TAEA_URL, WARN_SECONDS } from '../lib/vocab';
import { useSongs } from '../state/SongsProvider';
import { APPROVED_LICENSORS, BC_REGIONALS, regionalStatus, RUBRIC_DETAILS, RUBRIC_LEVEL_BLURB, SLATE_EXAMPLES } from './star-prep/content';
import { RehearsalTimer } from './star-prep/RehearsalTimer';
import './StarPrepPage.css';

const JUMP_LINKS = [
  { href: '#time', emoji: '⏱️', label: 'Time limit' },
  { href: '#track', emoji: '🎧', label: 'Backing track' },
  { href: '#song-rules', emoji: '📜', label: 'Song rules' },
  { href: '#dress', emoji: '🖤', label: 'Dress & set' },
  { href: '#slate', emoji: '🎤', label: 'Slate' },
  { href: '#timer', emoji: '⏲️', label: 'Timer' },
  { href: '#rubric', emoji: '📋', label: 'Rubric' },
  { href: '#dates', emoji: '📅', label: 'Dates' },
];

function ChairIcon() {
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" className="prep-set-icon">
      <path d="M9 3h14v13H9z" fill="currentColor" opacity="0.35" />
      <path d="M8 16h16v4H8z" fill="currentColor" />
      <path d="M9 20h3v10H9zM20 20h3v10h-3z" fill="currentColor" />
      <path d="M9 3h3v13H9zM20 3h3v13h-3z" fill="currentColor" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg viewBox="0 0 40 32" width="36" height="30" aria-hidden="true" className="prep-set-icon">
      <path d="M2 9h36v5H2z" fill="currentColor" />
      <path d="M6 14h3v16H6zM31 14h3v16h-3z" fill="currentColor" />
    </svg>
  );
}

function SetPieces({ chairs, label }: { chairs: number; label: string }) {
  return (
    <div className="prep-set">
      <p className="prep-set-label">{label}</p>
      <p className="prep-set-icons" role="img" aria-label={`Up to ${chairs} chair${chairs === 1 ? '' : 's'} and 1 table`}>
        {Array.from({ length: chairs }, (_, i) => (
          <ChairIcon key={i} />
        ))}
        <span className="prep-set-plus" aria-hidden="true">
          +
        </span>
        <TableIcon />
      </p>
      <p className="prep-set-text" aria-hidden="true">
        {chairs} chair{chairs === 1 ? '' : 's'} + 1 table
      </p>
    </div>
  );
}

function Do({ children }: { children: ReactNode }) {
  return (
    <li className="prep-do">
      <span className="prep-check-icon is-do" aria-hidden="true">
        <Check size={14} strokeWidth={3} />
      </span>
      <span>
        <span className="visually-hidden">Do: </span>
        {children}
      </span>
    </li>
  );
}

function Dont({ children }: { children: ReactNode }) {
  return (
    <li className="prep-dont">
      <span className="prep-check-icon is-dont" aria-hidden="true">
        <Ban size={14} strokeWidth={3} />
      </span>
      <span>
        <span className="visually-hidden">Don’t: </span>
        {children}
      </span>
    </li>
  );
}

function TimingStrip() {
  return (
    <div className="prep-timing" role="img" aria-label="Timeline: your slate is not timed. The 6-minute clock starts when your song starts. Amber from 5:30, and over the limit after 6:00.">
      <div className="prep-timing-slate" aria-hidden="true">
        <span>🎤 Slate</span>
        <small>not timed</small>
      </div>
      <div className="prep-timing-song" aria-hidden="true">
        <span className="prep-timing-zone is-ok">
          <span>0:00 ▶ your song</span>
        </span>
        <span className="prep-timing-zone is-warn">
          <span>5:30</span>
        </span>
        <span className="prep-timing-zone is-limit">
          <span>6:00</span>
        </span>
      </div>
    </div>
  );
}

export default function StarPrepPage() {
  useDocumentTitle('STAR Prep');
  const { meta } = useSongs();
  const festival = meta?.festival ?? DEFAULT_FESTIVAL;
  const today = new Date();

  return (
    <div className="prep-page">
      {/* ---------------- hero ---------------- */}
      <section className="prep-hero container" aria-labelledby="prep-title">
        <Marquee size="lg" className="prep-marquee" innerClassName="prep-marquee-inner">
          <p className="prep-eyebrow">🎓 STAR Prep · Musical Theatre Solo &amp; Duet</p>
          <h1 id="prep-title" className="prep-title marquee-text">
            Get <span className="nowrap">stage-ready</span>
          </h1>
          <p className="prep-lede">The STAR rules in plain English, a slate builder, and a rehearsal timer that knows about the 6:00 limit.</p>
          <div className="prep-countdown">
            <p className="prep-countdown-label">
              {festival.name} · <strong>{formatLongDate(festival.date)}</strong>
            </p>
            <Countdown date={festival.date} label={festival.name} hideSeconds compact />
          </div>
        </Marquee>
        <nav className="prep-jump" aria-label="On this page">
          <ul role="list" className="chip-group">
            {JUMP_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="chip prep-jump-chip">
                  <span className="emoji" aria-hidden="true">
                    {l.emoji}
                  </span>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      <div className="container">
        {/* ---------------- rules ---------------- */}
        <section className="section" aria-labelledby="rules-title">
          <h2 id="rules-title" className="section-title">
            <span className="emoji" aria-hidden="true">
              📣
            </span>
            The rules, in plain English
          </h2>
          <div className="prep-rules">
            <article className="prep-card accent-gold" id="time" aria-labelledby="time-title">
              <header className="prep-card-head">
                <span className="prep-card-emoji emoji" aria-hidden="true">
                  ⏱️
                </span>
                <div>
                  <p className="prep-card-kicker">Time limit</p>
                  <h3 id="time-title" className="prep-card-title">
                    6:00 max, starting after your slate
                  </h3>
                </div>
              </header>
              <TimingStrip />
              <ul className="prep-list" role="list">
                <Do>
                  The clock starts <strong>after your slate</strong>, when your performance begins.
                </Do>
                <Dont>
                  Go over <strong>6:00</strong>. That risks <strong>disqualification</strong>, so cut the song if you need to.
                </Dont>
                <Do>Aim for 5:30 or less so there’s room for a breath and your “Thank you.”</Do>
              </ul>
              <Link to={browseHref({ maxSeconds: WARN_SECONDS })} className="prep-card-link">
                Songs that fit comfortably <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </article>

            <article className="prep-card accent-teal" id="track" aria-labelledby="track-title">
              <header className="prep-card-head">
                <span className="prep-card-emoji emoji" aria-hidden="true">
                  🎧
                </span>
                <div>
                  <p className="prep-card-kicker">Backing track</p>
                  <h3 id="track-title" className="prep-card-title">
                    Pre-recorded, with NO vocals
                  </h3>
                </div>
              </header>
              <ul className="prep-list" role="list">
                <Do>
                  Use a pre-recorded instrumental track with <strong>no vocals on it</strong>.
                </Do>
                <Do>Download the file to a device ahead of time. Don’t rely on streaming or Wi-Fi.</Do>
                <Dont>Use live accompaniment (no pianist or guitarist).</Dont>
                <Dont>
                  Sing a cappella, <em>unless</em> the song was written that way.
                </Dont>
              </ul>
              <div className="prep-formats" aria-label="Accepted file types">
                {['MP3', 'M4A', 'WAV', 'AIFF'].map((f) => (
                  <span key={f} className="prep-format">
                    .{f.toLowerCase()}
                  </span>
                ))}
              </div>
              <p className="small muted">Tip: every song page has a “Find a backing track” button. Make sure the track matches the key and the cut you rehearse.</p>
            </article>

            <article className="prep-card accent-pink" id="song-rules" aria-labelledby="song-rules-title">
              <header className="prep-card-head">
                <span className="prep-card-emoji emoji" aria-hidden="true">
                  📜
                </span>
                <div>
                  <p className="prep-card-kicker">Song rules</p>
                  <h3 id="song-rules-title" className="prep-card-title">
                    One song from a real stage musical
                  </h3>
                </div>
              </header>
              <ul className="prep-list" role="list">
                <Do>
                  Choose <strong>one song</strong> from a <strong>published score written for a stage musical</strong>.
                </Do>
                <Do>
                  <strong>Solo</strong> = a song written for <strong>one character</strong>.
                </Do>
                <Do>
                  <strong>Duet</strong> = a song written with vocal parts for <strong>two characters</strong>.
                </Do>
                <Dont>Pick songs that only appear in a film or TV version.</Dont>
              </ul>
              <details className="prep-details">
                <summary>Approved publishers &amp; licensors</summary>
                <ul className="prep-licensors">
                  {APPROVED_LICENSORS.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <p className="small muted">Not sure where your show is licensed? Check with your teacher before you commit.</p>
              </details>
            </article>

            <article className="prep-card accent-plum" id="dress" aria-labelledby="dress-title">
              <header className="prep-card-head">
                <span className="prep-card-emoji emoji" aria-hidden="true">
                  🖤
                </span>
                <div>
                  <p className="prep-card-kicker">Dress &amp; set pieces</p>
                  <h3 id="dress-title" className="prep-card-title">
                    All black, no costumes
                  </h3>
                </div>
              </header>
              <ul className="prep-list" role="list">
                <Do>Wear all black, with minimal accessories.</Do>
                <Dont>Use costumes, props or theatrical makeup. Your acting does the work!</Dont>
              </ul>
              <div className="prep-sets">
                <SetPieces chairs={1} label="🎤 Solo, up to" />
                <SetPieces chairs={2} label="👯 Duet, up to" />
              </div>
            </article>
          </div>
        </section>

        {/* ---------------- slate ---------------- */}
        <section className="section prep-slate" id="slate" aria-labelledby="slate-title">
          <h2 id="slate-title" className="section-title">
            <span className="emoji" aria-hidden="true">
              🎤
            </span>
            Nail your slate
          </h2>
          <div className="prep-slate-grid">
            <div className="stack">
              <p className="prep-slate-intro">
                Every performance starts with a <strong>slate</strong>, a quick introduction said straight to the adjudicators. It isn’t timed. When your song ends, finish
                with <strong>“Thank you.”</strong>
              </p>
              <div className="prep-template" aria-label="Slate format">
                <p className="prep-template-label">The format</p>
                <p className="prep-template-text">
                  “I am <mark>your name</mark> from <mark>your school</mark>, Troupe #<mark>number</mark>, and I’ll be performing “<mark>song title</mark>” from{' '}
                  <mark>show</mark> by <mark>composer &amp; lyricist</mark>.”
                </p>
                <p className="small muted">Duets start with “Our names are … and we’ll be performing…”. The troupe number is optional.</p>
              </div>
              <figure className="prep-example">
                <figcaption>Solo example</figcaption>
                <blockquote>“{SLATE_EXAMPLES.solo}”</blockquote>
              </figure>
              <figure className="prep-example">
                <figcaption>Duet example</figcaption>
                <blockquote>“{SLATE_EXAMPLES.duet}”</blockquote>
              </figure>
            </div>
            <div className="prep-slate-builder card">
              <h3 className="prep-builder-title">
                <span className="emoji" aria-hidden="true">
                  ✍️
                </span>{' '}
                Build yours
              </h3>
              <p className="small muted">Your name, school and troupe are remembered on this device. Tip: every song page has a slate builder with the credits filled in.</p>
              <SlateBuilder />
            </div>
          </div>
        </section>

        {/* ---------------- timer ---------------- */}
        <section className="section" id="timer" aria-labelledby="timer-title">
          <h2 id="timer-title" className="section-title">
            <span className="emoji" aria-hidden="true">
              ⏲️
            </span>
            Rehearsal timer
          </h2>
          <p className="prep-section-lede">Run your song like it’s the real thing. The ring turns amber at 5:30 and red at 6:00.</p>
          <RehearsalTimer />
        </section>

        {/* ---------------- rubric ---------------- */}
        <section className="section" id="rubric" aria-labelledby="rubric-title">
          <h2 id="rubric-title" className="section-title">
            <span className="emoji" aria-hidden="true">
              📋
            </span>
            How you’re scored
          </h2>
          <p className="prep-section-lede">Adjudicators score six categories on four levels. Here’s what the top level, Advanced, looks like in each one.</p>
          <ol className="prep-levels" role="list" aria-label="Rubric levels">
            {RUBRIC_LEVELS.map((l) => (
              <li key={l.score} className={`prep-level is-${l.score}`}>
                <span className="prep-level-score">{l.score}</span>
                <span className="prep-level-text">
                  <strong>{l.label}</strong>
                  <span>{RUBRIC_LEVEL_BLURB[l.score]}</span>
                </span>
              </li>
            ))}
          </ol>
          <ul className="prep-rubric" role="list">
            {RUBRIC_CATEGORIES.map((c) => (
              <li key={c} className="prep-rubric-card card">
                <span className="prep-rubric-emoji emoji" aria-hidden="true">
                  {RUBRIC_DETAILS[c].emoji}
                </span>
                <h3 className="prep-rubric-title">{c.replace('/', ' / ')}</h3>
                <p className="prep-rubric-advanced">
                  <span className="prep-rubric-tag">Advanced looks like</span>
                  {RUBRIC_DETAILS[c].advanced}
                </p>
              </li>
            ))}
          </ul>
          <aside className="prep-not-competition" aria-labelledby="not-comp-title">
            <span className="prep-not-competition-emoji emoji" aria-hidden="true">
              🤝
            </span>
            <div>
              <h3 id="not-comp-title">It’s not a competition!</h3>
              <p>
                You’re scored against the <strong>rubric</strong>, not against each other. Everyone can earn a top score, so cheer each other on, learn from the feedback, and
                have fun up there.
              </p>
            </div>
          </aside>
        </section>

        {/* ---------------- dates ---------------- */}
        <section className="section" id="dates" aria-labelledby="dates-title">
          <h2 id="dates-title" className="section-title">
            <span className="emoji" aria-hidden="true">
              📅
            </span>
            2026–27 BC Regional STAR Fests
          </h2>
          <ol className="prep-dates" role="list" data-testid="regional-dates">
            {BC_REGIONALS.map((r) => {
              const status = regionalStatus(daysUntil(r.date, today));
              const d = parseLocalDate(r.date);
              return (
                <li key={r.city} className={`prep-date is-${status.state}${r.home ? ' is-home' : ''}`}>
                  <span className="prep-date-cal" aria-hidden="true">
                    <span className="prep-date-month">{d.toLocaleDateString('en-CA', { month: 'short' })}</span>
                    <span className="prep-date-day">{d.getDate()}</span>
                  </span>
                  <span className="prep-date-body">
                    <span className="prep-date-city">
                      {r.city}
                      {r.home && <span className="badge badge-gold prep-date-home">Our festival</span>}
                      <span className="prep-date-status">{status.label}</span>
                    </span>
                    <span className="prep-date-meta">
                      <CalendarDays size={14} aria-hidden="true" /> {formatLongDate(r.date)}
                    </span>
                    {r.venue && (
                      <span className="prep-date-meta">
                        <MapPin size={14} aria-hidden="true" /> {r.venue}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="callout callout-info prep-caveat">
            <span aria-hidden="true">ℹ️</span>
            <p>
              Dates come from the 2026–27 program guide and can change. <strong>Always confirm with your teacher</strong> and the official TAEA page.
            </p>
          </div>
          <p className="prep-official">
            <a href={TAEA_URL} className="btn btn-primary" target="_blank" rel="noopener noreferrer">
              Official TAEA Regional STAR Fest page <ExternalLink size={16} aria-hidden="true" />
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}

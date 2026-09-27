/**
 * "/stats" By the Numbers (SPEC §7.10): headline counters, then CSS bar charts for genre,
 * sub-genre (grouped by genre), vocal range, top shows, length histogram (6:00 marker),
 * solos vs duets, mature share and preview coverage. Data: GET /api/stats (+ cached songs/meta/shows).
 */
import { ArrowRight, Ban, CircleCheck, Download, FileSpreadsheet, Sparkles, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { EXPORT_XLSX_URL, errorMessage, getStats } from '../api';
import { ArtworkTile } from '../components/ArtworkTile';
import { ErrorState } from '../components/EmptyState';
import { Marquee } from '../components/Marquee';
import { Skeleton } from '../components/Skeletons';
import { useApiData } from '../hooks/useApiData';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { browseHref } from '../lib/filters';
import { formatLength, percent } from '../lib/format';
import { showPath, songPath } from '../lib/links';
import { showSlug } from '../lib/normalize';
import { genreEmoji, normalizeVocalRange, rangeColorVar, RANGE_SHORT, subGenreEmoji, TIME_LIMIT_SECONDS, VOCAL_RANGES, WARN_SECONDS } from '../lib/vocab';
import { useShows, useSongs } from '../state/SongsProvider';
import type { Song, StatBucket, Stats, VocalRange } from '../types';
import { BarList, ColumnChart, Meter, SplitBar, type BarDatum, type ColumnDatum } from './stats/StatsCharts';
import { useCountUp } from './stats/useCountUp';
import './StatsPage.css';

/** /api/stats also sends `total` and min/max on each length bucket (server report §11). */
type LengthBucket = StatBucket & { min?: number | null; max?: number | null };
type StatsResponse = Stats & { total?: number; lengthBuckets: LengthBucket[] };

const TOP_SHOWS = 8;

const RANGE_PLURAL: Record<VocalRange, string> = {
  Soprano: 'sopranos',
  'Mezzo-soprano': 'mezzos',
  Alto: 'altos',
  Tenor: 'tenors',
  Baritone: 'baritones',
  Bass: 'basses',
};

export default function StatsPage() {
  useDocumentTitle('By the Numbers');
  const { data, loading, error, reload } = useApiData<StatsResponse>((signal) => getStats(signal) as Promise<StatsResponse>, []);
  const { songs, meta } = useSongs();
  const { shows } = useShows();

  return (
    <div className="stats-page">
      <div className="container">
        <StatsHero stats={data} />
        {error && !data ? (
          <ErrorState title="The numbers missed their cue" message={errorMessage(error)} onRetry={reload} />
        ) : loading && !data ? (
          <StatsSkeleton />
        ) : data ? (
          <StatsBody stats={data} songs={songs} subGenreGenres={meta?.subGenres ?? []} metaShows={meta?.shows ?? []} shows={shows} />
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- hero

function totalOf(stats: StatsResponse): number {
  return stats.total ?? stats.byKind.reduce((n, b) => n + b.count, 0);
}

function StatsHero({ stats }: { stats: StatsResponse | null }) {
  const ticker = useMemo(() => {
    if (!stats) return null;
    const bits = [`${totalOf(stats)} songs`, `${stats.byShow.length} shows`];
    for (const b of [...stats.byRange].sort((a, b2) => b2.count - a.count)) {
      const r = normalizeVocalRange(b.label);
      if (r && b.count > 0) bits.push(`${b.count} ${b.count === 1 ? r.toLowerCase() : RANGE_PLURAL[r]}`);
    }
    return bits;
  }, [stats]);

  return (
    <header className="stats-hero">
      <Marquee size="lg" className="stats-marquee" innerClassName="stats-marquee-inner">
        <p className="stats-eyebrow">
          <span aria-hidden="true">📊 </span>The STAR list, in lights
        </p>
        <h1 className="stats-title marquee-text">By the Numbers</h1>
        <p className="stats-ticker" data-testid="stats-ticker">
          {ticker ? (
            ticker.map((t, i) => (
              <span key={t} className="stats-ticker-item">
                {i > 0 && (
                  <span className="stats-ticker-dot" aria-hidden="true">
                    {' '}
                    ✦{' '}
                  </span>
                )}
                {t}
              </span>
            ))
          ) : (
            <span className="stats-ticker-item">Counting the house…</span>
          )}
        </p>
      </Marquee>
      <div className="stats-hero-actions">
        <p className="stats-hero-lede">Which voices, moods and shows fill the list — and how many songs fit STAR’s 6:00 limit?</p>
        <div className="cluster">
          <a href={EXPORT_XLSX_URL} download className="btn btn-primary" data-testid="download-xlsx">
            <Download size={18} aria-hidden="true" /> Download the spreadsheet
            <span className="visually-hidden"> (.xlsx)</span>
          </a>
          <Link to="/songs" className="btn btn-ghost">
            Browse all songs <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------- body

interface StatsBodyProps {
  stats: StatsResponse;
  songs: Song[];
  subGenreGenres: ReadonlyArray<{ name: string; genre: string | null }>;
  metaShows: ReadonlyArray<{ name: string; slug: string }>;
  shows: ReadonlyArray<{ name: string; slug: string; imageUrl: string | null }>;
}

function StatsBody({ stats, songs, subGenreGenres, metaShows, shows }: StatsBodyProps) {
  const total = totalOf(stats);
  const solos = stats.byKind.find((b) => b.label === 'solo')?.count ?? 0;
  const duets = stats.byKind.find((b) => b.label === 'duet')?.count ?? 0;
  const unknownLength = stats.lengthBuckets.find((b) => b.label === 'Unknown')?.count ?? 0;
  const underLimit = Math.max(0, total - stats.overLimit - unknownLength);

  return (
    <>
      {/* ------------------------------------------------ headline counters */}
      <section aria-labelledby="stats-headline-title" className="stats-headline">
        <h2 id="stats-headline-title" className="visually-hidden">
          Headline numbers
        </h2>
        <ul className="stats-tiles" role="list" data-testid="stats-tiles">
          <CountTile value={total} label="songs" emoji="🎵" to="/songs" accent="gold" />
          <CountTile value={solos} label="solos" emoji="🎤" to={browseHref({ kind: 'solo' })} accent="pink" />
          <CountTile value={duets} label="duets" emoji="👯" to={browseHref({ kind: 'duet' })} accent="teal" />
          <CountTile value={stats.byShow.length} label="shows" emoji="🎟️" to="/shows" accent="gold" />
          <CountTile value={stats.withPreview} label="with a 30-sec preview" emoji="🎧" to={browseHref({ hasAudio: true })} accent="pink" />
          <CountTile value={underLimit} label="fit under 6:00" emoji="⏱️" to={browseHref({ maxSeconds: TIME_LIMIT_SECONDS })} accent="teal" />
        </ul>
      </section>

      <FunFacts stats={stats} songs={songs} metaShows={metaShows} />

      <div className="stats-grid">
        {/* ------------------------------------------------ solos vs duets */}
        <ChartCard id="kind" emoji="🎤" title="Solo or duet?" subtitle={`${percent(total ? solos / total : 0)} of the list is solos.`}>
          <SplitBar
            testId="chart-kind"
            parts={[
              { key: 'solo', label: 'Solos', emoji: '🎤', count: solos, color: 'var(--stats-c1)', href: browseHref({ kind: 'solo' }) },
              { key: 'duet', label: 'Duets', emoji: '👯', count: duets, color: 'var(--stats-c2)', href: browseHref({ kind: 'duet' }) },
            ]}
          />
        </ChartCard>

        {/* ------------------------------------------------ genre */}
        <ChartCard id="genre" emoji="🎭" title="Songs by genre" subtitle="Tap a genre to browse it.">
          <BarList
            testId="chart-genre"
            label="Songs by genre"
            total={total}
            color="var(--stats-c1)"
            items={stats.byGenre.map((b) => ({ key: b.label, label: b.label, count: b.count, emoji: genreEmoji(b.label), href: browseHref({ genres: [b.label] }) }))}
          />
        </ChartCard>

        {/* ------------------------------------------------ vocal range */}
        <ChartCard id="range" emoji="🎶" title="Vocal ranges" subtitle="Highest to lowest. A duet counts once for each range it needs." wide>
          <RangeChart stats={stats} total={total} />
        </ChartCard>

        {/* ------------------------------------------------ length */}
        <ChartCard id="length" emoji="⏱️" title="How long are they?" subtitle="STAR’s time limit is 6:00 — anything over needs a cut." wide>
          <LengthChart buckets={stats.lengthBuckets} total={total} overLimit={stats.overLimit} unknown={unknownLength} />
        </ChartCard>

        {/* ------------------------------------------------ sub-genres */}
        <ChartCard id="mood" emoji="🌈" title="Moods (sub-genres)" subtitle="Grouped by genre — pick a vibe to browse it." wide>
          <SubGenreGroups stats={stats} total={total} subGenreGenres={subGenreGenres} />
        </ChartCard>

        {/* ------------------------------------------------ shows */}
        <ChartCard id="shows" emoji="🏆" title="Top shows" subtitle="Which musicals have the most songs on the list?">
          <TopShows stats={stats} total={total} metaShows={metaShows} shows={shows} />
        </ChartCard>

        <div className="stats-stack">
          {/* ------------------------------------------------ mature */}
          <ChartCard id="mature" emoji="⚠️" title="Mature themes">
            <MeterStat
              value={stats.mature.yes}
              total={stats.mature.yes + stats.mature.no}
              label="Songs flagged for mature themes"
              color="var(--stats-c2)"
              testId="chart-mature"
              sentence={
                <>
                  <strong>{stats.mature.yes}</strong> of {stats.mature.yes + stats.mature.no} songs deal with mature themes — {stats.mature.no} don’t.
                </>
              }
              link={{ to: browseHref({ hideMature: true }), text: `Browse the ${stats.mature.no} without` }}
            />
          </ChartCard>

          {/* ------------------------------------------------ previews */}
          <ChartCard id="preview" emoji="🎧" title="Preview coverage">
            <MeterStat
              value={stats.withPreview}
              total={total}
              label="Songs with a 30-second preview"
              color="var(--stats-c3)"
              testId="chart-preview"
              sentence={
                stats.withPreview >= total && total > 0 ? (
                  <>
                    Every single song has a <strong>30-second preview</strong> — press ▶ and have a listen!
                  </>
                ) : (
                  <>
                    <strong>{stats.withPreview}</strong> of {total} songs have a 30-second preview you can play right here.
                  </>
                )
              }
              link={{ to: browseHref({ hasAudio: true }), text: 'Browse songs with audio' }}
            />
          </ChartCard>
        </div>
      </div>

      {/* ------------------------------------------------ outro */}
      <section className="stats-outro card" aria-labelledby="stats-outro-title">
        <FileSpreadsheet className="stats-outro-icon" size={40} aria-hidden="true" />
        <div className="stats-outro-text">
          <h2 id="stats-outro-title" className="stats-outro-title">
            Take the whole list with you
          </h2>
          <p className="muted">Solos and duets on separate sheets, with the original STAR columns — handy for your teacher or a planning session.</p>
        </div>
        <div className="cluster stats-outro-actions">
          <a href={EXPORT_XLSX_URL} download className="btn btn-primary" data-testid="download-xlsx-bottom">
            <Download size={18} aria-hidden="true" /> Download .xlsx
          </a>
          <Link to="/add" className="btn btn-ghost">
            <Sparkles size={18} aria-hidden="true" /> Add a missing song
          </Link>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------- pieces

function CountTile({ value, label, emoji, to, accent }: { value: number; label: string; emoji: string; to: string; accent: 'gold' | 'pink' | 'teal' }) {
  const shown = useCountUp(value);
  return (
    <li>
      <Link to={to} className={`stats-tile card card-hover accent-${accent}`} data-testid="stats-tile">
        <span className="stats-tile-emoji emoji" aria-hidden="true">
          {emoji}
        </span>
        <span className="stats-tile-value" aria-hidden="true">
          {shown}
        </span>
        <span className="visually-hidden" data-testid="stats-tile-value">
          {value}
        </span>
        <span className="stats-tile-label">{label}</span>
      </Link>
    </li>
  );
}

function ChartCard({ id, emoji, title, subtitle, wide = false, children }: { id: string; emoji: string; title: string; subtitle?: string; wide?: boolean; children: ReactNode }) {
  const headingId = `stats-${id}-title`;
  return (
    <section className={`stats-card card${wide ? ' is-wide' : ''}`} aria-labelledby={headingId} data-testid={`stats-card-${id}`}>
      <header className="stats-card-head">
        <h2 id={headingId} className="stats-card-title">
          <span className="emoji" aria-hidden="true">
            {emoji}
          </span>
          {title}
        </h2>
        {subtitle && <p className="stats-card-sub">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function RangeChart({ stats, total }: { stats: StatsResponse; total: number }) {
  const items: ColumnDatum[] = VOCAL_RANGES.map((r) => {
    const count = stats.byRange.find((b) => normalizeVocalRange(b.label) === r)?.count ?? 0;
    return { key: r, short: RANGE_SHORT[r], long: r, label: r, count, color: rangeColorVar(r), href: browseHref({ ranges: [r] }) };
  });
  return (
    <>
      <ColumnChart items={items} total={total} label="Songs by vocal range, highest to lowest" testId="chart-range" className="is-ranges" />
      <ul className="stats-range-key" role="list" aria-hidden="true">
        {items.map((d) => (
          <li key={d.key}>
            <span className="stats-swatch" style={{ background: d.color }} />
            {d.short} = {d.label}
          </li>
        ))}
      </ul>
    </>
  );
}

type LengthStatus = 'ok' | 'close' | 'over';

function bucketStatus(b: LengthBucket): LengthStatus {
  const max = b.max ?? null;
  const min = b.min ?? null;
  if (max === null && min !== null && min > TIME_LIMIT_SECONDS) return 'over';
  if (/over/i.test(b.label)) return 'over';
  if (max !== null && max > WARN_SECONDS) return 'close';
  if (min !== null && min > WARN_SECONDS) return 'close';
  return 'ok';
}

const STATUS_COLOR: Record<LengthStatus, string> = { ok: 'var(--stats-ok)', close: 'var(--stats-close)', over: 'var(--stats-over)' };

function LengthChart({ buckets, total, overLimit, unknown }: { buckets: LengthBucket[]; total: number; overLimit: number; unknown: number }) {
  const known = buckets.filter((b) => b.label !== 'Unknown');
  const items: ColumnDatum[] = known.map((b) => {
    const status = bucketStatus(b);
    const min = b.min ?? null;
    const max = b.max ?? null;
    return {
      key: b.label,
      short: b.label.replace(/^Under /, '< ').replace(/^Over (.*)$/, '$1+').replace('–', '–\u200b'),
      label: b.label,
      count: b.count,
      color: STATUS_COLOR[status],
      note: status === 'over' ? 'Over STAR’s 6:00 limit — needs a cut' : status === 'close' ? 'Close to the 6:00 limit' : undefined,
      href: browseHref({ minSeconds: min && min > 0 ? min : null, maxSeconds: max }),
    };
  });
  const firstOver = known.findIndex((b) => bucketStatus(b) === 'over');
  const close = known.filter((b) => bucketStatus(b) === 'close').reduce((n, b) => n + b.count, 0);
  return (
    <>
      <ColumnChart
        items={items}
        total={total}
        markerBefore={firstOver >= 0 ? firstOver : undefined}
        markerLabel="6:00 limit"
        label="Songs by length (minutes:seconds)"
        testId="chart-length"
        className="is-lengths"
      />
      <ul className="stats-legend" role="list">
        <li>
          <CircleCheck size={16} aria-hidden="true" className="stats-legend-ok" /> Comfortably under 5:30
        </li>
        <li>
          <TriangleAlert size={16} aria-hidden="true" className="stats-legend-close" /> Close to the limit
          {close > 0 && <span className="muted"> ({close})</span>}
        </li>
        <li>
          <Ban size={16} aria-hidden="true" className="stats-legend-over" /> Over 6:00 — needs a cut
          {overLimit > 0 && <span className="muted"> ({overLimit})</span>}
        </li>
      </ul>
      <p className="stats-note small muted" data-testid="length-note">
        {overLimit === 0 ? 'Every song with a known length fits inside 6:00. 🎉' : `${overLimit === 1 ? '1 song runs' : `${overLimit} songs run`} over 6:00 — plan a cut with your teacher.`}
        {unknown > 0 && ` ${unknown === 1 ? '1 song has' : `${unknown} songs have`} no length listed yet.`}
      </p>
    </>
  );
}

function SubGenreGroups({ stats, total, subGenreGenres }: { stats: StatsResponse; total: number; subGenreGenres: StatsBodyProps['subGenreGenres'] }) {
  const groups = useMemo(() => {
    const genreOf = new Map(subGenreGenres.map((s) => [s.name.toLowerCase(), s.genre]));
    const order = stats.byGenre.map((g) => g.label);
    const map = new Map<string, StatBucket[]>();
    for (const b of stats.bySubGenre) {
      const g = genreOf.get(b.label.toLowerCase()) ?? 'Other';
      const key = order.find((o) => o.toLowerCase() === (g ?? 'Other').toLowerCase()) ?? g ?? 'Other';
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    const keys = [...map.keys()].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return keys.map((k) => ({ genre: k, items: map.get(k) ?? [] }));
  }, [stats, subGenreGenres]);
  const max = Math.max(1, ...stats.bySubGenre.map((b) => b.count));
  const genreTotal = (g: string) => stats.byGenre.find((b) => b.label === g)?.count;

  return (
    <div className="stats-moods" data-testid="chart-subgenre">
      {groups.map((grp) => {
        const gt = genreTotal(grp.genre);
        return (
          <div key={grp.genre} className="stats-mood-group">
            <h3 className="stats-mood-title">
              <span className="emoji" aria-hidden="true">
                {grp.genre === 'Other' ? '✨' : genreEmoji(grp.genre)}
              </span>
              {grp.genre}
              {gt !== undefined && <span className="stats-mood-count">{gt} songs</span>}
            </h3>
            <BarList
              label={`${grp.genre} sub-genres`}
              total={total}
              max={max}
              showShare={false}
              compact
              color="var(--stats-c2)"
              items={grp.items.map<BarDatum>((b) => ({ key: b.label, label: b.label, count: b.count, emoji: subGenreEmoji(b.label), href: browseHref({ subGenres: [b.label] }) }))}
            />
          </div>
        );
      })}
    </div>
  );
}

function TopShows({ stats, total, metaShows, shows }: { stats: StatsResponse; total: number; metaShows: StatsBodyProps['metaShows']; shows: StatsBodyProps['shows'] }) {
  const [all, setAll] = useState(false);
  const bySlugName = useMemo(() => {
    const m = new Map<string, { slug: string; imageUrl: string | null }>();
    for (const s of metaShows) m.set(s.name.toLowerCase(), { slug: s.slug, imageUrl: null });
    for (const s of shows) m.set(s.name.toLowerCase(), { slug: s.slug, imageUrl: s.imageUrl });
    return m;
  }, [metaShows, shows]);
  const items: BarDatum[] = stats.byShow.map((b) => {
    const info = bySlugName.get(b.label.toLowerCase());
    return {
      key: b.label,
      label: b.label,
      count: b.count,
      href: showPath(info?.slug ?? showSlug(b.label)),
      lead: <ArtworkTile src={info?.imageUrl ?? null} seed={b.label} size={36} />,
    };
  });
  const visible = all ? items : items.slice(0, TOP_SHOWS);
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <>
      <BarList testId="chart-shows" label="Shows ranked by number of songs" items={visible} total={total} max={max} color="var(--stats-c3)" ranked />
      {items.length > TOP_SHOWS && (
        <button type="button" className="btn btn-quiet btn-sm stats-more" aria-expanded={all} onClick={() => setAll((a) => !a)} data-testid="toggle-all-shows">
          {all ? 'Show the top 8' : `Show all ${items.length} shows`}
        </button>
      )}
    </>
  );
}

function MeterStat({ value, total, label, color, sentence, link, testId }: { value: number; total: number; label: string; color: string; sentence: ReactNode; link: { to: string; text: string }; testId: string }) {
  const pct = total > 0 ? value / total : 0;
  const shown = useCountUp(Math.round(pct * 100));
  return (
    <div className="stats-meter">
      <p className="stats-meter-big" aria-hidden="true">
        {shown}
        <span className="stats-meter-pct">%</span>
      </p>
      <Meter value={value} total={total} label={label} color={color} testId={testId} />
      <p className="stats-meter-text">{sentence}</p>
      <Link to={link.to} className="btn btn-quiet btn-sm stats-meter-link">
        {link.text} <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------- fun facts

function FunFacts({ stats, songs, metaShows }: { stats: StatsResponse; songs: Song[]; metaShows: StatsBodyProps['metaShows'] }) {
  const facts = useMemo(() => {
    const timed = songs.filter((s) => typeof s.lengthSeconds === 'number' && s.lengthSeconds > 0);
    const shortest = timed.reduce<Song | null>((m, s) => (!m || (s.lengthSeconds ?? 0) < (m.lengthSeconds ?? 0) ? s : m), null);
    const longest = timed.reduce<Song | null>((m, s) => (!m || (s.lengthSeconds ?? 0) > (m.lengthSeconds ?? 0) ? s : m), null);
    const topShow = stats.byShow[0];
    const topMood = stats.bySubGenre[0];
    const topShowSlug = topShow ? metaShows.find((s) => s.name.toLowerCase() === topShow.label.toLowerCase())?.slug ?? songs.find((s) => s.show.name.toLowerCase() === topShow.label.toLowerCase())?.show.slug ?? showSlug(topShow.label) : null;
    const out: Array<{ key: string; emoji: string; kicker: string; title: string; detail: string; to: string }> = [];
    if (shortest)
      out.push({ key: 'short', emoji: '⚡', kicker: 'Quickest song', title: shortest.title, detail: `${formatLength(shortest.lengthSeconds)} · ${shortest.show.name}`, to: songPath(shortest.id) });
    if (longest && longest.id !== shortest?.id)
      out.push({ key: 'long', emoji: '🐢', kicker: 'Longest song', title: longest.title, detail: `${formatLength(longest.lengthSeconds)} · ${longest.show.name}`, to: songPath(longest.id) });
    if (topShow && topShowSlug) out.push({ key: 'show', emoji: '👑', kicker: 'Most songs from one show', title: topShow.label, detail: `${topShow.count} songs`, to: showPath(topShowSlug) });
    if (topMood)
      out.push({ key: 'mood', emoji: subGenreEmoji(topMood.label), kicker: 'Most popular mood', title: topMood.label, detail: `${topMood.count} songs`, to: browseHref({ subGenres: [topMood.label] }) });
    return out;
  }, [songs, stats, metaShows]);

  if (facts.length === 0) return null;
  return (
    <section className="stats-facts" aria-labelledby="stats-facts-title">
      <h2 id="stats-facts-title" className="section-title">
        <span className="emoji" aria-hidden="true">
          🍿
        </span>
        Fun facts
      </h2>
      <ul className="stats-facts-list" role="list" data-testid="fun-facts">
        {facts.map((f) => (
          <li key={f.key}>
            <Link to={f.to} className="stats-fact card card-hover">
              <span className="stats-fact-emoji emoji" aria-hidden="true">
                {f.emoji}
              </span>
              <span className="stats-fact-kicker">{f.kicker}</span>
              <span className="stats-fact-title">{f.title}</span>
              <span className="stats-fact-detail">{f.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------- loading

function StatsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="stats-skeleton">
      <span className="visually-hidden">Counting the house…</span>
      <div className="stats-tiles" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={112} radius={18} />
        ))}
      </div>
      <div className="stats-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="stats-card card">
            <Skeleton height={24} width="50%" />
            <div className="stack stack-sm" style={{ marginTop: 'var(--space-md)' }}>
              {Array.from({ length: 4 }, (_, j) => (
                <Skeleton key={j} height={14} width={`${90 - j * 15}%`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

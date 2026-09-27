/**
 * /spin — Spin the Spotlight (SPEC §7.7).
 * A marquee slot-machine reel scrolls through song titles + artwork and decelerates onto a random
 * song from the (optionally filtered) pool. requestAnimationFrame drives the reel; with
 * prefers-reduced-motion we skip straight to the result with a gentle fade. Picking logic is pure
 * and injectable (./spin/picker.ts). Filters live in the URL (?kind=&range=&hideMature=1).
 */
import { ArrowRight, Dices, Headphones, RotateCcw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArtworkTile } from '../components/ArtworkTile';
import { fireConfetti } from '../components/Confetti';
import { SegmentedControl, Switch, ToggleChip } from '../components/Controls';
import { ErrorState } from '../components/EmptyState';
import { GenreTag, KindTag, SubGenreTag } from '../components/GenreTag';
import { LengthBadge } from '../components/LengthBadge';
import { Marquee } from '../components/Marquee';
import { MatureBadge } from '../components/MatureBadge';
import { PlayButton } from '../components/PlayButton';
import { RangeBadge } from '../components/RangeBadge';
import { SetlistHeart } from '../components/SetlistHeart';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { defaultFilters, filtersFromSearchParams, filtersToSearchParams, hasPlayableAudio, rangeCounts, type KindFilter } from '../lib/filters';
import { songPath, showPath } from '../lib/links';
import { RANGE_SHORT, rangeColorVar, VOCAL_RANGES } from '../lib/vocab';
import { useSongs } from '../state/SongsProvider';
import type { Song, VocalRange } from '../types';
import { buildReel, pickRandom, reelPosition, spinPool, type RandomFn, type SpinFilters } from './spin/picker';
import './SpinPage.css';

/** Height of one reel row in px (kept in sync with CSS via --spin-item-h). */
const ITEM_H = 84;
const HISTORY_MAX = 5;

type ReelItem = Song | null; // null = the "?" mystery tile shown before the first spin

interface Reel {
  /** bumps on every spin (keeps row keys stable while a spin lands) */
  id: number;
  items: ReelItem[];
}

interface PendingSpin {
  target: Song;
  duration: number;
}

function readFilters(params: URLSearchParams): SpinFilters {
  const f = filtersFromSearchParams(params);
  return { kind: f.kind, ranges: f.ranges, hideMature: f.hideMature };
}

function ReelRow({ item }: { item: ReelItem }) {
  if (!item) {
    return (
      <div className="spin-item is-mystery">
        <span className="spin-item-mystery" aria-hidden="true">
          ?
        </span>
        <span className="spin-item-text">
          <strong>Your next song…</strong>
          <span>is waiting in the wings</span>
        </span>
      </div>
    );
  }
  return (
    <div className="spin-item">
      <ArtworkTile src={item.media.artworkUrl ?? item.show.imageUrl} seed={item.show.name} size={56} />
      <span className="spin-item-text">
        <strong>{item.title}</strong>
        <span>{item.show.name}</span>
      </span>
    </div>
  );
}

export default function SpinPage({ random = Math.random }: { random?: RandomFn } = {}) {
  useDocumentTitle('Spin the Spotlight');
  const { songs, loading, error, reload } = useSongs();
  const reduced = usePrefersReducedMotion();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const pool = useMemo(() => spinPool(songs, filters), [songs, filters]);
  const counts = useMemo(() => rangeCounts(spinPool(songs, { ...filters, ranges: [] })), [songs, filters]);

  const [reel, setReel] = useState<Reel>({ id: 0, items: [null] });
  const [restIndex, setRestIndex] = useState(0);
  const [pending, setPending] = useState<PendingSpin | null>(null);
  const [result, setResult] = useState<Song | null>(null);
  const [landed, setLanded] = useState(0);
  const [history, setHistory] = useState<Song[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const stripRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  const raf = useRef(0);
  const spinning = pending !== null;

  const setFilters = (next: SpinFilters) => {
    const state = defaultFilters({ kind: next.kind, ranges: next.ranges, hideMature: next.hideMature });
    setParams((prev) => filtersToSearchParams(state, prev), { replace: true, preventScrollReset: true });
  };

  const land = useCallback(
    (target: Song) => {
      setResult(target);
      setLanded((n) => n + 1);
      setHistory((h) => [target, ...h.filter((s) => s.id !== target.id)].slice(0, HISTORY_MAX + 1));
      setAnnouncement(`The spotlight lands on “${target.title}” from ${target.show.name}!`);
      fireConfetti({ y: 0.42, count: 140 });
    },
    [],
  );

  const spin = () => {
    if (spinning || !pool.length) return;
    const target = pickRandom(pool, random, result?.id);
    if (!target) return;
    const current: ReelItem = reel.items[restIndex] ?? null;
    if (reduced) {
      setReel({ id: reel.id + 1, items: [target] });
      setRestIndex(0);
      land(target);
      return;
    }
    const length = 24 + Math.floor(random() * 8);
    const items: ReelItem[] = [current, ...buildReel(pool, target, length, random)];
    setReel({ id: reel.id + 1, items });
    setPending({ target, duration: 2700 + random() * 700 });
  };

  // Drive the reel with requestAnimationFrame (writes the transform directly — no re-renders per frame).
  useLayoutEffect(() => {
    if (!pending) return;
    const strip = stripRef.current;
    const last = reel.items.length - 1;
    let start: number | null = null;
    let prevPos = 0;
    const apply = (pos: number, blur: number) => {
      if (!strip) return;
      strip.style.transform = `translate3d(0, ${-pos * ITEM_H}px, 0)`;
      strip.style.filter = blur > 0.2 ? `blur(${blur.toFixed(2)}px)` : '';
    };
    apply(0, 0);
    const frame = (now: number) => {
      if (start === null) start = now;
      const t = now - start;
      const pos = reelPosition(t, pending.duration, last);
      apply(pos, Math.min(2.5, (pos - prevPos) * 2.2));
      prevPos = pos;
      if (t < pending.duration) {
        raf.current = requestAnimationFrame(frame);
      } else {
        apply(last, 0);
        setRestIndex(last);
        setPending(null);
        land(pending.target);
      }
    };
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
    // `reel` is always set in the same update as `pending`, so it is intentionally not a dependency.
  }, [pending, land]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Reduced motion: the result fades in (Web Animations aren't affected by the global CSS kill-switch).
  // On narrow screens the result card sits below the machine, so bring it into view if it's hidden.
  useEffect(() => {
    if (!landed) return;
    const el = resultRef.current;
    if (!el) return;
    if (reduced) el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-out' });
    const rect = el.getBoundingClientRect();
    if (rect.top > window.innerHeight - 120) el.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [landed, reduced]);

  const kindOptions = [
    { value: 'all' as KindFilter, label: '🎲 Either', testId: 'spin-kind-all' },
    { value: 'solo' as KindFilter, label: '🎤 Solo', testId: 'spin-kind-solo' },
    { value: 'duet' as KindFilter, label: '👯 Duet', testId: 'spin-kind-duet' },
  ];

  const toggleRange = (r: VocalRange) => {
    const ranges = filters.ranges.includes(r) ? filters.ranges.filter((x) => x !== r) : [...filters.ranges, r];
    setFilters({ ...filters, ranges });
  };

  const filtered = filters.kind !== 'all' || filters.ranges.length > 0 || filters.hideMature;
  const earlier = history.filter((s) => s.id !== result?.id).slice(0, HISTORY_MAX);
  const strip = reel.items;
  const stripStyle: CSSProperties = pending ? {} : { transform: `translate3d(0, ${-restIndex * ITEM_H}px, 0)` };
  // decorative neighbours above the first row and below the last one
  const neighbour = (avoid: ReelItem, fromEnd: boolean): ReelItem => {
    const list = fromEnd ? [...songs].reverse() : songs;
    return list.find((s) => s.id !== avoid?.id) ?? null;
  };
  const above = neighbour(strip[0] ?? null, true);
  const below = neighbour(strip[strip.length - 1] ?? null, false);

  if (error && !songs.length) {
    return (
      <div className="container">
        <ErrorState message="We couldn’t load the songs to spin. Check your connection and try again." onRetry={() => void reload()} />
      </div>
    );
  }

  return (
    <div className="spin-page container" style={{ '--spin-item-h': `${ITEM_H}px` } as CSSProperties}>
      <header className="page-header spin-header">
        <div>
          <p className="eyebrow">Feeling lucky?</p>
          <h1 className="page-title">Spin the Spotlight</h1>
          <p className="page-subtitle">Can’t decide? Pull the lever and let fate cast your next song. Narrow the pool first if you like.</p>
        </div>
      </header>

      {/* ---------------- pool filters ---------------- */}
      <section className="spin-filters" aria-labelledby="spin-filters-title">
        <h2 id="spin-filters-title" className="visually-hidden">
          Choose which songs go in the hat
        </h2>
        <div className="spin-filter-row">
          <SegmentedControl<KindFilter> label="Solo or duet" value={filters.kind} onChange={(kind) => setFilters({ ...filters, kind })} options={kindOptions} />
          <Switch checked={filters.hideMature} onChange={(hideMature) => setFilters({ ...filters, hideMature })} label="Hide mature themes" testId="spin-hide-mature" />
        </div>
        <div className="spin-filter-row" role="group" aria-label="Vocal ranges">
          <span className="spin-filter-label" aria-hidden="true">
            Voices:
          </span>
          <div className="chip-group">
            {VOCAL_RANGES.map((r) => (
              <ToggleChip
                key={r}
                pressed={filters.ranges.includes(r)}
                onToggle={() => toggleRange(r)}
                color={rangeColorVar(r)}
                count={counts[r]}
                testId={`spin-range-${r}`}
                title={r}
              >
                <span className="spin-range-short" aria-hidden="true">
                  {RANGE_SHORT[r]}
                </span>
                <span className="spin-range-full" aria-hidden="true">
                  {r === 'Mezzo-soprano' ? 'Mezzo' : r}
                </span>
                <span className="visually-hidden">{r}</span>
              </ToggleChip>
            ))}
          </div>
          {filtered && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setFilters({ kind: 'all', ranges: [], hideMature: false })} data-testid="spin-clear">
              <RotateCcw size={15} aria-hidden="true" /> Everything
            </button>
          )}
        </div>
      </section>

      <div className="spin-layout">
        {/* ---------------- the machine ---------------- */}
        <section className="spin-machine" aria-label="Slot machine">
          <Marquee size="lg" className={`spin-marquee${spinning ? ' is-spinning' : ''}`} innerClassName="spin-marquee-inner">
            <p className="spin-sign marquee-text" aria-hidden="true">
              ★ Tonight’s Song ★
            </p>
            <div className={`spin-window${spinning ? ' is-spinning' : ''}${result && !spinning ? ' has-landed' : ''}`} aria-hidden="true" data-testid="spin-reel">
              <div className="spin-strip" ref={stripRef} style={stripStyle}>
                <ReelRow item={above} />
                {strip.map((item, i) => (
                  <ReelRow key={`${reel.id}-${i}`} item={item} />
                ))}
                <ReelRow item={below} />
              </div>
              <span className="spin-payline" />
              <span className="spin-shade is-top" />
              <span className="spin-shade is-bottom" />
            </div>
            <button type="button" className="spin-button" onClick={spin} disabled={spinning || pool.length === 0} data-testid="spin-button">
              <Dices size={26} aria-hidden="true" />
              <span>{spinning ? 'Spinning…' : result ? 'Spin again' : 'Spin!'}</span>
            </button>
            <p className="spin-pool" data-testid="spin-pool-size" aria-live="polite">
              {loading && !songs.length ? (
                'Loading the songbook…'
              ) : pool.length === 0 ? (
                'No songs match these filters.'
              ) : (
                <>
                  <span className="emoji" aria-hidden="true">
                    🎟️
                  </span>{' '}
                  <strong>{pool.length}</strong> {pool.length === 1 ? 'song' : 'songs'} in the hat
                </>
              )}
            </p>
          </Marquee>
          <div className={`spin-lever${spinning ? ' is-pulled' : ''}`} aria-hidden="true">
            <span className="spin-lever-knob" />
            <span className="spin-lever-arm" />
            <span className="spin-lever-base" />
          </div>
        </section>

        {/* ---------------- result ---------------- */}
        <section className="spin-result-wrap" aria-labelledby="spin-result-title">
          <p className="visually-hidden" role="status" data-testid="spin-announcement">
            {announcement}
          </p>
          {result ? (
            <article key={landed} ref={resultRef} className={`spin-result card${spinning ? ' is-waiting' : ''}`} data-testid="spin-result" data-song-id={result.id}>
              <div className="spin-result-beam" aria-hidden="true" />
              <p className="eyebrow spin-result-eyebrow">
                <Sparkles size={14} aria-hidden="true" /> The spotlight lands on…
              </p>
              <div className="spin-result-main">
                <div className="spin-result-art">
                  <ArtworkTile src={result.media.artworkUrl ?? result.show.imageUrl} seed={result.show.name} size={160} />
                </div>
                <div className="spin-result-body">
                  <h2 id="spin-result-title" className="spin-result-title">
                    <Link to={songPath(result.id)}>{result.title}</Link>
                  </h2>
                  <p className="spin-result-show">
                    from <Link to={showPath(result.show.slug)}>{result.show.name}</Link>
                  </p>
                  <ul className="spin-result-parts" role="list">
                    {result.parts.map((p) => (
                      <li key={p.position}>
                        <RangeBadge range={p.vocalRange} variant="full" />
                        <span>{p.character}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="cluster">
                <KindTag kind={result.kind} />
                <GenreTag genre={result.genre} />
                <SubGenreTag subGenre={result.subGenre} />
                <LengthBadge seconds={result.lengthSeconds} showText="always" />
                <MatureBadge mature={result.mature} />
              </div>
              <div className="spin-result-actions">
                {hasPlayableAudio(result) ? (
                  <PlayButton song={result} size="lg" label="Play preview" />
                ) : (
                  <span className="muted small spin-no-preview">
                    <Headphones size={16} aria-hidden="true" /> No preview yet
                  </span>
                )}
                <Link to={songPath(result.id)} className="btn btn-primary" data-testid="spin-open-song">
                  Open song <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <SetlistHeart songId={result.id} songTitle={result.title} withLabel />
                <button type="button" className="btn btn-pink" onClick={spin} disabled={spinning || pool.length === 0} data-testid="spin-again">
                  <Dices size={18} aria-hidden="true" /> Spin again
                </button>
              </div>
            </article>
          ) : (
            <div className="spin-result-empty card">
              <span className="emoji spin-result-empty-emoji" aria-hidden="true">
                🎰
              </span>
              <h2 id="spin-result-title" className="spin-result-empty-title">
                {spinning ? 'Drumroll please…' : 'Your song will appear here'}
              </h2>
              <p className="muted">
                {pool.length === 0 && !loading
                  ? 'Nothing in the hat! Loosen the filters above to add some songs back.'
                  : 'Hit Spin and the reel will land on a random song. You can listen, save it to your setlist, or spin again.'}
              </p>
            </div>
          )}

          {earlier.length > 0 && (
            <div className="spin-history">
              <h3 className="spin-history-title">Earlier spins</h3>
              <ul role="list">
                {earlier.map((s) => (
                  <li key={s.id}>
                    <Link to={songPath(s.id)}>{s.title}</Link> <span className="muted small">· {s.show.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

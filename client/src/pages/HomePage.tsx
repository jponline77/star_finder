/**
 * Home "/" (SPEC §7.1, §7b): marquee hero + a countdown for the visitor's festival (or "Where are
 * you performing?" chips), big search, quick-pick chips, Spotlight Song of the Day, feature cards,
 * community picks and a stats teaser.
 */
import { ArrowRight, Headphones, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArtworkTile, ShowPoster } from '../components/ArtworkTile';
import { GenreTag, KindTag, SubGenreTag } from '../components/GenreTag';
import { LengthBadge } from '../components/LengthBadge';
import { Marquee } from '../components/Marquee';
import { MatureBadge } from '../components/MatureBadge';
import { PlayButton } from '../components/PlayButton';
import { RangeBadge } from '../components/RangeBadge';
import { SearchBox } from '../components/SearchBox';
import { SetlistHeart } from '../components/SetlistHeart';
import { Skeleton } from '../components/Skeletons';
import { SongCard } from '../components/SongCard';
import { VoiceLadder } from '../components/VoiceLadder';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { browseHref, hasAnyAudio, hasPlayableAudio, sortSongs } from '../lib/filters';
import { pickDaily } from '../lib/hash';
import { songPath, showPath } from '../lib/links';
import { useSetlist } from '../lib/setlist';
import { useFestival } from '../state/FestivalProvider';
import { useShows, useSongs } from '../state/SongsProvider';
import { FestivalHero, heroEyebrow } from './home/FestivalHero';
import { spotlightPool } from './home/spotlight';
import type { Song } from '../types';
import './HomePage.css';

const QUICK_PICKS: Array<{ emoji: string; label: string; href: string; testId: string }> = [
  { emoji: '🎀', label: 'Soprano solos', href: browseHref({ kind: 'solo', ranges: ['Soprano'] }), testId: 'quick-soprano-solos' },
  { emoji: '🎺', label: 'Tenor solos', href: browseHref({ kind: 'solo', ranges: ['Tenor'] }), testId: 'quick-tenor-solos' },
  { emoji: '😂', label: 'Comedy duets', href: browseHref({ kind: 'duet', genres: ['Comedy'] }), testId: 'quick-comedy-duets' },
  { emoji: '⏱️', label: 'Under 3 minutes', href: browseHref({ maxSeconds: 180 }), testId: 'quick-under-3' },
  { emoji: '🙈', label: 'No mature content', href: browseHref({ hideMature: true }), testId: 'quick-no-mature' },
  { emoji: '💜', label: 'Mezzo solos', href: browseHref({ kind: 'solo', ranges: ['Mezzo-soprano'] }), testId: 'quick-mezzo-solos' },
  { emoji: '🥁', label: 'Baritone solos', href: browseHref({ kind: 'solo', ranges: ['Baritone'] }), testId: 'quick-baritone-solos' },
  { emoji: '🎧', label: 'Has a preview', href: browseHref({ hasAudio: true }), testId: 'quick-has-audio' },
];

const FEATURES: Array<{ to: string; emoji: string; title: string; blurb: string; accent: string }> = [
  { to: '/match', emoji: '💘', title: 'Song Matchmaker', blurb: 'Five quick questions → songs that fit your voice and vibe.', accent: 'pink' },
  { to: '/spin', emoji: '🎰', title: 'Spin the Spotlight', blurb: 'Feeling lucky? Let the roulette pick a song for you.', accent: 'gold' },
  { to: '/shows', emoji: '🎟️', title: 'Show Poster Wall', blurb: 'Explore every musical and its cast of characters.', accent: 'teal' },
  { to: '/setlist', emoji: '💖', title: 'My Setlist', blurb: 'Save favourites, check running time, share with your teacher.', accent: 'pink' },
  { to: '/star-prep', emoji: '🎓', title: 'STAR Prep', blurb: 'Rules, slate builder and a rehearsal timer with the 6:00 limit.', accent: 'gold' },
  { to: '/stats', emoji: '📊', title: 'By the Numbers', blurb: 'Which voices, moods and shows fill the list?', accent: 'teal' },
];

export default function HomePage() {
  useDocumentTitle(null);
  const navigate = useNavigate();
  const { songs, meta, loading } = useSongs();
  const setlist = useSetlist();
  const [q, setQ] = useState('');
  const { selected: festival } = useFestival();

  // Licensing lives on /api/shows — wait for it (briefly) so the pick doesn't switch after loading.
  const { shows, loading: showsLoading, error: showsError } = useShows();
  const spotlightWaiting = showsLoading && !showsError;
  const spotlight = useMemo(
    () => (spotlightWaiting ? null : pickDaily(spotlightPool(songs, showsError ? null : shows))),
    [songs, shows, showsError, spotlightWaiting],
  );

  const community = useMemo(() => sortSongs(songs.filter((s) => s.source === 'community'), 'newest').slice(0, 3), [songs]);

  const counts = meta?.counts ?? {
    songs: songs.length,
    solos: songs.filter((s) => s.kind === 'solo').length,
    duets: songs.filter((s) => s.kind === 'duet').length,
    shows: new Set(songs.map((s) => s.show.id)).size,
  };
  const withAudio = songs.filter(hasAnyAudio).length;

  const submitSearch = (value: string) => {
    const v = value.trim();
    navigate(v ? browseHref({ q: v }) : '/songs');
  };

  return (
    <div className="home">
      {/* ---------------- hero ---------------- */}
      <section className="home-hero" aria-labelledby="home-title">
        <div className="valance" aria-hidden="true" />
        <div className="container home-hero-inner">
          <Marquee size="lg" className="home-marquee" innerClassName="home-marquee-inner">
            <p className="home-eyebrow" data-testid="home-eyebrow">
              <span aria-hidden="true">🎭 </span>
              {heroEyebrow(festival)}
            </p>
            <h1 id="home-title" className="home-title marquee-text">
              Find your <span className="home-title-accent">spotlight</span> song
            </h1>
            <p className="home-lede">
              {loading && !meta ? 'Musical theatre' : `${counts.songs} musical theatre`} solos &amp; duets for the STAR Festival — search, listen, and build your setlist.
            </p>
            <FestivalHero />
          </Marquee>

          <div className="home-search">
            <SearchBox value={q} onChange={setQ} onSubmit={submitSearch} size="lg" placeholder="Try “Wicked”, “Javert”, “comedy”…" label="Search all songs" />
          </div>

          <nav className="home-quick" aria-label="Quick picks">
            <ul className="chip-group" role="list">
              {QUICK_PICKS.map((p) => (
                <li key={p.href}>
                  <Link to={p.href} className="chip home-quick-chip" data-testid={p.testId}>
                    <span className="emoji" aria-hidden="true">
                      {p.emoji}
                    </span>
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>

      <div className="container">
        {/* ---------------- spotlight ---------------- */}
        <section className="section" aria-labelledby="spotlight-title">
          <h2 id="spotlight-title" className="section-title">
            <span className="emoji" aria-hidden="true">
              🔦
            </span>
            Spotlight Song of the Day
          </h2>
          {(loading || spotlightWaiting) && !spotlight ? <SpotlightSkeleton /> : spotlight ? <Spotlight song={spotlight} /> : <p className="muted">The stage is dark — no songs yet!</p>}
        </section>

        {/* ---------------- features ---------------- */}
        <section className="section" aria-labelledby="features-title">
          <h2 id="features-title" className="section-title">
            <span className="emoji" aria-hidden="true">
              ✨
            </span>
            Find it your way
          </h2>
          <ul className="feature-grid" role="list">
            {FEATURES.map((f) => (
              <li key={f.to}>
                <Link to={f.to} className={`feature-card card card-hover accent-${f.accent}`}>
                  <span className="feature-emoji emoji" aria-hidden="true">
                    {f.emoji}
                  </span>
                  <span className="feature-text">
                    <span className="feature-title">
                      {f.title}
                      {f.to === '/setlist' && setlist.count > 0 && <span className="count-badge">{setlist.count}</span>}
                    </span>
                    <span className="feature-blurb">{f.blurb}</span>
                  </span>
                  <ArrowRight className="feature-arrow" size={20} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------------- community ---------------- */}
        {community.length > 0 && (
          <section className="section" aria-labelledby="community-title">
            <div className="cluster cluster-between">
              <h2 id="community-title" className="section-title">
                <span className="emoji" aria-hidden="true">
                  🌱
                </span>
                Fresh from the community
              </h2>
              <Link to={browseHref({ sort: 'newest' })} className="btn btn-quiet btn-sm">
                See newest <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <div className="song-grid">
              {community.map((s) => (
                <SongCard key={s.id} song={s} />
              ))}
            </div>
          </section>
        )}

        {/* ---------------- stats teaser ---------------- */}
        <section className="section home-stats" aria-labelledby="stats-title">
          <div className="home-stats-head">
            <h2 id="stats-title" className="section-title">
              <span className="emoji" aria-hidden="true">
                📊
              </span>
              By the numbers
            </h2>
            <Link to="/stats" className="btn btn-ghost btn-sm">
              All the stats <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <ul className="stat-tiles" role="list">
            <StatTile value={counts.songs} label="songs" emoji="🎵" to="/songs" loading={loading} />
            <StatTile value={counts.solos} label="solos" emoji="🎤" to={browseHref({ kind: 'solo' })} loading={loading} />
            <StatTile value={counts.duets} label="duets" emoji="👯" to={browseHref({ kind: 'duet' })} loading={loading} />
            <StatTile value={counts.shows} label="shows" emoji="🎟️" to="/shows" loading={loading} />
            <StatTile value={withAudio} label="with audio" emoji="🎧" to={browseHref({ hasAudio: true })} loading={loading} />
          </ul>
          <p className="home-add-cta">
            <Sparkles size={18} aria-hidden="true" /> Know a great song that’s missing?{' '}
            <Link to="/add" className="btn btn-primary btn-sm">
              Add a song
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}

function StatTile({ value, label, emoji, to, loading }: { value: number; label: string; emoji: string; to: string; loading: boolean }) {
  return (
    <li>
      <Link to={to} className="stat-tile card card-hover">
        <span className="stat-value">{loading && !value ? <Skeleton width={60} height={36} /> : value}</span>
        <span className="stat-label">
          <span className="emoji" aria-hidden="true">
            {emoji}
          </span>{' '}
          {label}
        </span>
      </Link>
    </li>
  );
}

function Spotlight({ song }: { song: Song }) {
  const ranges = song.parts.map((p) => p.vocalRange);
  return (
    <article className="spotlight card" data-testid="spotlight-song">
      <div className="spotlight-beam" aria-hidden="true" />
      <div className="spotlight-art">
        <ArtworkTile src={song.media.artworkUrl ?? song.show.imageUrl} seed={song.show.name} size={220} />
        {song.show.imageUrl && song.media.artworkUrl && (
          <div className="spotlight-poster" aria-hidden="true">
            <ShowPoster show={song.show} alt="" />
          </div>
        )}
      </div>
      <div className="spotlight-body">
        <p className="eyebrow">Today’s pick</p>
        <h3 className="spotlight-title">
          <Link to={songPath(song.id)}>{song.title}</Link>
        </h3>
        <p className="spotlight-show">
          from{' '}
          <Link to={showPath(song.show.slug)} className="spotlight-show-link">
            {song.show.name}
          </Link>
        </p>
        <ul className="spotlight-parts" role="list">
          {song.parts.map((p) => (
            <li key={p.position}>
              <RangeBadge range={p.vocalRange} variant="full" />
              <span>{p.character}</span>
            </li>
          ))}
        </ul>
        <div className="cluster">
          <KindTag kind={song.kind} />
          <GenreTag genre={song.genre} link />
          <SubGenreTag subGenre={song.subGenre} link />
          <LengthBadge seconds={song.lengthSeconds} showText="always" />
          <MatureBadge mature={song.mature} />
        </div>
        <div className="spotlight-actions">
          <PlayButton song={song} size="lg" label="Play preview" />
          {!hasPlayableAudio(song) && (
            <span className="muted small">
              <Headphones size={16} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-3px' }} /> No preview yet
            </span>
          )}
          <Link to={songPath(song.id)} className="btn btn-primary">
            See the song <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <SetlistHeart songId={song.id} songTitle={song.title} withLabel />
        </div>
      </div>
      <div className="spotlight-ladder">
        <VoiceLadder ranges={ranges} />
      </div>
    </article>
  );
}

function SpotlightSkeleton() {
  return (
    <div className="spotlight card" aria-hidden="true">
      <div className="spotlight-art">
        <Skeleton height={220} width={220} radius={16} />
      </div>
      <div className="spotlight-body stack">
        <Skeleton height={16} width={100} />
        <Skeleton height={40} width="70%" />
        <Skeleton height={18} width="40%" />
        <Skeleton height={28} width="60%" />
      </div>
    </div>
  );
}

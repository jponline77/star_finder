/**
 * Browse filters: voice type chips, genre chips, mood (sub-genre) chips grouped by genre, show
 * dropdown, max-length slider with a 6:00 marker, "Hide mature" + "Has audio" switches.
 * Chip counts are true facet counts (songs matching every OTHER filter + that value).
 *
 * data-testids: filter-kind-{all|solo|duet} (only when showKind), filter-range-<Range>,
 * filter-genre-<Genre>, filter-subgenre-<SubGenre>, filter-show, filter-max-length,
 * filter-hide-mature, filter-has-audio.
 */
import { useId, useMemo, type CSSProperties } from 'react';
import type { Meta, Song, SubGenreMeta } from '../types';
import { LENGTH_SLIDER, songsIgnoring, toggleInList, type FilterState, type KindFilter } from '../lib/filters';
import { formatLength } from '../lib/format';
import { compareText, equalsLoose, normalizeText } from '../lib/normalize';
import { genreEmoji, KIND_EMOJI, normalizeVocalRange, rangeColorVar, subGenreEmoji, TIME_LIMIT_SECONDS, VOCAL_RANGES } from '../lib/vocab';
import { SegmentedControl, Switch, ToggleChip } from './Controls';

export type FilterSection = 'kind' | 'range' | 'genre' | 'subGenre' | 'show' | 'length' | 'toggles';

export interface FilterChangeOptions {
  /** true for high-frequency changes (slider drags) → replace history instead of push */
  replace?: boolean;
}

export interface FilterPanelProps {
  filters: FilterState;
  onChange: (next: FilterState, options?: FilterChangeOptions) => void;
  meta: Meta | null;
  /** All songs — used for facet counts and to discover genres/moods not in meta. */
  songs: readonly Song[];
  /** Which sections to show, in order (default: all but 'kind'). */
  sections?: readonly FilterSection[];
  className?: string;
}

const DEFAULT_SECTIONS: readonly FilterSection[] = ['range', 'genre', 'subGenre', 'show', 'length', 'toggles'];

const testIdSafe = (s: string) => s.replace(/\s+/g, '-');

export function KindSegmented({ value, onChange, className = '' }: { value: KindFilter; onChange: (k: KindFilter) => void; className?: string }) {
  return (
    <SegmentedControl<KindFilter>
      label="Solo or duet"
      value={value}
      onChange={onChange}
      className={className}
      options={[
        { value: 'all', label: 'All', testId: 'filter-kind-all' },
        {
          value: 'solo',
          label: (
            <>
              <span aria-hidden="true">{KIND_EMOJI.solo}</span> Solos
            </>
          ),
          testId: 'filter-kind-solo',
        },
        {
          value: 'duet',
          label: (
            <>
              <span aria-hidden="true">{KIND_EMOJI.duet}</span> Duets
            </>
          ),
          testId: 'filter-kind-duet',
        },
      ]}
    />
  );
}

export function FilterPanel({ filters, onChange, meta, songs, sections = DEFAULT_SECTIONS, className = '' }: FilterPanelProps) {
  const baseId = useId();

  // ---- facet bases (all filters except the facet's own) ----
  const rangeBase = useMemo(() => songsIgnoring(songs, filters, 'ranges'), [songs, filters]);
  const genreBase = useMemo(() => songsIgnoring(songs, filters, 'genres'), [songs, filters]);
  const subBase = useMemo(() => songsIgnoring(songs, filters, 'subGenres'), [songs, filters]);
  const showBase = useMemo(() => songsIgnoring(songs, filters, 'show'), [songs, filters]);

  const rangeCount = (r: string) =>
    rangeBase.filter((s) => s.parts.some((p) => normalizeVocalRange(p.vocalRange) === r)).length;

  // genres: meta first, then any extra ones found in songs
  const genres = useMemo(() => {
    const list = [...(meta?.genres ?? [])];
    for (const s of songs) if (s.genre && !list.some((g) => equalsLoose(g, s.genre))) list.push(s.genre);
    return list;
  }, [meta, songs]);

  // sub-genres grouped by genre
  const subGroups = useMemo(() => {
    const items: SubGenreMeta[] = [...(meta?.subGenres ?? [])];
    for (const s of songs) {
      if (s.subGenre && !items.some((i) => equalsLoose(i.name, s.subGenre))) items.push({ name: s.subGenre, genre: s.genre, count: 1 });
    }
    const groups = new Map<string, SubGenreMeta[]>();
    for (const it of items) {
      const key = it.genre ?? 'Other';
      const arr = groups.get(key) ?? [];
      arr.push(it);
      groups.set(key, arr);
    }
    const order = [...genres, 'Other'];
    return [...groups.entries()]
      .sort((a, b) => {
        const ia = order.findIndex((g) => equalsLoose(g, a[0]));
        const ib = order.findIndex((g) => equalsLoose(g, b[0]));
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
      .map(([genre, list]) => ({ genre, list: list.sort((x, y) => compareText(x.name, y.name)) }));
  }, [meta, songs, genres]);

  const shows = useMemo(() => {
    const list = meta?.shows?.length ? meta.shows : [...new Map(songs.map((s) => [s.show.slug, { id: s.show.id, name: s.show.name, slug: s.show.slug }])).values()];
    return [...list].sort((a, b) => compareText(a.name, b.name));
  }, [meta, songs]);

  const sliderValue = filters.maxSeconds ?? LENGTH_SLIDER.max;
  const pct = (v: number) => ((v - LENGTH_SLIDER.min) / (LENGTH_SLIDER.max - LENGTH_SLIDER.min)) * 100;
  const limitPct = pct(TIME_LIMIT_SECONDS);

  const render = (section: FilterSection) => {
    switch (section) {
      case 'kind':
        return (
          <div className="filter-section" key="kind">
            <p className="filter-section-title">Type</p>
            <KindSegmented value={filters.kind} onChange={(kind) => onChange({ ...filters, kind })} className="segmented-block" />
          </div>
        );
      case 'range':
        return (
          <fieldset className="filter-section" key="range">
            <legend className="filter-section-title">Voice type</legend>
            <div className="chip-group">
              {VOCAL_RANGES.map((r) => (
                <ToggleChip
                  key={r}
                  pressed={filters.ranges.includes(r)}
                  onToggle={() => onChange({ ...filters, ranges: toggleInList(filters.ranges, r) })}
                  color={rangeColorVar(r)}
                  count={rangeCount(r)}
                  testId={`filter-range-${r}`}
                >
                  {r}
                </ToggleChip>
              ))}
            </div>
          </fieldset>
        );
      case 'genre':
        return (
          <fieldset className="filter-section" key="genre">
            <legend className="filter-section-title">Genre</legend>
            <div className="chip-group">
              {genres.map((g) => (
                <ToggleChip
                  key={g}
                  pressed={filters.genres.some((x) => equalsLoose(x, g))}
                  onToggle={() => onChange({ ...filters, genres: toggleInList(filters.genres, g) })}
                  count={genreBase.filter((s) => equalsLoose(s.genre, g)).length}
                  testId={`filter-genre-${testIdSafe(g)}`}
                >
                  <span className="emoji" aria-hidden="true">
                    {genreEmoji(g)}
                  </span>
                  {g}
                </ToggleChip>
              ))}
            </div>
          </fieldset>
        );
      case 'subGenre':
        return (
          <fieldset className="filter-section" key="subGenre">
            <legend className="filter-section-title">Mood</legend>
            {subGroups.map(({ genre, list }) => (
              <div key={genre} className="stack stack-sm">
                <p className="filter-subgroup-label">
                  <span aria-hidden="true">{genre === 'Other' ? '✨' : genreEmoji(genre)} </span>
                  {genre}
                </p>
                <div className="chip-group">
                  {list.map((sg) => (
                    <ToggleChip
                      key={sg.name}
                      pressed={filters.subGenres.some((x) => equalsLoose(x, sg.name))}
                      onToggle={() => onChange({ ...filters, subGenres: toggleInList(filters.subGenres, sg.name) })}
                      count={subBase.filter((s) => equalsLoose(s.subGenre, sg.name)).length}
                      testId={`filter-subgenre-${testIdSafe(sg.name)}`}
                    >
                      <span className="emoji" aria-hidden="true">
                        {subGenreEmoji(sg.name)}
                      </span>
                      {sg.name}
                    </ToggleChip>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
        );
      case 'show': {
        const id = `${baseId}-show`;
        // ?show= may hold a show id as well as a slug — select the matching option either way
        const chosen = filters.show ? shows.find((s) => s.slug === filters.show || String(s.id) === filters.show) : undefined;
        const selectValue = chosen?.slug ?? filters.show;
        return (
          <div className="filter-section" key="show">
            <label className="filter-section-title" htmlFor={id}>
              Show
            </label>
            <select id={id} className="select" value={selectValue} onChange={(e) => onChange({ ...filters, show: e.target.value })} data-testid="filter-show">
              <option value="">All shows ({shows.length})</option>
              {filters.show && !chosen && <option value={filters.show}>{filters.show} (0)</option>}
              {shows.map((s) => {
                const n = showBase.filter((x) => x.show.slug === s.slug).length;
                return (
                  <option key={s.slug} value={s.slug}>
                    {s.name} ({n})
                  </option>
                );
              })}
            </select>
          </div>
        );
      }
      case 'length': {
        const id = `${baseId}-len`;
        const anyLength = filters.maxSeconds === null;
        return (
          <div className="filter-section" key="length">
            <label className="filter-section-title" htmlFor={id}>
              <span>Max length</span>
              <span className="length-slider-value" aria-live="polite">
                {anyLength ? 'Any length' : `Up to ${formatLength(filters.maxSeconds)}`}
              </span>
            </label>
            <div className="length-slider">
              <input
                id={id}
                type="range"
                className="range-slider"
                min={LENGTH_SLIDER.min}
                max={LENGTH_SLIDER.max}
                step={LENGTH_SLIDER.step}
                value={sliderValue}
                style={{ '--fill': `${pct(sliderValue)}%` } as CSSProperties}
                aria-valuetext={anyLength ? 'Any length' : `Up to ${formatLength(sliderValue)}`}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onChange({ ...filters, maxSeconds: v >= LENGTH_SLIDER.max ? null : v }, { replace: true });
                }}
                data-testid="filter-max-length"
              />
              <span className="length-slider-marker" style={{ left: `calc(${limitPct}% + ${(0.5 - limitPct / 100) * 24}px)` }} aria-hidden="true" />
              <span className="length-slider-marker-label" style={{ left: `calc(${limitPct}% + ${(0.5 - limitPct / 100) * 24}px)` }} aria-hidden="true">
                6:00 limit
              </span>
            </div>
            <p className="hint">STAR solos & duets must be 6:00 or less.</p>
          </div>
        );
      }
      case 'toggles':
        return (
          <div className="filter-section" key="toggles">
            <p className="filter-section-title">Extras</p>
            <Switch checked={filters.hideMature} onChange={(v) => onChange({ ...filters, hideMature: v })} label="Hide mature themes" testId="filter-hide-mature" />
            <Switch checked={filters.hasAudio} onChange={(v) => onChange({ ...filters, hasAudio: v })} label="Has audio preview 🎧" testId="filter-has-audio" />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`filter-panel ${className}`.trim()} data-testid="filter-panel">
      {sections.map(render)}
    </div>
  );
}

/** Stable key for a sub-genre name (for React lists outside this file). */
export const subGenreKey = (name: string) => normalizeText(name);

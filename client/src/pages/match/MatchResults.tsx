/**
 * Matchmaker results: answer summary (each chip jumps back to its question), Restart / Refine /
 * Share, and the top matches as SongCards with a match % badge and "why it matched" chips.
 */
import { ArrowRight, Pencil, RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { CopyButton } from '../../components/CopyButton';
import { EmptyState } from '../../components/EmptyState';
import { SongGridSkeleton } from '../../components/Skeletons';
import { SongCard } from '../../components/SongCard';
import { browseHref } from '../../lib/filters';
import { genreEmoji, KIND_EMOJI, normalizeVocalRange, subGenreEmoji } from '../../lib/vocab';
import type { VocalRange } from '../../types';
import { LENGTH_OPTIONS, matchHeadline, type MatchAnswers, type MatchResult } from './score';

export interface MatchResultsProps {
  answers: MatchAnswers;
  results: MatchResult[];
  considered: number;
  loading: boolean;
  shareUrl: string;
  onEditStep: (index: number) => void;
  onRestart: () => void;
  onRefine: () => void;
}

interface SummaryItem {
  step: number;
  emoji: string;
  label: string;
}

function summarize(a: MatchAnswers): SummaryItem[] {
  const items: SummaryItem[] = [];
  items.push({
    step: 0,
    emoji: a.kind && a.kind !== 'any' ? KIND_EMOJI[a.kind] : '🎲',
    label: a.kind === 'solo' ? 'Solo' : a.kind === 'duet' ? 'Duet' : 'Solo or duet',
  });
  const voice = a.range && a.range !== 'any' ? a.range : 'Any voice';
  const partner = a.kind === 'duet' && a.partner && a.partner !== 'any' ? ` + ${a.partner}` : '';
  items.push({ step: 1, emoji: '🎙️', label: `${voice}${partner}` });
  const vibe = a.genres && a.genres.length ? a.genres.join(' / ') : 'Any vibe';
  items.push({
    step: 2,
    emoji: a.genres && a.genres.length === 1 ? genreEmoji(a.genres[0]) : '✨',
    label: a.moods.length ? `${vibe} · ${a.moods.join(', ')}` : vibe,
  });
  items.push({ step: 3, emoji: a.length ? LENGTH_OPTIONS[a.length].emoji : '⏱️', label: a.length ? LENGTH_OPTIONS[a.length].label : 'Any length' });
  items.push({ step: 4, emoji: a.mature === 'no' ? '😇' : '🎭', label: a.mature === 'no' ? 'No mature themes' : 'Mature themes OK' });
  return items;
}

/** A "keep exploring" Browse link using the same answers as filters. */
export function browseLinkFor(a: MatchAnswers): string {
  const ranges: VocalRange[] = [];
  for (const r of [a.range, a.kind === 'duet' ? a.partner : null]) {
    const n = r && r !== 'any' ? normalizeVocalRange(r) : null;
    if (n && !ranges.includes(n)) ranges.push(n);
  }
  return browseHref({
    kind: a.kind === 'solo' || a.kind === 'duet' ? a.kind : 'all',
    ranges,
    genres: a.genres ?? [],
    hideMature: a.mature === 'no',
    maxSeconds: a.length === 'short' ? 150 : a.length === 'medium' ? 210 : null,
  });
}

export function MatchResults({ answers, results, considered, loading, shareUrl, onEditStep, onRestart, onRefine }: MatchResultsProps) {
  const summary = summarize(answers);
  return (
    <section className="match-results" aria-labelledby="match-results-title" data-testid="match-results">
      <div className="match-results-head">
        <div className="match-results-intro">
          <p className="eyebrow">Your matches are in</p>
          <h2 id="match-results-title" className="match-results-title" tabIndex={-1}>
            <span className="emoji" aria-hidden="true">
              💘{' '}
            </span>
            It’s a match!
          </h2>
          <p className="muted" data-testid="match-considered">
            {loading
              ? 'Shuffling through the songbook…'
              : considered === 0
                ? 'No songs are left after your answers.'
                : `We scored ${considered} song${considered === 1 ? '' : 's'} against your answers. Here ${results.length === 1 ? 'is your top pick' : `are your top ${results.length}`}.`}
          </p>
        </div>
        <ul className="match-summary" role="list" aria-label="Your answers">
          {summary.map((item) => (
            <li key={item.step}>
              <button type="button" className="match-summary-chip" onClick={() => onEditStep(item.step)} data-testid={`match-summary-${item.step + 1}`}>
                <span className="emoji" aria-hidden="true">
                  {item.emoji}
                </span>
                <span>{item.label}</span>
                <Pencil size={13} aria-hidden="true" className="match-summary-edit" />
                <span className="visually-hidden"> (change question {item.step + 1})</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="match-results-actions">
          <button type="button" className="btn btn-ghost" onClick={onRefine} data-testid="match-refine">
            <SlidersHorizontal size={18} aria-hidden="true" /> Refine
          </button>
          <button type="button" className="btn btn-quiet" onClick={onRestart} data-testid="match-restart">
            <RotateCcw size={18} aria-hidden="true" /> Restart
          </button>
          <CopyButton text={shareUrl} label="Share these results" copiedLabel="Link copied!" testId="match-share" />
        </div>
      </div>

      {loading ? (
        <SongGridSkeleton count={6} label="Finding your matches…" />
      ) : results.length === 0 ? (
        <EmptyState
          emoji="🕵️"
          title="No matches this time"
          actions={
            <>
              <button type="button" className="btn btn-primary" onClick={onRefine}>
                Change my answers
              </button>
              <Link to="/songs" className="btn btn-ghost">
                Browse every song
              </Link>
            </>
          }
        >
          <p>Try loosening an answer, like allowing mature themes or picking “Either” for solo or duet.</p>
        </EmptyState>
      ) : (
        <ol className="match-grid" role="list">
          {results.map((r, i) => (
            <li key={r.song.id} className={`match-result${i === 0 ? ' is-top' : ''}`} data-testid="match-result" data-percent={r.percent}>
              <div className="match-result-head">
                <span className="match-rank" aria-label={`Rank ${i + 1}`}>
                  #{i + 1}
                </span>
                <span className="match-percent" data-testid="match-percent" style={{ '--pct': `${r.percent}%` } as CSSProperties}>
                  <strong>{r.percent}%</strong> match
                </span>
                <span className="match-headline">{i === 0 && r.percent >= 60 ? 'Top pick' : matchHeadline(r.percent)}</span>
              </div>
              <SongCard song={r.song} headingLevel={3} />
              {r.reasons.length > 0 && (
                <ul className="match-reasons" aria-label="Why it matched">
                  {r.reasons.map((reason) => (
                    <li key={reason.id} className={`match-reason is-${reason.tone}`} data-testid="match-reason">
                      <span className="emoji" aria-hidden="true">
                        {reason.id === 'mood' ? subGenreEmoji(r.song.subGenre) : reason.emoji}
                      </span>
                      {reason.label}
                      {reason.tone === 'miss' && <span className="visually-hidden"> (not a match)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      {!loading && results.length > 0 && (
        <p className="match-more">
          Want to see more like these?{' '}
          <Link to={browseLinkFor(answers)} className="btn btn-sm btn-ghost">
            Keep exploring in Browse <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </p>
      )}
    </section>
  );
}

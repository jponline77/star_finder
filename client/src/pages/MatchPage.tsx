/**
 * /match — Song Matchmaker (SPEC §7.6).
 * Five playful one-tap questions → ranked matches (pure scoring in ./match/score.ts).
 * Every answer + the current step live in the URL (?kind=&range=&partner=&genre=&mood=&len=&mature=&step=)
 * so results are shareable and the browser Back button walks back through the questions.
 */
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorState } from '../components/EmptyState';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { facetCounts, rangeCounts, toggleInList } from '../lib/filters';
import { equalsLoose } from '../lib/normalize';
import { GENRES, genreEmoji, RANGE_SHORT, rangeColorVar, subGenreEmoji, VOCAL_RANGES } from '../lib/vocab';
import { useSongs } from '../state/SongsProvider';
import type { Song } from '../types';
import { answersFromParams, answersToParams, firstUnanswered, freshAnswers, isStepAnswered, STEPS, type StepParam } from './match/answers';
import { MatchResults } from './match/MatchResults';
import { LENGTH_OPTIONS, rankSongs, type KindAnswer, type LengthAnswer, type MatchAnswers, type MatureAnswer, type RangeAnswer } from './match/score';
import { VoiceHelper } from './match/VoiceHelper';
import './MatchPage.css';

const STEP_META: ReadonlyArray<{ emoji: string; short: string; title: string; hint: string; accent: string }> = [
  { emoji: '🎤', short: 'Solo or duet', title: 'Solo or duet?', hint: 'Are you flying solo, or sharing the stage with a scene partner?', accent: 'pink' },
  { emoji: '🎙️', short: 'Voice', title: 'What’s your voice type?', hint: 'We’ll look for parts written for your voice.', accent: 'teal' },
  { emoji: '✨', short: 'Vibe', title: 'What vibe are you going for?', hint: 'Pick one or more. Then, if you like, choose a mood.', accent: 'gold' },
  { emoji: '⏱️', short: 'Length', title: 'How long should it be?', hint: 'STAR allows up to 6:00, and the clock starts after your slate.', accent: 'plum' },
  { emoji: '🎭', short: 'Mature themes', title: 'Are mature themes OK?', hint: 'Some songs deal with grown-up topics. If you’re not sure, check with your teacher.', accent: 'coral' },
];

const GENRE_BLURB: Record<string, string> = {
  Comedy: 'Make ’em laugh with punchlines, timing and big characters.',
  Drama: 'Big feelings, big stakes, big notes.',
  Romantic: 'Crushes, true love and heartbreak.',
};

const AUTO_ADVANCE_MS = 320;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- option tile
interface OptionTileProps {
  pressed: boolean;
  onClick: () => void;
  emoji?: ReactNode;
  title: ReactNode;
  blurb?: ReactNode;
  meta?: ReactNode;
  testId?: string;
  className?: string;
  style?: CSSProperties;
  shortcut?: number;
}

function OptionTile({ pressed, onClick, emoji, title, blurb, meta, testId, className = '', style, shortcut }: OptionTileProps) {
  return (
    <button type="button" className={`match-option ${className}`.trim()} aria-pressed={pressed} onClick={onClick} data-testid={testId} style={style}>
      {emoji !== undefined && (
        <span className="match-option-emoji emoji" aria-hidden="true">
          {emoji}
        </span>
      )}
      <span className="match-option-text">
        <span className="match-option-title">{title}</span>
        {blurb && <span className="match-option-blurb">{blurb}</span>}
      </span>
      {meta !== undefined && <span className="match-option-meta">{meta}</span>}
      {shortcut !== undefined && (
        <kbd className="match-option-key" aria-hidden="true">
          {shortcut}
        </kbd>
      )}
      <span className="match-option-check" aria-hidden="true">
        <Check size={16} strokeWidth={3} />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- voice grid
function VoiceGrid({
  label,
  value,
  onPick,
  counts,
  testIdPrefix,
  anyLabel,
  anyTestId,
  shortcuts,
}: {
  label: string;
  value: RangeAnswer | null;
  onPick: (r: RangeAnswer) => void;
  counts: Record<string, number>;
  testIdPrefix: string;
  anyLabel: string;
  anyTestId: string;
  shortcuts: boolean;
}) {
  return (
    <div className="match-voice-group" role="group" aria-label={label}>
      <ul className="match-voice-grid" role="list">
        {VOCAL_RANGES.map((r, i) => (
          <li key={r}>
            <button
              type="button"
              className="match-voice"
              aria-pressed={value === r}
              onClick={() => onPick(r)}
              style={{ '--tile-color': rangeColorVar(r) } as CSSProperties}
              data-testid={`${testIdPrefix}-${r}`}
            >
              <span className="match-voice-disc" aria-hidden="true">
                {RANGE_SHORT[r]}
              </span>
              <span className="match-voice-name">{r}</span>
              <span className="match-voice-count">{plural(counts[r] ?? 0, 'song')}</span>
              {shortcuts && (
                <kbd className="match-option-key" aria-hidden="true">
                  {i + 1}
                </kbd>
              )}
              <span className="match-option-check" aria-hidden="true">
                <Check size={14} strokeWidth={3} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="match-any" aria-pressed={value === 'any'} onClick={() => onPick('any')} data-testid={anyTestId}>
        <span className="emoji" aria-hidden="true">
          🤷
        </span>
        {anyLabel}
        {shortcuts && (
          <kbd className="match-option-key" aria-hidden="true">
            7
          </kbd>
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- page
export default function MatchPage() {
  useDocumentTitle('Song Matchmaker');
  const [params, setParams] = useSearchParams();
  const { answers, step } = useMemo(() => answersFromParams(params), [params]);
  const { songs, loading, error, reload } = useSongs();
  const reduced = usePrefersReducedMotion();
  const advanceTimer = useRef<number | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const prevStep = useRef<StepParam>(step);
  const lastRendered = useRef<StepParam>(step);
  const direction = useRef<'forward' | 'back'>('forward');

  const stepIndex = step === 'results' ? STEPS.length : step - 1;
  if (lastRendered.current !== step) {
    // slide the new card in from the right when moving forward, from the left when going back
    const num = (s: StepParam) => (s === 'results' ? 99 : s);
    direction.current = num(step) >= num(lastRendered.current) ? 'forward' : 'back';
    lastRendered.current = step;
  }
  const meta = step === 'results' ? null : STEP_META[stepIndex];

  // --- navigation helpers ------------------------------------------------
  const commit = useCallback(
    (next: MatchAnswers, nextStep: StepParam, replace: boolean) => {
      setParams((prev) => answersToParams(next, nextStep, prev), { replace, preventScrollReset: true });
    },
    [setParams],
  );

  const goTo = useCallback(
    (target: StepParam) => {
      window.clearTimeout(advanceTimer.current);
      commit(answers, target, false);
    },
    [answers, commit],
  );

  const nextStepOf = (i: number): StepParam => (i + 1 >= STEPS.length ? 'results' : ((i + 2) as StepParam));

  /** Record an answer (replacing the history entry); optionally auto-advance after a beat. */
  const choose = (next: MatchAnswers, advance: boolean) => {
    window.clearTimeout(advanceTimer.current);
    commit(next, step, true);
    if (advance && step !== 'results') {
      const target = nextStepOf(stepIndex);
      advanceTimer.current = window.setTimeout(() => commit(next, target, false), reduced ? 120 : AUTO_ADVANCE_MS);
    }
  };

  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);

  // Move focus to the new question (not on first load) so keyboard/screen-reader users follow along.
  useEffect(() => {
    if (prevStep.current === step) return;
    prevStep.current = step;
    const el = step === 'results' ? document.getElementById('match-results-title') : headingRef.current;
    el?.focus({ preventScroll: true });
    const top = document.getElementById('match-top');
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  }, [step, reduced]);

  // --- data ----------------------------------------------------------------
  const kindPool = useMemo<Song[]>(() => (answers.kind === 'solo' || answers.kind === 'duet' ? songs.filter((s) => s.kind === answers.kind) : songs), [songs, answers.kind]);
  const solos = songs.filter((s) => s.kind === 'solo').length;
  const duets = songs.length - solos;
  const voiceCounts = useMemo(() => rangeCounts(kindPool), [kindPool]);
  const genreList = useMemo(() => {
    const facets = facetCounts(kindPool, (s) => s.genre);
    const known = GENRES.map((g) => facets.find((f) => equalsLoose(f.value, g)) ?? { value: g, count: 0 });
    const extra = facets.filter((f) => !GENRES.some((g) => equalsLoose(g, f.value)));
    return [...known, ...extra];
  }, [kindPool]);
  const moodList = useMemo(() => {
    const chosen = answers.genres ?? [];
    const pool = chosen.length ? kindPool.filter((s) => chosen.some((g) => equalsLoose(g, s.genre))) : kindPool;
    return facetCounts(pool, (s) => s.subGenre);
  }, [kindPool, answers.genres]);
  const lengthCounts = useMemo(() => {
    const out: Record<LengthAnswer, number> = { short: 0, medium: 0, max: 0 };
    for (const s of kindPool) {
      if (s.lengthSeconds === null) continue;
      for (const k of Object.keys(out) as LengthAnswer[]) if (s.lengthSeconds <= LENGTH_OPTIONS[k].max) out[k] += 1;
    }
    return out;
  }, [kindPool]);
  const matureCount = useMemo(() => kindPool.filter((s) => s.mature).length, [kindPool]);

  const ranked = useMemo(() => (step === 'results' ? rankSongs(songs, answers, 12) : { results: [], considered: 0 }), [songs, answers, step]);

  // --- answer setters --------------------------------------------------------
  const setKind = (kind: KindAnswer) => choose({ ...answers, kind, partner: kind === 'duet' ? answers.partner : null }, true);
  const setRange = (range: RangeAnswer) => {
    const next = { ...answers, range };
    choose(next, answers.kind !== 'duet' || next.partner !== null);
  };
  const setPartner = (partner: RangeAnswer) => {
    const next = { ...answers, partner };
    choose(next, next.range !== null);
  };
  const toggleGenre = (genre: string) => {
    const list = toggleInList(answers.genres ?? [], genre);
    const genres = list.length ? list : null;
    // drop moods that no longer belong to a picked genre
    const allowed = new Set(
      kindPool.filter((s) => !genres || genres.some((g) => equalsLoose(g, s.genre))).map((s) => s.subGenre?.toLowerCase() ?? ''),
    );
    choose({ ...answers, genres, moods: answers.moods.filter((m) => allowed.has(m.toLowerCase())) }, false);
  };
  const anyGenre = () => choose({ ...answers, genres: [], moods: [] }, false);
  const toggleMood = (mood: string) => {
    const moods = toggleInList(answers.moods, mood);
    choose({ ...answers, genres: answers.genres ?? [], moods }, false);
  };
  const setLength = (length: LengthAnswer) => choose({ ...answers, length }, true);
  const setMature = (mature: MatureAnswer) => choose({ ...answers, mature }, true);

  // --- keyboard shortcuts (digits pick an option on single-choice steps) ---------
  const onStageKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, summary')) return;
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1) return;
    const id = STEPS[stepIndex];
    if (id === 'kind' && n <= 3) setKind((['solo', 'duet', 'any'] as const)[n - 1]!);
    else if (id === 'voice' && answers.kind !== 'duet' && n <= 7) setRange(n === 7 ? 'any' : VOCAL_RANGES[n - 1]!);
    else if (id === 'length' && n <= 3) setLength((['short', 'medium', 'max'] as const)[n - 1]!);
    else if (id === 'mature' && n <= 2) setMature(n === 1 ? 'ok' : 'no');
    else return;
    e.preventDefault();
  };

  const restart = () => {
    window.clearTimeout(advanceTimer.current);
    commit(freshAnswers(), 1, false);
  };

  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/match?${answersToParams(answers, 'results').toString()}`;
  const answeredAll = firstUnanswered(answers) >= STEPS.length;
  const canNext = step !== 'results' && isStepAnswered(answers, stepIndex);
  const shortcutHint = meta && (stepIndex === 0 || stepIndex === 3 || stepIndex === 4 || (stepIndex === 1 && answers.kind !== 'duet'));

  // --- step bodies -------------------------------------------------------------
  let body: ReactNode = null;
  switch (STEPS[stepIndex]) {
    case 'kind':
      body = (
        <div className="match-options match-options-3" role="group" aria-label="Solo or duet">
          <OptionTile pressed={answers.kind === 'solo'} onClick={() => setKind('solo')} emoji="🎤" title="Solo" blurb="Just me in the spotlight." meta={loading ? '…' : plural(solos, 'song')} testId="match-kind-solo" shortcut={1} />
          <OptionTile pressed={answers.kind === 'duet'} onClick={() => setKind('duet')} emoji="👯" title="Duet" blurb="Me and a scene partner." meta={loading ? '…' : plural(duets, 'song')} testId="match-kind-duet" shortcut={2} />
          <OptionTile pressed={answers.kind === 'any'} onClick={() => setKind('any')} emoji="🎲" title="Either" blurb="Show me both, I’m flexible!" meta={loading ? '…' : plural(songs.length, 'song')} testId="match-kind-any" shortcut={3} />
        </div>
      );
      break;
    case 'voice':
      body = (
        <div className="stack">
          {answers.kind === 'duet' ? (
            <>
              <h3 className="match-subhead">Your voice</h3>
              <VoiceGrid label="Your voice" value={answers.range} onPick={setRange} counts={voiceCounts} testIdPrefix="match-range" anyLabel="Not sure / any" anyTestId="match-range-any" shortcuts={false} />
              <h3 className="match-subhead">Your partner’s voice</h3>
              <VoiceGrid label="Your partner’s voice" value={answers.partner} onPick={setPartner} counts={voiceCounts} testIdPrefix="match-partner" anyLabel="Any partner" anyTestId="match-partner-any" shortcuts={false} />
            </>
          ) : (
            <VoiceGrid label="Your voice type" value={answers.range} onPick={setRange} counts={voiceCounts} testIdPrefix="match-range" anyLabel="I’m not sure — show me everything" anyTestId="match-range-any" shortcuts />
          )}
          <VoiceHelper />
        </div>
      );
      break;
    case 'vibe':
      body = (
        <div className="stack">
          <div className="match-options match-options-genres" role="group" aria-label="Genres">
            {genreList.map((g) => (
              <OptionTile
                key={g.value}
                pressed={Boolean(answers.genres?.some((x) => equalsLoose(x, g.value)))}
                onClick={() => toggleGenre(g.value)}
                emoji={genreEmoji(g.value)}
                title={g.value}
                blurb={GENRE_BLURB[g.value] ?? 'Something a little different.'}
                meta={plural(g.count, 'song')}
                testId={`match-genre-${g.value.replace(/\s+/g, '-')}`}
                className="is-genre"
              />
            ))}
            <OptionTile pressed={answers.genres !== null && answers.genres.length === 0} onClick={anyGenre} emoji="🌈" title="Anything goes" blurb="Surprise me with any vibe." testId="match-genre-any" className="is-genre" />
          </div>
          {answers.genres !== null && moodList.length > 0 && (
            <fieldset className="match-moods">
              <legend className="match-subhead">
                Pick a mood <span className="muted small">(optional)</span>
              </legend>
              <div className="chip-group">
                {moodList.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    className="chip match-mood"
                    aria-pressed={answers.moods.some((x) => equalsLoose(x, m.value))}
                    onClick={() => toggleMood(m.value)}
                    data-testid={`match-mood-${m.value.replace(/[^A-Za-z0-9]+/g, '-')}`}
                  >
                    <span className="emoji" aria-hidden="true">
                      {subGenreEmoji(m.value)}
                    </span>
                    {m.value}
                    <span className="chip-count" aria-label={plural(m.count, 'song')}>
                      {m.count}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      );
      break;
    case 'length':
      body = (
        <div className="match-options match-options-3" role="group" aria-label="Song length">
          {(['short', 'medium', 'max'] as const).map((k, i) => {
            const o = LENGTH_OPTIONS[k];
            return (
              <OptionTile
                key={k}
                pressed={answers.length === k}
                onClick={() => setLength(k)}
                emoji={o.emoji}
                title={o.label}
                blurb={
                  <>
                    {o.blurb}
                    <span className="match-length-bar" aria-hidden="true" style={{ '--len': `${(o.max / 360) * 100}%` } as CSSProperties} />
                  </>
                }
                meta={loading ? '…' : plural(lengthCounts[k], 'song')}
                testId={`match-len-${k}`}
                shortcut={i + 1}
              />
            );
          })}
        </div>
      );
      break;
    case 'mature':
      body = (
        <div className="match-options match-options-2" role="group" aria-label="Mature themes">
          <OptionTile pressed={answers.mature === 'ok'} onClick={() => setMature('ok')} emoji="🎭" title="Yes, that’s fine" blurb="Include songs with mature themes." meta={loading ? '…' : `${plural(matureCount, 'song')} flagged`} testId="match-mature-ok" shortcut={1} />
          <OptionTile pressed={answers.mature === 'no'} onClick={() => setMature('no')} emoji="😇" title="Keep it clean" blurb="Leave out anything with mature themes." meta={loading ? '…' : `${plural(kindPool.length - matureCount, 'song')} left`} testId="match-mature-no" shortcut={2} />
        </div>
      );
      break;
    default:
      body = null;
  }

  return (
    <div className="match-page">
      <div className="container">
        <header className="match-header" id="match-top">
          <div>
            <p className="eyebrow">
              <Sparkles size={14} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-2px' }} /> Song Matchmaker
            </p>
            <h1 className="page-title match-title">Find your perfect song match</h1>
            <p className="page-subtitle">Five quick questions, one tap each. We’ll rank every song by how well it fits you.</p>
          </div>
        </header>

        <nav className="match-progress" aria-label="Quiz progress" data-testid="match-progress">
          <ol role="list">
            {STEP_META.map((m, i) => {
              const answered = isStepAnswered(answers, i);
              const current = stepIndex === i;
              const reachable = i <= firstUnanswered(answers) || answered;
              const label = `Question ${i + 1}: ${m.short}${answered ? ' (answered)' : ''}`;
              return (
                <li key={m.short} className={`match-dot${current ? ' is-current' : ''}${answered ? ' is-answered' : ''}`}>
                  {reachable && !current ? (
                    <button type="button" onClick={() => goTo((i + 1) as StepParam)} aria-label={label} title={m.short}>
                      {answered ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : <span aria-hidden="true">{i + 1}</span>}
                    </button>
                  ) : (
                    <span aria-label={label} aria-current={current ? 'step' : undefined} title={m.short} role="img">
                      {answered && !current ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : <span aria-hidden="true">{i + 1}</span>}
                    </span>
                  )}
                </li>
              );
            })}
            <li className={`match-dot is-finale${step === 'results' ? ' is-current' : ''}`}>
              {answeredAll && step !== 'results' ? (
                <button type="button" onClick={() => goTo('results')} aria-label="Your matches" title="Your matches">
                  <span aria-hidden="true">💘</span>
                </button>
              ) : (
                <span role="img" aria-label="Your matches" aria-current={step === 'results' ? 'step' : undefined} title="Your matches">
                  <span aria-hidden="true">💘</span>
                </span>
              )}
            </li>
          </ol>
        </nav>

        {error && !songs.length ? (
          <ErrorState message="We couldn’t load the songbook. Check your connection and try again." onRetry={() => void reload()} />
        ) : step === 'results' ? (
          <MatchResults
            answers={answers}
            results={ranked.results}
            considered={ranked.considered}
            loading={loading && !songs.length}
            shareUrl={shareUrl}
            onEditStep={(i) => goTo((i + 1) as StepParam)}
            onRestart={restart}
            onRefine={() => goTo(1)}
          />
        ) : (
          meta && (
            <div className="match-stage" onKeyDown={onStageKeyDown}>
              <section
                key={stepIndex}
                className={`match-card accent-${meta.accent} is-${direction.current}`}
                aria-labelledby="match-step-title"
                data-testid="match-step"
                data-step={stepIndex + 1}
              >
                <span className="match-card-deco emoji" aria-hidden="true">
                  {meta.emoji}
                </span>
                <p className="match-step-count">
                  Question {stepIndex + 1} <span className="muted">of {STEPS.length}</span>
                </p>
                <h2 id="match-step-title" className="match-step-title" ref={headingRef} tabIndex={-1}>
                  {meta.title}
                </h2>
                <p className="match-step-hint">{meta.hint}</p>
                <div className="match-card-body">{body}</div>
                {shortcutHint && <p className="match-kbd-hint subtle tiny">Tip: press the number keys to answer.</p>}
              </section>

              <div className="match-nav">
                {stepIndex > 0 ? (
                  <button type="button" className="btn btn-ghost" onClick={() => goTo(stepIndex as StepParam)} data-testid="match-back">
                    <ArrowLeft size={18} aria-hidden="true" /> Back
                  </button>
                ) : (
                  <span />
                )}
                <div className="match-nav-right">
                  {answeredAll && stepIndex < STEPS.length - 1 && (
                    <button type="button" className="btn btn-quiet" onClick={() => goTo('results')} data-testid="match-jump-results">
                      Skip to matches
                    </button>
                  )}
                  <button
                    type="button"
                    className={`btn ${stepIndex === STEPS.length - 1 ? 'btn-pink' : 'btn-primary'}`}
                    onClick={() => goTo(nextStepOf(stepIndex))}
                    disabled={!canNext}
                    data-testid="match-next"
                  >
                    {stepIndex === STEPS.length - 1 ? (
                      <>
                        See my matches <Sparkles size={18} aria-hidden="true" />
                      </>
                    ) : (
                      <>
                        Next <ArrowRight size={18} aria-hidden="true" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

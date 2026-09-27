/**
 * Song Matchmaker answers <-> URL (so results are shareable) and step bookkeeping. Pure.
 *
 *   /match?kind=duet&range=Tenor&partner=any&genre=Comedy&mood=Satire&len=short&mature=no&step=results
 */
import { equalsLoose } from '../../lib/normalize';
import { normalizeVocalRange } from '../../lib/vocab';
import { EMPTY_ANSWERS, type KindAnswer, type LengthAnswer, type MatchAnswers, type MatureAnswer, type RangeAnswer } from './score';

export const STEPS = ['kind', 'voice', 'vibe', 'length', 'mature'] as const;
export type StepId = (typeof STEPS)[number];
/** 1..5 = a quiz step, 'results' = the ranked list. */
export type StepParam = 1 | 2 | 3 | 4 | 5 | 'results';

export const MATCH_PARAM_KEYS = ['kind', 'range', 'partner', 'genre', 'mood', 'len', 'mature', 'step'] as const;

const escapeListValue = (v: string) => v.replace(/%/g, '%25').replace(/,/g, '%2C');
const unescapeListValue = (v: string) => v.replace(/%2C/gi, ',').replace(/%25/g, '%');

function readList(params: URLSearchParams, key: string): string[] {
  const out: string[] = [];
  for (const raw of params.getAll(key)) {
    for (const piece of raw.split(',')) {
      const v = unescapeListValue(piece).trim().slice(0, 40);
      if (v && !out.some((o) => equalsLoose(o, v))) out.push(v);
    }
  }
  return out.slice(0, 12);
}

function readRange(value: string | null): RangeAnswer | null {
  if (value === null) return null;
  if (value.trim().toLowerCase() === 'any') return 'any';
  return normalizeVocalRange(value);
}

export function answersFromParams(input: URLSearchParams | string): { answers: MatchAnswers; step: StepParam } {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;
  const kindRaw = (params.get('kind') ?? '').toLowerCase();
  const kind: KindAnswer | null = kindRaw === 'solo' || kindRaw === 'duet' || kindRaw === 'any' ? kindRaw : null;
  const genreRaw = params.get('genre');
  const genres = genreRaw === null ? null : genreRaw.trim().toLowerCase() === 'any' ? [] : readList(params, 'genre');
  const lenRaw = params.get('len') ?? '';
  const length: LengthAnswer | null = lenRaw === 'short' || lenRaw === 'medium' || lenRaw === 'max' ? lenRaw : null;
  const matureRaw = params.get('mature') ?? '';
  const mature: MatureAnswer | null = matureRaw === 'ok' || matureRaw === 'no' ? matureRaw : null;
  const answers: MatchAnswers = {
    kind,
    range: readRange(params.get('range')),
    partner: readRange(params.get('partner')),
    genres,
    moods: readList(params, 'mood'),
    length,
    mature,
  };
  const stepRaw = params.get('step') ?? '';
  let step: StepParam = 1;
  if (stepRaw === 'results') step = 'results';
  else if (/^[1-5]$/.test(stepRaw)) step = Number(stepRaw) as StepParam;
  return { answers, step };
}

/** Serialise answers + step, keeping any unrelated params in `base`. Unanswered values are omitted. */
export function answersToParams(answers: MatchAnswers, step: StepParam, base?: URLSearchParams | string): URLSearchParams {
  const params = new URLSearchParams(base ?? '');
  for (const key of MATCH_PARAM_KEYS) params.delete(key);
  if (answers.kind) params.set('kind', answers.kind);
  if (answers.range) params.set('range', answers.range);
  if (answers.partner && answers.kind === 'duet') params.set('partner', answers.partner);
  if (answers.genres) params.set('genre', answers.genres.length ? answers.genres.map(escapeListValue).join(',') : 'any');
  if (answers.moods.length) params.set('mood', answers.moods.map(escapeListValue).join(','));
  if (answers.length) params.set('len', answers.length);
  if (answers.mature) params.set('mature', answers.mature);
  if (step !== 1) params.set('step', String(step));
  return params;
}

/** Is quiz step `index` (0-based) answered? */
export function isStepAnswered(answers: MatchAnswers, index: number): boolean {
  switch (STEPS[index]) {
    case 'kind':
      return answers.kind !== null;
    case 'voice':
      return answers.range !== null;
    case 'vibe':
      return answers.genres !== null;
    case 'length':
      return answers.length !== null;
    case 'mature':
      return answers.mature !== null;
    default:
      return false;
  }
}

/** Index of the first unanswered step, or STEPS.length when everything is answered. */
export function firstUnanswered(answers: MatchAnswers): number {
  for (let i = 0; i < STEPS.length; i++) if (!isStepAnswered(answers, i)) return i;
  return STEPS.length;
}

export function countAnswered(answers: MatchAnswers): number {
  return STEPS.reduce((n, _s, i) => n + (isStepAnswered(answers, i) ? 1 : 0), 0);
}

export function freshAnswers(): MatchAnswers {
  return { ...EMPTY_ANSWERS, moods: [] };
}

/**
 * Song Matchmaker scoring (SPEC §7.6) — pure functions, no React.
 *
 *   const { results, considered } = rankSongs(songs, answers, 12);
 *   results[0] → { song, percent: 96, points, maxPoints, reasons: [{ id, label, emoji, tone }] }
 *
 * Weights (points; only questions the student actually answered count towards the max):
 *   kind 25 · voice 35 · genre 15 · mood 10 · length 15
 * Mature themes are a HARD filter ("No thanks" removes every mature song).
 * Voice fit: exact part match = full points; a neighbouring voice type in the same family
 * (e.g. Mezzo ↔ Soprano) = half; neighbours across families (Alto ↔ Tenor) = 30%; two steps
 * apart in the same family = 15%; unknown range = 25%. Duets with a partner voice try both
 * part assignments (you 60% / partner 40%) and keep the better one.
 */
import type { Kind, Song, VocalRange } from '../../types';
import { formatLength } from '../../lib/format';
import { compareText, equalsLoose } from '../../lib/normalize';
import { genreEmoji, KIND_EMOJI, KIND_LABEL, normalizeVocalRange, RANGE_SHORT, subGenreEmoji, VOCAL_RANGES } from '../../lib/vocab';

export type KindAnswer = Kind | 'any';
export type RangeAnswer = VocalRange | 'any';
export type LengthAnswer = 'short' | 'medium' | 'max';
export type MatureAnswer = 'ok' | 'no';

/** Quiz answers. `null` = not answered yet (treated as "no preference" when scoring). */
export interface MatchAnswers {
  kind: KindAnswer | null;
  /** Your voice. */
  range: RangeAnswer | null;
  /** Duet partner's voice (only used when kind === 'duet'). */
  partner: RangeAnswer | null;
  /** null = unanswered, [] = "anything goes", else OR-list of genres. */
  genres: string[] | null;
  /** Optional sub-genre moods (OR-list). */
  moods: string[];
  length: LengthAnswer | null;
  mature: MatureAnswer | null;
}

export const EMPTY_ANSWERS: Readonly<MatchAnswers> = Object.freeze({
  kind: null,
  range: null,
  partner: null,
  genres: null,
  moods: [],
  length: null,
  mature: null,
}) as Readonly<MatchAnswers>;

export const WEIGHTS = { kind: 25, range: 35, genre: 15, mood: 10, length: 15 } as const;

export interface LengthOption {
  /** Upper bound in seconds for a perfect fit. */
  max: number;
  /** A little over the bound still earns partial credit up to here. */
  soft: number;
  label: string;
  blurb: string;
  emoji: string;
}

export const LENGTH_OPTIONS: Record<LengthAnswer, LengthOption> = {
  short: { max: 150, soft: 180, label: 'Under 2:30', blurb: 'Short & sweet — in, shine, out.', emoji: '⚡' },
  medium: { max: 210, soft: 240, label: 'Under 3:30', blurb: 'The classic length. Room to build.', emoji: '🎵' },
  max: { max: 360, soft: 360, label: 'Up to 6:00', blurb: "Give me the epic — anything within STAR's limit.", emoji: '🎭' },
};

export type ReasonTone = 'strong' | 'good' | 'miss';

export interface MatchReason {
  id: 'kind' | 'range' | 'genre' | 'mood' | 'length';
  label: string;
  emoji: string;
  tone: ReasonTone;
}

export interface MatchResult {
  song: Song;
  /** 0–100 */
  percent: number;
  points: number;
  maxPoints: number;
  reasons: MatchReason[];
}

const TREBLE = new Set<VocalRange>(['Soprano', 'Mezzo-soprano', 'Alto']);

/**
 * How well a part written for `actual` suits a singer with voice `wanted` (0..1).
 * Unknown/blank part ranges earn a small benefit of the doubt.
 */
export function rangeFit(wanted: VocalRange, actual: string | null | undefined): number {
  const a = normalizeVocalRange(actual);
  if (!a) return 0.25;
  if (a === wanted) return 1;
  const d = Math.abs(VOCAL_RANGES.indexOf(a) - VOCAL_RANGES.indexOf(wanted));
  const sameFamily = TREBLE.has(a) === TREBLE.has(wanted);
  if (d === 1) return sameFamily ? 0.5 : 0.3;
  if (d === 2 && sameFamily) return 0.15;
  return 0;
}

const concrete = (r: RangeAnswer | null | undefined): VocalRange | null => (r && r !== 'any' ? r : null);

interface VoiceFit {
  fit: number;
  /** Which part range(s) the singer(s) got, for the reason label. */
  mine: string | null;
  theirs: string | null;
}

/** Best voice fit for a song given the singer's (and optionally partner's) voice. null = not scored. */
export function voiceFit(song: Song, answers: Pick<MatchAnswers, 'kind' | 'range' | 'partner'>): VoiceFit | null {
  const me = concrete(answers.range);
  const partner = answers.kind === 'duet' && song.kind === 'duet' ? concrete(answers.partner) : null;
  if (!me && !partner) return null;
  const parts = song.parts.map((p) => p.vocalRange);
  if (!parts.length) return { fit: 0.25, mine: null, theirs: null };
  if (me && partner && parts.length >= 2) {
    const [p1, p2] = parts;
    const a = rangeFit(me, p1) * 0.6 + rangeFit(partner, p2) * 0.4;
    const b = rangeFit(me, p2) * 0.6 + rangeFit(partner, p1) * 0.4;
    return a >= b ? { fit: a, mine: p1 ?? null, theirs: p2 ?? null } : { fit: b, mine: p2 ?? null, theirs: p1 ?? null };
  }
  const who = (me ?? partner) as VocalRange;
  let best = -1;
  let bestPart: string | null = null;
  for (const p of parts) {
    const f = rangeFit(who, p);
    if (f > best) {
      best = f;
      bestPart = p ?? null;
    }
  }
  return me ? { fit: best, mine: bestPart, theirs: null } : { fit: best, mine: null, theirs: bestPart };
}

function rangeLabel(r: string | null | undefined): string {
  return normalizeVocalRange(r) ?? 'unlisted';
}

function voiceReason(song: Song, answers: MatchAnswers, v: VoiceFit): MatchReason {
  const me = concrete(answers.range);
  const partner = answers.kind === 'duet' && song.kind === 'duet' ? concrete(answers.partner) : null;
  if (v.fit >= 0.999) {
    if (me && partner) {
      const a = normalizeVocalRange(v.mine);
      const b = normalizeVocalRange(v.theirs);
      return { id: 'range', emoji: '🎯', tone: 'strong', label: `${a ? RANGE_SHORT[a] : '?'} + ${b ? RANGE_SHORT[b] : '?'} — both voices fit` };
    }
    return { id: 'range', emoji: '🎯', tone: 'strong', label: `Written for ${rangeLabel(v.mine ?? v.theirs)}` };
  }
  if (v.fit >= 0.5) {
    return { id: 'range', emoji: '👌', tone: 'good', label: me && partner ? 'Voices are a close fit' : `Close to your range (${rangeLabel(v.mine ?? v.theirs)})` };
  }
  if (v.fit >= 0.25) {
    const unknown = !normalizeVocalRange(v.mine ?? v.theirs);
    return {
      id: 'range',
      emoji: unknown ? '❔' : '🤏',
      tone: 'good',
      label: unknown ? 'Voice type not listed' : `A stretch — part is ${rangeLabel(v.mine ?? v.theirs)}`,
    };
  }
  return { id: 'range', emoji: '🙅', tone: 'miss', label: `Part is ${rangeLabel(v.mine ?? v.theirs)}` };
}

/**
 * Score one song. Returns null when a hard filter excludes it (mature themes answered "no").
 */
export function scoreSong(song: Song, answers: MatchAnswers): MatchResult | null {
  if (answers.mature === 'no' && song.mature) return null;
  let points = 0;
  let maxPoints = 0;
  const reasons: MatchReason[] = [];

  // --- kind
  if (answers.kind && answers.kind !== 'any') {
    maxPoints += WEIGHTS.kind;
    if (song.kind === answers.kind) {
      points += WEIGHTS.kind;
      reasons.push({ id: 'kind', emoji: KIND_EMOJI[song.kind], tone: 'strong', label: KIND_LABEL[song.kind] });
    } else {
      reasons.push({ id: 'kind', emoji: KIND_EMOJI[song.kind], tone: 'miss', label: `It’s a ${song.kind}` });
    }
  }

  // --- voice
  const v = voiceFit(song, answers);
  if (v) {
    maxPoints += WEIGHTS.range;
    points += WEIGHTS.range * v.fit;
    reasons.push(voiceReason(song, answers, v));
  }

  // --- genre
  if (answers.genres && answers.genres.length) {
    maxPoints += WEIGHTS.genre;
    if (song.genre && answers.genres.some((g) => equalsLoose(g, song.genre))) {
      points += WEIGHTS.genre;
      reasons.push({ id: 'genre', emoji: genreEmoji(song.genre), tone: 'strong', label: song.genre });
    }
  }

  // --- mood
  if (answers.moods.length) {
    maxPoints += WEIGHTS.mood;
    if (song.subGenre && answers.moods.some((m) => equalsLoose(m, song.subGenre))) {
      points += WEIGHTS.mood;
      reasons.push({ id: 'mood', emoji: subGenreEmoji(song.subGenre), tone: 'strong', label: `${song.subGenre} mood` });
    }
  }

  // --- length
  if (answers.length) {
    const opt = LENGTH_OPTIONS[answers.length];
    maxPoints += WEIGHTS.length;
    const s = song.lengthSeconds;
    if (s === null) {
      points += WEIGHTS.length * 0.3;
      reasons.push({ id: 'length', emoji: '⏱️', tone: 'good', label: 'Length unknown' });
    } else if (s > 360) {
      reasons.push({ id: 'length', emoji: '✂️', tone: 'miss', label: `${formatLength(s)} — needs a cut` });
    } else if (s <= opt.max) {
      points += WEIGHTS.length;
      reasons.push({ id: 'length', emoji: '⏱️', tone: 'strong', label: `${formatLength(s)} — fits ${opt.label.toLowerCase()}` });
    } else if (s <= opt.soft) {
      points += WEIGHTS.length * 0.5;
      reasons.push({ id: 'length', emoji: '⏱️', tone: 'good', label: `${formatLength(s)} — a little long` });
    } else {
      reasons.push({ id: 'length', emoji: '⏳', tone: 'miss', label: `${formatLength(s)} — longer than you wanted` });
    }
  }

  const percent = maxPoints === 0 ? 100 : Math.round((100 * points) / maxPoints);
  return { song, percent, points, maxPoints, reasons };
}

function hasPreview(song: Song): boolean {
  return Boolean(song.media.previewUrl || song.media.audioUrl);
}

/** Tie-break order: higher %, then songs you can listen to, then title A–Z, then id. */
export function compareResults(a: MatchResult, b: MatchResult): number {
  return (
    b.percent - a.percent ||
    b.points - a.points ||
    Number(hasPreview(b.song)) - Number(hasPreview(a.song)) ||
    compareText(a.song.title, b.song.title) ||
    a.song.id - b.song.id
  );
}

/** Rank every song. `considered` = songs left after hard filters. */
export function rankSongs(songs: readonly Song[], answers: MatchAnswers, limit = 12): { results: MatchResult[]; considered: number } {
  const scored: MatchResult[] = [];
  for (const s of songs) {
    const r = scoreSong(s, answers);
    if (r) scored.push(r);
  }
  scored.sort(compareResults);
  return { results: scored.slice(0, Math.max(0, limit)), considered: scored.length };
}

/** A friendly headline for a match percentage. */
export function matchHeadline(percent: number): string {
  if (percent >= 95) return 'Perfect match';
  if (percent >= 80) return 'Great match';
  if (percent >= 60) return 'Good match';
  if (percent >= 40) return 'Worth a listen';
  return 'Wild card';
}

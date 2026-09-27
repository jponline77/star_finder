import { describe, expect, it } from 'vitest';
import { makeSong, part } from '../../test/fixtures';
import { answersFromParams, answersToParams, countAnswered, firstUnanswered, freshAnswers, isStepAnswered } from './answers';
import { compareResults, matchHeadline, rangeFit, rankSongs, scoreSong, voiceFit, WEIGHTS, type MatchAnswers } from './score';

const answers = (o: Partial<MatchAnswers> = {}): MatchAnswers => ({ ...freshAnswers(), ...o });

const popular = makeSong({ id: 1, title: 'Popular', kind: 'solo', genre: 'Comedy', subGenre: 'Satire', lengthSeconds: 140, parts: [part('Glinda', 'Soprano')] });
const stars = makeSong({ id: 2, title: 'Stars', kind: 'solo', genre: 'Drama', subGenre: 'Power', lengthSeconds: 200, parts: [part('Javert', 'Baritone')] });
const heart = makeSong({
  id: 3,
  title: 'A Heart Full of Love',
  kind: 'duet',
  genre: 'Romantic',
  subGenre: 'In Love',
  lengthSeconds: 170,
  parts: [part('Cosette', 'Soprano', 1), part('Marius', 'Tenor', 2)],
});
const epiphany = makeSong({ id: 4, title: 'Epiphany', kind: 'solo', genre: 'Drama', subGenre: 'Intimidating / Angry', mature: true, lengthSeconds: 400, parts: [part('Sweeney', 'Baritone')] });
const mystery = makeSong({ id: 5, title: 'Mystery', kind: 'solo', genre: null, subGenre: null, lengthSeconds: null, parts: [part('Someone', null)] });
const songs = [popular, stars, heart, epiphany, mystery];

describe('rangeFit', () => {
  it('rewards exact matches most, then neighbours in the same family', () => {
    expect(rangeFit('Soprano', 'Soprano')).toBe(1);
    expect(rangeFit('Soprano', 'mezzo')).toBe(0.5);
    expect(rangeFit('Alto', 'Tenor')).toBe(0.3); // neighbours across treble/bass
    expect(rangeFit('Soprano', 'Alto')).toBe(0.15);
    expect(rangeFit('Soprano', 'Bass')).toBe(0);
    expect(rangeFit('Tenor', null)).toBe(0.25);
  });
});

describe('voiceFit', () => {
  it('ignores the voice question when both answers are "any"', () => {
    expect(voiceFit(popular, answers({ range: 'any' }))).toBeNull();
    expect(voiceFit(popular, answers({ range: null }))).toBeNull();
  });
  it('matches a solo singer against either duet part', () => {
    expect(voiceFit(heart, answers({ kind: 'any', range: 'Tenor' }))?.fit).toBe(1);
    expect(voiceFit(heart, answers({ kind: 'solo', range: 'Soprano' }))?.fit).toBe(1);
  });
  it('tries both assignments for a duet with a partner voice', () => {
    const v = voiceFit(heart, answers({ kind: 'duet', range: 'Tenor', partner: 'Soprano' }));
    expect(v?.fit).toBeCloseTo(1);
    expect(v?.mine).toBe('Tenor');
    expect(v?.theirs).toBe('Soprano');
    const worse = voiceFit(heart, answers({ kind: 'duet', range: 'Tenor', partner: 'Bass' }));
    expect(worse!.fit).toBeLessThan(1);
    expect(worse!.fit).toBeCloseTo(0.6);
  });
  it('uses the partner voice alone when yours is "any"', () => {
    expect(voiceFit(heart, answers({ kind: 'duet', range: 'any', partner: 'Tenor' }))?.fit).toBe(1);
  });
});

describe('scoreSong', () => {
  it('gives 100% when everything fits, with reasons for each answered question', () => {
    const r = scoreSong(popular, answers({ kind: 'solo', range: 'Soprano', genres: ['Comedy'], moods: ['Satire'], length: 'short', mature: 'no' }))!;
    expect(r.percent).toBe(100);
    expect(r.maxPoints).toBe(WEIGHTS.kind + WEIGHTS.range + WEIGHTS.genre + WEIGHTS.mood + WEIGHTS.length);
    expect(r.reasons.map((x) => x.id)).toEqual(['kind', 'range', 'genre', 'mood', 'length']);
    expect(r.reasons.every((x) => x.tone === 'strong')).toBe(true);
    expect(r.reasons.find((x) => x.id === 'range')?.label).toBe('Written for Soprano');
  });

  it('treats mature "no" as a hard filter', () => {
    expect(scoreSong(epiphany, answers({ mature: 'no' }))).toBeNull();
    expect(scoreSong(epiphany, answers({ mature: 'ok' }))).not.toBeNull();
  });

  it('only counts answered questions (unanswered = no preference)', () => {
    const r = scoreSong(stars, answers({ range: 'Baritone' }))!;
    expect(r.maxPoints).toBe(WEIGHTS.range);
    expect(r.percent).toBe(100);
    expect(scoreSong(stars, answers())!.percent).toBe(100);
  });

  it('penalises the wrong kind but keeps the song (with an honest "miss" chip)', () => {
    const r = scoreSong(heart, answers({ kind: 'solo', range: 'Tenor' }))!;
    expect(r.percent).toBe(Math.round((100 * WEIGHTS.range) / (WEIGHTS.kind + WEIGHTS.range)));
    expect(r.reasons[0]).toMatchObject({ id: 'kind', tone: 'miss' });
  });

  it('scores length fit: perfect, a little long, over the limit, unknown', () => {
    expect(scoreSong(popular, answers({ length: 'short' }))!.percent).toBe(100);
    expect(scoreSong(heart, answers({ length: 'short' }))!.percent).toBe(50); // 2:50 is within the soft zone
    expect(scoreSong(stars, answers({ length: 'short' }))!.percent).toBe(0);
    const over = scoreSong(epiphany, answers({ length: 'max' }))!;
    expect(over.percent).toBe(0);
    expect(over.reasons[0]?.label).toMatch(/needs a cut/);
    expect(scoreSong(mystery, answers({ length: 'medium' }))!.reasons[0]?.label).toBe('Length unknown');
  });

  it('matches genres and moods case-insensitively', () => {
    const r = scoreSong(heart, answers({ genres: ['romantic'], moods: ['in love'] }))!;
    expect(r.percent).toBe(100);
    expect(r.reasons.map((x) => x.label)).toEqual(['Romantic', 'In Love mood']);
  });

  it('labels close and unknown voice fits', () => {
    expect(scoreSong(popular, answers({ range: 'Mezzo-soprano' }))!.reasons[0]?.label).toBe('Close to your range (Soprano)');
    expect(scoreSong(mystery, answers({ range: 'Tenor' }))!.reasons[0]?.label).toBe('Voice type not listed');
    expect(scoreSong(stars, answers({ range: 'Soprano' }))!.reasons[0]?.tone).toBe('miss');
  });
});

describe('rankSongs', () => {
  it('ranks best matches first and reports how many songs were considered', () => {
    const { results, considered } = rankSongs(songs, answers({ kind: 'solo', range: 'Baritone', genres: ['Drama'], mature: 'no' }), 3);
    expect(considered).toBe(4); // Epiphany filtered out
    expect(results).toHaveLength(3);
    expect(results[0]?.song.title).toBe('Stars');
    expect(results[0]?.percent).toBe(100);
  });

  it('breaks ties by preview availability, then title', () => {
    const a = makeSong({ id: 10, title: 'Beta' });
    const b = makeSong({ id: 11, title: 'Alpha' });
    const c = makeSong({ id: 12, title: 'Zeta', media: { ...a.media, previewUrl: 'https://audio-ssl.itunes.apple.com/x.m4a' } });
    const { results } = rankSongs([a, b, c], answers());
    expect(results.map((r) => r.song.title)).toEqual(['Zeta', 'Alpha', 'Beta']);
    expect(compareResults(results[0]!, results[1]!)).toBeLessThan(0);
  });

  it('never returns more than the limit', () => {
    expect(rankSongs(songs, answers(), 2).results).toHaveLength(2);
    expect(rankSongs(songs, answers(), 0).results).toHaveLength(0);
  });
});

describe('matchHeadline', () => {
  it('has a friendly label per band', () => {
    expect(matchHeadline(100)).toBe('Perfect match');
    expect(matchHeadline(85)).toBe('Great match');
    expect(matchHeadline(65)).toBe('Good match');
    expect(matchHeadline(45)).toBe('Worth a listen');
    expect(matchHeadline(10)).toBe('Wild card');
  });
});

describe('answers <-> URL', () => {
  it('round-trips every answer', () => {
    const a = answers({ kind: 'duet', range: 'Tenor', partner: 'any', genres: ['Comedy', 'Drama'], moods: ['Satire'], length: 'medium', mature: 'no' });
    const params = answersToParams(a, 'results');
    expect(params.toString()).toBe('kind=duet&range=Tenor&partner=any&genre=Comedy%2CDrama&mood=Satire&len=medium&mature=no&step=results');
    expect(answersFromParams(params)).toEqual({ answers: a, step: 'results' });
  });

  it('encodes "anything goes" genres as genre=any and drops the partner for non-duets', () => {
    const params = answersToParams(answers({ kind: 'solo', range: 'any', partner: 'Bass', genres: [] }), 3);
    expect(params.get('genre')).toBe('any');
    expect(params.get('partner')).toBeNull();
    expect(params.get('step')).toBe('3');
    expect(answersFromParams(params).answers.genres).toEqual([]);
  });

  it('normalises and ignores junk', () => {
    const { answers: a, step } = answersFromParams('kind=trio&range=mezzo&len=forever&mature=maybe&step=9&genre=');
    expect(a.kind).toBeNull();
    expect(a.range).toBe('Mezzo-soprano');
    expect(a.length).toBeNull();
    expect(a.mature).toBeNull();
    expect(a.genres).toEqual([]);
    expect(step).toBe(1);
  });

  it('keeps unrelated params and omits step 1', () => {
    expect(answersToParams(answers({ kind: 'solo' }), 1, 'utm=x&step=4').toString()).toBe('utm=x&kind=solo');
  });

  it('tracks which steps are answered', () => {
    const a = answers({ kind: 'solo', range: 'Alto' });
    expect(isStepAnswered(a, 0)).toBe(true);
    expect(isStepAnswered(a, 2)).toBe(false);
    expect(firstUnanswered(a)).toBe(2);
    expect(countAnswered(a)).toBe(2);
    expect(firstUnanswered(answers({ kind: 'any', range: 'any', genres: [], length: 'max', mature: 'ok' }))).toBe(5);
  });
});

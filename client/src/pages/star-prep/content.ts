/**
 * STAR Prep copy + facts (SPEC §1 — 2026 Regional STAR Fest Program Guide). Plain data, no React.
 */
import { RUBRIC_CATEGORIES } from '../../lib/vocab';

export type RubricCategory = (typeof RUBRIC_CATEGORIES)[number];

/** What an "Advanced" (4) performance looks like, in teen-friendly words (our own paraphrase). */
export const RUBRIC_DETAILS: Record<RubricCategory, { emoji: string; advanced: string }> = {
  Expression: {
    emoji: '😮',
    advanced: 'Your face, voice and body show exactly what the character feels, and the feelings change as the song goes.',
  },
  Characterization: {
    emoji: '🎭',
    advanced: 'We believe you ARE the character. You know who they are, what they want and why they’re singing, from start to finish.',
  },
  'Staging/Choreography': {
    emoji: '🕺',
    advanced: 'Every move has a reason. You use the space (and your chair or table) on purpose instead of wandering.',
  },
  'Singing Technique': {
    emoji: '🎶',
    advanced: 'Solid pitch, breath support and clear words. Your tone stays strong and healthy, even on the big notes.',
  },
  Transitions: {
    emoji: '🔀',
    advanced: 'You move smoothly from the slate into the song, between sections, and out to “Thank you.” with no awkward resets.',
  },
  Execution: {
    emoji: '✅',
    advanced: 'Polished and prepared: lyrics memorized, track ready, timing tight, and you recover from any slip like a pro.',
  },
};

export const RUBRIC_LEVEL_BLURB: Record<number, string> = {
  4: 'Consistently strong and polished',
  3: 'Solid, with a few rough spots',
  2: 'Getting there, but not consistent yet',
  1: 'Just starting out, so keep building',
};

/** Approved publishers / licensors named in the program guide. */
export const APPROVED_LICENSORS: readonly string[] = [
  'Music Theatre International (MTI)',
  'Rodgers & Hammerstein',
  'Tams-Witmark',
  'Concord Theatricals / Samuel French (some playwright exclusions)',
  'Theatrical Rights Worldwide (TRW) — request the free festival licence',
  'Dramatic Publishing (listed titles only)',
  'Pioneer Drama',
  'Playscripts',
  'Dramatists Play Service',
  'Eldridge',
  'Heuer',
  'CPA Theatricals',
  'Stage Partners',
  'Uproar Theatrics',
  'YouthPLAYS',
  'Theatrefolk',
  'Playwrights Guild of Canada',
  'Public domain',
];

export const SLATE_EXAMPLES = {
  solo: 'I am Heather Black from Canada Junior High School, Troupe #1000, and I’ll be performing “Popular” from Wicked by Stephen Schwartz.',
  duet: 'Our names are Lee Jones and Sam Becker from True North High School, Troupe #999, and we’ll be performing “Anything You Can Do (I Can Do Better)” from Annie Get Your Gun by Irving Berlin and Dorothy and Herbert Fields.',
} as const;

/**
 * STAR slate builder (SPEC §1). The slate is spoken before the song; timing starts after it.
 *
 * Solo: I am Heather Black from Canada Junior High School, Troupe #1000, and I'll be performing
 *       "Popular" from Wicked by Stephen Schwartz.
 * Duet: Our names are Lee Jones and Sam Becker from True North High School, Troupe #999, and we'll
 *       be performing "…" from … by … .
 *
 * The program guide writes the troupe as "(Troupe #1000,)" — the parentheses mean "optional", so
 * we include "Troupe #…," only when a troupe number is given, without the parentheses.
 */
import type { Kind } from '../types';

export interface SlateInput {
  kind: Kind;
  /** performer names: 1 for a solo, 2 for a duet (extra/missing names are handled gracefully) */
  names: readonly string[];
  school?: string | null;
  /** "1000", "#1000" or "Troupe 1000" are all fine */
  troupe?: string | number | null;
  title?: string | null;
  show?: string | null;
  composer?: string | null;
  lyricist?: string | null;
  /** When true (default), missing names/school/title/show become bracketed placeholders. */
  placeholders?: boolean;
}

export interface SlateResult {
  /** The slate sentence to say before the song. */
  slate: string;
  /** What to say at the very end. */
  closing: string;
  /** Friendly instruction line: 'Perform your song, then finish with "Thank you."' */
  instruction: string;
  /** slate + blank line + instruction — handy for a copy button. */
  text: string;
  /** "Stephen Schwartz" / "Richard Rodgers and Oscar Hammerstein II" / '' when unknown */
  credits: string;
}

export const SLATE_CLOSING = 'Thank you.';
export const SLATE_INSTRUCTION = 'Perform your song, then finish with “Thank you.”';

const clean = (v: string | number | null | undefined): string => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim();

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const sameName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' }) === 0 || fold(a) === fold(b);

/** "Jr.", "Sr.", "II"… — a suffix that belongs to the name before it ("Harry Connick, Jr."). */
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;

/**
 * The individual writers in one credit field: parenthetical notes are dropped ("(SpitLip)",
 * "(additional music by …)") and the rest is split on commas, "&" and "and".
 *   "Trey Parker, Robert Lopez & Matt Stone" → ["Trey Parker", "Robert Lopez", "Matt Stone"]
 */
export function creditNames(credit?: string | null): string[] {
  const text = clean(credit)
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .trim();
  if (!text) return [];
  const names: string[] = [];
  for (const piece of text.split(/\s*(?:,|&|\+|\band\b)\s*/)) {
    const name = piece.trim();
    if (!name) continue;
    if (NAME_SUFFIX.test(name) && names.length) names[names.length - 1] = `${names[names.length - 1]}, ${name}`;
    else names.push(name);
  }
  return names;
}

/**
 * Credits for "… by X": every writer named once (composer first), ignoring case and accents,
 * joined naturally — "Stephen Schwartz", "Richard Rodgers and Oscar Hammerstein II",
 * "Trey Parker, Robert Lopez and Matt Stone". '' when unknown, or when the score is credited to
 * "Various" (e.g. a show built from period songs), since there's no one to name.
 */
export function slateCredits(composer?: string | null, lyricist?: string | null): string {
  const all = [...creditNames(composer), ...creditNames(lyricist)];
  if (all.some((n) => fold(n) === 'various')) return '';
  const unique: string[] = [];
  for (const name of all) if (!unique.some((u) => sameName(u, name))) unique.push(name);
  return joinNames(unique);
}

/** "1000" from "#1000", "Troupe #1000", " 1000 "; '' when empty. Non-numeric text is kept trimmed. */
export function normalizeTroupe(troupe: string | number | null | undefined): string {
  const t = clean(troupe)
    .replace(/^troupe\s*/i, '')
    .replace(/^(no\.?|number)\s*/i, '')
    .replace(/^#\s*/, '')
    .trim();
  return t;
}

/** Join names: "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  const list = names.map(clean).filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** Ensure the sentence ends with exactly one terminal punctuation mark. */
function endSentence(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

export function buildSlate(input: SlateInput): SlateResult {
  const usePlaceholders = input.placeholders !== false;
  const isDuet = input.kind === 'duet';
  const rawNames = input.names.map(clean);
  const wanted = isDuet ? 2 : 1;
  const names: string[] = [];
  for (let i = 0; i < Math.max(wanted, rawNames.filter(Boolean).length); i++) {
    const n = rawNames[i] ?? '';
    if (n) names.push(n);
    else if (usePlaceholders && i < wanted) names.push(isDuet ? `[Name ${i + 1}]` : '[Your name]');
  }
  const who = joinNames(names);
  const school = clean(input.school) || (usePlaceholders ? '[Your school]' : '');
  const troupe = normalizeTroupe(input.troupe);
  const title = clean(input.title) || (usePlaceholders ? '[Song title]' : '');
  const show = clean(input.show) || (usePlaceholders ? '[Show]' : '');
  const credits = slateCredits(input.composer, input.lyricist);

  let s = isDuet ? `Our names are ${who}` : `I am ${who}`;
  if (school) s += ` from ${school}`;
  s += ',';
  if (troupe) s += ` Troupe #${troupe},`;
  s += isDuet ? " and we'll be performing" : " and I'll be performing";
  if (title) s += ` "${title}"`;
  if (show) s += ` from ${show}`;
  if (credits) s += ` by ${credits}`;
  const slate = endSentence(s.replace(/\s+/g, ' ').trim());
  return {
    slate,
    closing: SLATE_CLOSING,
    instruction: SLATE_INSTRUCTION,
    text: `${slate}\n\n${SLATE_INSTRUCTION}`,
    credits,
  };
}

// ---------------------------------------------------------------- performer details (Slate Builder)
/**
 * Students type real names, school and troupe here, often on shared lab computers. So by default
 * the details live only in this tab (sessionStorage, gone when it closes). They're kept on the
 * device (localStorage) only when the student ticks "Remember on this device", and logout forgets
 * them either way.
 */
export interface SlateDetails {
  name1: string;
  name2: string;
  school: string;
  troupe: string;
}

export const EMPTY_SLATE_DETAILS: SlateDetails = { name1: '', name2: '', school: '', troupe: '' };

const SLATE_SESSION_KEY = 'star.slate.session.v1';
const SLATE_REMEMBER_KEY = 'star.slate.remembered.v1';
/** Older builds kept the details in localStorage under this key without asking. */
const SLATE_LEGACY_KEY = 'star.slate.v1';

function slateStore(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function parseDetails(raw: string | null | undefined): SlateDetails | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof SlateDetails, unknown>> | null;
    if (!v || typeof v !== 'object') return null;
    const str = (x: unknown) => (typeof x === 'string' ? x : '');
    return { name1: str(v.name1), name2: str(v.name2), school: str(v.school), troupe: str(v.troupe) };
  } catch {
    return null;
  }
}

/** This tab's details, else the remembered ones. `remembered` = the student opted in on this device. */
export function loadSlateDetails(): { details: SlateDetails; remembered: boolean } {
  const local = slateStore('local');
  const session = slateStore('session');
  try {
    local?.removeItem(SLATE_LEGACY_KEY);
  } catch {
    /* ignore */
  }
  let remembered: SlateDetails | null = null;
  let current: SlateDetails | null = null;
  try {
    remembered = parseDetails(local?.getItem(SLATE_REMEMBER_KEY));
    current = parseDetails(session?.getItem(SLATE_SESSION_KEY));
  } catch {
    /* ignore */
  }
  return { details: current ?? remembered ?? EMPTY_SLATE_DETAILS, remembered: remembered !== null };
}

/** Keep the details for this tab, and on the device too when `remember` is true. */
export function saveSlateDetails(details: SlateDetails, remember: boolean): void {
  try {
    slateStore('session')?.setItem(SLATE_SESSION_KEY, JSON.stringify(details));
  } catch {
    /* ignore */
  }
  try {
    const local = slateStore('local');
    if (remember) local?.setItem(SLATE_REMEMBER_KEY, JSON.stringify(details));
    else local?.removeItem(SLATE_REMEMBER_KEY);
  } catch {
    /* ignore */
  }
}

/** Forget the performer details everywhere (the "Clear" button and logout). */
export function forgetSlateDetails(): void {
  for (const [kind, key] of [
    ['session', SLATE_SESSION_KEY],
    ['local', SLATE_REMEMBER_KEY],
    ['local', SLATE_LEGACY_KEY],
  ] as const) {
    try {
      slateStore(kind)?.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

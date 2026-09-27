/**
 * Festival helpers (SPEC §7b) — pure, no React, all unit-tested.
 *
 *  - grouping / sorting for pickers (BC regionals by date with TBD last, then Online; nationals)
 *  - date text: single day, ranges ("May 20–23, 2027"), cross-month / cross-year, deadlines, TBD
 *  - phase (upcoming / today / ongoing / over / tbd) and the countdown target
 *  - selection priority (url → account → local → default → none)
 *  - localStorage + share-link helpers, admin form validation
 *
 * Every 'YYYY-MM-DD' is a LOCAL calendar day (see `parseLocalDate`), never UTC midnight — so a
 * festival on Dec 11 reads "Dec 11" in Vancouver, Halifax or Tokyo alike.
 */
import type { Festival, FestivalInput, FestivalKind } from '../types';
import { daysUntil, parseLocalDate } from './format';
import { isHttpsUrl } from './links';

/** localStorage key holding the visitor's festival slug. */
export const FESTIVAL_STORAGE_KEY = 'star.festival';
/** Query parameter a share link uses: `/?festival=surrey`. */
export const FESTIVAL_PARAM = 'festival';

/** Where the current selection came from. */
export type FestivalSource = 'url' | 'account' | 'local' | 'default' | 'none';
/** Where a festival is in time, relative to "now". */
export type FestivalPhase = 'upcoming' | 'today' | 'ongoing' | 'over' | 'tbd';
export type MonthStyle = 'long' | 'short';

export const FESTIVAL_KINDS: readonly FestivalKind[] = ['regional', 'online', 'national'];
export const FESTIVAL_KIND_LABEL: Record<FestivalKind, string> = { regional: 'Regional', online: 'Online', national: 'National' };
export const FESTIVAL_KIND_EMOJI: Record<FestivalKind, string> = { regional: '📍', online: '💻', national: '🏆' };

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

interface Ymd {
  y: number;
  /** 0-based month */
  m: number;
  d: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toYmd(value: string | null | undefined): Ymd | null {
  if (typeof value !== 'string') return null;
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const month = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1000 || month < 1 || month > 12 || d < 1) return null;
  // Days in that month, computed in UTC so the local time zone can't shift it.
  const daysInMonth = new Date(Date.UTC(y, month, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return { y, m: month - 1, d };
}

/** True for a real 'YYYY-MM-DD' calendar date ('2027-02-29' → false, '2028-02-29' → true). */
export function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && toYmd(value) !== null;
}

/** Weekday of a calendar date, independent of the local time zone (UTC arithmetic). */
function weekdayOf({ y, m, d }: Ymd): number {
  return new Date(Date.UTC(y, m, d)).getUTCDay();
}

/** 'Friday, December 11, 2026' / 'Dec 11, 2026' / 'Fri, Dec 11, 2026' (no year: 'December 11'). */
export function formatDay(value: string, options: { month?: MonthStyle; weekday?: boolean; year?: boolean } = {}): string {
  const p = toYmd(value);
  if (!p) return '';
  const { month = 'long', weekday = false, year = true } = options;
  const names = month === 'short' ? MONTHS_SHORT : MONTHS_LONG;
  const day = `${names[p.m]} ${p.d}${year ? `, ${p.y}` : ''}`;
  if (!weekday) return day;
  const w = weekdayOf(p);
  return `${(month === 'short' ? WEEKDAYS_SHORT : WEEKDAYS_LONG)[w]}, ${day}`;
}

/**
 * A day or a range of days:
 *   single                  → 'December 11, 2026'
 *   same month              → 'May 20–23, 2027'
 *   same year, other month  → 'April 30 – May 2, 2027'
 *   across years            → 'December 30, 2026 – January 2, 2027'
 * An end before (or equal to) the start is ignored. Invalid start → ''.
 */
export function formatDateRange(start: string, end?: string | null, month: MonthStyle = 'long'): string {
  const a = toYmd(start);
  if (!a) return '';
  const b = end && end > start ? toYmd(end) : null;
  const names = month === 'short' ? MONTHS_SHORT : MONTHS_LONG;
  if (!b) return `${names[a.m]} ${a.d}, ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${names[a.m]} ${a.d}–${b.d}, ${a.y}`;
  if (a.y === b.y) return `${names[a.m]} ${a.d} – ${names[b.m]} ${b.d}, ${a.y}`;
  return `${names[a.m]} ${a.d}, ${a.y} – ${names[b.m]} ${b.d}, ${b.y}`;
}

type DatedFestival = Pick<Festival, 'kind' | 'startDate' | 'endDate' | 'dateLabel'>;
/** Dates plus (when known) the kind: an ONLINE festival's endDate is its submission deadline. */
type TimedFestival = Pick<Festival, 'startDate' | 'endDate'> & Partial<Pick<Festival, 'kind'>>;

function validStart(f: Pick<Festival, 'startDate'>): string | null {
  return isValidDateString(f.startDate) ? f.startDate : null;
}
function validEnd(f: Pick<Festival, 'endDate'>): string | null {
  return isValidDateString(f.endDate) ? f.endDate : null;
}

/** Has a start date or at least a deadline (i.e. not "to be announced"). */
export function hasFestivalDate(f: Pick<Festival, 'startDate' | 'endDate'>): boolean {
  return validStart(f) !== null || validEnd(f) !== null;
}

/**
 * The end date is a submission deadline, not the last day of performances: an ONLINE festival with
 * an end date (its start date, if any, is the day entries open — SPEC §7b), or any festival that
 * only has an end date.
 */
export function isDeadlineFestival(f: TimedFestival): boolean {
  if (validEnd(f) === null) return false;
  return f.kind === 'online' || validStart(f) === null;
}

/** An online festival whose entries haven't opened yet → the opening day ('YYYY-MM-DD'); else null. */
export function entriesOpenOn(f: TimedFestival, now: Date = new Date()): string | null {
  const start = validStart(f);
  return f.kind === 'online' && start !== null && daysUntil(start, now) > 0 ? start : null;
}

/** Online with an opening day but no deadline yet: counts to the day entries open, then "open now". */
export function isOpeningOnly(f: TimedFestival): boolean {
  return f.kind === 'online' && validStart(f) !== null && validEnd(f) === null;
}

/** Multi-day: a valid end date after the start date. */
export function isMultiDay(f: Pick<Festival, 'startDate' | 'endDate'>): boolean {
  const s = validStart(f);
  const e = validEnd(f);
  return s !== null && e !== null && e > s;
}

/**
 * The festival's date as text:
 *   in person  → 'December 11, 2026' · 'May 20–23, 2027' (weekday: 'Friday, December 11, 2026')
 *   deadline   → long: its dateLabel, else 'Submissions close February 28, 2027'; short: 'Closes Feb 28, 2027'
 *                (online festivals, even with an opening day — see `entriesOpenOn`)
 *   TBD        → its dateLabel, else 'Date to be announced'
 */
export function formatFestivalDate(f: DatedFestival, options: { month?: MonthStyle; weekday?: boolean } = {}): string {
  const { month = 'long', weekday = false } = options;
  const start = validStart(f);
  const end = validEnd(f);
  if (end && isDeadlineFestival(f)) {
    if (month === 'short') return `Closes ${formatDay(end, { month: 'short' })}`;
    return f.dateLabel?.trim() || `Submissions close ${formatDay(end, { month: 'long', weekday })}`;
  }
  if (start) {
    if (!isMultiDay(f) && weekday) return formatDay(start, { month, weekday: true });
    return formatDateRange(start, end, month);
  }
  return f.dateLabel?.trim() || 'Date to be announced';
}

/** For calendar tiles: '2026-12-11' → { month: 'Dec', day: 11, year: 2026 } (null if not a real date). */
export function calendarParts(value: string | null | undefined): { month: string; day: number; year: number } | null {
  const p = toYmd(value);
  return p ? { month: MONTHS_SHORT[p.m] ?? '', day: p.d, year: p.y } : null;
}

/** Tiny date for chips (no year): 'Nov 20' · 'May 20–23' · 'Apr 30 – May 2' · 'Closes Feb 28' · 'Date TBA'. */
export function festivalChipDate(f: TimedFestival): string {
  const a = toYmd(validStart(f));
  const end = validEnd(f);
  if (a && !isDeadlineFestival(f)) {
    const b = isMultiDay(f) ? toYmd(end) : null;
    if (!b) return `${MONTHS_SHORT[a.m]} ${a.d}`;
    return a.m === b.m && a.y === b.y ? `${MONTHS_SHORT[a.m]} ${a.d}–${b.d}` : `${MONTHS_SHORT[a.m]} ${a.d} – ${MONTHS_SHORT[b.m]} ${b.d}`;
  }
  const e = toYmd(end);
  return e ? `Closes ${MONTHS_SHORT[e.m]} ${e.d}` : 'Date TBA';
}

/** The dateLabel when it should appear ALONGSIDE real dates (in-person festivals with a note). */
export function festivalDateNote(f: DatedFestival): string | null {
  const note = f.dateLabel?.trim();
  return note && validStart(f) && !isDeadlineFestival(f) ? note : null;
}

/** The day a calendar tile shows: the deadline for a deadline festival, else the first day. */
export function festivalTileDate(f: TimedFestival): string | null {
  return isDeadlineFestival(f) ? validEnd(f) : (validStart(f) ?? validEnd(f));
}

/**
 * Where the festival is in time (local calendar days):
 *   in person:    upcoming → today (first day) → ongoing (later days of a multi-day run) → over
 *   deadline:     upcoming → today (closes today) → over   (online: whatever its opening day)
 *   opening only: upcoming → today (opens today) → ongoing (open, deadline not announced)
 *   no dates:     tbd
 */
export function festivalPhaseOf(f: TimedFestival, now: Date = new Date()): FestivalPhase {
  const start = validStart(f);
  const end = validEnd(f);
  if (end && isDeadlineFestival(f)) {
    const d = daysUntil(end, now);
    return d > 0 ? 'upcoming' : d === 0 ? 'today' : 'over';
  }
  if (start) {
    const toStart = daysUntil(start, now);
    if (toStart > 0) return 'upcoming';
    if (toStart === 0) return 'today';
    if (isOpeningOnly(f)) return 'ongoing';
    const last = end && end > start ? end : start;
    return daysUntil(last, now) >= 0 ? 'ongoing' : 'over';
  }
  return 'tbd';
}

export interface CountdownTarget {
  /** 'start' = curtain up (local midnight of the first day); 'deadline' = end of the closing day. */
  kind: 'start' | 'deadline';
  /** 'YYYY-MM-DD' */
  date: string;
  at: Date;
}

/**
 * What to count down to: the end of the deadline day for a deadline festival (online), else the
 * start date (an online festival without a deadline: the day entries open); null if TBD.
 */
export function countdownTarget(f: TimedFestival): CountdownTarget | null {
  const endDate = validEnd(f);
  const end = toYmd(endDate);
  if (endDate && end && isDeadlineFestival(f)) return { kind: 'deadline', date: endDate, at: new Date(end.y, end.m, end.d + 1) };
  const start = validStart(f);
  if (start) return { kind: 'start', date: start, at: parseLocalDate(start) };
  return null;
}

export interface FestivalStatus {
  phase: FestivalPhase;
  /** 'In 12 days' · 'Tomorrow' · 'Today!' · 'On now!' · 'Closes in 3 days' · 'Opens in 5 days' · 'Wrapped' · 'Closed' · 'Date TBA' */
  label: string;
  /** For styling: soon = within 30 days. */
  state: 'past' | 'today' | 'soon' | 'later' | 'tbd';
  /** Whole days until the start (or deadline); null when TBD. */
  days: number | null;
}

/** A short status pill for lists. */
export function festivalStatus(f: TimedFestival, now: Date = new Date()): FestivalStatus {
  const phase = festivalPhaseOf(f, now);
  const deadline = isDeadlineFestival(f);
  const opening = isOpeningOnly(f);
  const target = deadline ? validEnd(f) : (validStart(f) ?? validEnd(f));
  const days = target ? daysUntil(target, now) : null;
  switch (phase) {
    case 'tbd':
      return { phase, label: 'Date TBA', state: 'tbd', days };
    case 'over':
      return { phase, label: deadline ? 'Closed' : 'Wrapped', state: 'past', days };
    case 'ongoing':
      return { phase, label: opening ? 'Open now!' : 'On now!', state: 'today', days };
    case 'today':
      return { phase, label: deadline ? 'Closes today!' : opening ? 'Opens today!' : 'Today!', state: 'today', days };
    default: {
      const n = days ?? 0;
      const [one, many] = deadline ? ['Closes tomorrow', `Closes in ${n} days`] : opening ? ['Opens tomorrow', `Opens in ${n} days`] : ['Tomorrow', `In ${n} days`];
      return { phase, label: n === 1 ? one : many, state: n <= 30 ? 'soon' : 'later', days };
    }
  }
}

/** National festivals that haven't wrapped yet (for "Next stop: …" after a regional). */
export function upcomingNationals(list: readonly Festival[], now: Date = new Date()): Festival[] {
  return list.filter((f) => f.kind === 'national' && festivalPhaseOf(f, now) !== 'over');
}

// ---------------------------------------------------------------------------
// Names, sorting, grouping
// ---------------------------------------------------------------------------

/** 'Surrey Regional STAR Fest' → 'Surrey' · 'Online Regional STAR Fest' → 'Online' · 'STAR Fest West (National)' → 'STAR Fest West'. */
export function festivalShortName(f: Pick<Festival, 'name' | 'city'>): string {
  const name = f.name.trim();
  const short = name
    .replace(/\s*\((regional|national|online)\)\s*$/i, '')
    .replace(/\s+(regional\s+)?star\s+fest(ival)?$/i, '')
    .trim();
  return short || f.city?.trim() || name;
}

/** Regional or online, and active: something a student can pick as "their" festival. */
export function isChoosable(f: Pick<Festival, 'kind' | 'active'>): boolean {
  return f.active && (f.kind === 'regional' || f.kind === 'online');
}

/** Date order (start date, else deadline), festivals without a date last, then sortOrder, then name. */
export function compareFestivals(a: Festival, b: Festival): number {
  const ka = validStart(a) ?? validEnd(a);
  const kb = validStart(b) ?? validEnd(b);
  if (ka && !kb) return -1;
  if (!ka && kb) return 1;
  if (ka && kb && ka !== kb) return ka < kb ? -1 : 1;
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id - b.id;
}

export interface FestivalGroups {
  regional: Festival[];
  online: Festival[];
  national: Festival[];
}

/** Split by kind, each in date order (TBD last). Inactive festivals are dropped unless asked for. */
export function groupFestivals(list: readonly Festival[], options: { includeInactive?: boolean } = {}): FestivalGroups {
  const groups: FestivalGroups = { regional: [], online: [], national: [] };
  for (const f of list) {
    if (!f.active && !options.includeInactive) continue;
    groups[f.kind]?.push(f);
  }
  groups.regional.sort(compareFestivals);
  groups.online.sort(compareFestivals);
  groups.national.sort(compareFestivals);
  return groups;
}

/** What the pickers offer: active regionals (date order, TBD last), then online ones. */
export function regionalChoices(list: readonly Festival[]): Festival[] {
  const g = groupFestivals(list);
  return [...g.regional, ...g.online];
}

/** Active national festivals, in date order. */
export function nationalFestivals(list: readonly Festival[]): Festival[] {
  return groupFestivals(list).national;
}

export interface PickerGroup {
  id: 'regional' | 'online';
  /** 'BC regional festivals' (or 'Regional festivals' once there are non-BC ones) · 'Online' */
  label: string;
  festivals: Festival[];
}

/** Non-empty option groups for a picker. */
export function pickerGroups(list: readonly Festival[]): PickerGroup[] {
  const g = groupFestivals(list);
  const out: PickerGroup[] = [];
  if (g.regional.length) {
    const allBc = g.regional.every((f) => (f.province ?? '').trim().toUpperCase() === 'BC');
    out.push({ id: 'regional', label: allBc ? 'BC regional festivals' : 'Regional festivals', festivals: g.regional });
  }
  if (g.online.length) out.push({ id: 'online', label: 'Online', festivals: g.online });
  return out;
}

/** '2026–27' for a season spanning two years, '2027' for one, null without dates. */
export function festivalSeason(list: readonly Festival[]): string | null {
  const years = list
    .filter((f) => f.active && f.kind !== 'national')
    .map((f) => toYmd(validStart(f) ?? validEnd(f))?.y)
    .filter((y): y is number => typeof y === 'number');
  if (!years.length) return null;
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}–${String(max).slice(-2)}`;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Lower-cases/trims a slug from a URL or storage; null when it can't be a slug at all. */
export function normalizeFestivalSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  return s && s.length <= 80 && SLUG_RE.test(s) ? s : null;
}

/** The ACTIVE regional/online festival with this slug, if any. */
export function findChoosable(list: readonly Festival[], slug: unknown): Festival | undefined {
  const s = normalizeFestivalSlug(slug);
  if (!s) return undefined;
  return list.find((f) => f.slug === s && isChoosable(f));
}

export interface SelectionCandidates {
  festivals: readonly Festival[];
  /** `?festival=` */
  url?: string | null;
  /** the logged-in user's festivalSlug */
  account?: string | null;
  /** localStorage `star.festival` */
  local?: string | null;
  /** meta.defaultFestivalSlug */
  fallback?: string | null;
}

export interface FestivalSelection {
  slug: string | null;
  source: FestivalSource;
}

/**
 * SPEC §7b priority: url → account → local → default → none. A candidate that isn't an active
 * regional/online festival (unknown, hidden, national, junk) is skipped, not an error.
 */
export function resolveFestivalSelection({ festivals, url, account, local, fallback }: SelectionCandidates): FestivalSelection {
  const candidates: Array<[FestivalSource, string | null | undefined]> = [
    ['url', url],
    ['account', account],
    ['local', local],
    ['default', fallback],
  ];
  for (const [source, slug] of candidates) {
    const f = findChoosable(festivals, slug);
    if (f) return { slug: f.slug, source };
  }
  return { slug: null, source: 'none' };
}

function storage(given?: Storage | null): Storage | null {
  if (given !== undefined) return given;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // blocked storage (privacy settings) throws on access
  }
}

/** The stored festival slug (normalised), or null — never throws. */
export function readStoredFestival(store?: Storage | null): string | null {
  try {
    return normalizeFestivalSlug(storage(store)?.getItem(FESTIVAL_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Store (or, with null, forget) the festival slug. Returns false when storage is unavailable. */
export function writeStoredFestival(slug: string | null, store?: Storage | null): boolean {
  try {
    const s = storage(store);
    if (!s) return false;
    if (slug) s.setItem(FESTIVAL_STORAGE_KEY, slug);
    else s.removeItem(FESTIVAL_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** `<origin>/?festival=<slug>` — a link teachers can send so the class lands with it pre-picked. */
export function festivalShareUrl(slug: string, origin?: string): string {
  const base = origin ?? (typeof window === 'undefined' ? '' : window.location.origin);
  return `${base.replace(/\/+$/, '')}/?${FESTIVAL_PARAM}=${encodeURIComponent(slug)}`;
}

/** The `?festival=` value of a search string (raw), or null. */
export function festivalParam(search: string): string | null {
  return new URLSearchParams(search).get(FESTIVAL_PARAM);
}

/** The same search string without `festival` (other params kept, in order): '?q=x' or ''. */
export function withoutFestivalParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(FESTIVAL_PARAM);
  const s = params.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------------------
// Admin form (mirrors the server's §7b validation)
// ---------------------------------------------------------------------------

export const FESTIVAL_LIMITS = { nameMin: 3, nameMax: 80, dateLabel: 120, venue: 120, city: 120, province: 40, infoUrl: 500, sortOrderMin: -1_000_000, sortOrderMax: 1_000_000 } as const;

/** The admin form's state — every text field as typed. */
export interface FestivalDraft {
  name: string;
  kind: FestivalKind;
  province: string;
  city: string;
  startDate: string;
  endDate: string;
  dateLabel: string;
  venue: string;
  infoUrl: string;
  sortOrder: string;
  active: boolean;
}

export type FestivalDraftErrors = Partial<Record<keyof FestivalDraft, string>>;

/** What the form knows beyond the draft's values. */
export interface FestivalDraftChecks {
  /**
   * Date inputs the browser reports as half-filled (`validity.badInput`): their value reads '' but
   * they aren't empty, so they must not be saved as "no date".
   */
  incompleteDates?: Partial<Record<'startDate' | 'endDate', boolean>>;
}

export function emptyFestivalDraft(overrides: Partial<FestivalDraft> = {}): FestivalDraft {
  return { name: '', kind: 'regional', province: 'BC', city: '', startDate: '', endDate: '', dateLabel: '', venue: '', infoUrl: '', sortOrder: '', active: true, ...overrides };
}

export function draftFromFestival(f: Festival): FestivalDraft {
  return {
    name: f.name,
    kind: f.kind,
    province: f.province ?? '',
    city: f.city ?? '',
    startDate: f.startDate ?? '',
    endDate: f.endDate ?? '',
    dateLabel: f.dateLabel ?? '',
    venue: f.venue ?? '',
    infoUrl: f.infoUrl ?? '',
    sortOrder: String(f.sortOrder ?? 0),
    active: f.active,
  };
}

const tooLong = (value: string, max: number) => value.trim().length > max;

/** Field → message for everything the server would reject (empty object = OK to send). */
export function validateFestivalDraft(d: FestivalDraft, checks: FestivalDraftChecks = {}): FestivalDraftErrors {
  const e: FestivalDraftErrors = {};
  const name = d.name.trim();
  if (!name) e.name = 'Give the festival a name';
  else if (name.length < FESTIVAL_LIMITS.nameMin) e.name = `Use at least ${FESTIVAL_LIMITS.nameMin} characters`;
  else if (name.length > FESTIVAL_LIMITS.nameMax) e.name = `Keep it to ${FESTIVAL_LIMITS.nameMax} characters or fewer`;
  if (!FESTIVAL_KINDS.includes(d.kind)) e.kind = 'Choose regional, online or national';
  const start = d.startDate.trim();
  const end = d.endDate.trim();
  if ((start && !isValidDateString(start)) || checks.incompleteDates?.startDate) e.startDate = 'Use a real date (YYYY-MM-DD)';
  if ((end && !isValidDateString(end)) || checks.incompleteDates?.endDate) e.endDate = 'Use a real date (YYYY-MM-DD)';
  if (!e.startDate && !e.endDate && start && end && end < start) e.endDate = 'The end date can’t be before the start date';
  if (tooLong(d.dateLabel, FESTIVAL_LIMITS.dateLabel)) e.dateLabel = `Keep it to ${FESTIVAL_LIMITS.dateLabel} characters or fewer`;
  if (tooLong(d.venue, FESTIVAL_LIMITS.venue)) e.venue = `Keep it to ${FESTIVAL_LIMITS.venue} characters or fewer`;
  if (tooLong(d.city, FESTIVAL_LIMITS.city)) e.city = `Keep it to ${FESTIVAL_LIMITS.city} characters or fewer`;
  if (tooLong(d.province, FESTIVAL_LIMITS.province)) e.province = `Keep it to ${FESTIVAL_LIMITS.province} characters or fewer`;
  const url = d.infoUrl.trim();
  if (url) {
    if (url.length > FESTIVAL_LIMITS.infoUrl) e.infoUrl = `Keep the link to ${FESTIVAL_LIMITS.infoUrl} characters or fewer`;
    else if (!isHttpsUrl(url)) e.infoUrl = 'Use a full https:// link';
  }
  const order = d.sortOrder.trim();
  if (order && (!/^-?\d+$/.test(order) || !Number.isSafeInteger(Number(order)))) e.sortOrder = 'Use a whole number';
  else if (order && (Number(order) < FESTIVAL_LIMITS.sortOrderMin || Number(order) > FESTIVAL_LIMITS.sortOrderMax)) {
    e.sortOrder = `Use a number from ${FESTIVAL_LIMITS.sortOrderMin.toLocaleString('en-CA')} to ${FESTIVAL_LIMITS.sortOrderMax.toLocaleString('en-CA')}`;
  }
  return e;
}

/** The request body for a (validated) draft: trimmed, '' → null. */
export function festivalInputFromDraft(d: FestivalDraft): FestivalInput {
  const opt = (v: string) => v.trim() || null;
  const order = d.sortOrder.trim();
  return {
    name: d.name.trim(),
    kind: d.kind,
    province: opt(d.province),
    city: opt(d.city),
    startDate: opt(d.startDate),
    endDate: opt(d.endDate),
    dateLabel: opt(d.dateLabel),
    venue: opt(d.venue),
    infoUrl: opt(d.infoUrl),
    sortOrder: order ? Number(order) : 0,
    active: d.active,
  };
}

import { afterEach, describe, expect, it } from 'vitest';
import { makeFestival, makeFestivals } from '../test/fixtures';
import type { Festival } from '../types';
import {
  calendarParts,
  compareFestivals,
  countdownTarget,
  draftFromFestival,
  entriesOpenOn,
  emptyFestivalDraft,
  FESTIVAL_STORAGE_KEY,
  festivalChipDate,
  festivalDateNote,
  festivalInputFromDraft,
  festivalParam,
  festivalPhaseOf,
  festivalSeason,
  festivalShareUrl,
  festivalShortName,
  festivalStatus,
  festivalTileDate,
  findChoosable,
  formatDateRange,
  formatDay,
  formatFestivalDate,
  groupFestivals,
  hasFestivalDate,
  isChoosable,
  isDeadlineFestival,
  isMultiDay,
  isOpeningOnly,
  isValidDateString,
  nationalFestivals,
  normalizeFestivalSlug,
  pickerGroups,
  readStoredFestival,
  regionalChoices,
  resolveFestivalSelection,
  upcomingNationals,
  validateFestivalDraft,
  withoutFestivalParam,
  writeStoredFestival,
} from './festivals';

const ALL = makeFestivals();
const by = (slug: string) => ALL.find((f) => f.slug === slug) as Festival;
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

// Node honours runtime TZ changes; the client TS project has no node types, hence the cast.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const originalTz = env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete env.TZ;
  else env.TZ = originalTz;
});

describe('isValidDateString', () => {
  it('accepts real calendar days only', () => {
    expect(isValidDateString('2026-12-11')).toBe(true);
    expect(isValidDateString('2028-02-29')).toBe(true);
    expect(isValidDateString('2027-02-29')).toBe(false);
    expect(isValidDateString('2026-04-31')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('2026-00-10')).toBe(false);
    expect(isValidDateString('2026-1-5')).toBe(false);
    expect(isValidDateString('2026-12-11T00:00:00Z')).toBe(false);
    expect(isValidDateString('')).toBe(false);
    expect(isValidDateString(null)).toBe(false);
    expect(isValidDateString(20261211)).toBe(false);
  });
});

describe('formatDay / formatDateRange', () => {
  it('formats a single day, with an optional weekday and short month', () => {
    expect(formatDay('2026-12-11')).toBe('December 11, 2026');
    expect(formatDay('2026-12-11', { weekday: true })).toBe('Friday, December 11, 2026');
    expect(formatDay('2026-12-11', { month: 'short', weekday: true })).toBe('Fri, Dec 11, 2026');
    expect(formatDay('2027-01-29', { month: 'short', year: false })).toBe('Jan 29');
    expect(formatDay('nope')).toBe('');
  });

  it('formats ranges within a month, across months and across years', () => {
    expect(formatDateRange('2027-05-20', '2027-05-23')).toBe('May 20–23, 2027');
    expect(formatDateRange('2027-04-30', '2027-05-02')).toBe('April 30 – May 2, 2027');
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('December 30, 2026 – January 2, 2027');
    expect(formatDateRange('2027-04-30', '2027-05-02', 'short')).toBe('Apr 30 – May 2, 2027');
  });

  it('treats a missing, equal or backwards end as a single day', () => {
    expect(formatDateRange('2026-12-11', null)).toBe('December 11, 2026');
    expect(formatDateRange('2026-12-11', '2026-12-11')).toBe('December 11, 2026');
    expect(formatDateRange('2026-12-11', '2026-12-01')).toBe('December 11, 2026');
    expect(formatDateRange('garbage', '2026-12-12')).toBe('');
  });

  it('is the same calendar day in every time zone (no UTC-midnight slip)', () => {
    for (const tz of ['Pacific/Honolulu', 'America/Vancouver', 'UTC', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
      env.TZ = tz;
      expect(formatDay('2026-12-11', { weekday: true })).toBe('Friday, December 11, 2026');
      expect(formatFestivalDate(by('star-fest-west'))).toBe('May 20–23, 2027');
      expect(formatFestivalDate(by('online'), { month: 'short' })).toBe('Closes Feb 28, 2027');
    }
  });
});

describe('formatFestivalDate', () => {
  it('single in-person day, optionally with the weekday', () => {
    expect(formatFestivalDate(by('vancouver'))).toBe('December 11, 2026');
    expect(formatFestivalDate(by('vancouver'), { weekday: true })).toBe('Friday, December 11, 2026');
    expect(formatFestivalDate(by('surrey'), { month: 'short' })).toBe('Jan 29, 2027');
  });

  it('multi-day ranges ignore the weekday option', () => {
    expect(formatFestivalDate(by('star-fest-west'), { weekday: true })).toBe('May 20–23, 2027');
  });

  it('online deadline: the dateLabel (long) or “Closes …” (short)', () => {
    expect(formatFestivalDate(by('online'))).toBe('Online entries close February 28, 2027');
    expect(formatFestivalDate(by('online'), { month: 'short' })).toBe('Closes Feb 28, 2027');
    expect(formatFestivalDate({ ...by('online'), dateLabel: null })).toBe('Submissions close February 28, 2027');
  });

  it('TBD: the dateLabel, else “Date to be announced”', () => {
    expect(formatFestivalDate(by('nanaimo'))).toBe('Date to be announced');
    expect(formatFestivalDate({ ...by('nanaimo'), dateLabel: 'Spring 2027 — watch this space' })).toBe('Spring 2027 — watch this space');
    expect(formatFestivalDate({ ...by('nanaimo'), dateLabel: '  ' })).toBe('Date to be announced');
    expect(formatFestivalDate({ ...by('vancouver'), startDate: '2026-02-30' })).toBe('Date to be announced');
  });

  it('calendar tile parts', () => {
    expect(calendarParts('2026-12-11')).toEqual({ month: 'Dec', day: 11, year: 2026 });
    expect(calendarParts(null)).toBeNull();
    expect(calendarParts('2026-02-31')).toBeNull();
  });

  it('chip dates are tiny (no year)', () => {
    expect(festivalChipDate(by('prince-george'))).toBe('Nov 20');
    expect(festivalChipDate(by('star-fest-west'))).toBe('May 20–23');
    expect(festivalChipDate(makeFestival({ startDate: '2027-04-30', endDate: '2027-05-02' }))).toBe('Apr 30 – May 2');
    expect(festivalChipDate(by('online'))).toBe('Closes Feb 28');
    expect(festivalChipDate(by('nanaimo'))).toBe('Date TBA');
  });

  it('a dateLabel next to real dates is a note', () => {
    expect(festivalDateNote({ ...by('vancouver'), dateLabel: 'Doors open 8:30am' })).toBe('Doors open 8:30am');
    expect(festivalDateNote(by('online'))).toBeNull();
    expect(festivalDateNote(by('nanaimo'))).toBeNull();
  });

  it('knows what kind of date it has', () => {
    expect(hasFestivalDate(by('nanaimo'))).toBe(false);
    expect(hasFestivalDate(by('online'))).toBe(true);
    expect(isDeadlineFestival(by('online'))).toBe(true);
    expect(isDeadlineFestival(by('vancouver'))).toBe(false);
    expect(isMultiDay(by('star-fest-west'))).toBe(true);
    expect(isMultiDay(by('vancouver'))).toBe(false);
  });
});

describe('festivalPhaseOf', () => {
  const vancouver = by('vancouver');
  const west = by('star-fest-west');
  const online = by('online');

  it('single day: upcoming until the day, today on it, over after', () => {
    expect(festivalPhaseOf(vancouver, at(2026, 12, 10, 23, 59))).toBe('upcoming');
    expect(festivalPhaseOf(vancouver, at(2026, 12, 11, 0, 0))).toBe('today');
    expect(festivalPhaseOf(vancouver, at(2026, 12, 11, 23, 59))).toBe('today');
    expect(festivalPhaseOf(vancouver, at(2026, 12, 12, 0, 1))).toBe('over');
  });

  it('ranges: today on the first day, ongoing through the last, then over', () => {
    expect(festivalPhaseOf(west, at(2027, 5, 19))).toBe('upcoming');
    expect(festivalPhaseOf(west, at(2027, 5, 20))).toBe('today');
    expect(festivalPhaseOf(west, at(2027, 5, 22))).toBe('ongoing');
    expect(festivalPhaseOf(west, at(2027, 5, 23, 22))).toBe('ongoing');
    expect(festivalPhaseOf(west, at(2027, 5, 24))).toBe('over');
  });

  it('online deadlines: open until the end of the closing day', () => {
    expect(festivalPhaseOf(online, at(2027, 2, 27))).toBe('upcoming');
    expect(festivalPhaseOf(online, at(2027, 2, 28, 23, 30))).toBe('today');
    expect(festivalPhaseOf(online, at(2027, 3, 1, 0, 5))).toBe('over');
  });

  it('no dates → tbd', () => {
    expect(festivalPhaseOf(by('nanaimo'), at(2026, 9, 27))).toBe('tbd');
  });

  it('does not depend on the time zone', () => {
    for (const tz of ['Pacific/Honolulu', 'Asia/Tokyo', 'America/St_Johns']) {
      env.TZ = tz;
      expect(festivalPhaseOf(vancouver, at(2026, 12, 11, 0, 30))).toBe('today');
      expect(festivalPhaseOf(vancouver, at(2026, 12, 10, 23, 30))).toBe('upcoming');
    }
  });

  it('works across the spring DST change', () => {
    env.TZ = 'America/Vancouver';
    const f = makeFestival({ startDate: '2027-03-15' });
    expect(festivalStatus(f, at(2027, 3, 13, 12)).days).toBe(2);
    expect(festivalStatus(f, at(2027, 3, 14, 23, 30)).label).toBe('Tomorrow');
  });
});

describe('countdownTarget', () => {
  it('counts to local midnight of the first day in person', () => {
    const t = countdownTarget(by('star-fest-west'));
    expect(t?.kind).toBe('start');
    expect(t?.date).toBe('2027-05-20');
    expect(t?.at.getTime()).toBe(new Date(2027, 4, 20).getTime());
  });
  it('counts to the END of the deadline day online', () => {
    const t = countdownTarget(by('online'));
    expect(t?.kind).toBe('deadline');
    expect(t?.at.getTime()).toBe(new Date(2027, 2, 1).getTime());
  });
  it('handles month/year roll-over and TBD', () => {
    expect(countdownTarget(makeFestival({ startDate: null, endDate: '2026-12-31' }))?.at.getTime()).toBe(new Date(2027, 0, 1).getTime());
    expect(countdownTarget(by('nanaimo'))).toBeNull();
  });
});

describe('online festivals with an opening day (“Opens”) — the end date is still the deadline', () => {
  const online = { ...by('online'), startDate: '2027-01-15' };

  it('is a deadline festival: countdown to the end of the closing day, whatever the opening day', () => {
    expect(isDeadlineFestival(online)).toBe(true);
    expect(countdownTarget(online)).toMatchObject({ kind: 'deadline', date: '2027-02-28' });
    expect(countdownTarget(online)?.at.getTime()).toBe(new Date(2027, 2, 1).getTime());
    // an in-person festival with both dates is still a range, not a deadline
    expect(isDeadlineFestival(by('star-fest-west'))).toBe(false);
  });

  it('phases follow the deadline: upcoming (before and after opening) → today → over', () => {
    expect(festivalPhaseOf(online, at(2026, 11, 15))).toBe('upcoming');
    expect(festivalPhaseOf(online, at(2027, 2, 1))).toBe('upcoming');
    expect(festivalPhaseOf(online, at(2027, 2, 28, 23, 30))).toBe('today');
    expect(festivalPhaseOf(online, at(2027, 3, 1, 0, 5))).toBe('over');
    expect(festivalStatus(online, at(2027, 2, 1)).label).toBe('Closes in 27 days');
    expect(festivalStatus(online, at(2027, 2, 28)).label).toBe('Closes today!');
    expect(festivalStatus(online, at(2027, 3, 2)).label).toBe('Closed');
  });

  it('knows when entries open (only before that day)', () => {
    expect(entriesOpenOn(online, at(2026, 11, 15))).toBe('2027-01-15');
    expect(entriesOpenOn(online, at(2027, 1, 15))).toBeNull();
    expect(entriesOpenOn(by('online'), at(2026, 11, 15))).toBeNull();
    expect(entriesOpenOn(by('vancouver'), at(2026, 11, 15))).toBeNull();
  });

  it('dates read as the deadline everywhere (text, chips, calendar tiles)', () => {
    expect(formatFestivalDate(online)).toBe('Online entries close February 28, 2027');
    expect(formatFestivalDate(online, { month: 'short' })).toBe('Closes Feb 28, 2027');
    expect(formatFestivalDate({ ...online, dateLabel: null }, { weekday: true })).toBe('Submissions close Sunday, February 28, 2027');
    expect(festivalChipDate(online)).toBe('Closes Feb 28');
    expect(festivalTileDate(online)).toBe('2027-02-28');
    expect(festivalDateNote(online)).toBeNull();
    expect(festivalTileDate(by('star-fest-west'))).toBe('2027-05-20');
  });

  it('with only an opening day: counts to it, then “open now” (never “wrapped”)', () => {
    const opening = { ...by('online'), startDate: '2027-01-15', endDate: null };
    expect(isOpeningOnly(opening)).toBe(true);
    expect(isDeadlineFestival(opening)).toBe(false);
    expect(countdownTarget(opening)).toMatchObject({ kind: 'start', date: '2027-01-15' });
    expect(festivalPhaseOf(opening, at(2027, 1, 14))).toBe('upcoming');
    expect(festivalPhaseOf(opening, at(2027, 1, 15))).toBe('today');
    expect(festivalPhaseOf(opening, at(2027, 6, 1))).toBe('ongoing');
    expect(festivalStatus(opening, at(2027, 1, 10)).label).toBe('Opens in 5 days');
    expect(festivalStatus(opening, at(2027, 1, 14)).label).toBe('Opens tomorrow');
    expect(festivalStatus(opening, at(2027, 1, 15)).label).toBe('Opens today!');
    expect(festivalStatus(opening, at(2027, 2, 1)).label).toBe('Open now!');
  });
});

describe('upcomingNationals', () => {
  it('drops national festivals that are over (and anything that isn’t national)', () => {
    expect(upcomingNationals(ALL, at(2027, 1, 10)).map((f) => f.slug)).toEqual(['star-fest-west']);
    expect(upcomingNationals(ALL, at(2027, 5, 22)).map((f) => f.slug)).toEqual(['star-fest-west']); // on now
    expect(upcomingNationals(ALL, at(2027, 6, 15))).toEqual([]);
  });
});

describe('festivalStatus', () => {
  it('labels each phase', () => {
    const now = at(2026, 12, 1);
    expect(festivalStatus(by('prince-george'), now)).toMatchObject({ label: 'Wrapped', state: 'past' });
    expect(festivalStatus(by('fraser-valley'), now)).toMatchObject({ label: 'In 3 days', state: 'soon', days: 3 });
    expect(festivalStatus(by('surrey'), now)).toMatchObject({ label: 'In 59 days', state: 'later' });
    expect(festivalStatus(by('nanaimo'), now)).toMatchObject({ label: 'Date TBA', state: 'tbd', days: null });
    expect(festivalStatus(by('online'), now).label).toBe('Closes in 89 days');
    expect(festivalStatus(by('vancouver'), at(2026, 12, 10)).label).toBe('Tomorrow');
    expect(festivalStatus(by('vancouver'), at(2026, 12, 11)).label).toBe('Today!');
    expect(festivalStatus(by('star-fest-west'), at(2027, 5, 21)).label).toBe('On now!');
    expect(festivalStatus(by('online'), at(2027, 2, 28)).label).toBe('Closes today!');
    expect(festivalStatus(by('online'), at(2027, 3, 2)).label).toBe('Closed');
  });
});

describe('names, grouping and sorting', () => {
  it('short names drop “Regional STAR Fest” / “(National)”', () => {
    expect(festivalShortName(by('surrey'))).toBe('Surrey');
    expect(festivalShortName(by('fraser-valley'))).toBe('Fraser Valley');
    expect(festivalShortName(by('online'))).toBe('Online');
    expect(festivalShortName(by('star-fest-west'))).toBe('STAR Fest West');
    expect(festivalShortName({ name: 'Kelowna STAR Festival', city: 'Kelowna' })).toBe('Kelowna');
    expect(festivalShortName({ name: 'STAR Fest', city: null })).toBe('STAR Fest');
  });

  it('only active regionals and online festivals are choosable', () => {
    expect(isChoosable(by('surrey'))).toBe(true);
    expect(isChoosable(by('online'))).toBe(true);
    expect(isChoosable(by('star-fest-west'))).toBe(false);
    expect(isChoosable({ ...by('surrey'), active: false })).toBe(false);
  });

  it('regional choices: date order, TBD last, then online', () => {
    const shuffled = [...ALL].reverse();
    expect(regionalChoices(shuffled).map((f) => f.slug)).toEqual(['prince-george', 'fraser-valley', 'victoria', 'vancouver', 'burnaby', 'surrey', 'nanaimo', 'online']);
    expect(nationalFestivals(shuffled).map((f) => f.slug)).toEqual(['star-fest-west']);
  });

  it('drops hidden festivals unless asked', () => {
    const list = ALL.map((f) => (f.slug === 'victoria' ? { ...f, active: false } : f));
    expect(regionalChoices(list).map((f) => f.slug)).not.toContain('victoria');
    expect(groupFestivals(list, { includeInactive: true }).regional.map((f) => f.slug)).toContain('victoria');
  });

  it('ties on date fall back to sortOrder then name', () => {
    const a = makeFestival({ name: 'Beta', startDate: '2027-01-01', sortOrder: 5 });
    const b = makeFestival({ name: 'Alpha', startDate: '2027-01-01', sortOrder: 5 });
    const c = makeFestival({ name: 'Zed', startDate: '2027-01-01', sortOrder: 1 });
    expect([a, b, c].sort(compareFestivals).map((f) => f.name)).toEqual(['Zed', 'Alpha', 'Beta']);
  });

  it('picker groups: “BC regional festivals” then “Online”, empty groups omitted', () => {
    expect(pickerGroups(ALL).map((g) => [g.label, g.festivals.length])).toEqual([
      ['BC regional festivals', 7],
      ['Online', 1],
    ]);
    const withAlberta = [...ALL, makeFestival({ name: 'Calgary Regional STAR Fest', province: 'AB' })];
    expect(pickerGroups(withAlberta)[0]?.label).toBe('Regional festivals');
    expect(pickerGroups(ALL.filter((f) => f.kind !== 'online')).map((g) => g.id)).toEqual(['regional']);
    expect(pickerGroups([])).toEqual([]);
  });

  it('works out the season', () => {
    expect(festivalSeason(ALL)).toBe('2026–27');
    expect(festivalSeason([makeFestival({ startDate: '2027-01-10' })])).toBe('2027');
    expect(festivalSeason([by('nanaimo')])).toBeNull();
  });
});

describe('resolveFestivalSelection', () => {
  const festivals = ALL;
  it('follows url → account → local → default → none', () => {
    expect(resolveFestivalSelection({ festivals, url: 'surrey', account: 'victoria', local: 'burnaby', fallback: 'vancouver' })).toEqual({ slug: 'surrey', source: 'url' });
    expect(resolveFestivalSelection({ festivals, account: 'victoria', local: 'burnaby', fallback: 'vancouver' })).toEqual({ slug: 'victoria', source: 'account' });
    expect(resolveFestivalSelection({ festivals, local: 'burnaby', fallback: 'vancouver' })).toEqual({ slug: 'burnaby', source: 'local' });
    expect(resolveFestivalSelection({ festivals, fallback: 'vancouver' })).toEqual({ slug: 'vancouver', source: 'default' });
    expect(resolveFestivalSelection({ festivals })).toEqual({ slug: null, source: 'none' });
  });

  it('skips unknown, hidden, national and junk slugs', () => {
    const hidden = festivals.map((f) => (f.slug === 'surrey' ? { ...f, active: false } : f));
    expect(resolveFestivalSelection({ festivals: hidden, url: 'surrey', account: 'atlantis', local: 'star-fest-west', fallback: 'online' })).toEqual({ slug: 'online', source: 'default' });
    expect(resolveFestivalSelection({ festivals, url: '<script>', local: 'victoria' })).toEqual({ slug: 'victoria', source: 'local' });
  });

  it('normalises case and whitespace (links typed by hand)', () => {
    expect(resolveFestivalSelection({ festivals, url: ' Surrey ' })).toEqual({ slug: 'surrey', source: 'url' });
    expect(findChoosable(festivals, 'PRINCE-GEORGE')?.name).toBe('Prince George Regional STAR Fest');
    expect(normalizeFestivalSlug('a--b')).toBeNull();
    expect(normalizeFestivalSlug('x'.repeat(81))).toBeNull();
    expect(normalizeFestivalSlug(42)).toBeNull();
  });

  it('with no festivals loaded, nothing is selected', () => {
    expect(resolveFestivalSelection({ festivals: [], url: 'surrey', local: 'surrey' })).toEqual({ slug: null, source: 'none' });
  });
});

describe('storage helpers', () => {
  it('reads, writes and clears star.festival', () => {
    expect(readStoredFestival()).toBeNull();
    expect(writeStoredFestival('surrey')).toBe(true);
    expect(window.localStorage.getItem(FESTIVAL_STORAGE_KEY)).toBe('surrey');
    expect(readStoredFestival()).toBe('surrey');
    writeStoredFestival(null);
    expect(window.localStorage.getItem(FESTIVAL_STORAGE_KEY)).toBeNull();
  });

  it('ignores junk that was stored', () => {
    window.localStorage.setItem(FESTIVAL_STORAGE_KEY, '{"oops":1}');
    expect(readStoredFestival()).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    } as unknown as Storage;
    expect(readStoredFestival(blocked)).toBeNull();
    expect(writeStoredFestival('surrey', blocked)).toBe(false);
    expect(writeStoredFestival(null, blocked)).toBe(false);
    expect(readStoredFestival(null)).toBeNull();
    expect(writeStoredFestival('surrey', null)).toBe(false);
  });
});

describe('share links & URL params', () => {
  it('builds <origin>/?festival=<slug>', () => {
    expect(festivalShareUrl('surrey', 'https://star.example.ca')).toBe('https://star.example.ca/?festival=surrey');
    expect(festivalShareUrl('prince-george', 'http://localhost:5173/')).toBe('http://localhost:5173/?festival=prince-george');
    expect(festivalShareUrl('surrey')).toBe(`${window.location.origin}/?festival=surrey`);
  });

  it('reads and strips the param, keeping everything else', () => {
    expect(festivalParam('?festival=surrey&q=wicked')).toBe('surrey');
    expect(festivalParam('?q=wicked')).toBeNull();
    expect(withoutFestivalParam('?q=wicked&festival=surrey&kind=duet')).toBe('?q=wicked&kind=duet');
    expect(withoutFestivalParam('?festival=surrey')).toBe('');
    expect(withoutFestivalParam('')).toBe('');
  });
});

describe('admin form validation (mirrors §7b)', () => {
  const ok = emptyFestivalDraft({ name: 'Kelowna Regional STAR Fest', city: 'Kelowna', startDate: '2027-02-05', venue: 'Kelowna Community Theatre', infoUrl: 'https://taeacanada.ca/', sortOrder: '75' });

  it('accepts a good draft and builds a trimmed body', () => {
    expect(validateFestivalDraft(ok)).toEqual({});
    expect(festivalInputFromDraft({ ...ok, dateLabel: '  ', name: '  Kelowna Regional STAR Fest ' })).toEqual({
      name: 'Kelowna Regional STAR Fest',
      kind: 'regional',
      province: 'BC',
      city: 'Kelowna',
      startDate: '2027-02-05',
      endDate: null,
      dateLabel: null,
      venue: 'Kelowna Community Theatre',
      infoUrl: 'https://taeacanada.ca/',
      sortOrder: 75,
      active: true,
    });
    expect(festivalInputFromDraft({ ...ok, sortOrder: '' }).sortOrder).toBe(0);
  });

  it('checks name length', () => {
    expect(validateFestivalDraft({ ...ok, name: '' }).name).toMatch(/name/);
    expect(validateFestivalDraft({ ...ok, name: 'ab' }).name).toMatch(/at least 3/);
    expect(validateFestivalDraft({ ...ok, name: 'x'.repeat(81) }).name).toMatch(/80/);
    expect(validateFestivalDraft({ ...ok, name: 'x'.repeat(80) }).name).toBeUndefined();
  });

  it('checks dates are real and in order', () => {
    expect(validateFestivalDraft({ ...ok, startDate: '2027-02-30' }).startDate).toMatch(/real date/);
    expect(validateFestivalDraft({ ...ok, endDate: 'soon' }).endDate).toMatch(/real date/);
    expect(validateFestivalDraft({ ...ok, startDate: '2027-05-23', endDate: '2027-05-20' }).endDate).toMatch(/before the start/);
    expect(validateFestivalDraft({ ...ok, startDate: '2027-05-20', endDate: '2027-05-20' })).toEqual({});
    expect(validateFestivalDraft({ ...ok, startDate: '', endDate: '2027-02-28', kind: 'online' })).toEqual({});
  });

  it('checks lengths, https links, sort order and kind', () => {
    const e = validateFestivalDraft({
      ...ok,
      dateLabel: 'x'.repeat(121),
      venue: 'x'.repeat(121),
      city: 'x'.repeat(121),
      province: 'x'.repeat(41),
      infoUrl: 'http://taeacanada.ca/',
      sortOrder: '1.5',
      kind: 'galactic' as never,
    });
    expect(Object.keys(e).sort()).toEqual(['city', 'dateLabel', 'infoUrl', 'kind', 'province', 'sortOrder', 'venue']);
    expect(validateFestivalDraft({ ...ok, infoUrl: `https://x.ca/${'a'.repeat(500)}` }).infoUrl).toMatch(/500/);
    expect(validateFestivalDraft({ ...ok, sortOrder: '-10' }).sortOrder).toBeUndefined();
  });

  it('sort order stays within the server’s ±1,000,000', () => {
    expect(validateFestivalDraft({ ...ok, sortOrder: '99999999' }).sortOrder).toBe('Use a number from -1,000,000 to 1,000,000');
    expect(validateFestivalDraft({ ...ok, sortOrder: '-1000001' }).sortOrder).toMatch(/-1,000,000 to 1,000,000/);
    expect(validateFestivalDraft({ ...ok, sortOrder: '1000000' }).sortOrder).toBeUndefined();
    expect(validateFestivalDraft({ ...ok, sortOrder: '-1000000' }).sortOrder).toBeUndefined();
  });

  it('a half-typed date (the browser reports "" + badInput) is an error, not “no date”', () => {
    const halfTyped = { ...ok, startDate: '' };
    expect(validateFestivalDraft(halfTyped)).toEqual({});
    expect(validateFestivalDraft(halfTyped, { incompleteDates: { startDate: true } }).startDate).toBe('Use a real date (YYYY-MM-DD)');
    expect(validateFestivalDraft({ ...ok, endDate: '' }, { incompleteDates: { endDate: true } }).endDate).toBe('Use a real date (YYYY-MM-DD)');
    expect(validateFestivalDraft(ok, { incompleteDates: { startDate: false, endDate: false } })).toEqual({});
  });

  it('round-trips an existing festival', () => {
    const d = draftFromFestival(by('online'));
    expect(d).toMatchObject({ kind: 'online', province: '', startDate: '', endDate: '2027-02-28', sortOrder: '80' });
    expect(validateFestivalDraft(d)).toEqual({});
    expect(festivalInputFromDraft(d)).toMatchObject({ province: null, startDate: null, endDate: '2027-02-28', sortOrder: 80 });
  });
});

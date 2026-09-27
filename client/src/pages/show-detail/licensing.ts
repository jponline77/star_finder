/**
 * STAR approved publishers/licensors (SPEC §1, 2026 Regional STAR Fest Program Guide) and a
 * loose matcher for a show's `licensor` text. Used for the licensing panel on show pages.
 */

export interface ApprovedPublisher {
  name: string;
  pattern: RegExp;
  /** Extra caveat from the program guide. */
  note?: string;
}

export const APPROVED_PUBLISHERS: readonly ApprovedPublisher[] = [
  { name: 'Music Theatre International (MTI)', pattern: /music theat(re|er) international|\bmti\b/i },
  { name: 'Rodgers & Hammerstein', pattern: /rodgers\s*(&|and)\s*hammerstein|\br\s*&\s*h\b/i },
  { name: 'Concord Theatricals', pattern: /concord/i },
  { name: 'Tams-Witmark', pattern: /tams[\s-]*witmark/i },
  {
    name: 'Samuel French',
    pattern: /samuel french/i,
    note: 'Concord / Samuel French approval has some playwright exclusions for plays — check with your teacher.',
  },
  {
    name: 'Theatrical Rights Worldwide (TRW)',
    pattern: /theatrical rights worldwide|\btrw\b/i,
    note: 'TRW shows need a free festival licence request — ask your teacher to send one in.',
  },
  { name: 'Dramatic Publishing', pattern: /dramatic publishing/i, note: 'Dramatic Publishing is approved for listed titles only.' },
  { name: 'Pioneer Drama', pattern: /pioneer drama/i },
  { name: 'Playscripts', pattern: /playscripts/i },
  { name: 'Dramatists Play Service', pattern: /dramatists play service/i },
  { name: 'Eldridge', pattern: /eldridge/i },
  { name: 'Heuer', pattern: /heuer/i },
  { name: 'CPA Theatricals', pattern: /\bcpa theatricals\b/i },
  { name: 'Stage Partners', pattern: /stage partners/i },
  { name: 'Uproar Theatrics', pattern: /uproar/i },
  { name: 'YouthPLAYS', pattern: /youthplays/i },
  { name: 'Theatrefolk', pattern: /theatrefolk/i },
  { name: 'Playwrights Guild of Canada', pattern: /playwrights guild/i },
  { name: 'Public domain', pattern: /public domain/i },
];

export type LicensingStatus =
  | { kind: 'approved'; publisher: ApprovedPublisher; notes: string[] }
  | { kind: 'unlisted' }
  | { kind: 'unknown' };

/** Classify a licensor string against the approved list (all matching notes are collected). */
export function licensingStatus(licensor: string | null | undefined): LicensingStatus {
  const text = licensor?.trim();
  if (!text) return { kind: 'unknown' };
  const matches = APPROVED_PUBLISHERS.filter((p) => p.pattern.test(text));
  const first = matches[0];
  if (!first) return { kind: 'unlisted' };
  const notes = matches.map((m) => m.note).filter((n): n is string => Boolean(n));
  return { kind: 'approved', publisher: first, notes };
}

/** "Music & lyrics by X" style credit lines, merging identical people. */
export function creditLines(show: { composer: string | null; lyricist: string | null; bookWriter: string | null }): Array<{ role: string; who: string }> {
  const clean = (s: string | null) => s?.trim() || null;
  const music = clean(show.composer);
  const lyrics = clean(show.lyricist);
  const book = clean(show.bookWriter);
  const same = (a: string | null, b: string | null) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  const lines: Array<{ role: string; who: string }> = [];
  if (music && same(music, lyrics) && same(music, book)) return [{ role: 'Music, lyrics & book', who: music }];
  if (music && same(music, lyrics)) lines.push({ role: 'Music & lyrics', who: music });
  else {
    if (music) lines.push({ role: 'Music', who: music });
    if (lyrics) lines.push({ role: 'Lyrics', who: lyrics });
  }
  if (book) {
    if (same(book, lyrics) && !same(music, lyrics)) {
      const i = lines.findIndex((l) => l.role === 'Lyrics');
      if (i >= 0) lines[i] = { role: 'Lyrics & book', who: book };
      else lines.push({ role: 'Book', who: book });
    } else lines.push({ role: 'Book', who: book });
  }
  return lines;
}

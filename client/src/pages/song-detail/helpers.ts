/**
 * Pure helpers for the song detail page (/songs/:id). Unit-tested in __tests__/helpers.test.ts.
 */
import type { Kind, Show, SongMedia } from '../../types';
import { formatLength, timeStatus, type TimeStatus } from '../../lib/format';
import { TIME_LIMIT_SECONDS } from '../../lib/vocab';

// ---------------------------------------------------------------------------
// Audio uploads — moved to lib/media.ts (shared with the song form's backing-track dropzone)
// ---------------------------------------------------------------------------

export { AUDIO_ACCEPT, AUDIO_EXTENSIONS, AUDIO_FORMATS_TEXT, AUDIO_MAX_BYTES, fileExtension, validateAudioFile } from '../../lib/media';

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

export interface CreditLine {
  role: string;
  names: string;
}

const same = (a: string, b: string) =>
  a.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim() === b.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** "Music & lyrics by X" when composer = lyricist, else separate lines. Book is optional. */
export function creditLines(show: Pick<Show, 'composer' | 'lyricist' | 'bookWriter'> | null | undefined, { withBook = false } = {}): CreditLine[] {
  if (!show) return [];
  const composer = show.composer?.trim() ?? '';
  const lyricist = show.lyricist?.trim() ?? '';
  const book = show.bookWriter?.trim() ?? '';
  const lines: CreditLine[] = [];
  if (composer && lyricist && same(composer, lyricist)) lines.push({ role: 'Music & lyrics', names: composer });
  else {
    if (composer) lines.push({ role: 'Music', names: composer });
    if (lyricist) lines.push({ role: 'Lyrics', names: lyricist });
  }
  if (withBook && book) lines.push({ role: 'Book', names: book });
  return lines;
}

// ---------------------------------------------------------------------------
// Apple preview credit
// ---------------------------------------------------------------------------

/** "Preview courtesy of Apple Music — <recordingName> · <recordingArtist>" (missing parts dropped). */
export function previewCredit(media: Pick<SongMedia, 'recordingName' | 'recordingArtist'>): string {
  const bits = [media.recordingName?.trim(), media.recordingArtist?.trim()].filter(Boolean);
  return bits.length ? `Preview courtesy of Apple Music — ${bits.join(' · ')}` : 'Preview courtesy of Apple Music';
}

// ---------------------------------------------------------------------------
// Time vs STAR's 6:00 limit — friendly copy
// ---------------------------------------------------------------------------

export interface TimeMessage {
  status: TimeStatus | 'unknown';
  headline: string;
  detail: string;
  /** Short line for the checklist */
  short: string;
}

export function timeMessage(seconds: number | null | undefined, limit = TIME_LIMIT_SECONDS): TimeMessage {
  const status = timeStatus(seconds, limit);
  if (status === null || seconds == null) {
    return {
      status: 'unknown',
      headline: 'Length not listed yet',
      detail: `Time a full run-through with the rehearsal timer — it has to come in at ${formatLength(limit)} or less.`,
      short: `Length unknown — time a run-through (limit ${formatLength(limit)})`,
    };
  }
  const len = formatLength(seconds);
  if (status === 'over') {
    const cut = formatLength(seconds - limit);
    return {
      status,
      headline: `Over STAR’s ${formatLength(limit)} limit — you’ll need a cut`,
      detail: `Trim at least ${cut} (timing starts after your slate). Ask your teacher which verse or section to cut.`,
      short: `${len} — over the limit, cut at least ${cut}`,
    };
  }
  const spare = formatLength(limit - seconds);
  if (status === 'close') {
    return {
      status,
      headline: `Close to the ${formatLength(limit)} limit`,
      detail: `Only ${spare} to spare — keep the intro and ending tight, and time a full run-through with your track.`,
      short: `${len} — close to the limit (${spare} to spare)`,
    };
  }
  return {
    status,
    headline: `Fits STAR’s ${formatLength(limit)} limit`,
    detail: `You’ve got ${spare} to spare. Remember, the clock only starts after your slate.`,
    short: `${len} — fits the ${formatLength(limit)} limit`,
  };
}

// ---------------------------------------------------------------------------
// STAR staging rules
// ---------------------------------------------------------------------------

/** Set pieces allowed (2026 program guide): solo 1 chair + 1 table; duet 2 chairs + 1 table. */
export function setPieces(kind: Kind): string {
  return kind === 'duet' ? 'up to 2 chairs + 1 table' : 'up to 1 chair + 1 table';
}

/** "Glinda" / "Shrek & Fiona" */
export function characterNames(parts: ReadonlyArray<{ character: string }>): string {
  const names = parts.map((p) => p.character.trim()).filter(Boolean);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** Page title: "Popular — Wicked" */
export function songDocumentTitle(song: { title: string; show: { name: string } } | null | undefined): string | null {
  return song ? `${song.title} — ${song.show.name}` : null;
}

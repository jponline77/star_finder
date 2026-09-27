/** External link builders + URL safety helpers. */
import type { Song } from '../types';

type SongLike = Pick<Song, 'title'> & { show: { name: string } };

export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/** YouTube search for a vocals-free backing track: "<title>" "<show>" karaoke instrumental */
export function backingTrackUrl(song: SongLike): string {
  return youtubeSearchUrl(`"${song.title}" "${song.show.name}" karaoke instrumental`);
}

/** YouTube search for performances of the song. */
export function performancesUrl(song: SongLike): string {
  return youtubeSearchUrl(`"${song.title}" "${song.show.name}" musical performance`);
}

/** Musicnotes sheet-music search. */
export function sheetMusicUrl(song: SongLike): string {
  return `https://www.musicnotes.com/search/go?w=${encodeURIComponent(`${song.title} ${song.show.name}`)}`;
}

/** True only for absolute http(s) URLs — never render other schemes (javascript:, data:) as links. */
export function isSafeHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** True for https URLs only (API requires https for audioLink). */
export function isHttpsUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Host name for display ("youtube.com"), or '' if not a URL. */
export function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Placeholder origin used only to resolve `next` values; never navigated to. */
const NEXT_BASE = 'https://star-song-finder.invalid';

/**
 * Sanitise a `?next=` redirect target: only same-site absolute paths ("/songs?q=x"), never
 * "//evil.com", "https://…" or anything the URL parser would turn into another origin
 * (e.g. "/\t/evil.com" — the parser strips tabs/newlines, leaving "//evil.com").
 * The value is resolved against a placeholder origin and only its path + query + hash is
 * returned, so what we navigate to is exactly what the browser would. Falls back to `fallback`.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  // Control characters (incl. tab/CR/LF) and backslashes are never part of a real app path.
  if (!next.startsWith('/') || /[\u0000-\u001F\u007F\\]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, NEXT_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== NEXT_BASE) return fallback;
  if (/^\/(login|signup)(\/|$)/i.test(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/login?next=<path>` for the given location path (+search). */
export function loginHref(next?: string | null): string {
  const safe = safeNextPath(next, '');
  return safe ? `/login?next=${encodeURIComponent(safe)}` : '/login';
}

/** `/signup?next=<path>` */
export function signupHref(next?: string | null): string {
  const safe = safeNextPath(next, '');
  return safe ? `/signup?next=${encodeURIComponent(safe)}` : '/signup';
}

export const songPath = (id: number) => `/songs/${id}`;
export const songEditPath = (id: number) => `/songs/${id}/edit`;
export const showPath = (slug: string) => `/shows/${slug}`;

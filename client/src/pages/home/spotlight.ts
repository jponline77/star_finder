/**
 * "Spotlight Song of the Day" pool for the home page — the landing page for grade 6–12 students
 * (often on a classroom projector), so it only features songs a school could actually do.
 */
import { hasPlayableAudio } from '../../lib/filters';
import { licensingStatus } from '../show-detail/licensing';
import type { Show, Song } from '../../types';

/**
 * Songs eligible for the daily pick, best tier first: not mature, with a preview, from a show whose
 * licensor is on STAR's approved list. Loosens step by step (licensing unknown → any show; no
 * previews → any song) only when a stricter tier is empty. `shows` = the /api/shows list, or null
 * when licensing info isn't available.
 */
export function spotlightPool(songs: readonly Song[], shows: readonly Show[] | null): Song[] {
  const playable = songs.filter(hasPlayableAudio);
  const base = playable.length >= 5 ? playable : [...songs];
  const clean = base.filter((s) => !s.mature);
  const licensed = shows ? new Set(shows.filter((sh) => licensingStatus(sh.licensor).kind === 'approved').map((sh) => sh.id)) : null;
  const tiers = [licensed ? clean.filter((s) => licensed.has(s.show.id)) : [], clean, base];
  return tiers.find((t) => t.length > 0) ?? [];
}

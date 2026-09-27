/**
 * `const deleteSong = useDeleteSong(); await deleteSong(song);` — DELETE /api/songs/:id and tidy up
 * every piece of shared state that knew about it: stops the mini player if it's playing that song,
 * drops it from the setlist and the songs cache, and refreshes meta counts + the shows cache.
 * Throws (ApiError) if the server refuses; nothing local changes then.
 */
import { useCallback } from 'react';
import { deleteSong as apiDeleteSong } from '../api';
import { useSetlist } from '../lib/setlist';
import type { Song } from '../types';
import { useAudio } from './AudioProvider';
import { useSongs } from './SongsProvider';

export function useDeleteSong(): (song: Pick<Song, 'id'>) => Promise<void> {
  const audio = useAudio();
  const { remove: removeFromSetlist } = useSetlist();
  const { removeSong, reload } = useSongs();
  const { current, stop } = audio;
  const playingId = current?.songId;
  return useCallback(
    async (song: Pick<Song, 'id'>) => {
      await apiDeleteSong(song.id);
      if (playingId === song.id) stop();
      removeFromSetlist(song.id);
      removeSong(song.id);
      void reload(); // counts (meta) and the shows cache (song counts) — in the background
    },
    [playingId, stop, removeFromSetlist, removeSong, reload],
  );
}

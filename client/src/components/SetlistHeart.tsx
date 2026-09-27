import { Heart } from 'lucide-react';
import { useSetlist } from '../lib/setlist';
import { useToast } from '../state/ToastProvider';

export interface SetlistHeartProps {
  songId: number;
  /** Used in the accessible label + toast ("Add Popular to your setlist"). */
  songTitle?: string;
  /** Show "Add to setlist" / "In your setlist" text (pill style). */
  withLabel?: boolean;
  /** Show a toast on change (default true). */
  toast?: boolean;
  className?: string;
}

/** ♥ toggle for My Setlist (localStorage). aria-pressed reflects state. data-testid="setlist-heart". */
export function SetlistHeart({ songId, songTitle, withLabel = false, toast: showToast = true, className = '' }: SetlistHeartProps) {
  const setlist = useSetlist();
  const toast = useToast();
  const on = setlist.has(songId);
  const name = songTitle ? `“${songTitle}”` : 'this song';
  return (
    <button
      type="button"
      className={`heart-button${withLabel ? ' with-label' : ''} ${className}`.trim()}
      aria-pressed={on}
      aria-label={on ? `Remove ${name} from your setlist` : `Add ${name} to your setlist`}
      title={on ? 'In your setlist — click to remove' : 'Add to your setlist'}
      data-testid="setlist-heart"
      onClick={() => {
        const added = setlist.toggle(songId);
        if (showToast) {
          if (added) toast.success(`${songTitle ? `“${songTitle}”` : 'Song'} added to your setlist`, { emoji: '💖', id: 'setlist' });
          else
            toast.info(`${songTitle ? `“${songTitle}”` : 'Song'} removed from your setlist`, {
              emoji: '💔',
              id: 'setlist',
              action: { label: 'Undo', onClick: () => setlist.add(songId) },
            });
        }
      }}
    >
      <Heart size={withLabel ? 18 : 20} aria-hidden="true" />
      {withLabel && <span>{on ? 'In your setlist' : 'Add to setlist'}</span>}
    </button>
  );
}

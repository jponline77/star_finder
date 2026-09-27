import { useEffect, useState } from 'react';

const MAX_TIMEOUT = 2_147_483_647; // setTimeout's limit (~24.8 days)

/**
 * "Now", refreshed just after every local midnight (and when the tab becomes visible on a new day),
 * so whatever depends on the calendar day — a festival's phase and its wording — changes together
 * with the <Countdown> ticking past zero, instead of waiting for some unrelated re-render.
 */
export function useLocalDay(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // a few ms late, so the new day has surely begun (if it fires early, this just runs again)
    const wait = Math.min(Math.max(0, nextMidnight.getTime() - Date.now()) + 25, MAX_TIMEOUT);
    const id = window.setTimeout(() => setNow(new Date()), wait);
    // Timers are throttled in background tabs and paused while a laptop sleeps.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const fresh = new Date();
      if (fresh.toDateString() !== now.toDateString()) setNow(fresh);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [now]);
  return now;
}

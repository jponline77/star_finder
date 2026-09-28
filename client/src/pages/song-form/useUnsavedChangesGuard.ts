/**
 * Warn before leaving a form with unsaved changes: blocks in-app navigation (React Router
 * useBlocker) and tab close/reload (beforeunload). Call `allowNavigation()` right before a
 * deliberate navigate() (e.g. after a successful save).
 *
 * `screenKey` (optional) says which "screen" a location is: navigating to a different key is
 * leaving. Default: the pathname (so query-string changes on the same page don't count) — the
 * "/add" steps pass one that also looks at the step's query params.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useBlocker, type Blocker } from 'react-router';

type Loc = { pathname: string; search: string };

const byPath = (l: Loc) => l.pathname;

export function useUnsavedChangesGuard(dirty: boolean, screenKey: (location: Loc) => string = byPath): { blocker: Blocker; allowNavigation: () => void } {
  const allowRef = useRef(false);
  const dirtyRef = useRef(dirty);
  const keyRef = useRef(screenKey);
  useEffect(() => {
    dirtyRef.current = dirty;
    keyRef.current = screenKey;
  }, [dirty, screenKey]);

  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: Loc; nextLocation: Loc }) =>
        dirtyRef.current && !allowRef.current && keyRef.current(currentLocation) !== keyRef.current(nextLocation) && nextLocation.pathname !== '/login',
      [],
    ),
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (allowRef.current) return;
      e.preventDefault();
      // Legacy browsers need returnValue set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const allowNavigation = useCallback(() => {
    allowRef.current = true;
  }, []);

  return { blocker, allowNavigation };
}

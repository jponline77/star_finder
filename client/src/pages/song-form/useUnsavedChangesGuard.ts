/**
 * Warn before leaving a form with unsaved changes: blocks in-app navigation (React Router
 * useBlocker) and tab close/reload (beforeunload). Call `allowNavigation()` right before a
 * deliberate navigate() (e.g. after a successful save).
 */
import { useCallback, useEffect, useRef } from 'react';
import { useBlocker, type Blocker } from 'react-router';

export function useUnsavedChangesGuard(dirty: boolean): { blocker: Blocker; allowNavigation: () => void } {
  const allowRef = useRef(false);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
        dirtyRef.current && !allowRef.current && currentLocation.pathname !== nextLocation.pathname && nextLocation.pathname !== '/login',
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

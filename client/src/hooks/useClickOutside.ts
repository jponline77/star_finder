import { useEffect, type RefObject } from 'react';

/**
 * While `active`: calls `handler` on pointerdown outside `ref`, and `onEscape` (default: `handler`)
 * on Escape. Pass an `onEscape` that also returns focus to the toggle button, so keyboard users
 * aren't dropped onto <body> when the popup unmounts.
 */
export function useClickOutside(ref: RefObject<HTMLElement | null>, handler: () => void, active = true, onEscape: () => void = handler): void {
  useEffect(() => {
    if (!active) return;
    const onPointer = (e: PointerEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) handler();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, handler, active, onEscape]);
}

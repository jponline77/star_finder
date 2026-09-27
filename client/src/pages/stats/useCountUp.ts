import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../hooks/useMediaQuery';

/** easeOutCubic */
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Animated number that counts from 0 (or its previous value) up to `target`.
 * Returns the final value straight away when the user prefers reduced motion, when
 * requestAnimationFrame is unavailable (tests), or when `target` is not positive.
 * Callers should expose the final number to assistive tech separately (the animated
 * text is decorative).
 */
export function useCountUp(target: number, duration = 900): number {
  const skip = () => !Number.isFinite(target) || target <= 0 || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function' || prefersReducedMotion();
  const [value, setValue] = useState(() => (skip() ? target : 0));
  const fromRef = useRef(value);

  useEffect(() => {
    if (skip()) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    let raf = 0;
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / duration);
      const v = Math.round(from + (target - from) * ease(t));
      fromRef.current = v;
      setValue(v);
      if (t < 1) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
}

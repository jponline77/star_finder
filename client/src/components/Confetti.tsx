/**
 * Confetti burst on a <canvas> — no library. Respects prefers-reduced-motion (does nothing).
 *
 *   import { fireConfetti } from '../components/Confetti';
 *   fireConfetti();                                  // centre-top burst
 *   fireConfetti({ x: 0.5, y: 0.6, count: 200 });    // x/y as 0..1 of the viewport
 *   <Confetti fire={submitCount} />                  // declarative: bursts whenever `fire` changes (> 0)
 */
import { useEffect } from 'react';
import { prefersReducedMotion } from '../hooks/useMediaQuery';

export interface ConfettiOptions {
  /** 0..1 horizontal origin (default 0.5) */
  x?: number;
  /** 0..1 vertical origin (default 0.35) */
  y?: number;
  count?: number;
  /** ms (default 2600) */
  duration?: number;
  colors?: string[];
}

const DEFAULT_COLORS = ['#ffc94a', '#ffe08a', '#ff5fa8', '#34e0c8', '#c792ff', '#ffffff', '#ff8a65'];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  shape: 'rect' | 'circle' | 'star';
  wobble: number;
}

function drawStar(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

/** Fire a one-off burst. Returns a function that stops it early. */
export function fireConfetti(options: ConfettiOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (prefersReducedMotion()) return () => {};
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return () => {};
  canvas.className = 'confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  document.body.appendChild(canvas);

  const colors = options.colors ?? DEFAULT_COLORS;
  const count = options.count ?? Math.round(Math.min(220, Math.max(90, w / 6)));
  const duration = options.duration ?? 2600;
  const ox = (options.x ?? 0.5) * w;
  const oy = (options.y ?? 0.35) * h;
  const particles: Particle[] = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 9;
    const shapes: Particle['shape'][] = ['rect', 'rect', 'circle', 'star'];
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      size: 5 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      color: colors[Math.floor(Math.random() * colors.length)] ?? '#ffc94a',
      shape: shapes[Math.floor(Math.random() * shapes.length)] ?? 'rect',
      wobble: Math.random() * 10,
    };
  });

  const start = performance.now();
  let raf = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    canvas.remove();
  };
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    const fade = t > duration - 600 ? Math.max(0, (duration - t) / 600) : 1;
    for (const p of particles) {
      p.vy += 0.28; // gravity
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx + Math.sin((t / 180) + p.wobble) * 0.6;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 3, 0, Math.PI * 2);
        ctx.fill();
      } else drawStar(ctx, p.size / 1.6);
      ctx.restore();
    }
    if (t < duration) raf = requestAnimationFrame(frame);
    else stop();
  };
  raf = requestAnimationFrame(frame);
  return stop;
}

/** Declarative wrapper: bursts every time `fire` changes to a new truthy value. */
export function Confetti({ fire, ...options }: ConfettiOptions & { fire: number | boolean }) {
  useEffect(() => {
    if (!fire) return;
    return fireConfetti(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fire]);
  return null;
}

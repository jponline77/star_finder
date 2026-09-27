import type { ElementType, ReactNode } from 'react';

export interface MarqueeProps {
  children: ReactNode;
  /** bulb size: sm (header logo), md (default), lg (hero) */
  size?: 'sm' | 'md' | 'lg';
  /** Turn off the chase animation. */
  still?: boolean;
  /** Wrapper element (default div). */
  as?: ElementType;
  className?: string;
  innerClassName?: string;
}

/**
 * Broadway marquee sign: a frame of light bulbs (CSS only, chase-blink animation that turns off
 * under prefers-reduced-motion) around a dark panel. Put `.marquee-text` on gold lettering.
 */
export function Marquee({ children, size = 'md', still = false, as: Tag = 'div', className = '', innerClassName = '' }: MarqueeProps) {
  return (
    <Tag className={`marquee${size !== 'md' ? ` marquee-${size}` : ''}${still ? ' is-still' : ''} ${className}`.trim()}>
      <div className={`marquee-inner ${innerClassName}`.trim()}>{children}</div>
    </Tag>
  );
}

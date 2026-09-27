export interface MatureBadgeProps {
  mature: boolean;
  /** 'full' = "⚠️ Mature themes" (default), 'compact' = "⚠️ Mature" */
  variant?: 'full' | 'compact';
  className?: string;
}

/** Discreet mature-content label (renders nothing when mature is false). */
export function MatureBadge({ mature, variant = 'full', className = '' }: MatureBadgeProps) {
  if (!mature) return null;
  return (
    <span className={`mature-badge ${className}`.trim()} title="Mature themes — check with your teacher">
      <span className="emoji" aria-hidden="true">
        ⚠️
      </span>
      {variant === 'compact' ? 'Mature' : 'Mature themes'}
    </span>
  );
}

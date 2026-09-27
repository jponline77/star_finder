import { X } from 'lucide-react';
import { activeFilterPills, clearFilters, type FilterState } from '../lib/filters';

export interface ActiveFilterPillsProps {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  /** meta.shows (to show show names instead of slugs) */
  shows?: ReadonlyArray<{ slug: string; name: string; id?: number }>;
  className?: string;
}

/** One removable pill per active filter + "Clear all" (data-testid="clear-filters"). Renders nothing when unfiltered. */
export function ActiveFilterPills({ filters, onChange, shows = [], className = '' }: ActiveFilterPillsProps) {
  const pills = activeFilterPills(filters, shows);
  if (!pills.length) return null;
  return (
    <div className={`active-pills ${className}`.trim()} aria-label="Active filters" role="group" data-testid="active-filters">
      {pills.map((p) => (
        <span className="pill" key={p.id} data-testid="filter-pill">
          {p.emoji && (
            <span className="emoji" aria-hidden="true">
              {p.emoji}
            </span>
          )}
          <span>
            <span className="visually-hidden">{p.group}: </span>
            {p.label}
          </span>
          <button type="button" className="pill-remove" aria-label={`Remove filter ${p.group}: ${p.label}`} onClick={() => onChange(p.next)}>
            <X size={14} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => onChange(clearFilters(filters))} data-testid="clear-filters">
        Clear all
      </button>
    </div>
  );
}

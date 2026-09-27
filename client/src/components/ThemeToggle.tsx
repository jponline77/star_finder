import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../lib/theme';

/** Sun/moon toggle between the dark "stage" and light "matinee" themes (remembered). */
export function ThemeToggle({ withLabel = false, className = '', testId = 'theme-toggle' }: { withLabel?: boolean; className?: string; testId?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light (matinee)' : 'dark (stage)';
  if (withLabel) {
    return (
      <button type="button" className={`btn btn-ghost ${className}`.trim()} onClick={toggle} data-testid={testId}>
        {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        {theme === 'dark' ? 'Matinee (light) theme' : 'Stage (dark) theme'}
      </button>
    );
  }
  return (
    <button type="button" className={`btn-icon is-filled ${className}`.trim()} onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`} data-testid={testId}>
      {theme === 'dark' ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
    </button>
  );
}

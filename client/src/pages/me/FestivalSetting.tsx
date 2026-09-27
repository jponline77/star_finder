/**
 * /me "My festival" (SPEC §7b): the inline festival picker, saved to the account via
 * useFestival().setFestival (PUT /api/auth/me { festivalSlug }).
 */
import { Check, MapPin } from 'lucide-react';
import { FestivalPicker } from '../../components/FestivalPicker';
import { useFestival } from '../../state/FestivalProvider';

export function FestivalSetting({ mustChange = false }: { mustChange?: boolean }) {
  const { saving, selected, source } = useFestival();
  const status = saving ? 'Saving…' : mustChange ? 'Choose a new password first — then this is saved to your account too.' : selected && source === 'account' ? 'Saved to your account' : '';
  return (
    <section className="me-form card me-festival" aria-labelledby="me-festival-title" data-testid="me-festival">
      <h2 id="me-festival-title" className="me-form-title">
        <MapPin size={20} aria-hidden="true" /> My festival
      </h2>
      <p className="me-form-lede">We’ll count down to it on the home page and highlight it on STAR Prep, on every device you log in on.</p>
      <FestivalPicker variant="inline" id="me-festival-select" label="Where are you performing?" allowClear testId="me-festival-select" />
      <p className={`me-festival-status${status && !saving && !mustChange ? ' is-saved' : ''}`} role="status" aria-live="polite" data-testid="me-festival-status">
        {status && !saving && !mustChange && <Check size={15} aria-hidden="true" />}
        {status}
      </p>
    </section>
  );
}

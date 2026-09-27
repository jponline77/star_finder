/**
 * Signup "/signup" (SPEC §7.12): display name (public — not your full name), email, password
 * with show/hide + strength hint, ?next= redirect, inline + server errors.
 * data-testids: signup-name, signup-email, signup-password, signup-submit, signup-error.
 */
import { Ticket } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { errorMessage, isApiError } from '../api';
import { PasswordInput } from '../components/PasswordInput';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { loginHref, safeNextPath } from '../lib/links';
import { DISPLAY_NAME_MAX, passwordStrength, validateDisplayName, validateEmail, validatePassword } from '../lib/validation';
import { useAuth } from '../state/AuthProvider';
import { useFestival } from '../state/FestivalProvider';
import { useToast } from '../state/ToastProvider';
import { BackstagePass } from './BackstagePass';

type Errors = Partial<Record<'displayName' | 'email' | 'password', string>>;

export default function SignupPage() {
  useDocumentTitle('Get a backstage pass');
  const { user, loading, signup } = useAuth();
  // The festival this visitor already picked (not a site-wide default) goes onto the new account.
  const { selected: festival, source: festivalSource } = useFestival();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'), '/');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to={next} replace />;

  const strength = passwordStrength(password);

  const validate = (): Errors => {
    const e: Errors = {};
    const dn = validateDisplayName(displayName);
    const em = validateEmail(email);
    const pw = validatePassword(password);
    if (dn) e.displayName = dn;
    if (em) e.email = em;
    if (pw) e.password = pw;
    return e;
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const e = validate();
    setErrors(e);
    setFormError(null);
    setDuplicate(false);
    if (Object.keys(e).length) {
      const first = (['displayName', 'email', 'password'] as const).find((k) => e[k]);
      if (first) document.getElementById(`signup-${first === 'displayName' ? 'name' : first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const festivalSlug = festival && (festivalSource === 'local' || festivalSource === 'url') ? festival.slug : undefined;
      const me = await signup({ displayName, email, password, festivalSlug });
      toast.success(`You're in the cast, ${me.displayName}!`, { emoji: '🎉', title: 'Backstage pass issued' });
    } catch (err) {
      setBusy(false);
      if (isApiError(err)) {
        if (err.status === 409) {
          setDuplicate(true);
          setErrors({ email: err.message || 'An account with that email already exists' });
          return;
        }
        const d = err.details;
        const fieldErrors: Errors = {};
        if (d.displayName) fieldErrors.displayName = d.displayName;
        if (d.email) fieldErrors.email = d.email;
        if (d.password) fieldErrors.password = d.password;
        setErrors(fieldErrors);
        if (!Object.keys(fieldErrors).length) setFormError(err.isNetworkError ? "Can't reach the server right now. Try again in a moment." : err.message);
        return;
      }
      setFormError(errorMessage(err));
    }
  };

  const described = (field: keyof Errors, hintId?: string) => [hintId, errors[field] ? `signup-${field}-error` : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <BackstagePass kicker="Backstage Pass" title="Join the cast" stubText="ALL ACCESS">
      <p className="ticket-lede">Make a free account to add songs, share tips in Backstage Chatter, and help other performers.</p>
      <form className="ticket-form" onSubmit={onSubmit} noValidate data-testid="signup-form">
        {formError && (
          <div className="callout callout-danger" role="alert" data-testid="signup-error">
            <span aria-hidden="true">🎭</span>
            <span>{formError}</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="signup-name" className="label">
            Display name
          </label>
          <input
            id="signup-name"
            className="input"
            autoComplete="nickname"
            maxLength={DISPLAY_NAME_MAX + 10}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => displayName && setErrors((x) => ({ ...x, displayName: validateDisplayName(displayName) ?? undefined }))}
            aria-invalid={errors.displayName ? true : undefined}
            aria-describedby={described('displayName', 'signup-name-hint')}
            data-testid="signup-name"
          />
          <p id="signup-name-hint" className="hint">
            Shown next to your songs &amp; comments — don’t use your full name. Try a stage name like “BroadwayBelter”!
          </p>
          {errors.displayName && (
            <p id="signup-displayName-error" className="field-error" role="alert">
              {errors.displayName}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="signup-email" className="label">
            Email
          </label>
          <input
            id="signup-email"
            className="input"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email && setErrors((x) => ({ ...x, email: validateEmail(email) ?? undefined }))}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={described('email', 'signup-email-hint')}
            data-testid="signup-email"
          />
          <p id="signup-email-hint" className="hint">
            Used only to log in. Only you and the site admins (your teachers) can see it — it’s never shown publicly.
          </p>
          {errors.email && (
            <p id="signup-email-error" className="field-error" role="alert">
              {errors.email}
              {duplicate && (
                <>
                  {' '}
                  — <Link to={loginHref(params.get('next'))}>log in instead?</Link>
                </>
              )}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="signup-password" className="label">
            Password
          </label>
          <PasswordInput
            id="signup-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={described('password', 'signup-password-hint')}
            data-testid="signup-password"
          />
          <div className="strength" data-score={strength.score} aria-hidden={password ? undefined : true}>
            <span className="strength-bar">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={i <= strength.score ? 'is-on' : undefined} />
              ))}
            </span>
            <span id="signup-password-hint" className="hint">
              {password ? `Strength: ${strength.label}` : 'At least 8 characters. Longer is stronger — try three or more random words you’ll remember, and don’t reuse a password from another site.'}
            </span>
          </div>
          {errors.password && (
            <p id="signup-password-error" className="field-error" role="alert">
              {errors.password}
            </p>
          )}
        </div>
        {/* aria-disabled (not disabled) while busy, so keyboard focus stays on the button */}
        <button type="submit" className="btn btn-primary btn-lg btn-block" aria-disabled={busy || undefined} data-testid="signup-submit">
          {busy ? <span className="spinner" aria-hidden="true" /> : <Ticket size={20} aria-hidden="true" />}
          {busy ? 'Printing your pass…' : 'Get my backstage pass'}
        </button>
      </form>
      <p className="ticket-switch">
        Already have a pass? <Link to={loginHref(params.get('next'))}>Log in</Link>
      </p>
    </BackstagePass>
  );
}

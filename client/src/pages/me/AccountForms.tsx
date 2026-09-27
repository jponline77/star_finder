/**
 * /me account settings: display name + change password (PUT /api/auth/me via useAuth().updateProfile).
 */
import { BadgeCheck, KeyRound, Save, UserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, isApiError } from '../../api';
import { Field } from '../../components/Controls';
import { PasswordInput } from '../../components/PasswordInput';
import { DISPLAY_NAME_MAX, passwordStrength, validateDisplayName, validatePassword } from '../../lib/validation';
import { useAuth } from '../../state/AuthProvider';
import { useToast } from '../../state/ToastProvider';

// ---------------------------------------------------------------- profile

export function ProfileForm() {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const current = user?.displayName ?? '';
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // keep in sync if the user object changes elsewhere
  useEffect(() => {
    setName(current);
  }, [current]);

  const trimmed = name.trim();
  const unchanged = trimmed === current;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v = validateDisplayName(name);
    if (v) {
      setError(v);
      return;
    }
    if (unchanged) return;
    setBusy(true);
    setError(null);
    try {
      const me = await updateProfile({ displayName: trimmed });
      setName(me.displayName);
      toast.success(`You’re now appearing as “${me.displayName}”`, { emoji: '🌟', id: 'profile' });
    } catch (err) {
      setError(isApiError(err) ? (err.field('displayName') ?? err.message) : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="me-form card" onSubmit={submit} noValidate aria-labelledby="me-profile-title" data-testid="profile-form">
      <h2 id="me-profile-title" className="me-form-title">
        <UserRound size={20} aria-hidden="true" /> Profile
      </h2>
      <Field label="Display name" hint="Shown next to your songs & comments — don’t use your full name." error={error}>
        {(p) => (
          <input
            id={p.id}
            className="input"
            value={name}
            maxLength={DISPLAY_NAME_MAX + 10}
            autoComplete="nickname"
            aria-describedby={p.describedBy}
            aria-invalid={p.invalid || undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            data-testid="profile-name"
          />
        )}
      </Field>
      <div className="me-form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || unchanged || !trimmed} data-testid="profile-save">
          {busy ? <span className="spinner" aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
          Save name
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- password

export const CURRENT_PASSWORD_ID = 'me-current-password';

type PwErrors = Partial<Record<'currentPassword' | 'newPassword' | 'confirm' | 'form', string>>;

export function PasswordForm({ highlight = false }: { highlight?: boolean }) {
  const { updateProfile } = useAuth();
  const toast = useToast();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<PwErrors>({});
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(newPassword);

  const validate = (): PwErrors => {
    const e: PwErrors = {};
    if (!currentPassword) e.currentPassword = highlight ? 'Enter the temporary password your admin gave you.' : 'Enter your current password.';
    const pw = validatePassword(newPassword);
    if (pw) e.newPassword = pw;
    else if (newPassword === currentPassword) e.newPassword = 'Pick something different from your current password.';
    if (!e.newPassword && confirm !== newPassword) e.confirm = 'The two new passwords don’t match.';
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length) {
      const first = v.currentPassword ? CURRENT_PASSWORD_ID : v.newPassword ? 'me-new-password' : 'me-confirm-password';
      document.getElementById(first)?.focus();
      return;
    }
    setBusy(true);
    try {
      await updateProfile({ currentPassword, newPassword });
      setCurrent('');
      setNew('');
      setConfirm('');
      setErrors({});
      toast.success('Password updated — you’re all set! Other devices have been logged out.', { emoji: '🔐', id: 'password' });
    } catch (err) {
      if (isApiError(err)) {
        const cur = err.field('currentPassword');
        const np = err.field('newPassword');
        if (cur || np) setErrors({ currentPassword: cur ?? undefined, newPassword: np ?? undefined });
        else if (err.status === 429) setErrors({ form: 'Too many tries — take a breather and try again in a few minutes.' });
        else setErrors({ form: err.message });
        if (cur) document.getElementById(CURRENT_PASSWORD_ID)?.focus();
      } else {
        setErrors({ form: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  const clear = (k: keyof PwErrors) => {
    if (errors[k] || errors.form) setErrors((e) => ({ ...e, [k]: undefined, form: undefined }));
  };

  return (
    <form id="password" className={`me-form card${highlight ? ' is-highlight' : ''}`} onSubmit={submit} noValidate aria-labelledby="me-password-title" data-testid="password-form">
      <h2 id="me-password-title" className="me-form-title">
        <KeyRound size={20} aria-hidden="true" /> {highlight ? 'Choose a new password' : 'Change password'}
      </h2>
      {highlight && <p className="small me-form-lede">Type the temporary password from your admin, then pick a brand-new one only you know.</p>}
      <Field id={CURRENT_PASSWORD_ID} label={highlight ? 'Temporary password' : 'Current password'} error={errors.currentPassword}>
        {(p) => (
          <PasswordInput
            id={p.id}
            value={currentPassword}
            autoComplete="current-password"
            aria-describedby={p.describedBy}
            aria-invalid={p.invalid || undefined}
            onChange={(e) => {
              setCurrent(e.target.value);
              clear('currentPassword');
            }}
            data-testid="password-current"
          />
        )}
      </Field>
      <Field id="me-new-password" label="New password" error={errors.newPassword} hint={newPassword ? `Strength: ${strength.label}` : 'At least 8 characters — three or more random words you’ll remember work great. Don’t reuse a password from another site.'}>
        {(p) => (
          <>
            <PasswordInput
              id={p.id}
              value={newPassword}
              autoComplete="new-password"
              aria-describedby={p.describedBy}
              aria-invalid={p.invalid || undefined}
              onChange={(e) => {
                setNew(e.target.value);
                clear('newPassword');
              }}
              data-testid="password-new"
            />
            <span className="me-strength" data-score={strength.score} aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} className={i <= strength.score ? 'is-on' : undefined} />
              ))}
            </span>
          </>
        )}
      </Field>
      <Field id="me-confirm-password" label="Confirm new password" error={errors.confirm}>
        {(p) => (
          <PasswordInput
            id={p.id}
            value={confirm}
            autoComplete="new-password"
            aria-describedby={p.describedBy}
            aria-invalid={p.invalid || undefined}
            onChange={(e) => {
              setConfirm(e.target.value);
              clear('confirm');
            }}
            data-testid="password-confirm"
          />
        )}
      </Field>
      {errors.form && (
        <p className="field-error" role="alert" data-testid="password-error">
          {errors.form}
        </p>
      )}
      <div className="me-form-actions">
        {/* aria-disabled (not disabled) while busy, so keyboard focus stays on the button */}
        <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined} data-testid="password-save">
          {busy ? <span className="spinner" aria-hidden="true" /> : <BadgeCheck size={18} aria-hidden="true" />}
          Update password
        </button>
      </div>
    </form>
  );
}

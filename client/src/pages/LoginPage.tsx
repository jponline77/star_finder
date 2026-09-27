/**
 * Login "/login" (SPEC §7.12): Backstage Pass card, ?next= redirect, friendly errors,
 * mustChangePassword → /me.
 * data-testids: login-email, login-password, login-submit, login-error.
 */
import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { errorMessage, isApiError } from '../api';
import { PasswordInput } from '../components/PasswordInput';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { safeNextPath, signupHref } from '../lib/links';
import { validateEmail } from '../lib/validation';
import { useAuth } from '../state/AuthProvider';
import { useToast } from '../state/ToastProvider';
import { BackstagePass } from './BackstagePass';

export default function LoginPage() {
  useDocumentTitle('Log in');
  const { user, loading, login } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'), '/');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  if (!loading && user) {
    return <Navigate to={user.mustChangePassword ? '/me' : next} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const ee = validateEmail(email);
    setEmailError(ee);
    if (ee) return;
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const me = await login(email, password);
      if (me.mustChangePassword) {
        toast.warning('Your password was reset — please choose a new one.', { emoji: '🔑', duration: 8000 });
      } else {
        toast.success(`Welcome back, ${me.displayName}!`, { emoji: '🌟' });
      }
      // <Navigate> above takes over on the next render
    } catch (err) {
      if (isApiError(err) && err.isNetworkError) setError("Can't reach the server right now. Try again in a moment.");
      else setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <BackstagePass kicker="Backstage Pass" title="Welcome back!">
      <p className="ticket-lede">Log in to add songs, leave comments and keep track of your contributions.</p>
      <form className="ticket-form" onSubmit={onSubmit} noValidate data-testid="login-form">
        {error && (
          <div className="callout callout-danger" role="alert" data-testid="login-error">
            <span aria-hidden="true">🎭</span>
            <span>{error}</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="login-email" className="label">
            Email
          </label>
          <input
            id="login-email"
            className="input"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email && setEmailError(validateEmail(email))}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? 'login-email-error' : undefined}
            required
            data-testid="login-email"
          />
          {emailError && (
            <p id="login-email-error" className="field-error">
              {emailError}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="login-password" className="label">
            Password
          </label>
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            data-testid="login-password"
          />
        </div>
        {/* aria-disabled (not disabled) while busy, so keyboard focus stays on the button */}
        <button type="submit" className="btn btn-primary btn-lg btn-block" aria-disabled={busy || undefined} data-testid="login-submit">
          {busy ? <span className="spinner" aria-hidden="true" /> : <LogIn size={20} aria-hidden="true" />}
          {busy ? 'Checking your pass…' : 'Let me backstage'}
        </button>
      </form>
      <p className="ticket-switch">
        New here? <Link to={signupHref(params.get('next'))}>Get your backstage pass</Link>
      </p>
      <p className="ticket-fineprint">Forgot your password? Ask your teacher or a site admin to reset it for you.</p>
    </BackstagePass>
  );
}

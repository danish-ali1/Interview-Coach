import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ErrorMessage } from '../components/ui.jsx';

function Field({ label, error, hint, ...props }) {
  const id = props.name;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} {...props} />
      {error ? (
        <div id={`${id}-err`} className="field-error">{error}</div>
      ) : (
        hint && <div id={`${id}-hint`} className="muted small">{hint}</div>
      )}
    </div>
  );
}

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
        <p className="muted small center">{footer}</p>
      </div>
    </div>
  );
}

function useAuthForm(action) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event, values) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // No navigation here: once the session is set, <PublicOnly> redirects to the page the user
      // originally asked for. Navigating in two places made the final destination timing-dependent.
      await action(values);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return { error, busy, submit };
}

export function LoginPage() {
  const { login } = useAuth();
  const { error, busy, submit } = useAuthForm(login);
  const [values, setValues] = useState({ email: '', password: '' });
  const set = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }));

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to keep practising."
      footer={<>New here? <Link to="/register">Create an account</Link></>}
    >
      <form onSubmit={(e) => submit(e, values)} noValidate>
        <ErrorMessage error={error} />
        <Field label="Email" name="email" type="email" autoComplete="email" required value={values.email} onChange={set} error={error?.fieldErrors.email} />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required value={values.password} onChange={set} error={error?.fieldErrors.password} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const { error, busy, submit } = useAuthForm(register);
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const set = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }));

  return (
    <AuthShell
      title="Create your account"
      subtitle="Practise with questions drawn from your own resume."
      footer={<>Already registered? <Link to="/login">Sign in</Link></>}
    >
      <form onSubmit={(e) => submit(e, values)} noValidate>
        <ErrorMessage error={error} />
        <Field label="Name" name="name" autoComplete="name" required value={values.name} onChange={set} error={error?.fieldErrors.name} />
        <Field label="Email" name="email" type="email" autoComplete="email" required value={values.email} onChange={set} error={error?.fieldErrors.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={values.password}
          onChange={set}
          error={error?.fieldErrors.password}
          hint="8 to 72 characters, with at least one letter and one number."
        />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthShell>
  );
}

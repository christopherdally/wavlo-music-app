import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Register() {
  const { register, user } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signupEnabled, setSignupEnabled] = useState(true);

  useEffect(() => {
    api
      .getAuthConfig()
      .then((config) => setSignupEnabled(config.signupEnabled))
      .catch(() => {});
  }, []);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(email, password, displayName);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!signupEnabled) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="brand">Wavlo</h1>
          <h2>Sign-up is disabled</h2>
          <p className="auth-switch">
            This instance isn't accepting new accounts right now. <Link to="/login">Log in</Link> if you already
            have one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1 className="brand">Wavlo</h1>
        <h2>Create your account</h2>
        {error && <div className="auth-error">{error}</div>}
        <label>Display name</label>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        <label>Password</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          minLength={6}
          required
        />
        <button className="btn-primary" disabled={busy} type="submit">
          {busy ? 'Creating…' : 'Sign up'}
        </button>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}

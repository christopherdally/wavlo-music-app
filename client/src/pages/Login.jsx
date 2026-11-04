import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Login() {
  const { login, user } = useAuth();
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
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1 className="brand">Wavlo</h1>
        <h2>Log in</h2>
        {error && <div className="auth-error">{error}</div>}
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        <label>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        <button className="btn-primary" disabled={busy} type="submit">
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        {signupEnabled && (
          <p className="auth-switch">
            No account? <Link to="/register">Sign up</Link>
          </p>
        )}
      </form>
    </div>
  );
}

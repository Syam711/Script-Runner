import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Wordmark, Icon } from '../lib/icons';
import Handshake from '../components/Handshake';

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await signIn({ email, password });
    setBusy(false);
    if (err) return setError(err.message);
    navigate('/');
  };

  return (
    <div className="auth">
      <aside className="auth-stage">
        <div className="auth-pitch">
          <h1>Your servers, one keystroke away.</h1>
          <p>
            Save the scripts you run every day, keep the login steps for every region, and run
            them without opening a terminal.
          </p>
        </div>
        <Handshake />
      </aside>

      <main className="auth-form-side">
        <div className="auth-form">
          <div className="auth-mark">
            <Wordmark />
          </div>

          <div className="auth-head">
            <h2>Sign in</h2>
            <p>Pick up where you left off.</p>
          </div>

          <form onSubmit={submit} className="auth-fields">
            <label className="field">
              <span className="field-label">Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@company.com"
                required
              />
            </label>

            <label className="field">
              <span className="field-label">Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </label>

            {error && (
              <p className="form-error">
                <Icon.Alert size={15} />
                <span>{error}</span>
              </p>
            )}

            <button type="submit" className="btn btn-primary btn-lg btn-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="auth-foot">
            New here? <Link to="/signup">Create an account</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

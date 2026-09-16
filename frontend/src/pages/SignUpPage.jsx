import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Wordmark, Icon } from '../lib/icons';
import Handshake from '../components/Handshake';

export default function SignUpPage() {
  const navigate = useNavigate();
  const { signUp } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [claimAdmin, setClaimAdmin] = useState(false);
  const [adminExists, setAdminExists] = useState(true); // fail closed until confirmed
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    supabase.rpc('admin_exists').then(({ data, error: rpcErr }) => {
      if (!alive) return;
      setAdminExists(rpcErr ? true : Boolean(data));
      setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await signUp({
      email,
      password,
      displayName,
      wantsAdmin: !adminExists && claimAdmin,
    });
    setBusy(false);
    if (err) return setError(err.message);
    navigate('/');
  };

  return (
    <div className="auth">
      <aside className="auth-stage">
        <div className="auth-pitch">
          <h1>Stop retyping the same commands.</h1>
          <p>
            Every region, every login sequence, every script your team relies on — kept in one
            place and ready to run.
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
            <h2>Create your account</h2>
            <p>Takes about a minute.</p>
          </div>

          <form onSubmit={submit} className="auth-fields">
            <label className="field">
              <span className="field-label">Name</span>
              <input
                className="input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                placeholder="Priya Raman"
                required
              />
            </label>

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
                autoComplete="new-password"
                placeholder="At least 8 characters"
                minLength={8}
                required
              />
            </label>

            {!checking && !adminExists && (
              <label className="claim">
                <input
                  type="checkbox"
                  checked={claimAdmin}
                  onChange={(e) => setClaimAdmin(e.target.checked)}
                />
                <span>
                  <span className="claim-title">Set yourself up as admin</span>
                  <span className="claim-note">
                    No one has claimed this yet. Admins manage regions, share scripts with the
                    team, and see all activity. Once taken, only an admin can appoint another.
                  </span>
                </span>
              </label>
            )}

            {error && (
              <p className="form-error">
                <Icon.Alert size={15} />
                <span>{error}</span>
              </p>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-lg btn-full"
              disabled={busy || checking}
            >
              {busy ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="auth-foot">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </main>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { AUTH_TYPE_OPTIONS, buildDefaultLoginSteps } from '../lib/loginStepTemplates';
import { backendApi } from '../lib/backendApi';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../lib/icons';

const blank = {
  name: '',
  host: '',
  port: 22,
  authType: 'password',
  visibility: 'private',
  username: '',
  password: '',
  serviceUsername: '',
  servicePassword: '',
};

export default function RegionForm({ existingRegion, onSaved, onCancel }) {
  const { isAdmin } = useAuth();
  const editing = Boolean(existingRegion);

  const [form, setForm] = useState(blank);
  const [steps, setSteps] = useState([]);
  const [stepsLoaded, setStepsLoaded] = useState(!existingRegion);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!existingRegion) return;

    setForm({
      ...blank,
      name: existingRegion.name,
      host: existingRegion.host,
      port: existingRegion.port,
      authType: existingRegion.auth_type,
      visibility: existingRegion.visibility,
    });

    // Load the region's real saved steps. Regenerating from the
    // template here would quietly discard any hand-tuned patterns the
    // next time this form is saved, even for an unrelated edit.
    let alive = true;
    setStepsLoaded(false);
    supabase
      .from('region_login_steps')
      .select('*')
      .eq('region_id', existingRegion.id)
      .order('step_order', { ascending: true })
      .then(({ data, error: err }) => {
        if (!alive) return;
        if (!err && data) setSteps(data);
        setStepsLoaded(true);
      });

    return () => {
      alive = false;
    };
  }, [existingRegion]);

  useEffect(() => {
    if (!editing) {
      setSteps(buildDefaultLoginSteps(form.authType, { serviceUsername: form.serviceUsername }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.authType]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const changeAuthType = (e) => {
    const next = e.target.value;
    setForm((f) => ({ ...f, authType: next }));
    if (editing) {
      // A deliberate switch of login method means the old sequence
      // can't apply, so replacing it is correct here.
      setSteps(buildDefaultLoginSteps(next, { serviceUsername: form.serviceUsername }));
    }
  };

  const editStep = (i, key, value) =>
    setSteps((list) => list.map((s, n) => (n === i ? { ...s, [key]: value } : s)));

  const needsSu = form.authType === 'password_su' || form.authType === 'key_su';
  const needsPassword = form.authType === 'password' || form.authType === 'password_su';
  const isKeyAuth = form.authType.startsWith('key');

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        host: form.host,
        port: Number(form.port),
        authType: form.authType,
        visibility: form.visibility,
        username: form.username || undefined,
        password: form.password || undefined,
        serviceUsername: form.serviceUsername || undefined,
        servicePassword: form.servicePassword || undefined,
        loginSteps: steps,
      };
      if (editing) await backendApi.updateRegion(existingRegion.id, payload);
      else await backendApi.createRegion(payload);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      <label className="field">
        <span className="field-label">Name</span>
        <input
          className="input"
          value={form.name}
          onChange={set('name')}
          placeholder="Production · Mumbai"
          required
        />
      </label>

      <div className="field-row">
        <label className="field" style={{ flex: 2 }}>
          <span className="field-label">Host</span>
          <input
            className="input input-mono"
            value={form.host}
            onChange={set('host')}
            placeholder="10.24.8.15"
            required
          />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span className="field-label">Port</span>
          <input
            className="input input-mono"
            type="number"
            value={form.port}
            onChange={set('port')}
            required
          />
        </label>
      </div>

      <label className="field">
        <span className="field-label">How you log in</span>
        <select className="select" value={form.authType} onChange={changeAuthType}>
          {AUTH_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {isKeyAuth && (
        <p className="notice notice-warn">
          <Icon.Alert size={15} />
          <span>
            Key-based login isn't wired up yet — there's nowhere to add a key. Pick a password
            method for now.
          </span>
        </p>
      )}

      <div className="field-row">
        <label className="field">
          <span className="field-label">Username</span>
          <input
            className="input input-mono"
            value={form.username}
            onChange={set('username')}
            placeholder="ops"
          />
        </label>
        {needsPassword && (
          <label className="field">
            <span className="field-label">Password</span>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={set('password')}
              placeholder={editing ? 'Leave blank to keep current' : '••••••••'}
              required={!editing}
            />
          </label>
        )}
      </div>

      {needsSu && (
        <div className="field-row">
          <label className="field">
            <span className="field-label">Service account</span>
            <input
              className="input input-mono"
              value={form.serviceUsername}
              onChange={set('serviceUsername')}
              placeholder="serviceacc"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Service account password</span>
            <input
              className="input"
              type="password"
              value={form.servicePassword}
              onChange={set('servicePassword')}
              placeholder={editing ? 'Leave blank to keep current' : '••••••••'}
              required={!editing}
            />
          </label>
        </div>
      )}

      <p className="notice notice-info">
        <Icon.Lock size={15} />
        <span>Passwords are encrypted before they're stored and never sent back to the browser.</span>
      </p>

      {isAdmin && (
        <label className="field">
          <span className="field-label">Who can see it</span>
          <select className="select" value={form.visibility} onChange={set('visibility')}>
            <option value="private">Just me</option>
            <option value="shared">My team — pick people after saving</option>
          </select>
        </label>
      )}

      <div>
        <button
          type="button"
          className={`disclosure${advanced ? ' disclosure-open' : ''}`}
          onClick={() => setAdvanced((v) => !v)}
        >
          <Icon.ChevronRight size={14} />
          Login steps
        </button>
      </div>

      {advanced && (
        <div className="stack" style={{ gap: 'var(--s-3)' }}>
          <p className="field-note">
            {editing
              ? "These are this server's saved steps. Change them only if its prompts differ."
              : 'Filled in from the login method above. Change them only if this server\u2019s prompts differ.'}{' '}
            Use <code className="mono-sm">{'{password}'}</code> and{' '}
            <code className="mono-sm">{'{service_password}'}</code> — never the real values.
          </p>

          {!stepsLoaded ? (
            <p className="muted">Loading steps…</p>
          ) : steps.length === 0 ? (
            <p className="muted">This method connects without a prompt sequence.</p>
          ) : (
            <div className="steps">
              {steps.map((s, i) => (
                <div className="step" key={i}>
                  <span className="step-n">{i + 1}</span>
                  <input
                    className="input input-mono"
                    value={s.expect_pattern}
                    onChange={(e) => editStep(i, 'expect_pattern', e.target.value)}
                    placeholder="Wait for…"
                  />
                  <input
                    className="input input-mono"
                    value={s.send_template}
                    onChange={(e) => editStep(i, 'send_template', e.target.value)}
                    placeholder="Then send…"
                  />
                  <input
                    className="input input-mono"
                    type="number"
                    value={s.timeout_ms}
                    onChange={(e) => editStep(i, 'timeout_ms', Number(e.target.value))}
                    title="Give up after (ms)"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="notice notice-danger">
          <Icon.Alert size={15} />
          <span>{error}</span>
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !stepsLoaded}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Add region'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

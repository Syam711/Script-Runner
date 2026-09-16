import { useState } from 'react';
import { backendApi } from '../lib/backendApi';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../lib/icons';

const TIERS = [
  { value: 'safe', label: 'Safe — only reads' },
  { value: 'caution', label: 'Changes state' },
  { value: 'destructive', label: 'Destructive — hard to undo' },
];

export default function CommandForm({ regionId, existingCommand, onSaved, onCancel }) {
  const { isAdmin } = useAuth();
  const editing = Boolean(existingCommand);

  const [name, setName] = useState(existingCommand?.name || '');
  const [content, setContent] = useState(existingCommand?.content || '');
  const [tier, setTier] = useState(existingCommand?.safety_tier || 'safe');
  const [visibility, setVisibility] = useState(existingCommand?.visibility || 'private');
  const [timeout, setTimeoutS] = useState(existingCommand?.timeout_seconds || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        regionId,
        name,
        content,
        safetyTier: tier,
        visibility,
        timeoutSeconds: timeout ? Number(timeout) : null,
      };
      if (editing) await backendApi.updateCommand(existingCommand.id, payload);
      else await backendApi.createCommand(payload);
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Check disk usage"
          required
        />
      </label>

      <label className="field">
        <span className="field-label">Script</span>
        <textarea
          className="textarea code-input"
          rows={10}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          placeholder={'#!/bin/bash\ndf -h /var\nfree -m'}
          required
        />
        {editing && (
          <span className="field-note">
            Saving a change keeps the old version in history — currently on v
            {existingCommand.current_version}.
          </span>
        )}
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field-label">What it does</span>
          <select className="select" value={tier} onChange={(e) => setTier(e.target.value)}>
            {TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Give up after</span>
          <input
            className="input"
            type="number"
            value={timeout}
            onChange={(e) => setTimeoutS(e.target.value)}
            placeholder="60 seconds"
          />
        </label>
      </div>

      {tier === 'destructive' && (
        <p className="notice notice-danger">
          <Icon.Alert size={15} />
          <span>Anyone who can see this script will get a warning before running it.</span>
        </p>
      )}

      {isAdmin && (
        <label className="field">
          <span className="field-label">Who can see it</span>
          <select
            className="select"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="private">Just me</option>
            <option value="shared">My team — pick people after saving</option>
          </select>
        </label>
      )}

      {error && (
        <p className="notice notice-danger">
          <Icon.Alert size={15} />
          <span>{error}</span>
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Save script'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

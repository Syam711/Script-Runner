import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { backendApi } from '../lib/backendApi';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../lib/icons';

const TIER_BADGE = {
  safe: { cls: 'badge-jade', label: 'Safe' },
  caution: { cls: 'badge-amber', label: 'Changes state' },
  destructive: { cls: 'badge-rose', label: 'Destructive' },
};

export default function BatchForm({ regionId, existingBatch, onSaved, onCancel }) {
  const { isAdmin } = useAuth();
  const editing = Boolean(existingBatch);

  const [name, setName] = useState(existingBatch?.name || '');
  const [visibility, setVisibility] = useState(existingBatch?.visibility || 'private');
  const [available, setAvailable] = useState([]); // every command in this region
  const [selected, setSelected] = useState([]); // ordered list of command objects
  const [loadingCommands, setLoadingCommands] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from('commands')
      .select('*')
      .eq('region_id', regionId)
      .order('name', { ascending: true })
      .then(async ({ data }) => {
        if (!alive || !data) return;
        setAvailable(data);

        if (existingBatch) {
          const { data: stepRows } = await supabase
            .from('batch_steps')
            .select('step_order, command_id')
            .eq('batch_id', existingBatch.id)
            .order('step_order', { ascending: true });
          if (alive && stepRows) {
            const byId = new Map(data.map((c) => [c.id, c]));
            setSelected(stepRows.map((r) => byId.get(r.command_id)).filter(Boolean));
          }
        }
        setLoadingCommands(false);
      });
    return () => {
      alive = false;
    };
  }, [regionId, existingBatch]);

  const unselected = available.filter((c) => !selected.some((s) => s.id === c.id));

  const addStep = (cmd) => setSelected((list) => [...list, cmd]);
  const removeStep = (index) => setSelected((list) => list.filter((_, i) => i !== index));
  const moveStep = (index, dir) => {
    setSelected((list) => {
      const next = [...list];
      const target = index + dir;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const hasDestructive = selected.some((c) => c.safety_tier === 'destructive');

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    if (selected.length === 0) {
      return setError('Add at least one command to the batch.');
    }

    setBusy(true);
    try {
      const payload = {
        regionId,
        name,
        visibility,
        commandIds: selected.map((c) => c.id),
      };
      if (editing) await backendApi.updateBatch(existingBatch.id, payload);
      else await backendApi.createBatch(payload);
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
          placeholder="Weekly maintenance"
          required
        />
      </label>

      {available.length === 0 && !loadingCommands ? (
        <p className="notice notice-warn">
          <Icon.Alert size={15} />
          <span>This region has no saved commands yet — save a few first, then build a batch.</span>
        </p>
      ) : (
        <div className="field">
          <span className="field-label">Steps, in order</span>

          {selected.length === 0 ? (
            <p className="muted" style={{ padding: 'var(--s-3) 0' }}>
              Nothing added yet.
            </p>
          ) : (
            <div className="steps">
              {selected.map((cmd, i) => {
                const tier = TIER_BADGE[cmd.safety_tier];
                return (
                  <div className="batch-step-row" key={cmd.id}>
                    <span className="step-n">{i + 1}</span>
                    <span className="batch-step-name">{cmd.name}</span>
                    <span className={`badge ${tier.cls}`}>{tier.label}</span>
                    <div className="row" style={{ gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => moveStep(i, -1)}
                        disabled={i === 0}
                        aria-label="Move up"
                      >
                        <Icon.ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => moveStep(i, 1)}
                        disabled={i === selected.length - 1}
                        aria-label="Move down"
                      >
                        <Icon.ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => removeStep(i)}
                        aria-label="Remove"
                      >
                        <Icon.X size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {unselected.length > 0 && (
            <div className="batch-add-row">
              <select
                className="select"
                value=""
                onChange={(e) => {
                  const cmd = available.find((c) => c.id === e.target.value);
                  if (cmd) addStep(cmd);
                }}
              >
                <option value="" disabled>
                  Add a command…
                </option>
                {unselected.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {hasDestructive && (
        <p className="notice notice-danger">
          <Icon.Alert size={15} />
          <span>This batch includes a destructive step. Anyone running it will see a warning first.</span>
        </p>
      )}

      {isAdmin && (
        <label className="field">
          <span className="field-label">Who can see it</span>
          <select className="select" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
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
        <button type="submit" className="btn btn-primary" disabled={busy || loadingCommands}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create batch'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

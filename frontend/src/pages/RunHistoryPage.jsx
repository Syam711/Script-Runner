import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { PageHead, Empty } from '../components/AppShell';
import { Icon, StatusDot } from '../lib/icons';

const STATUS = {
  running: { label: 'Running', tone: 'running', cls: 'badge-indigo' },
  success: { label: 'Finished', tone: 'ok', cls: 'badge-jade' },
  failed: { label: 'Failed', tone: 'bad', cls: 'badge-rose' },
  timeout: { label: 'Timed out', tone: 'bad', cls: 'badge-rose' },
  cancelled: { label: 'Stopped', tone: 'warn', cls: 'badge-amber' },
};

const took = (a, b) => {
  if (!b) return '—';
  const ms = new Date(b) - new Date(a);
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};

const when = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function RunHistoryPage() {
  const { user, isAdmin } = useAuth();
  const [scope, setScope] = useState('mine');
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('run_history')
      .select('*, profiles!run_history_user_id_fkey(display_name)')
      .order('started_at', { ascending: false })
      .limit(200);
    if (scope === 'mine') q = q.eq('user_id', user.id);

    const { data, error: err } = await q;
    if (err) setError(err.message);
    else {
      setRuns(data);
      setError(null);
    }
    setLoading(false);
  }, [scope, user.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHead title="Run history" sub="Everything that has run in the last 7 days">
        {isAdmin && (
          <>
            <button
              className={`btn btn-sm ${scope === 'mine' ? 'btn-quiet' : 'btn-ghost'}`}
              onClick={() => setScope('mine')}
            >
              Mine
            </button>
            <button
              className={`btn btn-sm ${scope === 'org' ? 'btn-quiet' : 'btn-ghost'}`}
              onClick={() => setScope('org')}
            >
              Everyone
            </button>
          </>
        )}
      </PageHead>

      <div className="page stack">
        <p className="notice notice-info">
          <Icon.Clock size={15} />
          <span>
            Runs are kept for 7 days, then removed automatically. No one can delete them early —
            not members, not admins.
          </span>
        </p>

        {error && (
          <p className="notice notice-danger">
            <Icon.Alert size={15} />
            <span>{error}</span>
          </p>
        )}

        <section className="card">
          {loading ? (
            <div className="card-body muted">Loading history…</div>
          ) : runs.length === 0 ? (
            <Empty
              icon={<Icon.History size={40} />}
              title="Nothing has run yet"
              text="Run a saved script or something from the scratch pad and it'll show up here."
            />
          ) : (
            <table className="table table-rows table-click">
              <thead>
                <tr>
                  <th style={{ width: 22 }} />
                  {scope === 'org' && <th>Who</th>}
                  <th>Command</th>
                  <th>Result</th>
                  <th>When</th>
                  <th>Took</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const meta = STATUS[run.status] || STATUS.failed;
                  const isOpen = open === run.id;
                  const cols = scope === 'org' ? 7 : 6;
                  return [
                    <tr key={run.id} onClick={() => setOpen(isOpen ? null : run.id)}>
                      <td>
                        <StatusDot tone={meta.tone} pulse={run.status === 'running'} />
                      </td>
                      {scope === 'org' && <td>{run.profiles?.display_name || 'Unknown'}</td>}
                      <td className="mono-sm">
                        {String(run.raw_command_text).split('\n')[0].slice(0, 56)}
                      </td>
                      <td>
                        <span className={`badge ${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="muted">{when(run.started_at)}</td>
                      <td className="mono-sm muted">{took(run.started_at, run.ended_at)}</td>
                      <td className="cell-actions muted">
                        {isOpen ? <Icon.ChevronDown size={15} /> : <Icon.ChevronRight size={15} />}
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={`${run.id}-detail`}>
                        <td colSpan={cols} style={{ background: 'var(--surface-sunk)' }}>
                          <div className="stack" style={{ gap: 'var(--s-3)', padding: 'var(--s-2) 0' }}>
                            <div className="field">
                              <span className="field-label">Command</span>
                              <pre className="script-block">{run.raw_command_text}</pre>
                            </div>
                            <div className="field">
                              <span className="field-label">Output</span>
                              <div className="term">
                                <pre className="term-body">
                                  {run.output || (
                                    <span className="term-waiting">Nothing was returned.</span>
                                  )}
                                </pre>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

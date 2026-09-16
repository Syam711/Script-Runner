import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { PageHead, Empty } from '../components/AppShell';
import { Icon, StatusDot } from '../lib/icons';

const STATUS_TONE = {
  success: 'ok',
  failed: 'bad',
  timeout: 'bad',
  cancelled: 'warn',
  running: 'running',
};

function ago(iso) {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [regions, setRegions] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from('regions').select('id, name, host, port').order('name'),
      supabase
        .from('run_history')
        .select('id, raw_command_text, status, started_at, region_id')
        .order('started_at', { ascending: false })
        .limit(6),
    ]).then(([r, h]) => {
      if (!alive) return;
      if (r.data) setRegions(r.data);
      if (h.data) setRuns(h.data);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = (profile?.display_name || '').split(' ')[0];

  return (
    <>
      <PageHead title={`${greeting}, ${firstName}`} sub="Here's where things stand." />

      <div className="page stack">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Regions</h2>
            <span className="card-count">{regions.length}</span>
          </div>

          {loading ? (
            <div className="card-body muted">Loading…</div>
          ) : regions.length === 0 ? (
            <Empty
              icon={<Icon.Server size={40} />}
              title="No regions yet"
              text="A region is a server plus how to log into it. Add one and your saved scripts have somewhere to run."
              action={
                <button className="btn btn-primary" onClick={() => navigate('/regions?new=1')}>
                  <Icon.Plus size={15} />
                  Add a region
                </button>
              }
            />
          ) : (
            <table className="table table-rows table-click">
              <tbody>
                {regions.map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/regions/${r.id}/commands`)}>
                    <td style={{ width: 22 }}>
                      <StatusDot tone="idle" />
                    </td>
                    <td className="cell-primary">{r.name}</td>
                    <td className="mono-sm muted">
                      {r.host}:{r.port}
                    </td>
                    <td className="cell-actions">
                      <Icon.ChevronRight size={16} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Recent runs</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/history')}>
              See all
            </button>
          </div>

          {loading ? (
            <div className="card-body muted">Loading…</div>
          ) : runs.length === 0 ? (
            <Empty
              icon={<Icon.History size={40} />}
              title="Nothing has run yet"
              text="Once you run a script, the last few show up here."
            />
          ) : (
            <table className="table table-rows">
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td style={{ width: 22 }}>
                      <StatusDot
                        tone={STATUS_TONE[run.status] || 'idle'}
                        pulse={run.status === 'running'}
                      />
                    </td>
                    <td className="mono-sm">
                      {String(run.raw_command_text).split('\n')[0].slice(0, 64)}
                    </td>
                    <td className="muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {ago(run.started_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

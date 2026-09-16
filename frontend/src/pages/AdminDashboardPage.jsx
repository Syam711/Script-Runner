import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { PageHead, Empty } from '../components/AppShell';
import ShareDialog from '../components/ShareDialog';
import { Icon } from '../lib/icons';

export default function AdminDashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [members, setMembers] = useState([]);
  const [regions, setRegions] = useState([]);
  const [commands, setCommands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [managing, setManaging] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, r, c] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name, role, created_at')
        .order('created_at', { ascending: true }),
      supabase
        .from('regions')
        .select('id, name, host, owner_id, profiles!regions_owner_id_fkey(display_name)')
        .eq('visibility', 'shared'),
      supabase
        .from('commands')
        .select(
          'id, name, owner_id, profiles!commands_owner_id_fkey(display_name), regions(name)'
        )
        .eq('visibility', 'shared'),
    ]);

    const firstErr = m.error || r.error || c.error;
    if (firstErr) setError(firstErr.message);
    else {
      setMembers(m.data);
      setRegions(r.data);
      setCommands(c.data);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const initials = (name) =>
    (name || '?')
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

  return (
    <>
      <PageHead title="Admin" sub="Your team and what they can reach">
        <button className="btn btn-quiet" onClick={() => navigate('/history')}>
          <Icon.History size={15} />
          All activity
        </button>
      </PageHead>

      <div className="page stack">
        {error && (
          <p className="notice notice-danger">
            <Icon.Alert size={15} />
            <span>{error}</span>
          </p>
        )}

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Team</h2>
            <span className="card-count">{members.length}</span>
          </div>
          {loading ? (
            <div className="card-body muted">Loading team…</div>
          ) : (
            <table className="table table-rows">
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td style={{ width: 46 }}>
                      <span className="avatar">{initials(m.display_name)}</span>
                    </td>
                    <td className="cell-primary">
                      {m.display_name}
                      {m.id === profile.id && <span className="muted"> · you</span>}
                    </td>
                    <td>
                      <span className={`badge ${m.role === 'admin' ? 'badge-jade' : 'badge-neutral'}`}>
                        {m.role === 'admin' ? 'Admin' : 'Member'}
                      </span>
                    </td>
                    <td className="muted" style={{ textAlign: 'right' }}>
                      Joined {new Date(m.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Shared regions</h2>
            <span className="card-count">{regions.length}</span>
          </div>
          {loading ? (
            <div className="card-body muted">Loading…</div>
          ) : regions.length === 0 ? (
            <Empty
              icon={<Icon.Server size={38} />}
              title="Nothing shared yet"
              text="Regions you share with the team show up here, so you can see and change who has access."
            />
          ) : (
            <table className="table table-rows">
              <tbody>
                {regions.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-primary">{r.name}</td>
                    <td className="mono-sm muted">{r.host}</td>
                    <td className="muted">{r.profiles?.display_name}</td>
                    <td className="cell-actions">
                      <button
                        className="btn btn-quiet btn-sm"
                        onClick={() => setManaging({ type: 'region', id: r.id, name: r.name })}
                      >
                        <Icon.Users size={13} />
                        Access
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">Shared scripts</h2>
            <span className="card-count">{commands.length}</span>
          </div>
          {loading ? (
            <div className="card-body muted">Loading…</div>
          ) : commands.length === 0 ? (
            <Empty
              icon={<Icon.Script size={38} />}
              title="Nothing shared yet"
              text="Scripts you share with the team show up here."
            />
          ) : (
            <table className="table table-rows">
              <tbody>
                {commands.map((c) => (
                  <tr key={c.id}>
                    <td className="cell-primary">{c.name}</td>
                    <td className="muted">{c.regions?.name}</td>
                    <td className="muted">{c.profiles?.display_name}</td>
                    <td className="cell-actions">
                      <button
                        className="btn btn-quiet btn-sm"
                        onClick={() => setManaging({ type: 'command', id: c.id, name: c.name })}
                      >
                        <Icon.Users size={13} />
                        Access
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {managing && (
        <ShareDialog
          resourceType={managing.type}
          resourceId={managing.id}
          resourceName={managing.name}
          onClose={() => {
            setManaging(null);
            load();
          }}
        />
      )}
    </>
  );
}

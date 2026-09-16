import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { backendApi } from '../lib/backendApi';
import { useAuth } from '../context/AuthContext';
import { PageHead, Empty } from '../components/AppShell';
import RegionForm from '../components/RegionForm';
import ShareDialog from '../components/ShareDialog';
import Modal from '../components/Modal';
import { Icon, StatusDot } from '../lib/icons';

export default function RegionsPage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('regions')
      .select('*')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else {
      setRegions(data);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const close = () => {
    setFormOpen(false);
    setEditing(null);
    if (params.get('new')) setParams({});
  };

  const saved = () => {
    close();
    load();
  };

  const remove = async () => {
    try {
      await backendApi.deleteRegion(confirmDelete.id);
      setConfirmDelete(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHead title="Regions" sub="Servers you can run scripts against">
        <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
          <Icon.Plus size={15} />
          Add region
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
          {loading ? (
            <div className="card-body muted">Loading regions…</div>
          ) : regions.length === 0 ? (
            <Empty
              icon={<Icon.Server size={40} />}
              title="No regions yet"
              text="A region is a server plus the steps to log into it — host, port, and what to send at each prompt."
              action={
                <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
                  <Icon.Plus size={15} />
                  Add your first region
                </button>
              }
            />
          ) : (
            <table className="table table-rows">
              <thead>
                <tr>
                  <th style={{ width: 22 }} />
                  <th>Name</th>
                  <th>Address</th>
                  <th>Login</th>
                  <th>Visible to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {regions.map((r) => {
                  const mine = r.owner_id === user.id;
                  const canManage = mine || isAdmin;
                  return (
                    <tr key={r.id}>
                      <td>
                        <StatusDot tone="idle" />
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm cell-primary"
                          onClick={() => navigate(`/regions/${r.id}/commands`)}
                          style={{ padding: 0 }}
                        >
                          {r.name}
                        </button>
                      </td>
                      <td className="mono-sm muted">
                        {r.host}:{r.port}
                      </td>
                      <td className="muted">
                        {r.auth_type.includes('su') ? 'Password, then su' : 'Password'}
                      </td>
                      <td>
                        <span className={`badge ${r.visibility === 'shared' ? 'badge-jade' : 'badge-neutral'}`}>
                          {r.visibility === 'shared' ? 'Team' : mine ? 'Just me' : 'Private'}
                        </span>
                      </td>
                      <td className="cell-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => navigate(`/regions/${r.id}/commands`)}
                        >
                          Scripts
                        </button>
                        {canManage && (
                          <>
                            <button
                              className="btn btn-ghost btn-icon btn-reveal"
                              onClick={() => {
                                setEditing(r);
                                setFormOpen(true);
                              }}
                              title="Edit"
                              aria-label={`Edit ${r.name}`}
                            >
                              <Icon.Pencil size={15} />
                            </button>
                            {isAdmin && (
                              <button
                                className="btn btn-ghost btn-icon btn-reveal"
                                onClick={() => setSharing(r)}
                                title="Share"
                                aria-label={`Share ${r.name}`}
                              >
                                <Icon.Share size={15} />
                              </button>
                            )}
                            <button
                              className="btn btn-ghost btn-icon btn-reveal"
                              onClick={() => setConfirmDelete(r)}
                              title="Delete"
                              aria-label={`Delete ${r.name}`}
                            >
                              <Icon.Trash size={15} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {formOpen && (
        <Modal
          title={editing ? 'Edit region' : 'Add a region'}
          sub={editing ? editing.name : 'Where your scripts will run'}
          onClose={close}
          wide
        >
          <RegionForm existingRegion={editing} onSaved={saved} onCancel={close} />
        </Modal>
      )}

      {sharing && (
        <ShareDialog
          resourceType="region"
          resourceId={sharing.id}
          resourceName={sharing.name}
          onClose={() => {
            setSharing(null);
            load();
          }}
        />
      )}

      {confirmDelete && (
        <Modal
          title={`Delete ${confirmDelete.name}?`}
          onClose={() => setConfirmDelete(null)}
          foot={
            <>
              <button className="btn btn-quiet" onClick={() => setConfirmDelete(null)}>
                Keep it
              </button>
              <button className="btn btn-danger" onClick={remove}>
                Delete region
              </button>
            </>
          }
        >
          <p>
            Its saved scripts and stored credentials go too. Past runs stay in history with the
            commands that were run.
          </p>
        </Modal>
      )}
    </>
  );
}

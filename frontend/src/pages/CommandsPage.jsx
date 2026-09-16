import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { backendApi } from '../lib/backendApi';
import { useAuth } from '../context/AuthContext';
import { PageHead, Empty } from '../components/AppShell';
import CommandForm from '../components/CommandForm';
import ShareDialog from '../components/ShareDialog';
import RunPanel from '../components/RunPanel';
import Modal from '../components/Modal';
import { Icon } from '../lib/icons';

const TIER = {
  safe: { cls: 'badge-jade', label: 'Safe' },
  caution: { cls: 'badge-amber', label: 'Changes state' },
  destructive: { cls: 'badge-rose', label: 'Destructive' },
};

export default function CommandsPage() {
  const { regionId } = useParams();
  const { user, isAdmin } = useAuth();

  const [region, setRegion] = useState(null);
  const [commands, setCommands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [running, setRunning] = useState(null);
  const [scratch, setScratch] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, c] = await Promise.all([
      supabase.from('regions').select('*').eq('id', regionId).single(),
      supabase
        .from('commands')
        .select('*')
        .eq('region_id', regionId)
        .order('created_at', { ascending: false }),
    ]);
    if (r.error) setError(r.error.message);
    else if (c.error) setError(c.error.message);
    else {
      setRegion(r.data);
      setCommands(c.data);
      setError(null);
    }
    setLoading(false);
  }, [regionId]);

  useEffect(() => {
    load();
  }, [load]);

  const close = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const saved = () => {
    close();
    load();
  };

  const remove = async () => {
    try {
      await backendApi.deleteCommand(confirmDelete.id);
      setConfirmDelete(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHead
        title={region ? region.name : 'Scripts'}
        sub={region ? `${region.host}:${region.port}` : undefined}
      >
        <button className="btn btn-quiet" onClick={() => setScratch(true)}>
          <Icon.Terminal size={15} />
          Scratch pad
        </button>
        <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
          <Icon.Plus size={15} />
          New script
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
            <div className="card-body muted">Loading scripts…</div>
          ) : commands.length === 0 ? (
            <Empty
              icon={<Icon.Script size={40} />}
              title="No saved scripts here"
              text="Save the commands you run against this server and they'll be one click away next time."
              action={
                <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
                  <Icon.Plus size={15} />
                  Save a script
                </button>
              }
            />
          ) : (
            <table className="table table-rows">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Version</th>
                  <th>Visible to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {commands.map((c) => {
                  const mine = c.owner_id === user.id;
                  const canManage = mine || isAdmin;
                  const tier = TIER[c.safety_tier];
                  return (
                    <tr key={c.id}>
                      <td className="cell-primary">{c.name}</td>
                      <td>
                        <span className={`badge ${tier.cls}`}>{tier.label}</span>
                      </td>
                      <td className="mono-sm muted">v{c.current_version}</td>
                      <td>
                        <span
                          className={`badge ${c.visibility === 'shared' ? 'badge-jade' : 'badge-neutral'}`}
                        >
                          {c.visibility === 'shared' ? 'Team' : mine ? 'Just me' : 'Private'}
                        </span>
                      </td>
                      <td className="cell-actions">
                        <button className="btn btn-quiet btn-sm" onClick={() => setRunning(c)}>
                          <Icon.Play size={12} />
                          Run
                        </button>
                        {canManage && (
                          <>
                            <button
                              className="btn btn-ghost btn-icon btn-reveal"
                              onClick={() => {
                                setEditing(c);
                                setFormOpen(true);
                              }}
                              title="Edit"
                              aria-label={`Edit ${c.name}`}
                            >
                              <Icon.Pencil size={15} />
                            </button>
                            {isAdmin && (
                              <button
                                className="btn btn-ghost btn-icon btn-reveal"
                                onClick={() => setSharing(c)}
                                title="Share"
                                aria-label={`Share ${c.name}`}
                              >
                                <Icon.Share size={15} />
                              </button>
                            )}
                            <button
                              className="btn btn-ghost btn-icon btn-reveal"
                              onClick={() => setConfirmDelete(c)}
                              title="Delete"
                              aria-label={`Delete ${c.name}`}
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
          title={editing ? 'Edit script' : 'New script'}
          sub={region?.name}
          onClose={close}
          wide
        >
          <CommandForm
            regionId={regionId}
            existingCommand={editing}
            onSaved={saved}
            onCancel={close}
          />
        </Modal>
      )}

      {running && (
        <Modal title="Run script" sub={region?.name} onClose={() => setRunning(null)} wide>
          <RunPanel
            mode="saved"
            region={region}
            commandId={running.id}
            commandName={running.name}
            safetyTier={running.safety_tier}
            initialCommandText={running.content}
          />
        </Modal>
      )}

      {scratch && (
        <Modal
          title="Scratch pad"
          sub={`${region?.name} · not saved`}
          onClose={() => setScratch(false)}
          wide
        >
          <RunPanel mode="scratch" region={region} />
        </Modal>
      )}

      {sharing && (
        <ShareDialog
          resourceType="command"
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
                Delete script
              </button>
            </>
          }
        >
          <p>Past runs of this script stay in history, along with the exact commands that ran.</p>
        </Modal>
      )}
    </>
  );
}

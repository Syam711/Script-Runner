import { useState, useEffect } from 'react';
import { backendApi } from '../lib/backendApi';
import { Icon } from '../lib/icons';
import Modal from './Modal';

export default function ShareDialog({ resourceType, resourceId, resourceName, onClose }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);

  const load = async () => {
    try {
      const data = await backendApi.listShareContext({ resourceType, resourceId });
      setMembers(data.members);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType, resourceId]);

  const toggle = async (member) => {
    setPending(member.id);
    setError(null);
    try {
      const call = member.shared ? backendApi.deleteShare : backendApi.createShare;
      await call({ resourceType, resourceId, memberId: member.id });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(null);
    }
  };

  const shared = members.filter((m) => m.shared).length;

  return (
    <Modal
      title={`Who can use ${resourceName}`}
      sub={`${shared} of ${members.length} ${members.length === 1 ? 'person' : 'people'}`}
      onClose={onClose}
      foot={
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {error && (
        <p className="notice notice-danger">
          <Icon.Alert size={15} />
          <span>{error}</span>
        </p>
      )}

      {loading ? (
        <p className="muted">Loading team…</p>
      ) : members.length === 0 ? (
        <p className="muted">
          No one to share with yet. Team members appear here once they create an account.
        </p>
      ) : (
        <div className="people">
          {members.map((m) => (
            <div className="person" key={m.id}>
              <span className="avatar">
                {m.display_name
                  ?.split(' ')
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
              <span className="person-name">{m.display_name}</span>
              <button
                className={`btn btn-sm ${m.shared ? 'btn-quiet' : 'btn-primary'}`}
                onClick={() => toggle(m)}
                disabled={pending === m.id}
              >
                {pending === m.id ? '…' : m.shared ? 'Remove' : 'Give access'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

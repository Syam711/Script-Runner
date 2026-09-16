import { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Wordmark, Icon, StatusDot } from '../lib/icons';

/* The rail keeps regions one click away, because that's the thing
   people come here to reach. Everything else is secondary navigation
   below it. */
export default function AppShell({ children }) {
  const { profile, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [regions, setRegions] = useState([]);

  useEffect(() => {
    let alive = true;
    supabase
      .from('regions')
      .select('id, name, host')
      .order('name', { ascending: true })
      .then(({ data }) => {
        if (alive && data) setRegions(data);
      });
    return () => {
      alive = false;
    };
    // Re-reads when navigating, so a newly created region shows up
    // without needing a full reload.
  }, [location.pathname]);

  const initials = (profile?.display_name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail-head">
          <Wordmark size={26} />
        </div>

        <div className="rail-scroll">
          <div className="rail-group">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `rail-link${isActive ? ' rail-link-on' : ''}`}
            >
              <Icon.Terminal size={17} />
              <span>Overview</span>
            </NavLink>
            <NavLink
              to="/regions"
              end
              className={({ isActive }) => `rail-link${isActive ? ' rail-link-on' : ''}`}
            >
              <Icon.Server size={17} />
              <span>Regions</span>
            </NavLink>
            <NavLink
              to="/history"
              className={({ isActive }) => `rail-link${isActive ? ' rail-link-on' : ''}`}
            >
              <Icon.History size={17} />
              <span>Run history</span>
            </NavLink>
            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) => `rail-link${isActive ? ' rail-link-on' : ''}`}
              >
                <Icon.Shield size={17} />
                <span>Admin</span>
              </NavLink>
            )}
          </div>

          <div className="rail-group">
            <div className="rail-group-head">
              <span>Regions</span>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => navigate('/regions?new=1')}
                title="Add a region"
                aria-label="Add a region"
              >
                <Icon.Plus size={15} />
              </button>
            </div>

            {regions.length === 0 ? (
              <p className="rail-group-head muted">Nothing here yet</p>
            ) : (
              regions.map((r) => {
                const on = location.pathname === `/regions/${r.id}/commands`;
                return (
                  <button
                    key={r.id}
                    className={`rail-region${on ? ' rail-region-on' : ''}`}
                    onClick={() => navigate(`/regions/${r.id}/commands`)}
                  >
                    <StatusDot tone="idle" />
                    <span className="rail-region-name">{r.name}</span>
                    <span className="rail-region-host">:{String(r.host).slice(-3)}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rail-foot">
          <div className="rail-user">
            <span className="avatar">{initials}</span>
            <span className="rail-user-meta">
              <span className="rail-user-name">{profile?.display_name}</span>
              <span className="rail-user-role">{isAdmin ? 'Admin' : 'Member'}</span>
            </span>
            <button
              className="btn btn-ghost btn-icon"
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
            >
              <Icon.LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>

      <div className="content">{children}</div>
    </div>
  );
}

/* Shared page header. Keeping it here means every page gets the same
   sticky bar, the same title scale, and the same action placement. */
export function PageHead({ title, sub, children }) {
  return (
    <header className="topbar">
      <div className="topbar-titles">
        <h1>{title}</h1>
        {sub && <p className="topbar-sub">{sub}</p>}
      </div>
      {children && <div className="topbar-actions">{children}</div>}
    </header>
  );
}

export function Empty({ icon, title, text, action }) {
  return (
    <div className="empty">
      {icon || <Icon.Empty size={44} />}
      <p className="empty-title">{title}</p>
      {text && <p className="empty-text">{text}</p>}
      {action}
    </div>
  );
}

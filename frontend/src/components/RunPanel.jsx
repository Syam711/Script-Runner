import { useState, useEffect, useRef } from 'react';
import { useCommandRunner } from '../hooks/useCommandRunner';
import { useAuth } from '../context/AuthContext';
import { Icon, StatusDot } from '../lib/icons';

const STATUS = {
  pending:   { label: 'Waiting',   tone: 'idle',    cls: 'run-status-idle' },
  running:   { label: 'Running',   tone: 'running', cls: 'run-status-running' },
  success:   { label: 'Finished',  tone: 'ok',      cls: 'run-status-ok' },
  failed:    { label: 'Failed',    tone: 'bad',     cls: 'run-status-bad' },
  timeout:   { label: 'Timed out', tone: 'bad',     cls: 'run-status-bad' },
  cancelled: { label: 'Stopped',   tone: 'warn',    cls: 'run-status-warn' },
  error:     { label: 'Error',     tone: 'bad',     cls: 'run-status-bad' },
};

const TIER = {
  safe:        { cls: 'badge-jade',  label: 'Safe' },
  caution:     { cls: 'badge-amber', label: 'Changes state' },
  destructive: { cls: 'badge-rose',  label: 'Destructive' },
};

export default function RunPanel({ mode, region, commandId, commandName, safetyTier, initialCommandText }) {
  const { profile } = useAuth();
  const { output, status, errorMessage, runCommand, cancel, reset } = useCommandRunner();
  const [text, setText] = useState(initialCommandText || '');
  const bodyRef = useRef(null);

  useEffect(() => setText(initialCommandText || ''), [initialCommandText]);

  // Follow the output as it streams, the way a terminal would.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [output]);

  const running = status === 'running';
  const blocked = Boolean(profile?.active_run_id) && !running;
  const meta = STATUS[status];
  const tier = safetyTier ? TIER[safetyTier] : null;

  const start = () => {
    reset();
    runCommand({
      regionId: region?.id,
      commandId: mode === 'saved' ? commandId : undefined,
      commandText: text,
    });
  };

  return (
    <div className="stack">
      <div className="run-head">
        <div>
          <h3>{mode === 'scratch' ? 'Scratch pad' : commandName}</h3>
          <div className="run-meta">
            <span className="mono-sm muted">
              {region?.name} · {region?.host}:{region?.port}
            </span>
            {tier && <span className={`badge ${tier.cls}`}>{tier.label}</span>}
          </div>
        </div>
        {meta && (
          <span className={`run-status ${meta.cls}`}>
            <StatusDot tone={meta.tone} pulse={running} />
            {meta.label}
          </span>
        )}
      </div>

      {safetyTier === 'destructive' && !running && (
        <p className="notice notice-danger">
          <Icon.Alert size={15} />
          <span>
            This script is marked destructive. Check you've picked the right region before you
            run it.
          </span>
        </p>
      )}

      {mode === 'scratch' ? (
        <label className="field">
          <span className="field-label">Command</span>
          <textarea
            className="textarea code-input"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="df -h /var"
            disabled={running}
          />
          <span className="field-note">Runs once. Nothing is saved, but it shows in history.</span>
        </label>
      ) : (
        <pre className="script-block">{text}</pre>
      )}

      {blocked && (
        <p className="notice notice-warn">
          <Icon.Clock size={15} />
          <span>Another command of yours is still running. Wait for it to finish.</span>
        </p>
      )}

      {errorMessage && (
        <p className="notice notice-danger">
          <Icon.Alert size={15} />
          <span>{errorMessage}</span>
        </p>
      )}

      <div className="row">
        {running ? (
          <button className="btn btn-quiet" onClick={cancel}>
            <Icon.Stop size={14} />
            Stop
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={start}
            disabled={blocked || !text.trim()}
          >
            <Icon.Play size={14} />
            {status === 'idle' ? 'Run' : 'Run again'}
          </button>
        )}
      </div>

      {(output || running) && (
        <div className="term">
          <div className="term-bar">
            <span className="term-target">
              <StatusDot tone={running ? 'running' : 'idle'} pulse={running} />
              {region?.host}
            </span>
            <span className="term-target">{running ? 'streaming' : 'session closed'}</span>
          </div>
          <pre className="term-body" ref={bodyRef}>
            {output || <span className="term-waiting">Opening session…</span>}
            {running && <span className="caret" />}
          </pre>
        </div>
      )}
    </div>
  );
}

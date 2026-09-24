import { useState, useEffect } from 'react';
import { useBatchRunner } from '../hooks/useBatchRunner';
import { useAuth } from '../context/AuthContext';
import { Icon, StatusDot } from '../lib/icons';

const STATUS = {
  pending:   { label: 'Waiting',   tone: 'idle',    cls: 'run-status-idle' },
  running:   { label: 'Running',   tone: 'running', cls: 'run-status-running' },
  success:   { label: 'Finished',  tone: 'ok',      cls: 'run-status-ok' },
  failed:    { label: 'Failed',    tone: 'bad',     cls: 'run-status-bad' },
  timeout:   { label: 'Timed out', tone: 'bad',     cls: 'run-status-bad' },
  cancelled: { label: 'Stopped',   tone: 'warn',    cls: 'run-status-warn' },
};

const BATCH_STATUS_LABEL = {
  running: 'Running',
  success: 'All steps finished',
  failed: 'Stopped — a step failed',
  timeout: 'Stopped — timed out',
  cancelled: 'Stopped',
  error: 'Error',
};

export default function BatchRunPanel({ region, batchId, batchName, hasDestructive }) {
  const { profile } = useAuth();
  const { steps, batchStatus, errorMessage, runBatch, cancel, reset } = useBatchRunner();
  const [expanded, setExpanded] = useState(null);

  const running = batchStatus === 'running';
  const blocked = Boolean(profile?.active_run_id) && !running;

  const start = () => {
    reset();
    setExpanded(null);
    runBatch(batchId);
  };

  // Once the batch is running, follow along by auto-expanding
  // whichever step is currently active — closer to watching a
  // terminal than having to click through steps one by one.
  useEffect(() => {
    if (!running) return;
    const active = steps.find((s) => s.status === 'running');
    if (active) setExpanded(active.runId);
  }, [steps, running]);

  return (
    <div className="stack">
      <div className="run-head">
        <div>
          <h3>{batchName}</h3>
          <span className="mono-sm muted">
            {region?.name} · {steps.length || '—'} step{steps.length === 1 ? '' : 's'}
          </span>
        </div>
        {batchStatus !== 'idle' && (
          <span className={`run-status ${STATUS[batchStatus]?.cls || 'run-status-bad'}`}>
            <StatusDot tone={STATUS[batchStatus]?.tone || 'bad'} pulse={running} />
            {BATCH_STATUS_LABEL[batchStatus] || batchStatus}
          </span>
        )}
      </div>

      {hasDestructive && !running && (
        <p className="notice notice-danger">
          <Icon.Alert size={15} />
          <span>This batch includes a destructive step. Check the region before you run it.</span>
        </p>
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
            Stop batch
          </button>
        ) : (
          <button className="btn btn-primary" onClick={start} disabled={blocked}>
            <Icon.Play size={14} />
            {batchStatus === 'idle' ? 'Run batch' : 'Run again'}
          </button>
        )}
      </div>

      {steps.length > 0 && (
        <div className="batch-run-steps">
          {steps.map((step) => {
            const meta = STATUS[step.status] || STATUS.pending;
            const isOpen = expanded === step.runId;
            return (
              <div className="batch-run-step" key={step.runId}>
                <button
                  type="button"
                  className="batch-run-step-head"
                  onClick={() => setExpanded(isOpen ? null : step.runId)}
                >
                  <StatusDot tone={meta.tone} pulse={step.status === 'running'} />
                  <span className="step-n">{step.order + 1}</span>
                  <span className="batch-step-name">{step.name}</span>
                  <span className={`run-status ${meta.cls}`}>{meta.label}</span>
                  {isOpen ? <Icon.ChevronDown size={14} /> : <Icon.ChevronRight size={14} />}
                </button>
                {isOpen && (
                  <div className="term">
                    <pre className="term-body">
                      {step.output || <span className="term-waiting">Waiting to start…</span>}
                      {step.status === 'running' && <span className="caret" />}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

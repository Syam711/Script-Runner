import { useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';

const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL;

if (!BACKEND_WS_URL) {
  throw new Error('Missing VITE_BACKEND_WS_URL. Check your .env file.');
}

/**
 * Owns one batch run's lifecycle: opens a WebSocket, sends the
 * run_batch request, and tracks each step's status and output
 * independently as step_started / output / step_done messages stream
 * in, finishing on batch_done. Mirrors useCommandRunner's connection
 * handling (backstop-aware, honest about a dropped connection) but
 * tracks an array of steps instead of one status, since a batch's
 * shape is fundamentally different from a single run's.
 */
export function useBatchRunner() {
  const { refreshProfile } = useAuth();
  // steps: [{ runId, name, order, status, output }]
  const [steps, setSteps] = useState([]);
  const [batchStatus, setBatchStatus] = useState('idle'); // idle | running | success | failed | timeout | cancelled | error
  const [errorMessage, setErrorMessage] = useState(null);
  const wsRef = useRef(null);
  const batchIdRef = useRef(null);
  const firstStepRunIdRef = useRef(null);

  const reset = useCallback(() => {
    setSteps([]);
    setBatchStatus('idle');
    setErrorMessage(null);
    firstStepRunIdRef.current = null;
  }, []);

  const updateStep = useCallback((runId, patch) => {
    setSteps((prev) => prev.map((s) => (s.runId === runId ? { ...s, ...patch } : s)));
  }, []);

  const runBatch = useCallback(
    async (batchId) => {
      setSteps([]);
      setErrorMessage(null);
      setBatchStatus('running');
      batchIdRef.current = null;
      firstStepRunIdRef.current = null;

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setBatchStatus('error');
        setErrorMessage('Not logged in');
        return;
      }

      const ws = new WebSocket(BACKEND_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'run_batch', accessToken, batchId }));
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (_) {
          return;
        }

        if (msg.type === 'batch_started') {
          batchIdRef.current = msg.batchId;
          firstStepRunIdRef.current = msg.steps[0]?.runId || null;
          setSteps(
            msg.steps.map((s) => ({
              runId: s.runId,
              name: s.name,
              order: s.order,
              status: s.order === 0 ? 'running' : 'pending',
              output: '',
            }))
          );
        } else if (msg.type === 'step_started') {
          updateStep(msg.runId, { status: 'running' });
        } else if (msg.type === 'output') {
          setSteps((prev) =>
            prev.map((s) => (s.runId === msg.runId ? { ...s, output: s.output + msg.chunk } : s))
          );
        } else if (msg.type === 'step_done') {
          updateStep(msg.runId, { status: msg.status });
        } else if (msg.type === 'batch_done') {
          setBatchStatus(msg.status);
          refreshProfile();
          ws.close();
        } else if (msg.type === 'error') {
          setBatchStatus('error');
          setErrorMessage(msg.message);
          refreshProfile();
          ws.close();
        }
      };

      ws.onerror = () => {
        setBatchStatus('error');
        setErrorMessage('Connection to backend failed');
      };

      ws.onclose = () => {
        wsRef.current = null;
        setBatchStatus((prev) => {
          if (prev === 'running') {
            setErrorMessage(
              'Connection lost before the batch finished. Check Run History to see how far it got.'
            );
            return 'error';
          }
          return prev;
        });
      };
    },
    [refreshProfile, updateStep]
  );

  const cancel = useCallback(() => {
    // The backend's cancel check matches ws._activeRunId, which it set
    // to the FIRST step's run_history row id when the batch started —
    // that id stays the same for the whole batch's cancel-matching
    // purposes regardless of which step is currently running, so it's
    // the id to send here. Any steps still 'pending' when this lands
    // get resolved to 'cancelled' server-side once the batch settles.
    if (wsRef.current && firstStepRunIdRef.current) {
      wsRef.current.send(
        JSON.stringify({ type: 'cancel', runId: firstStepRunIdRef.current })
      );
    }
  }, []);

  return { steps, batchStatus, errorMessage, runBatch, cancel, reset };
}

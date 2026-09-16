import { useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';

const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL;

if (!BACKEND_WS_URL) {
  throw new Error('Missing VITE_BACKEND_WS_URL. Check your .env file.');
}

/**
 * Owns a single run's lifecycle: opens a WebSocket, sends the run
 * request, streams output into state, and resolves to a final status.
 * One instance of this hook = one run panel. Used identically for
 * saved-command runs and scratch-pad runs — the only difference is
 * whether `commandId` is passed to `runCommand`.
 */
export function useCommandRunner() {
  const { refreshProfile } = useAuth();
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | success | failed | timeout | cancelled | error
  const [errorMessage, setErrorMessage] = useState(null);
  const wsRef = useRef(null);
  const runIdRef = useRef(null);

  const reset = useCallback(() => {
    setOutput('');
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  const runCommand = useCallback(
    async ({ regionId, commandId, commandText }) => {
      setOutput('');
      setErrorMessage(null);
      setStatus('running');
      runIdRef.current = null;

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setStatus('error');
        setErrorMessage('Not logged in');
        return;
      }

      const ws = new WebSocket(BACKEND_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'run',
            accessToken,
            regionId,
            commandId: commandId || undefined,
            commandText,
          })
        );
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (_) {
          return;
        }

        if (msg.type === 'started') {
          runIdRef.current = msg.runId;
        } else if (msg.type === 'output') {
          setOutput((prev) => prev + msg.chunk);
        } else if (msg.type === 'done') {
          setStatus(msg.status);
          refreshProfile(); // active_run_id was cleared server-side
          ws.close();
        } else if (msg.type === 'error') {
          setStatus('error');
          setErrorMessage(msg.message);
          refreshProfile();
          ws.close();
        }
      };

      ws.onerror = () => {
        setStatus('error');
        setErrorMessage('Connection to backend failed');
      };

      ws.onclose = (event) => {
        wsRef.current = null;
        // If the socket closed without us ever receiving a 'done' or
        // 'error' message, the UI would otherwise be stuck showing
        // "Running..." forever with no way to recover short of a page
        // reload — e.g. the backend process restarted, or the network
        // dropped mid-run. We can't know the command's true final
        // state in this case (it may have completed or still be
        // running remotely), so surface that honestly rather than
        // guessing a status.
        setStatus((prevStatus) => {
          if (prevStatus === 'running') {
            setErrorMessage(
              'Connection lost before the run finished. Check Run History to see if it completed.'
            );
            return 'error';
          }
          return prevStatus;
        });
      };
    },
    [refreshProfile]
  );

  const cancel = useCallback(() => {
    // Sends a real cancellation request to the backend, which closes
    // the SSH session for this run — this does stop the remote
    // command in the common case. A process the remote shell detached
    // (nohup/disown) may keep running after the connection closes;
    // that's a property of the remote shell, not something this can
    // control. The socket itself stays open until the backend confirms
    // via a 'done' message with status 'cancelled'.
    if (wsRef.current && runIdRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'cancel', runId: runIdRef.current }));
    }
  }, []);

  return { output, status, errorMessage, runCommand, cancel, reset };
}

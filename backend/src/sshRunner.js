const { Client } = require('ssh2');
const config = require('./config');

/**
 * Opens an SSH connection and runs the region's login-step sequence,
 * leaving the shell ready to accept commands. This is the shared core
 * used by both runSession() (one command) and runBatch() (several
 * commands over the same connection) — factored out so a batch
 * doesn't need to reconnect and re-authenticate between every step,
 * which would be slow and would repeat the su handshake unnecessarily.
 *
 * The caller drives what happens after login via the returned handle:
 * write to `stream`, listen via `onData`, and call `close()` when done.
 * This function resolves once the shell is ready or rejects if the
 * connection/login fails — it does not run any command itself.
 *
 * @returns {Promise<{ stream, write, close }>}
 */
function openAuthenticatedSession({ region, loginSteps, secrets, username, appendOutput }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    let loginTimer = null;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(loginTimer);
      try {
        conn.end();
      } catch (_) {
        /* already closed */
      }
      reject(err);
    };

    const substitute = (template) =>
      template
        .replace(/\{username\}/g, username || '')
        .replace(/\{password\}/g, secrets.password || '')
        .replace(/\{service_password\}/g, secrets.servicePassword || '')
        .replace(/\{service_username\}/g, secrets.serviceUsername || '');

    conn.on('ready', () => {
      conn.shell((err, stream) => {
        if (err) return fail(new Error(`Failed to open shell: ${err.message}`));

        let stepIndex = 0;
        let stepBuffer = '';
        const steps = loginSteps || [];
        let currentStepChecker = null;
        let loginComplete = false;

        loginTimer = setTimeout(() => {
          fail(new Error('Login sequence exceeded overall timeout'));
        }, config.loginSequenceTotalTimeoutMs);

        const runNextStep = () => {
          if (stepIndex >= steps.length) {
            clearTimeout(loginTimer);
            loginComplete = true;
            settled = true; // "settled" here means the open() promise is
            // resolved, not that the whole session is done — the caller
            // continues using this same conn/stream afterward.
            resolve({
              stream,
              write: (text) => stream.write(text),
              close: () => {
                try {
                  conn.end();
                } catch (_) {
                  /* already closed */
                }
              },
            });
            return;
          }
          const step = steps[stepIndex];
          const stepTimeout = setTimeout(() => {
            fail(
              new Error(
                `Login step ${stepIndex + 1} timed out waiting for pattern: ${step.expect_pattern}`
              )
            );
          }, step.timeout_ms || 10000);

          const checkBuffer = () => {
            const re = new RegExp(step.expect_pattern);
            if (re.test(stepBuffer)) {
              clearTimeout(stepTimeout);
              stepBuffer = '';
              stream.write(substitute(step.send_template) + '\n');
              stepIndex += 1;
              runNextStep();
            }
          };
          currentStepChecker = checkBuffer;
        };

        stream.on('data', (data) => {
          const text = data.toString('utf8');
          appendOutput(text);
          if (!loginComplete) {
            stepBuffer += text;
            if (currentStepChecker) currentStepChecker();
          }
          // Once login completes, data is handled by whatever the
          // caller attaches next (see runSession/runBatch below) — this
          // handler only drives the login phase.
        });

        stream.stderr.on('data', (data) => appendOutput(data.toString('utf8')));

        conn.on('error', (err) => fail(new Error(`Connection error: ${err.message}`)));
        stream.on('close', () => {
          if (!loginComplete) fail(new Error('Connection closed before login completed'));
        });

        runNextStep();
      });
    });

    conn.on('error', (err) => fail(new Error(`Connection error: ${err.message}`)));

    const connectConfig = {
      host: region.host,
      port: region.port || 22,
      username,
      readyTimeout: 20000,
    };
    if (secrets.privateKey) connectConfig.privateKey = secrets.privateKey;
    else connectConfig.password = secrets.password;

    conn.connect(connectConfig);
  });
}

/**
 * Runs exactly one command over a freshly-opened, freshly-authenticated
 * session, then disconnects. This is the original single-command
 * behavior, preserved exactly as before — batches do NOT go through
 * this function, since they need to keep the connection open across
 * several commands (see runBatch below).
 *
 * @returns {{ promise: Promise<{status, output}>, cancel: function }}
 *          `cancel()` closes the SSH connection immediately, which
 *          terminates the remote shell session the command was running
 *          in. This does stop most commands, but a process the remote
 *          shell has detached (nohup/disown) may keep running on the
 *          server after the connection closes — a property of the
 *          remote shell, not something the SSH layer can control.
 */
function runSession({ region, loginSteps, secrets, username, command, timeoutSeconds, onOutput }) {
  let resolveFn;
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
  });

  let fullOutput = '';
  let settled = false;
  let commandTimer = null;
  let session = null;

  const appendOutput = (chunk) => {
    fullOutput += chunk;
    if (onOutput) onOutput(chunk);
  };

  const finish = (status) => {
    if (settled) return;
    settled = true;
    clearTimeout(commandTimer);
    if (session) session.close();
    resolveFn({ status, output: fullOutput });
  };

  openAuthenticatedSession({ region, loginSteps, secrets, username, appendOutput })
    .then((s) => {
      session = s;
      let commandDone = false;
      const COMMAND_END_MARKER = '__CMD_DONE_' + Date.now() + '__';

      commandTimer = setTimeout(() => {
        if (!commandDone) {
          appendOutput('\n[command timed out]\n');
          finish('timeout');
        }
      }, timeoutSeconds * 1000);

      s.stream.on('data', (data) => {
        const text = data.toString('utf8');
        appendOutput(text);
        if (text.includes(COMMAND_END_MARKER)) {
          commandDone = true;
          clearTimeout(commandTimer);
          finish('success');
        }
      });

      s.stream.on('close', () => {
        if (!settled) finish(commandDone ? 'success' : 'failed');
      });

      s.write(command + '\n');
      s.write(`echo ${COMMAND_END_MARKER}\n`);
    })
    .catch((err) => {
      appendOutput(`\n[connection error] ${err.message}\n`);
      finish('failed');
    });

  return {
    promise,
    cancel: () => {
      appendOutput('\n[cancelled by user]\n');
      finish('cancelled');
    },
  };
}

/**
 * Runs several commands in order over ONE authenticated session —
 * login happens once, then each step's command runs in the same
 * shell. After each step, the remote shell's exit code ($?) is
 * captured and used to decide success/failure for that step; a
 * non-zero exit stops the batch immediately without running the
 * remaining steps, per the product's stop-on-failure rule.
 *
 * Exit-code detection over a raw interactive shell is inherently a
 * best-effort signal, not a guarantee — a command that backgrounds
 * itself or manipulates $? deliberately can produce a misleading
 * result. This is a known limitation of driving a shell this way
 * rather than using a non-interactive exec channel per command (which
 * would in turn lose the shared-login benefit this exists for).
 *
 * @param {object} params
 * @param {object} params.region
 * @param {Array}  params.loginSteps
 * @param {object} params.secrets
 * @param {string} params.username
 * @param {Array}  params.steps - ordered [{ id, command }] — id is
 *                  caller-defined (e.g. a run_history row id) and is
 *                  passed back in onStepStart/onStepDone so the caller
 *                  can update the right row.
 * @param {number} params.timeoutSeconds - applied per step
 * @param {function} params.onStepStart - (stepId) => void
 * @param {function} params.onOutput - (stepId, chunk) => void, called
 *                  as each step's output streams in
 * @param {function} params.onStepDone - (stepId, {status, output}) => void,
 *                  called when a step finishes, before the next starts
 *
 * @returns {{ promise: Promise<{status: 'success'|'failed'|'timeout'|'cancelled'}>, cancel: function }}
 *          The resolved status describes the batch as a whole: 'success'
 *          only if every step succeeded; otherwise the status of the
 *          step that stopped the batch.
 */
function runBatch({
  region,
  loginSteps,
  secrets,
  username,
  steps,
  timeoutSeconds,
  onStepStart,
  onOutput,
  onStepDone,
}) {
  let resolveFn;
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
  });

  let settled = false;
  let session = null;
  let stepTimer = null;
  let cancelled = false;

  const finishBatch = (status) => {
    if (settled) return;
    settled = true;
    clearTimeout(stepTimer);
    if (session) session.close();
    resolveFn({ status });
  };

  const EXIT_MARKER_PREFIX = '__STEP_EXIT_';

  const runStepsSequentially = async () => {
    for (let i = 0; i < steps.length; i += 1) {
      if (cancelled) return finishBatch('cancelled');

      const step = steps[i];
      let stepOutput = '';
      let stepDone = false;
      const marker = `${EXIT_MARKER_PREFIX}${Date.now()}_${i}__`;

      onStepStart(step.id);

      const stepResult = await new Promise((resolveStep) => {
        stepTimer = setTimeout(() => {
          if (!stepDone) {
            stepDone = true;
            stepOutput += '\n[step timed out]\n';
            onOutput(step.id, '\n[step timed out]\n');
            resolveStep('timeout');
          }
        }, timeoutSeconds * 1000);

        const dataHandler = (data) => {
          const text = data.toString('utf8');
          stepOutput += text;
          onOutput(step.id, text);

          const markerIndex = text.indexOf(marker);
          if (markerIndex !== -1 && !stepDone) {
            stepDone = true;
            clearTimeout(stepTimer);
            // The marker line is "echo __STEP_EXIT_..._<code>", so the
            // exit code is whatever trails the marker on that line.
            const afterMarker = text.slice(markerIndex + marker.length);
            const codeMatch = afterMarker.match(/(\d+)/);
            const exitCode = codeMatch ? parseInt(codeMatch[1], 10) : null;
            session.stream.removeListener('data', dataHandler);
            resolveStep(exitCode === 0 ? 'success' : 'failed');
          }
        };

        session.stream.on('data', dataHandler);
        session.write(step.command + '\n');
        session.write(`echo ${marker}$?\n`);
      });

      onStepDone(step.id, { status: stepResult, output: stepOutput });

      if (stepResult !== 'success') {
        // Stop-on-failure: the product rule is explicit that remaining
        // steps must not run once one fails or times out.
        return finishBatch(stepResult);
      }
    }
    finishBatch('success');
  };

  openAuthenticatedSession({
    region,
    loginSteps,
    secrets,
    username,
    appendOutput: () => {}, // login-phase output isn't attributed to any
    // step, so it's discarded here rather than misleadingly attached to
    // step one's output.
  })
    .then((s) => {
      session = s;
      s.stream.on('close', () => {
        if (!settled) finishBatch('failed');
      });
      runStepsSequentially();
    })
    .catch(() => {
      // Login itself failed — no step ever started, so report it via
      // the first step's callbacks so the UI has somewhere to show it.
      if (steps[0]) {
        onStepStart(steps[0].id);
        onOutput(steps[0].id, '\n[connection error] could not open session\n');
        onStepDone(steps[0].id, { status: 'failed', output: '[connection error]' });
      }
      finishBatch('failed');
    });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      finishBatch('cancelled');
    },
  };
}

module.exports = { runSession, runBatch };

const { Client } = require('ssh2');
const config = require('./config');

/**
 * Runs a full session against a region: connect -> execute login steps
 * (which may include a `su serviceaccount` handshake or not, depending
 * on region config) -> run the actual command -> capture output ->
 * disconnect.
 *
 * Because login flows vary per region (different ports, different
 * prompts, with or without `su`), the sequence is data-driven: it's a
 * list of {expect_pattern, send_template, timeout_ms} steps loaded
 * from region_login_steps, not hardcoded logic.
 *
 * @param {object} params
 * @param {object} params.region - { host, port }
 * @param {Array}  params.loginSteps - ordered list of step configs
 * @param {object} params.secrets - { password, servicePassword } resolved values
 *                                    for template substitution
 * @param {string} params.username - the initial login username
 * @param {string} params.command - the command/script text to execute
 *                                    once the shell is ready
 * @param {number} params.timeoutSeconds - max time allowed for command execution
 * @param {function} params.onOutput - callback(chunk: string) called as
 *                                       output streams in, for live relay
 *                                       to the frontend over WebSocket
 *
 * @returns {{ promise: Promise<{status, output}>, cancel: function }}
 *          `cancel()` closes the SSH connection immediately, which
 *          terminates the remote shell session the command was running
 *          in (equivalent to the terminal disconnecting). This does
 *          stop most commands, but a process the remote shell has
 *          detached (e.g. started with nohup/disown) may keep running
 *          on the server after the connection closes — that's a
 *          property of how the remote shell handles the command, not
 *          something the SSH layer can control from the client side.
 */
function runSession({
  region,
  loginSteps,
  secrets,
  username,
  command,
  timeoutSeconds,
  onOutput,
}) {
  let resolveFn;
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
  });

  const conn = new Client();
  let fullOutput = '';
  let settled = false;
  let commandTimer = null;
  let loginTimer = null;

  const appendOutput = (chunk) => {
    fullOutput += chunk;
    if (onOutput) onOutput(chunk);
  };

  const finish = (status) => {
    if (settled) return;
    settled = true;
    clearTimeout(commandTimer);
    clearTimeout(loginTimer);
    try {
      conn.end();
    } catch (_) {
      /* already closed */
    }
    resolveFn({ status, output: fullOutput });
  };

  const substitute = (template) =>
    template
      .replace(/\{username\}/g, username || '')
      .replace(/\{password\}/g, secrets.password || '')
      .replace(/\{service_password\}/g, secrets.servicePassword || '')
      .replace(/\{service_username\}/g, secrets.serviceUsername || '');

  conn.on('ready', () => {
    conn.shell((err, stream) => {
      if (err) {
        appendOutput(`\n[connection error] ${err.message}\n`);
        return finish('failed');
      }

      let stepIndex = 0;
      let stepBuffer = '';
      const steps = loginSteps || [];

      // Overall cap on how long the whole login sequence can take,
      // independent of individual step timeouts, as a backstop.
      loginTimer = setTimeout(() => {
        appendOutput('\n[login sequence exceeded overall timeout]\n');
        finish('failed');
      }, config.loginSequenceTotalTimeoutMs);

      const runNextStep = () => {
        if (stepIndex >= steps.length) {
          // Login sequence complete — now send the actual command.
          clearTimeout(loginTimer);
          stepBuffer = '';
          runCommandPhase();
          return;
        }
        const step = steps[stepIndex];
        const stepTimeout = setTimeout(() => {
          appendOutput(
            `\n[login step ${stepIndex + 1} timed out waiting for pattern: ${step.expect_pattern}]\n`
          );
          finish('failed');
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

        // Store the checker so the shared 'data' handler can call it
        currentStepChecker = checkBuffer;
      };

      let currentStepChecker = null;

      let commandPhaseActive = false;
      let commandDone = false;
      const COMMAND_END_MARKER = '__CMD_DONE_' + Date.now() + '__';

      const runCommandPhase = () => {
        commandPhaseActive = true;
        commandTimer = setTimeout(() => {
          if (!commandDone) {
            appendOutput('\n[command timed out]\n');
            finish('timeout');
          }
        }, timeoutSeconds * 1000);

        // Echo a marker after the command so we know when it's done,
        // since shell output doesn't have a clean "end of command" signal.
        stream.write(command + '\n');
        stream.write(`echo ${COMMAND_END_MARKER}\n`);
      };

      stream.on('data', (data) => {
        const text = data.toString('utf8');

        if (!commandPhaseActive) {
          stepBuffer += text;
          appendOutput(text);
          if (currentStepChecker) currentStepChecker();
        } else {
          appendOutput(text);
          if (text.includes(COMMAND_END_MARKER)) {
            commandDone = true;
            clearTimeout(commandTimer);
            finish('success');
          }
        }
      });

      stream.on('close', () => {
        if (!settled) {
          finish(commandDone ? 'success' : 'failed');
        }
      });

      stream.stderr.on('data', (data) => {
        appendOutput(data.toString('utf8'));
      });

      runNextStep();
    });
  });

  conn.on('error', (err) => {
    appendOutput(`\n[connection error] ${err.message}\n`);
    finish('failed');
  });

  const connectConfig = {
    host: region.host,
    port: region.port || 22,
    username: username,
    readyTimeout: 20000,
  };

  if (secrets.privateKey) {
    connectConfig.privateKey = secrets.privateKey;
  } else {
    connectConfig.password = secrets.password;
  }

  conn.connect(connectConfig);

  return {
    promise,
    cancel: () => {
      appendOutput('\n[cancelled by user]\n');
      finish('cancelled');
    },
  };
}

module.exports = { runSession };

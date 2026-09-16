const WebSocket = require('ws');
const supabaseAdmin = require('./supabaseAdmin');
const { getSecret } = require('./vault');
const { runSession } = require('./sshRunner');
const config = require('./config');

/**
 * Loads everything needed to run a command against a region:
 * region row, its login steps, and resolved secrets from Vault.
 */
async function loadRegionContext(regionId) {
  const { data: region, error: regionErr } = await supabaseAdmin
    .from('regions')
    .select('*')
    .eq('id', regionId)
    .single();
  if (regionErr || !region) {
    throw new Error('Region not found');
  }

  const { data: steps, error: stepsErr } = await supabaseAdmin
    .from('region_login_steps')
    .select('*')
    .eq('region_id', regionId)
    .order('step_order', { ascending: true });
  if (stepsErr) throw new Error('Failed to load login steps');

  const { data: creds, error: credsErr } = await supabaseAdmin
    .from('region_credentials')
    .select('*')
    .eq('region_id', regionId)
    .single();
  if (credsErr || !creds) {
    throw new Error('Region credentials not configured');
  }

  const password = creds.login_secret_ref
    ? await getSecret(creds.login_secret_ref)
    : null;
  const servicePassword = creds.service_secret_ref
    ? await getSecret(creds.service_secret_ref)
    : null;

  return {
    region,
    loginSteps: steps || [],
    username: creds.login_username,
    secrets: {
      password,
      servicePassword,
      serviceUsername: creds.service_username,
    },
  };
}

/**
 * Verifies the user (via their JWT) is allowed to see this region and
 * this command, re-checking access server-side rather than trusting
 * the frontend. Mirrors the RLS visibility rules: owner, admin, or an
 * explicit share.
 */
async function verifyAccess({ userId, orgId, isAdmin, regionId, commandId }) {
  const { data: region } = await supabaseAdmin
    .from('regions')
    .select('id, owner_id, org_id, visibility')
    .eq('id', regionId)
    .single();

  if (!region || region.org_id !== orgId) return false;

  const regionOk =
    region.owner_id === userId ||
    isAdmin ||
    (await hasShare('region', regionId, userId));

  if (!regionOk) return false;

  if (commandId) {
    const { data: cmd } = await supabaseAdmin
      .from('commands')
      .select('id, owner_id, org_id')
      .eq('id', commandId)
      .single();
    if (!cmd || cmd.org_id !== orgId) return false;

    const commandOk =
      cmd.owner_id === userId ||
      isAdmin ||
      (await hasShare('command', commandId, userId));
    if (!commandOk) return false;
  }

  return true;
}

async function hasShare(resourceType, resourceId, userId) {
  const { data } = await supabaseAdmin
    .from('shares')
    .select('id')
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)
    .eq('shared_with_user_id', userId)
    .maybeSingle();
  return !!data;
}

function attachWebSocketServer(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer });

  wss.on('connection', (ws) => {
    // Tracks the cancel function for whatever run is currently active
    // on this specific WebSocket connection (one run at a time per
    // connection, matching the one-run-at-a-time product rule).
    ws._activeCancel = null;
    ws._activeRunId = null;

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }

      if (msg.type === 'run') {
        handleRun(ws, msg).catch((err) => {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        });
      } else if (msg.type === 'cancel') {
        if (ws._activeCancel && ws._activeRunId === msg.runId) {
          ws._activeCancel();
        } else {
          ws.send(
            JSON.stringify({ type: 'error', message: 'No matching active run to cancel' })
          );
        }
      }
    });

    ws.on('close', () => {
      // If the browser tab closes mid-run, cancel the SSH session too
      // rather than leaving it running with no one listening.
      if (ws._activeCancel) {
        ws._activeCancel();
      }
    });
  });

  return wss;
}

async function handleRun(ws, msg) {
  // msg: { type: 'run', accessToken, regionId, commandId (nullable for
  //        scratch pad), commandText, timeoutSeconds (nullable) }
  const { accessToken, regionId, commandId, commandText } = msg;

  if (!accessToken || !regionId || !commandText) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Missing required fields' }));
  }

  // Verify the JWT and get the user
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Invalid or expired session' }));
  }
  const userId = userData.user.id;

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (profileErr || !profile) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Profile not found' }));
  }

  // Enforce one-run-at-a-time
  if (profile.active_run_id) {
    return ws.send(
      JSON.stringify({ type: 'error', message: 'You already have a command running' })
    );
  }

  const isAdmin = profile.role === 'admin';
  const allowed = await verifyAccess({
    userId,
    orgId: profile.org_id,
    isAdmin,
    regionId,
    commandId: commandId || null,
  });
  if (!allowed) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Access denied to this resource' }));
  }

  // Determine timeout: explicit command setting > system default
  let timeoutSeconds = config.defaultCommandTimeoutSeconds;
  let commandVersion = null;
  if (commandId) {
    const { data: cmd } = await supabaseAdmin
      .from('commands')
      .select('timeout_seconds, current_version')
      .eq('id', commandId)
      .single();
    if (cmd?.timeout_seconds) timeoutSeconds = cmd.timeout_seconds;
    if (cmd?.current_version) commandVersion = cmd.current_version;
  }

  // Create the run_history row up front with status 'running'
  const { data: runRow, error: runInsertErr } = await supabaseAdmin
    .from('run_history')
    .insert({
      org_id: profile.org_id,
      user_id: userId,
      region_id: regionId,
      command_id: commandId || null,
      command_version: commandVersion,
      raw_command_text: commandText,
      status: 'running',
      timeout_used_s: timeoutSeconds,
    })
    .select()
    .single();

  if (runInsertErr) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Failed to start run record' }));
  }

  // Mark user as having an active run
  await supabaseAdmin
    .from('profiles')
    .update({ active_run_id: runRow.id })
    .eq('id', userId);

  ws.send(JSON.stringify({ type: 'started', runId: runRow.id }));

  let regionContext;
  try {
    regionContext = await loadRegionContext(regionId);
  } catch (err) {
    await finalizeRun(runRow.id, userId, 'failed', `[setup error] ${err.message}`);
    return ws.send(JSON.stringify({ type: 'error', message: err.message, runId: runRow.id }));
  }

  const { promise, cancel } = runSession({
    region: regionContext.region,
    loginSteps: regionContext.loginSteps,
    secrets: regionContext.secrets,
    username: regionContext.username,
    command: commandText,
    timeoutSeconds,
    onOutput: (chunk) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'output', runId: runRow.id, chunk }));
      }
    },
  });

  ws._activeCancel = cancel;
  ws._activeRunId = runRow.id;

  // Hard backstop independent of sshRunner's own timeout logic. If
  // something inside the SSH library never fires a callback (a known
  // class of bug in long-lived TCP/SSH libraries under unusual network
  // conditions), this guarantees active_run_id is still cleared and
  // the run_history row still gets a terminal status — without this,
  // a single hung connection would permanently lock the user out of
  // running anything ever again, since nothing else clears
  // active_run_id. Set comfortably above the run's own timeout so it
  // only fires if the run's own timeout logic itself failed to.
  const backstopMs = (timeoutSeconds + 30) * 1000;
  let backstopFired = false;
  const backstopTimer = setTimeout(async () => {
    backstopFired = true;
    cancel(); // best-effort: try to close the hung connection too
    await finalizeRun(
      runRow.id,
      userId,
      'timeout',
      '[backstop] run did not complete or cancel within the expected window'
    );
    ws._activeCancel = null;
    ws._activeRunId = null;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'done', runId: runRow.id, status: 'timeout' }));
    }
  }, backstopMs);

  const result = await promise;
  clearTimeout(backstopTimer);

  // If the backstop already fired and finalized this run, don't
  // finalize it a second time (finalizeRun is not designed to be
  // called twice for the same run).
  if (backstopFired) return;

  ws._activeCancel = null;
  ws._activeRunId = null;

  await finalizeRun(runRow.id, userId, result.status, result.output);

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'done',
        runId: runRow.id,
        status: result.status,
      })
    );
  }
}

async function finalizeRun(runId, userId, status, output) {
  // These two updates are independent goals: recording the run's
  // outcome, and unlocking the user so they can run another command.
  // Run them separately so a failure in one (e.g. a transient network
  // error writing run_history) can't prevent the other — in particular,
  // clearing active_run_id must not be skipped just because the
  // history write failed, or the user would be locked out with no
  // path to recovery except a manual database edit.
  try {
    await supabaseAdmin
      .from('run_history')
      .update({
        status,
        output,
        ended_at: new Date().toISOString(),
      })
      .eq('id', runId);
  } catch (err) {
    console.error(`Failed to update run_history for run ${runId}:`, err);
  }

  try {
    await supabaseAdmin.from('profiles').update({ active_run_id: null }).eq('id', userId);
  } catch (err) {
    console.error(`Failed to clear active_run_id for user ${userId}:`, err);
  }
}

module.exports = { attachWebSocketServer };

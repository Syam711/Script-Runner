const crypto = require('crypto');
const WebSocket = require('ws');
const supabaseAdmin = require('./supabaseAdmin');
const { getSecret } = require('./vault');
const { runSession, runBatch } = require('./sshRunner');
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

/**
 * Loads a batch, verifies the caller can see it (owner/admin/share),
 * and loads its ordered steps with each step's command content. Also
 * re-verifies each referenced command is visible to the caller — a
 * batch should never be usable to run a command the user couldn't
 * otherwise reach directly, even if that command was somehow attached
 * to a batch the user can see.
 */
async function loadBatchForRun({ batchId, userId, orgId, isAdmin }) {
  const { data: batch, error: batchErr } = await supabaseAdmin
    .from('batches')
    .select('*')
    .eq('id', batchId)
    .single();
  if (batchErr || !batch || batch.org_id !== orgId) {
    throw new Error('Batch not found');
  }

  const batchOk =
    batch.owner_id === userId || isAdmin || (await hasShare('batch', batchId, userId));
  if (!batchOk) throw new Error('Access denied to this batch');

  const { data: stepRows, error: stepsErr } = await supabaseAdmin
    .from('batch_steps')
    .select('step_order, command_id, commands(*)')
    .eq('batch_id', batchId)
    .order('step_order', { ascending: true });
  if (stepsErr || !stepRows || stepRows.length === 0) {
    throw new Error('Batch has no steps');
  }

  for (const row of stepRows) {
    const cmd = row.commands;
    if (!cmd) throw new Error('A command in this batch no longer exists');
    const cmdOk =
      cmd.owner_id === userId || isAdmin || (await hasShare('command', cmd.id, userId));
    if (!cmdOk) throw new Error('Access denied to a command in this batch');
  }

  return { batch, steps: stepRows.map((r) => r.commands) };
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
      } else if (msg.type === 'run_batch') {
        handleRunBatch(ws, msg).catch((err) => {
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

async function handleRunBatch(ws, msg) {
  // msg: { type: 'run_batch', accessToken, batchId }
  const { accessToken, batchId } = msg;

  if (!accessToken || !batchId) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Missing required fields' }));
  }

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

  // Same one-run-at-a-time rule as a single command — a batch counts
  // as one run for this purpose, for its entire duration.
  if (profile.active_run_id) {
    return ws.send(
      JSON.stringify({ type: 'error', message: 'You already have a command running' })
    );
  }

  const isAdmin = profile.role === 'admin';
  let batchData;
  try {
    batchData = await loadBatchForRun({ batchId, userId, orgId: profile.org_id, isAdmin });
  } catch (err) {
    return ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }

  const { batch, steps } = batchData;
  const regionId = batch.region_id;

  let regionContext;
  try {
    regionContext = await loadRegionContext(regionId);
  } catch (err) {
    return ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }

  // Create one run_history row per step up front, all sharing a
  // batch_id, with 'running' status only on the first — the rest sit
  // implicitly pending until the batch reaches them. This gives the UI
  // a stable set of row IDs to reference from the very first message.
  // A fresh id per execution of this batch (not the batch definition's
  // own id) — so running the same saved batch twice produces two
  // distinguishable groups of rows in history, the same way two runs
  // of the same saved command are still separate run_history rows.
  const commonBatchId = crypto.randomUUID();
  const rowsToInsert = steps.map((cmd, i) => ({
    org_id: profile.org_id,
    user_id: userId,
    region_id: regionId,
    command_id: cmd.id,
    command_version: cmd.current_version,
    batch_id: commonBatchId,
    batch_step_order: i,
    raw_command_text: cmd.content,
    status: i === 0 ? 'running' : 'pending', // real placeholder for
    // not-yet-started steps — distinct from 'cancelled' so a page
    // refresh mid-batch shows "waiting" rather than misleadingly
    // implying the step was stopped before it ever got a turn.
    timeout_used_s: cmd.timeout_seconds || config.defaultCommandTimeoutSeconds,
  }));

  const { data: runRows, error: insertErr } = await supabaseAdmin
    .from('run_history')
    .insert(rowsToInsert)
    .select();
  if (insertErr || !runRows) {
    return ws.send(JSON.stringify({ type: 'error', message: 'Failed to start batch record' }));
  }

  // Map each step's position to its run_history row id, since
  // runBatch() below refers to steps by a caller-defined id.
  const rowByStepIndex = new Map();
  runRows
    .sort((a, b) => a.batch_step_order - b.batch_step_order)
    .forEach((row) => rowByStepIndex.set(row.batch_step_order, row));

  await supabaseAdmin
    .from('profiles')
    .update({ active_run_id: runRows[0].id })
    .eq('id', userId);

  ws.send(
    JSON.stringify({
      type: 'batch_started',
      batchId: commonBatchId,
      steps: steps.map((cmd, i) => ({
        runId: rowByStepIndex.get(i).id,
        name: cmd.name,
        order: i,
      })),
    })
  );

  const perStepTimeout = (cmd) => cmd.timeout_seconds || config.defaultCommandTimeoutSeconds;

  const { promise, cancel } = runBatch({
    region: regionContext.region,
    loginSteps: regionContext.loginSteps,
    secrets: regionContext.secrets,
    username: regionContext.username,
    steps: steps.map((cmd, i) => ({ id: i, command: cmd.content })),
    // A single timeout applies for the whole batch's per-step wait,
    // using the longest individual command timeout so no step is cut
    // short by a stricter neighbor's setting.
    timeoutSeconds: Math.max(...steps.map(perStepTimeout)),
    onStepStart: (stepIndex) => {
      const row = rowByStepIndex.get(stepIndex);
      if (stepIndex > 0) {
        // Flip this step's placeholder status to 'running' now that
        // it's actually starting.
        supabaseAdmin.from('run_history').update({ status: 'running' }).eq('id', row.id);
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'step_started', runId: row.id }));
      }
    },
    onOutput: (stepIndex, chunk) => {
      const row = rowByStepIndex.get(stepIndex);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'output', runId: row.id, chunk }));
      }
    },
    onStepDone: (stepIndex, { status, output }) => {
      const row = rowByStepIndex.get(stepIndex);
      supabaseAdmin
        .from('run_history')
        .update({ status, output, ended_at: new Date().toISOString() })
        .eq('id', row.id);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'step_done', runId: row.id, status }));
      }
    },
  });

  ws._activeCancel = cancel;
  ws._activeRunId = runRows[0].id;

  // Same hard backstop as a single run, sized to the whole batch's
  // worst case (sum of every step's timeout) rather than one step's,
  // since the batch legitimately may take that long to reach a
  // terminal state on its own.
  const totalTimeoutS = steps.reduce((sum, cmd) => sum + perStepTimeout(cmd), 0) + 30;
  let backstopFired = false;
  const backstopTimer = setTimeout(async () => {
    backstopFired = true;
    cancel();
    await sweepPendingBatchSteps(commonBatchId, 'timeout');
    await supabaseAdmin.from('profiles').update({ active_run_id: null }).eq('id', userId);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'batch_done', batchId: commonBatchId, status: 'timeout' }));
    }
  }, totalTimeoutS * 1000);

  const result = await promise;
  clearTimeout(backstopTimer);
  if (backstopFired) return;

  // Any step that never got a turn (the batch stopped early due to a
  // failure or a user cancel) is still sitting at 'pending' — resolve
  // it to a real terminal status now, so history never shows a step
  // as permanently "waiting" once the batch itself has ended.
  await sweepPendingBatchSteps(commonBatchId, result.status === 'success' ? 'success' : 'cancelled');

  ws._activeCancel = null;
  ws._activeRunId = null;
  await supabaseAdmin.from('profiles').update({ active_run_id: null }).eq('id', userId);

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'batch_done', batchId: commonBatchId, status: result.status }));
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

/**
 * Resolves any run_history rows for this batch still sitting at
 * 'pending' (steps that never got a turn because the batch stopped
 * early) to a real terminal status. Called once after a batch settles,
 * regardless of whether it finished normally, failed partway, was
 * cancelled, or hit the backstop timeout — so history never shows a
 * step stuck at "waiting" forever.
 */
async function sweepPendingBatchSteps(batchId, terminalStatus) {
  try {
    await supabaseAdmin
      .from('run_history')
      .update({ status: terminalStatus, ended_at: new Date().toISOString() })
      .eq('batch_id', batchId)
      .eq('status', 'pending');
  } catch (err) {
    console.error(`Failed to sweep pending steps for batch ${batchId}:`, err);
  }
}

module.exports = { attachWebSocketServer };

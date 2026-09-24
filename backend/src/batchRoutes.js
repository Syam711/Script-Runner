const supabaseAdmin = require('./supabaseAdmin');
const { authenticate, sendJson } = require('./httpHelpers');

/**
 * Confirms the caller can act on the given region — same rule as
 * commandRoutes.js: owner, admin, or an explicit share.
 */
async function canAccessRegion(profile, regionId) {
  const { data: region } = await supabaseAdmin
    .from('regions')
    .select('id, owner_id, org_id')
    .eq('id', regionId)
    .single();

  if (!region || region.org_id !== profile.org_id) return false;
  if (region.owner_id === profile.id || profile.role === 'admin') return true;

  const { data: share } = await supabaseAdmin
    .from('shares')
    .select('id')
    .eq('resource_type', 'region')
    .eq('resource_id', regionId)
    .eq('shared_with_user_id', profile.id)
    .maybeSingle();

  return !!share;
}

/**
 * Verifies every commandId belongs to the org, is visible to the
 * caller (owner/admin/share), and — the rule specific to batches —
 * targets the same region as the batch itself. Mixing regions within
 * one batch isn't allowed, since a batch runs over a single SSH
 * session opened against one region.
 */
async function validateStepCommands(profile, regionId, commandIds) {
  if (!Array.isArray(commandIds) || commandIds.length === 0) {
    return 'A batch needs at least one command';
  }

  const { data: commands, error } = await supabaseAdmin
    .from('commands')
    .select('id, org_id, region_id, owner_id')
    .in('id', commandIds);

  if (error) return 'Failed to look up commands';
  if (!commands || commands.length !== commandIds.length) {
    return 'One or more commands could not be found';
  }

  for (const cmd of commands) {
    if (cmd.org_id !== profile.org_id) return 'A command belongs to a different organization';
    if (cmd.region_id !== regionId) {
      return 'Every command in a batch must belong to the same region as the batch';
    }
    const ok =
      cmd.owner_id === profile.id ||
      profile.role === 'admin' ||
      (await hasShare('command', cmd.id, profile.id));
    if (!ok) return 'Access denied to one of the selected commands';
  }

  return null; // no error
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
 * POST /batches
 * body: { accessToken, regionId, name, commandIds: [ordered], visibility }
 */
async function createBatch(req, res, body) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });

  if (!body.regionId || !body.name) {
    return sendJson(res, 400, { error: 'regionId and name are required' });
  }

  const regionOk = await canAccessRegion(profile, body.regionId);
  if (!regionOk) return sendJson(res, 403, { error: 'No access to that region' });

  const stepError = await validateStepCommands(profile, body.regionId, body.commandIds);
  if (stepError) return sendJson(res, 400, { error: stepError });

  const visibility =
    profile.role === 'admin' && body.visibility === 'shared' ? 'shared' : 'private';

  const { data: batch, error: batchErr } = await supabaseAdmin
    .from('batches')
    .insert({
      org_id: profile.org_id,
      owner_id: profile.id,
      region_id: body.regionId,
      name: body.name,
      visibility,
    })
    .select()
    .single();

  if (batchErr) return sendJson(res, 400, { error: batchErr.message });

  const stepRows = body.commandIds.map((commandId, i) => ({
    batch_id: batch.id,
    step_order: i,
    command_id: commandId,
  }));

  const { error: stepsErr } = await supabaseAdmin.from('batch_steps').insert(stepRows);
  if (stepsErr) {
    // Roll back so we never leave a batch with no steps sitting around.
    await supabaseAdmin.from('batches').delete().eq('id', batch.id);
    return sendJson(res, 500, { error: `Failed to save batch steps: ${stepsErr.message}` });
  }

  return sendJson(res, 200, { batch });
}

/**
 * PATCH /batches/:id
 * body: { accessToken, name?, commandIds?, visibility? }
 * If commandIds is provided, it fully replaces the step list (same
 * "form always submits the complete list" approach as region login
 * steps) — simpler and less error-prone than diffing partial edits.
 */
async function updateBatch(req, res, body, batchId) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });

  const { data: batch, error: batchErr } = await supabaseAdmin
    .from('batches')
    .select('*')
    .eq('id', batchId)
    .single();
  if (batchErr || !batch) return sendJson(res, 404, { error: 'Batch not found' });

  const isOwner = batch.owner_id === profile.id;
  if (!isOwner && profile.role !== 'admin') {
    return sendJson(res, 403, { error: 'Not authorized to edit this batch' });
  }

  const updates = {};
  if (body.name) updates.name = body.name;
  if (profile.role === 'admin' && body.visibility) updates.visibility = body.visibility;

  if (Object.keys(updates).length > 0) {
    const { error: updErr } = await supabaseAdmin.from('batches').update(updates).eq('id', batchId);
    if (updErr) return sendJson(res, 400, { error: updErr.message });
  }

  if (Array.isArray(body.commandIds)) {
    const stepError = await validateStepCommands(profile, batch.region_id, body.commandIds);
    if (stepError) return sendJson(res, 400, { error: stepError });

    await supabaseAdmin.from('batch_steps').delete().eq('batch_id', batchId);
    const stepRows = body.commandIds.map((commandId, i) => ({
      batch_id: batchId,
      step_order: i,
      command_id: commandId,
    }));
    const { error: stepsErr } = await supabaseAdmin.from('batch_steps').insert(stepRows);
    if (stepsErr) return sendJson(res, 500, { error: stepsErr.message });
  }

  return sendJson(res, 200, { ok: true });
}

/**
 * DELETE /batches/:id
 * batch_steps cascade-delete via the FK. run_history rows keep their
 * batch_id (no FK there, by design — see schema.sql) so past runs
 * remain grouped and readable after the batch definition is gone.
 */
async function deleteBatch(req, res, body, batchId) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });

  const { data: batch, error: batchErr } = await supabaseAdmin
    .from('batches')
    .select('*')
    .eq('id', batchId)
    .single();
  if (batchErr || !batch) return sendJson(res, 404, { error: 'Batch not found' });

  const isOwner = batch.owner_id === profile.id;
  if (!isOwner && profile.role !== 'admin') {
    return sendJson(res, 403, { error: 'Not authorized to delete this batch' });
  }

  const { error: delErr } = await supabaseAdmin.from('batches').delete().eq('id', batchId);
  if (delErr) return sendJson(res, 500, { error: delErr.message });

  return sendJson(res, 200, { ok: true });
}

module.exports = { createBatch, updateBatch, deleteBatch };

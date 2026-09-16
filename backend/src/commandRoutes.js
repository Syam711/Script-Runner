const supabaseAdmin = require('./supabaseAdmin');
const { authenticate, sendJson } = require('./httpHelpers');

/**
 * Confirms the caller can act on the given region — same visibility
 * rule as elsewhere: owner, admin, or an explicit share. A command
 * must belong to a region the user can actually see, otherwise you
 * could create a command against a region you have no business
 * touching.
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
 * POST /commands
 * body: { accessToken, regionId, name, content, safetyTier, visibility, timeoutSeconds }
 */
async function createCommand(req, res, body) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });

  if (!body.regionId || !body.name || !body.content) {
    return sendJson(res, 400, { error: 'regionId, name, and content are required' });
  }

  const allowed = await canAccessRegion(profile, body.regionId);
  if (!allowed) return sendJson(res, 403, { error: 'No access to that region' });

  const visibility =
    profile.role === 'admin' && body.visibility === 'shared' ? 'shared' : 'private';

  const { data: command, error: cmdErr } = await supabaseAdmin
    .from('commands')
    .insert({
      org_id: profile.org_id,
      owner_id: profile.id,
      region_id: body.regionId,
      name: body.name,
      content: body.content,
      safety_tier: body.safetyTier || 'safe',
      visibility,
      timeout_seconds: body.timeoutSeconds || null,
      current_version: 1,
    })
    .select()
    .single();

  if (cmdErr) return sendJson(res, 400, { error: cmdErr.message });

  const { error: versionErr } = await supabaseAdmin.from('command_versions').insert({
    command_id: command.id,
    version: 1,
    content: body.content,
  });

  if (versionErr) {
    // Roll back so we don't leave a command with no version history.
    await supabaseAdmin.from('commands').delete().eq('id', command.id);
    return sendJson(res, 500, { error: `Failed to save command version: ${versionErr.message}` });
  }

  return sendJson(res, 200, { command });
}

/**
 * PATCH /commands/:id
 * If `content` differs from the current version, a new command_versions
 * row is created and current_version is bumped. Other fields (name,
 * safety_tier, visibility, timeout) update in place without versioning
 * — only the executable content is versioned.
 */
async function updateCommand(req, res, body, commandId) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });

  const { data: command, error: cmdErr } = await supabaseAdmin
    .from('commands')
    .select('*')
    .eq('id', commandId)
    .single();
  if (cmdErr || !command) return sendJson(res, 404, { error: 'Command not found' });

  const isOwner = command.owner_id === profile.id;
  if (!isOwner && profile.role !== 'admin') {
    return sendJson(res, 403, { error: 'Not authorized to edit this command' });
  }

  const updates = {};
  if (body.name) updates.name = body.name;
  if (body.safetyTier) updates.safety_tier = body.safetyTier;
  if (profile.role === 'admin' && body.visibility) updates.visibility = body.visibility;
  if (body.timeoutSeconds !== undefined) updates.timeout_seconds = body.timeoutSeconds || null;

  const contentChanged = body.content && body.content !== command.content;
  if (contentChanged) {
    const newVersion = command.current_version + 1;
    const { error: versionErr } = await supabaseAdmin.from('command_versions').insert({
      command_id: commandId,
      version: newVersion,
      content: body.content,
    });
    if (versionErr) return sendJson(res, 500, { error: versionErr.message });

    updates.content = body.content;
    updates.current_version = newVersion;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updErr } = await supabaseAdmin
      .from('commands')
      .update(updates)
      .eq('id', commandId);
    if (updErr) return sendJson(res, 400, { error: updErr.message });
  }

  return sendJson(res, 200, { ok: true });
}

/**
 * DELETE /commands/:id
 * run_history rows referencing this command have command_id set to
 * null automatically (ON DELETE SET NULL in the schema) and keep
 * raw_command_text, so history stays readable after deletion.
 */
async function deleteCommand(req, res, body, commandId) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });

  const { data: command, error: cmdErr } = await supabaseAdmin
    .from('commands')
    .select('*')
    .eq('id', commandId)
    .single();
  if (cmdErr || !command) return sendJson(res, 404, { error: 'Command not found' });

  const isOwner = command.owner_id === profile.id;
  if (!isOwner && profile.role !== 'admin') {
    return sendJson(res, 403, { error: 'Not authorized to delete this command' });
  }

  const { error: delErr } = await supabaseAdmin.from('commands').delete().eq('id', commandId);
  if (delErr) return sendJson(res, 500, { error: delErr.message });

  return sendJson(res, 200, { ok: true });
}

module.exports = { createCommand, updateCommand, deleteCommand };

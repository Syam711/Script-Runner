const supabaseAdmin = require('./supabaseAdmin');
const { authenticate, sendJson } = require('./httpHelpers');

// Single source of truth for which resource types can be shared and
// which table backs each — extending to a new shareable type (like
// batches) means adding one line here, not hunting down every ternary.
const SHAREABLE_TABLES = {
  region: 'regions',
  command: 'commands',
  batch: 'batches',
};
const SHAREABLE_TYPES = Object.keys(SHAREABLE_TABLES);

/**
 * POST /shares
 * body: { accessToken, resourceType: 'region'|'command'|'batch', resourceId, memberId }
 *
 * Admin-only. Marks the underlying resource's visibility as 'shared'
 * (if it wasn't already) and creates the share row. Re-validates
 * everything server-side — this endpoint is the actual enforcement
 * point for "only admins can share," not just an RLS side-effect.
 */
async function createShare(req, res, body) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });
  if (profile.role !== 'admin') {
    return sendJson(res, 403, { error: 'Only admins can share resources' });
  }

  const { resourceType, resourceId, memberId } = body;
  if (!SHAREABLE_TYPES.includes(resourceType) || !resourceId || !memberId) {
    return sendJson(res, 400, { error: 'resourceType, resourceId, and memberId are required' });
  }

  const table = SHAREABLE_TABLES[resourceType];
  const { data: resource, error: resourceErr } = await supabaseAdmin
    .from(table)
    .select('id, org_id')
    .eq('id', resourceId)
    .single();
  if (resourceErr || !resource || resource.org_id !== profile.org_id) {
    return sendJson(res, 404, { error: `${resourceType} not found` });
  }

  const { data: member, error: memberErr } = await supabaseAdmin
    .from('profiles')
    .select('id, org_id')
    .eq('id', memberId)
    .single();
  if (memberErr || !member || member.org_id !== profile.org_id) {
    return sendJson(res, 404, { error: 'Member not found in your organization' });
  }

  // Ensure the resource is marked shared so its visibility rule is
  // consistent — a share row with visibility still 'private' would be
  // a contradictory state.
  await supabaseAdmin.from(table).update({ visibility: 'shared' }).eq('id', resourceId);

  const { error: shareErr } = await supabaseAdmin.from('shares').upsert(
    {
      resource_type: resourceType,
      resource_id: resourceId,
      shared_with_user_id: memberId,
      shared_by_user_id: profile.id,
    },
    { onConflict: 'resource_type,resource_id,shared_with_user_id' }
  );

  if (shareErr) return sendJson(res, 500, { error: shareErr.message });

  return sendJson(res, 200, { ok: true });
}

/**
 * DELETE /shares
 * body: { accessToken, resourceType, resourceId, memberId }
 * Removes one member's access. Does not automatically revert the
 * resource to 'private' even if this was the last share — an admin
 * may intend to keep it 'shared' and add different members later.
 */
async function deleteShare(req, res, body) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });
  if (profile.role !== 'admin') {
    return sendJson(res, 403, { error: 'Only admins can manage sharing' });
  }

  const { resourceType, resourceId, memberId } = body;
  if (!SHAREABLE_TYPES.includes(resourceType) || !resourceId || !memberId) {
    return sendJson(res, 400, { error: 'resourceType, resourceId, and memberId are required' });
  }

  const { error } = await supabaseAdmin
    .from('shares')
    .delete()
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)
    .eq('shared_with_user_id', memberId);

  if (error) return sendJson(res, 500, { error: error.message });

  return sendJson(res, 200, { ok: true });
}

/**
 * GET-style fetch via POST (kept consistent with the rest of this API,
 * which passes accessToken in the body rather than an Authorization
 * header): lists current shares for a resource, and all org members,
 * so the frontend can render a share dialog in one call.
 */
async function listShareContext(req, res, body) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });
  if (profile.role !== 'admin') {
    return sendJson(res, 403, { error: 'Only admins can view sharing details' });
  }

  const { resourceType, resourceId } = body;
  if (!SHAREABLE_TYPES.includes(resourceType) || !resourceId) {
    return sendJson(res, 400, { error: 'resourceType and resourceId are required' });
  }

  const { data: shares, error: sharesErr } = await supabaseAdmin
    .from('shares')
    .select('shared_with_user_id')
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId);
  if (sharesErr) return sendJson(res, 500, { error: sharesErr.message });

  const { data: members, error: membersErr } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, role')
    .eq('org_id', profile.org_id)
    .eq('role', 'member');
  if (membersErr) return sendJson(res, 500, { error: membersErr.message });

  const sharedWithIds = new Set(shares.map((s) => s.shared_with_user_id));

  return sendJson(res, 200, {
    members: members.map((m) => ({ ...m, shared: sharedWithIds.has(m.id) })),
  });
}

module.exports = { createShare, deleteShare, listShareContext };

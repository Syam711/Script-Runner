const supabaseAdmin = require('./supabaseAdmin');
const { createSecret, updateSecret, deleteSecret } = require('./vault');
const { authenticate, sendJson } = require('./httpHelpers');

/**
 * POST /regions
 * body: {
 *   accessToken, name, host, port, authType, visibility,
 *   username, password, serviceUsername, servicePassword,
 *   loginSteps: [{ step_order, expect_pattern, send_template, timeout_ms }]
 * }
 *
 * Members creating their own region will have visibility forced to
 * 'private' server-side regardless of what's sent — only an Admin can
 * create a 'shared' region. This mirrors the product rule and is
 * re-checked here rather than trusted from the client.
 */
async function createRegion(req, res, body) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });

  const visibility =
    profile.role === 'admin' && body.visibility === 'shared' ? 'shared' : 'private';

  const { data: region, error: regionErr } = await supabaseAdmin
    .from('regions')
    .insert({
      org_id: profile.org_id,
      owner_id: profile.id,
      name: body.name,
      host: body.host,
      port: body.port || 22,
      auth_type: body.authType,
      visibility,
    })
    .select()
    .single();

  if (regionErr) return sendJson(res, 400, { error: regionErr.message });

  try {
    // Store credentials in Vault, then save only the refs in Postgres.
    const loginSecretRef = body.password
      ? await createSecret(body.password, `region-login-${region.id}`)
      : null;
    const serviceSecretRef = body.servicePassword
      ? await createSecret(body.servicePassword, `region-su-${region.id}`)
      : null;

    const { error: credErr } = await supabaseAdmin.from('region_credentials').insert({
      region_id: region.id,
      login_username: body.username || null,
      login_secret_ref: loginSecretRef,
      service_username: body.serviceUsername || null,
      service_secret_ref: serviceSecretRef,
    });
    if (credErr) throw new Error(credErr.message);

    if (Array.isArray(body.loginSteps) && body.loginSteps.length > 0) {
      const rows = body.loginSteps.map((s) => ({
        region_id: region.id,
        step_order: s.step_order,
        expect_pattern: s.expect_pattern,
        send_template: s.send_template,
        timeout_ms: s.timeout_ms || 10000,
      }));
      const { error: stepsErr } = await supabaseAdmin.from('region_login_steps').insert(rows);
      if (stepsErr) throw new Error(stepsErr.message);
    }

    return sendJson(res, 200, { region });
  } catch (err) {
    // Roll back the region row if credential/step setup failed, so we
    // don't leave a half-configured region behind.
    await supabaseAdmin.from('regions').delete().eq('id', region.id);
    return sendJson(res, 500, { error: `Failed to save region credentials: ${err.message}` });
  }
}

/**
 * PATCH /regions/:id
 * Same body shape as create; only provided credential fields are
 * rotated (omitted password fields leave the existing secret as-is).
 */
async function updateRegion(req, res, body, regionId) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });

  const { data: region, error: regionErr } = await supabaseAdmin
    .from('regions')
    .select('*')
    .eq('id', regionId)
    .single();
  if (regionErr || !region) return sendJson(res, 404, { error: 'Region not found' });

  const isOwner = region.owner_id === profile.id;
  if (!isOwner && profile.role !== 'admin') {
    return sendJson(res, 403, { error: 'Not authorized to edit this region' });
  }

  const updates = {};
  if (body.name) updates.name = body.name;
  if (body.host) updates.host = body.host;
  if (body.port) updates.port = body.port;
  if (body.authType) updates.auth_type = body.authType;
  if (profile.role === 'admin' && body.visibility) updates.visibility = body.visibility;

  if (Object.keys(updates).length > 0) {
    const { error: updErr } = await supabaseAdmin
      .from('regions')
      .update(updates)
      .eq('id', regionId);
    if (updErr) return sendJson(res, 400, { error: updErr.message });
  }

  const { data: creds } = await supabaseAdmin
    .from('region_credentials')
    .select('*')
    .eq('region_id', regionId)
    .single();

  try {
    if (body.password && creds?.login_secret_ref) {
      await updateSecret(creds.login_secret_ref, body.password);
    } else if (body.password) {
      const ref = await createSecret(body.password, `region-login-${regionId}`);
      await supabaseAdmin
        .from('region_credentials')
        .update({ login_secret_ref: ref })
        .eq('region_id', regionId);
    }

    if (body.servicePassword && creds?.service_secret_ref) {
      await updateSecret(creds.service_secret_ref, body.servicePassword);
    } else if (body.servicePassword) {
      const ref = await createSecret(body.servicePassword, `region-su-${regionId}`);
      await supabaseAdmin
        .from('region_credentials')
        .update({ service_secret_ref: ref })
        .eq('region_id', regionId);
    }

    if (body.username || body.serviceUsername) {
      const credUpdates = {};
      if (body.username) credUpdates.login_username = body.username;
      if (body.serviceUsername) credUpdates.service_username = body.serviceUsername;
      await supabaseAdmin.from('region_credentials').update(credUpdates).eq('region_id', regionId);
    }

    if (Array.isArray(body.loginSteps)) {
      // Replace the full step sequence for simplicity — the form
      // always submits the complete ordered list, not partial edits.
      await supabaseAdmin.from('region_login_steps').delete().eq('region_id', regionId);
      if (body.loginSteps.length > 0) {
        const rows = body.loginSteps.map((s) => ({
          region_id: regionId,
          step_order: s.step_order,
          expect_pattern: s.expect_pattern,
          send_template: s.send_template,
          timeout_ms: s.timeout_ms || 10000,
        }));
        await supabaseAdmin.from('region_login_steps').insert(rows);
      }
    }

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendJson(res, 500, { error: `Failed to update region credentials: ${err.message}` });
  }
}

/**
 * DELETE /regions/:id
 * Cleans up the Vault secrets before the row cascade-deletes
 * region_credentials, since Vault secrets are not automatically
 * removed by a Postgres cascade (they live in a separate Vault table).
 */
async function deleteRegion(req, res, body, regionId) {
  const profile = await authenticate(body.accessToken);
  if (!profile) return sendJson(res, 401, { error: 'Invalid or expired session' });

  const { data: region, error: regionErr } = await supabaseAdmin
    .from('regions')
    .select('*')
    .eq('id', regionId)
    .single();
  if (regionErr || !region) return sendJson(res, 404, { error: 'Region not found' });

  const isOwner = region.owner_id === profile.id;
  if (!isOwner && profile.role !== 'admin') {
    return sendJson(res, 403, { error: 'Not authorized to delete this region' });
  }

  const { data: creds } = await supabaseAdmin
    .from('region_credentials')
    .select('*')
    .eq('region_id', regionId)
    .single();

  if (creds) {
    await deleteSecret(creds.login_secret_ref);
    await deleteSecret(creds.service_secret_ref);
  }

  const { error: delErr } = await supabaseAdmin.from('regions').delete().eq('id', regionId);
  if (delErr) return sendJson(res, 500, { error: delErr.message });

  return sendJson(res, 200, { ok: true });
}

module.exports = { createRegion, updateRegion, deleteRegion };

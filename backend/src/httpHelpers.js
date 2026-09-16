const supabaseAdmin = require('./supabaseAdmin');

/**
 * Verifies the caller's JWT and returns their profile row, or null if
 * invalid or the profile doesn't exist. Shared by all HTTP route
 * handlers so token verification logic lives in exactly one place.
 */
async function authenticate(accessToken) {
  if (!accessToken) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) return null;

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();
  if (profileErr || !profile) return null;

  return profile;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

module.exports = { authenticate, sendJson };

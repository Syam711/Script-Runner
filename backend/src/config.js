require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

module.exports = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  port: parseInt(process.env.PORT || '3000', 10),
  defaultCommandTimeoutSeconds: parseInt(
    process.env.DEFAULT_COMMAND_TIMEOUT_SECONDS || '60',
    10
  ),
  loginSequenceTotalTimeoutMs: parseInt(
    process.env.LOGIN_SEQUENCE_TOTAL_TIMEOUT_MS || '30000',
    10
  ),
  // Restrict this to your actual frontend URL once deployed, e.g.
  // https://your-app.vercel.app — defaults to '*' for local dev only.
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
};

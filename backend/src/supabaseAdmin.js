const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

// This client uses the service_role key, which bypasses Row Level
// Security entirely. It must NEVER be sent to the frontend or logged.
// Only this backend process should hold it.
const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

module.exports = supabaseAdmin;

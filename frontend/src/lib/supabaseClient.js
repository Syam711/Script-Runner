import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Check your .env file.'
  );
}

// Only ever use the anon/public key on the frontend. The service_role
// key must never appear in frontend code or env vars prefixed VITE_
// (Vite exposes anything prefixed VITE_ to the browser bundle).
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

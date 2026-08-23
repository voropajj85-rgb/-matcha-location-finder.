import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, hasSupabaseConfig } from './config.js?v=supabase-1';

let client = null;

export function getSupabaseClient() {
  if (!hasSupabaseConfig()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return client;
}

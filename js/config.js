export const SUPABASE_URL = 'https://gyezuxxihgiagzirabpv.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6W1SNjmZJmXzFqbtOC0pXw_Uxk8Y-hr';

export function hasSupabaseConfig() {
  return Boolean(
    SUPABASE_URL
      && SUPABASE_PUBLISHABLE_KEY
      && !SUPABASE_URL.includes('YOUR_SUPABASE_URL')
      && !SUPABASE_PUBLISHABLE_KEY.includes('YOUR_SUPABASE_PUBLISHABLE_KEY')
  );
}

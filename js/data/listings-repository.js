import { hasSupabaseConfig } from '../config.js?v=supabase-1';
import { getSupabaseClient } from '../supabase.js?v=supabase-1';
import { mapDatabaseListing } from './listings-mapper.js?v=business-fit-2';

const FIXTURE_URL = './data/listings.json';

export { mapDatabaseListing };

async function fetchFixtureListings() {
  const response = await window.fetch(FIXTURE_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`fixture HTTP ${response.status}`);
  return response.json();
}

export async function fetchListings({ allowFixtureFallback = location.hostname === 'localhost' } = {}) {
  if (!hasSupabaseConfig()) {
    if (allowFixtureFallback) return fetchFixtureListings();
    throw new Error('Supabase config missing');
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('listings')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return Array.isArray(data) ? data.map(mapDatabaseListing) : [];
}
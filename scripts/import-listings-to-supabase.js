#!/usr/bin/env node

const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LISTINGS_PATH = process.env.LISTINGS_PATH || 'data/listings.json';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

function condition(value) {
  if (value && typeof value === 'object') {
    return {
      known: Boolean(value.known),
      value: value.value ?? null,
      amount: value.amount ?? null
    };
  }

  return { known: value != null, value: value ?? null, amount: null };
}

function titleFor(listing) {
  return listing.title || listing.district || listing.address || listing.id;
}

function rowFor(listing) {
  const coords = listing.coordinates || {};
  return {
    external_id: listing.externalId || listing.id,
    title: titleFor(listing),
    address: listing.address || null,
    district: listing.district || null,
    price: listing.rent ?? null,
    area: listing.unitArea ?? listing.area ?? null,
    source: listing.source || listing.sourceName || null,
    source_url: listing.url || null,
    status: listing.status || null,
    notes: listing.note || listing.verifiedSummary || null,
    source_family: listing.sourceFamily || null,
    source_name: listing.sourceName || listing.source || null,
    listing_type: listing.listingType || 'direct_listing',
    availability_status: listing.availabilityStatus || 'unknown',
    last_verified_at: listing.lastVerifiedAt || null,
    verification_method: listing.verificationMethod || null,
    verification_override: listing.verificationOverride || null,
    unit_area: listing.unitArea ?? listing.area ?? null,
    project_total_area: listing.projectTotalArea ?? null,
    rent: listing.rent ?? null,
    nebenkosten: listing.nk ?? listing.nebenkosten?.value ?? null,
    provision: condition(listing.provision),
    abloese: condition(listing.abloese),
    kaution: condition(listing.kaution),
    gastro_suitability: listing.gastroSuitability || 'unknown',
    gastro_evidence: listing.gastroEvidence || null,
    verified_summary: listing.verifiedSummary || listing.note || null,
    key_facts: Array.isArray(listing.keyFacts) ? listing.keyFacts : [],
    unknowns: Array.isArray(listing.unknowns) ? listing.unknowns : [],
    next_action: listing.nextAction || null,
    latitude: coords.lat ?? null,
    longitude: coords.lng ?? null
  };
}

async function main() {
  const listings = JSON.parse(fs.readFileSync(LISTINGS_PATH, 'utf8'));
  const rows = listings.map(rowFor);
  const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/listings?on_conflict=external_id`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(rows)
  });

  if (!response.ok) {
    console.error(await response.text());
    process.exit(1);
  }

  const imported = await response.json();
  console.log(`Upserted ${imported.length} listings into Supabase.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

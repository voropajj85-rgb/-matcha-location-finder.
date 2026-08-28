const fs = require('fs');

function readFrontendPublishableKey() {
  try {
    const config = fs.readFileSync('js/config.js', 'utf8');
    const url = config.match(/SUPABASE_URL\s*=\s*'([^']+)'/)?.[1];
    const key = config.match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*'([^']+)'/)?.[1];
    return { url, key };
  } catch {
    return { url: null, key: null };
  }
}

function condition(value) {
  if (value && typeof value === 'object') {
    return {
      ...value,
      known: value.known != null ? Boolean(value.known) : value.status !== 'unknown',
      value: value.value ?? value.evidence?.raw ?? null,
      amount: value.amount ?? null
    };
  }

  return { known: value != null, value: value ?? null, amount: null };
}

function numericAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value && typeof value === 'object') return numericAmount(value.amount);
  if (typeof value !== 'string') return null;

  const match = value.match(/([0-9][0-9.\s]*(?:,[0-9]{1,2})?)/);
  if (!match) return null;
  const normalized = match[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function serializedRent(listing) {
  const sourceName = listing.sourceName || listing.source || '';
  const rawRent = numericAmount(listing.rent);
  const rawPerSqm = numericAmount(listing.rentPerSqm);
  const explicitPerSqm = listing.rentType === 'per_sqm' || rawPerSqm != null;
  const suspiciousEngelUnitPrice = /Engel\s*&\s*V[oö]lkers/i.test(sourceName)
    && rawRent != null
    && rawRent > 0
    && rawRent < 100;

  if (explicitPerSqm || suspiciousEngelUnitPrice) {
    return {
      rent: null,
      rentType: 'per_sqm',
      rentPerSqm: rawPerSqm ?? rawRent
    };
  }

  return {
    rent: rawRent,
    rentType: listing.rentType ?? (rawRent != null ? 'monthly' : null),
    rentPerSqm: rawPerSqm
  };
}

function rowForListing(listing) {
  const coords = listing.coordinates || {};
  const rent = serializedRent(listing);
  return {
    external_id: listing.externalId || listing.id,
    title: listing.title || listing.district || listing.address || listing.externalId || listing.id,
    address: listing.address || null,
    district: listing.district || null,
    price: rent.rent,
    area: listing.unitArea ?? listing.area ?? null,
    source: listing.source || listing.sourceName || null,
    source_url: listing.sourceUrl || listing.url || null,
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
    rent: rent.rent,
    rent_type: rent.rentType,
    rent_per_sqm: rent.rentPerSqm,
    nebenkosten: numericAmount(listing.nk ?? listing.nebenkosten),
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
    longitude: coords.lng ?? null,
    discovered_at: listing.discoveredAt || null,
    last_seen_at: listing.lastSeenAt || null,
    discovery_method: listing.discoveryMethod || null,
    canonical_url: listing.canonicalUrl || listing.sourceUrl || listing.url || null,
    raw_source_data: listing.rawSourceData || null
  };
}

async function fetchExistingRows() {
  const envUrl = process.env.SUPABASE_URL;
  const envKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  const frontend = readFrontendPublishableKey();
  const url = envUrl || frontend.url;
  const key = envKey || frontend.key;

  if (!url || !key) return [];

  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/listings?select=external_id,title,address,district,price,area,source,source_family,source_name,source_url,status,notes,listing_type,availability_status,last_verified_at,verification_method,verification_override,unit_area,project_total_area,rent,rent_type,rent_per_sqm,nebenkosten,provision,abloese,kaution,gastro_suitability,gastro_evidence,verified_summary,key_facts,unknowns,next_action,latitude,longitude,discovered_at,last_seen_at,discovery_method,canonical_url,raw_source_data`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase read failed: HTTP ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function upsertListings(listings) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for real ingestion.');
  }

  const rows = listings.map(rowForListing);
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/listings?on_conflict=external_id`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(rows)
  });

  if (!response.ok) {
    throw new Error(`Supabase upsert failed: HTTP ${response.status} ${await response.text()}`);
  }

  return response.json();
}

module.exports = {
  fetchExistingRows,
  rowForListing,
  upsertListings
};

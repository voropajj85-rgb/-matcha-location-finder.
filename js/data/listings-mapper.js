function toCondition(value) {
  if (value && typeof value === 'object') return value;
  return { value: value ?? null, known: value != null };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function getCoordinates(row) {
  if (row.latitude == null || row.longitude == null) return null;
  return { lat: row.latitude, lng: row.longitude };
}

export function mapDatabaseListing(row) {
  return {
    id: row.external_id,
    externalId: row.external_id,
    title: row.title,
    address: row.address,
    district: row.district,
    source: row.source_name || row.source,
    sourceFamily: row.source_family,
    sourceName: row.source_name || row.source,
    url: row.source_url,
    listingType: row.listing_type,
    availabilityStatus: row.availability_status,
    lastVerifiedAt: row.last_verified_at,
    verificationMethod: row.verification_method,
    verificationOverride: row.verification_override,
    area: row.unit_area ?? row.area,
    unitArea: row.unit_area ?? row.area,
    projectTotalArea: row.project_total_area,
    rent: row.rent ?? row.price,
    nk: row.nebenkosten,
    nebenkosten: { value: row.nebenkosten, known: row.nebenkosten != null },
    provision: toCondition(row.provision),
    abloese: toCondition(row.abloese),
    kaution: toCondition(row.kaution),
    gastroSuitability: row.gastro_suitability || 'unknown',
    gastroEvidence: row.gastro_evidence,
    verifiedSummary: row.verified_summary || row.notes,
    keyFacts: toArray(row.key_facts),
    unknowns: toArray(row.unknowns),
    nextAction: row.next_action,
    status: row.status,
    note: row.notes,
    coordinates: getCoordinates(row),
    discoveredAt: row.discovered_at,
    lastSeenAt: row.last_seen_at,
    discoveryMethod: row.discovery_method,
    canonicalUrl: row.canonical_url,
    rawSourceData: row.raw_source_data,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

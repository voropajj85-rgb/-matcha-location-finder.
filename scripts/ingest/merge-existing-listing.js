function hasUsefulValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    if ('value' in value || 'known' in value || 'amount' in value) {
      return Boolean(value.known) || value.value != null || value.amount != null;
    }
    return Object.keys(value).length > 0;
  }
  return true;
}

function preferUseful(existingValue, discoveredValue) {
  return hasUsefulValue(discoveredValue) ? discoveredValue : existingValue;
}

function preferGastroSuitability(existingValue, discoveredValue) {
  if (!hasUsefulValue(discoveredValue) || discoveredValue === 'unknown') return existingValue || discoveredValue;
  return discoveredValue;
}

function preferAvailability(existingValue, discoveredValue) {
  if (!hasUsefulValue(discoveredValue) || discoveredValue === 'unknown') return existingValue || discoveredValue || 'unknown';
  return discoveredValue;
}

function coordinates(existing, discovered) {
  if (hasUsefulValue(discovered)) return discovered;
  return existing || null;
}

function mapExistingRow(row) {
  return {
    externalId: row.external_id,
    id: row.external_id,
    title: row.title,
    address: row.address,
    district: row.district,
    source: row.source_name || row.source,
    sourceFamily: row.source_family,
    sourceName: row.source_name || row.source,
    sourceUrl: row.source_url,
    url: row.source_url,
    canonicalUrl: row.canonical_url || row.source_url,
    listingType: row.listing_type,
    availabilityStatus: row.availability_status,
    lastVerifiedAt: row.last_verified_at,
    verificationMethod: row.verification_method,
    verificationOverride: row.verification_override,
    unitArea: row.unit_area ?? row.area,
    area: row.unit_area ?? row.area,
    projectTotalArea: row.project_total_area,
    rent: row.rent ?? row.price,
    nk: row.nebenkosten,
    nebenkosten: { value: row.nebenkosten, known: row.nebenkosten != null },
    provision: row.provision,
    abloese: row.abloese,
    kaution: row.kaution,
    gastroSuitability: row.gastro_suitability,
    gastroEvidence: row.gastro_evidence,
    verifiedSummary: row.verified_summary || row.notes,
    keyFacts: Array.isArray(row.key_facts) ? row.key_facts : [],
    unknowns: Array.isArray(row.unknowns) ? row.unknowns : [],
    nextAction: row.next_action,
    coordinates: row.latitude == null || row.longitude == null ? null : { lat: row.latitude, lng: row.longitude },
    discoveredAt: row.discovered_at,
    lastSeenAt: row.last_seen_at,
    discoveryMethod: row.discovery_method,
    rawSourceData: row.raw_source_data
  };
}

function mergeExistingListing(existingRow, discovered) {
  const existing = mapExistingRow(existingRow);
  const override = existing.verificationOverride;
  const merged = {
    ...existing,
    ...discovered,
    externalId: existing.externalId || discovered.externalId,
    id: existing.externalId || discovered.externalId || discovered.id,
    title: preferUseful(existing.title, discovered.title),
    address: preferUseful(existing.address, discovered.address),
    district: preferUseful(existing.district, discovered.district),
    sourceFamily: preferUseful(existing.sourceFamily, discovered.sourceFamily),
    sourceName: preferUseful(existing.sourceName, discovered.sourceName),
    source: preferUseful(existing.source, discovered.sourceName || discovered.source),
    sourceUrl: preferUseful(existing.sourceUrl, discovered.sourceUrl || discovered.url),
    url: preferUseful(existing.url, discovered.sourceUrl || discovered.url),
    canonicalUrl: preferUseful(existing.canonicalUrl, discovered.canonicalUrl),
    listingType: preferUseful(existing.listingType, discovered.listingType),
    unitArea: preferUseful(existing.unitArea, discovered.unitArea ?? discovered.area),
    area: preferUseful(existing.area, discovered.unitArea ?? discovered.area),
    projectTotalArea: preferUseful(existing.projectTotalArea, discovered.projectTotalArea),
    rent: preferUseful(existing.rent, discovered.rent),
    nk: preferUseful(existing.nk, discovered.nk ?? discovered.nebenkosten?.value),
    nebenkosten: preferUseful(existing.nebenkosten, discovered.nebenkosten),
    provision: preferUseful(existing.provision, discovered.provision),
    abloese: preferUseful(existing.abloese, discovered.abloese),
    kaution: preferUseful(existing.kaution, discovered.kaution),
    gastroSuitability: preferGastroSuitability(existing.gastroSuitability, discovered.gastroSuitability),
    gastroEvidence: preferUseful(existing.gastroEvidence, discovered.gastroEvidence),
    verifiedSummary: preferUseful(existing.verifiedSummary, discovered.verifiedSummary),
    keyFacts: preferUseful(existing.keyFacts, discovered.keyFacts),
    unknowns: preferUseful(existing.unknowns, discovered.unknowns),
    nextAction: preferUseful(existing.nextAction, discovered.nextAction),
    coordinates: coordinates(existing.coordinates, discovered.coordinates),
    discoveredAt: existing.discoveredAt || discovered.discoveredAt,
    lastSeenAt: discovered.lastSeenAt || existing.lastSeenAt,
    discoveryMethod: preferUseful(existing.discoveryMethod, discovered.discoveryMethod),
    rawSourceData: preferUseful(existing.rawSourceData, discovered.rawSourceData),
    availabilityStatus: override?.status || preferAvailability(existing.availabilityStatus, discovered.availabilityStatus),
    lastVerifiedAt: override?.verifiedAt || discovered.lastVerifiedAt || existing.lastVerifiedAt,
    verificationMethod: override?.status ? 'manual-override' : discovered.verificationMethod || existing.verificationMethod,
    verificationOverride: override || discovered.verificationOverride || null,
    dedupeAction: 'updated'
  };

  return merged;
}

module.exports = {
  hasUsefulValue,
  mapExistingRow,
  mergeExistingListing
};

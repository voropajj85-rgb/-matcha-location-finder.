const { extractExternalId } = require('./utils');

function deduplicateListings(candidates, existingRows = []) {
  const byExternalId = new Map();
  const byCanonicalUrl = new Map();
  const batchExternalIds = new Set();
  const batchCanonicalUrls = new Set();
  const output = [];
  const skipped = [];

  for (const row of existingRows) {
    if (row.external_id) byExternalId.set(row.external_id, row);
    const nativeId = extractExternalId(row.source_name || row.source || 'source', row.canonical_url || row.source_url);
    if (nativeId) byExternalId.set(nativeId, row);
    if (row.canonical_url || row.source_url) {
      byCanonicalUrl.set(row.canonical_url || row.source_url, row);
    }
  }

  for (const candidate of candidates.filter(Boolean)) {
    if (batchExternalIds.has(candidate.externalId)) {
      skipped.push({ candidate, reason: 'duplicate externalId in batch' });
      continue;
    }

    if (candidate.canonicalUrl && batchCanonicalUrls.has(candidate.canonicalUrl)) {
      skipped.push({ candidate, reason: 'duplicate canonicalUrl in batch' });
      continue;
    }

    const existing = byExternalId.get(candidate.externalId)
      || byCanonicalUrl.get(candidate.canonicalUrl || candidate.sourceUrl || candidate.url);

    if (existing) {
      output.push({
        ...candidate,
        externalId: existing.external_id || candidate.externalId,
        discoveredAt: existing.discovered_at || candidate.discoveredAt,
        availabilityStatus: existing.availability_status || candidate.availabilityStatus,
        lastVerifiedAt: existing.last_verified_at || candidate.lastVerifiedAt,
        verificationMethod: existing.verification_method || candidate.verificationMethod,
        verificationOverride: existing.verification_override || candidate.verificationOverride,
        dedupeAction: 'updated'
      });
      batchExternalIds.add(candidate.externalId);
      if (candidate.canonicalUrl) batchCanonicalUrls.add(candidate.canonicalUrl);
      continue;
    }

    if (byExternalId.has(candidate.externalId)) {
      skipped.push({ candidate, reason: 'duplicate externalId in batch' });
      continue;
    }

    if (candidate.canonicalUrl && byCanonicalUrl.has(candidate.canonicalUrl)) {
      skipped.push({ candidate, reason: 'duplicate canonicalUrl in batch' });
      continue;
    }

    byExternalId.set(candidate.externalId, candidate);
    if (candidate.canonicalUrl) byCanonicalUrl.set(candidate.canonicalUrl, candidate);
    batchExternalIds.add(candidate.externalId);
    if (candidate.canonicalUrl) batchCanonicalUrls.add(candidate.canonicalUrl);
    output.push({ ...candidate, dedupeAction: 'new' });
  }

  return { listings: output, skipped };
}

module.exports = {
  deduplicateListings
};

const {
  canonicalizeListingUrl,
  extractExternalId,
  isDirectListingUrl,
  isSearchPageUrl
} = require('./utils');

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

function normalizeListing(candidate, detectedAt = new Date().toISOString()) {
  const canonicalUrl = canonicalizeListingUrl(candidate.sourceUrl || candidate.url);
  const listingType = candidate.listingType || 'direct_listing';
  const directListing = listingType === 'direct_listing';

  if (directListing && (!canonicalUrl || !isDirectListingUrl(canonicalUrl) || isSearchPageUrl(canonicalUrl))) {
    return null;
  }

  const sourceName = candidate.sourceName || candidate.source || 'Unknown';
  const externalId = candidate.externalId || extractExternalId(sourceName, canonicalUrl);
  if (!externalId) return null;

  const availabilityStatus = directListing ? 'unknown' : 'lead';

  return {
    externalId,
    id: externalId,
    sourceFamily: candidate.sourceFamily || 'portal',
    sourceName,
    source: sourceName,
    sourceUrl: canonicalUrl,
    url: canonicalUrl,
    canonicalUrl,
    listingType,
    title: candidate.title || null,
    address: candidate.address || null,
    district: candidate.district || null,
    unitArea: candidate.unitArea ?? candidate.area ?? null,
    area: candidate.unitArea ?? candidate.area ?? null,
    projectTotalArea: candidate.projectTotalArea ?? null,
    rent: candidate.rent ?? null,
    nk: candidate.nebenkosten ?? candidate.nk ?? null,
    nebenkosten: condition(candidate.nebenkosten ?? candidate.nk ?? null),
    provision: condition(candidate.provision ?? null),
    abloese: condition(candidate.abloese ?? null),
    kaution: condition(candidate.kaution ?? null),
    gastroSuitability: candidate.gastroSuitability || 'unknown',
    gastroEvidence: candidate.gastroEvidence || null,
    availabilityStatus,
    lastVerifiedAt: null,
    verificationMethod: 'not-verified',
    verificationOverride: candidate.verificationOverride || null,
    verifiedSummary: candidate.verifiedSummary || null,
    keyFacts: Array.isArray(candidate.keyFacts) ? candidate.keyFacts : [],
    unknowns: Array.isArray(candidate.unknowns) ? candidate.unknowns : [],
    nextAction: candidate.nextAction || null,
    coordinates: candidate.coordinates || null,
    discoveryMethod: candidate.discoveryMethod || 'unknown',
    discoveredAt: candidate.discoveredAt || detectedAt,
    lastSeenAt: detectedAt,
    rawSourceData: candidate.rawSourceData || {
      sourceTitle: candidate.title || null,
      sourcePriceText: candidate.sourcePriceText || null,
      sourceAreaText: candidate.sourceAreaText || null,
      detectedAt
    }
  };
}

module.exports = {
  normalizeListing
};

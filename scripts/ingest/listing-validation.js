const {
  canonicalizeListingUrl,
  isDirectListingUrl,
  isSearchPageUrl
} = require('./utils');
const { calculateDataCompleteness } = require('./data-completeness');

function getSourceUrl(listing) {
  return listing.sourceUrl || listing.url || listing.canonicalUrl || null;
}

function isDirectListing(listing) {
  return listing.listingType === 'direct_listing';
}

function getValidExternalUrl(listing) {
  const url = canonicalizeListingUrl(getSourceUrl(listing));
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (url === '#') return null;
  if (isDirectListing(listing) && !isDirectListingUrl(url)) return null;
  return url;
}

function validateSourceLink(listing) {
  const sourceUrl = getSourceUrl(listing);
  const canonicalUrl = canonicalizeListingUrl(sourceUrl);
  const missing = !sourceUrl;
  const search = Boolean(sourceUrl && isSearchPageUrl(sourceUrl));
  const valid = Boolean(getValidExternalUrl(listing));

  return {
    sourceLinkValid: valid,
    sourceUrlMissing: missing,
    sourceUrlInvalid: Boolean(sourceUrl && !valid && !search),
    sourceUrlSearch: search,
    canonicalUrl
  };
}

function isUsableCandidate(listing) {
  if (!isDirectListing(listing)) return false;
  if (listing.availabilityStatus !== 'active') return false;
  const link = validateSourceLink(listing);
  if (!link.sourceLinkValid) return false;

  const completeness = listing.dataCompleteness ?? calculateDataCompleteness(listing).dataCompleteness;
  if (completeness < 60) return false;
  if (listing.rent == null || listing.unitArea == null) return false;
  if (!listing.title && !listing.district && !listing.address) return false;
  if (!listing.verifiedSummary && !listing.gastroEvidence) return false;
  return true;
}

function isSafeForProduction(listing) {
  if (listing.verificationOverride?.status === 'dead') return true;
  if (isDirectListing(listing)) return isUsableCandidate(listing);
  return listing.availabilityStatus === 'lead';
}

function validationIssues(listing) {
  const issues = [];
  const link = validateSourceLink(listing);

  if (isDirectListing(listing) && listing.availabilityStatus === 'active' && !link.sourceLinkValid) {
    issues.push('active direct listing without valid direct URL');
  }

  if (listing.availabilityStatus === 'lead' && !link.sourceLinkValid) {
    issues.push('lead source link unavailable');
  }

  if (!listing.title) issues.push('missing title');
  if (isDirectListing(listing) && listing.availabilityStatus === 'active') {
    if (listing.rent == null) issues.push('active direct listing missing confirmed rent');
    if (listing.unitArea == null) issues.push('active direct listing missing confirmed unit area');
    if (!listing.verifiedSummary && !listing.gastroEvidence) issues.push('active direct listing missing verified evidence summary');
  }
  if (listing.rent == null && listing.unitArea == null && listing.area == null) issues.push('missing rent and unit area');
  if (link.sourceUrlSearch) issues.push('source URL is search page');
  if (link.sourceUrlInvalid) issues.push('source URL invalid for listing type');

  return issues;
}

function summarizeValidation(listings) {
  const summary = {
    usableDirectListings: 0,
    activeButNotUsable: 0,
    leads: 0,
    validDirectUrls: 0,
    missingUrls: 0,
    invalidUrls: 0,
    searchUrlsRejected: 0,
    safeForProduction: 0
  };

  for (const listing of listings) {
    const link = validateSourceLink(listing);
    const usable = isUsableCandidate(listing);
    if (usable) summary.usableDirectListings += 1;
    if (isDirectListing(listing) && listing.availabilityStatus === 'active' && !usable) {
      summary.activeButNotUsable += 1;
    }
    if (listing.availabilityStatus === 'lead') summary.leads += 1;
    if (isDirectListing(listing) && link.sourceLinkValid) summary.validDirectUrls += 1;
    if (link.sourceUrlMissing) summary.missingUrls += 1;
    if (link.sourceUrlInvalid) summary.invalidUrls += 1;
    if (link.sourceUrlSearch) summary.searchUrlsRejected += 1;
    if (isSafeForProduction(listing)) summary.safeForProduction += 1;
  }

  return summary;
}

module.exports = {
  getValidExternalUrl,
  isSafeForProduction,
  isUsableCandidate,
  summarizeValidation,
  validateSourceLink,
  validationIssues
};

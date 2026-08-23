import { getValidExternalUrl } from './source-links.js?v=source-links-1';

export const defaultFilters = {
  minArea: '',
  maxArea: '',
  maxRent: '',
  gastro: 'all',
  source: 'all',
  status: 'all'
};

export const defaultProjectConfig = {
  city: 'München',
  targetArea: {
    preferredMin: 35,
    preferredMax: 60,
    acceptableMin: 25,
    acceptableMax: 80
  },
  targetRent: {
    preferredMax: 3000
  },
  freshnessHours: 48
};

function normalizeText(value) {
  return String(value ?? '').trim();
}

export function getAvailabilityStatus(listing) {
  if (listing.availabilityStatus) return listing.availabilityStatus;
  if (normalizeText(listing.status).toLowerCase() === 'lead') return 'lead';
  return 'unknown';
}

export function isVisibleListing(listing, projectConfig = defaultProjectConfig) {
  const availabilityStatus = getAvailabilityStatus(listing);
  if (availabilityStatus === 'lead') return true;
  if (availabilityStatus === 'active') {
    return listing.listingType === 'direct_listing'
      && isFreshVerifiedListing(listing, projectConfig.freshnessHours)
      && Boolean(getValidExternalUrl(listing));
  }
  return false;
}

export function isFreshVerifiedListing(listing, maxAgeHours = 48) {
  if (getAvailabilityStatus(listing) !== 'active') return false;
  if (!listing.lastVerifiedAt) return false;

  const verifiedAt = new Date(listing.lastVerifiedAt);
  if (Number.isNaN(verifiedAt.getTime())) return false;

  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  return Date.now() - verifiedAt.getTime() <= maxAgeMs;
}

function getUnitArea(listing) {
  return listing.unitArea ?? listing.area ?? null;
}

function getSourceFilterValue(listing) {
  return normalizeText(listing.sourceName || listing.source);
}

function getListingSortScore(listing, projectConfig) {
  const availabilityStatus = getAvailabilityStatus(listing);
  const isDirect = listing.listingType === 'direct_listing';
  const isFreshActive = availabilityStatus === 'active' && isFreshVerifiedListing(listing, projectConfig.freshnessHours);
  const unitArea = getUnitArea(listing);
  const rent = listing.rent;
  const preferredArea = unitArea != null
    && unitArea >= projectConfig.targetArea.preferredMin
    && unitArea <= projectConfig.targetArea.preferredMax;
  const acceptableRent = rent != null && rent <= projectConfig.targetRent.preferredMax;

  if (isDirect && isFreshActive && preferredArea && acceptableRent) return 300;
  if (isDirect && isFreshActive) return 250;
  if (availabilityStatus === 'lead') {
    const facts = Array.isArray(listing.keyFacts) ? listing.keyFacts.length : 0;
    return 150 + Math.min(40, facts * 8);
  }
  return 0;
}

export function applyListingFilters(listings, filters, projectConfig = defaultProjectConfig, scoreCalculator = null) {
  const minArea = Number(filters.minArea) || 0;
  const maxArea = Number(filters.maxArea) || 999;
  const maxRent = Number(filters.maxRent) || 999999;

  let result = listings.filter((listing) => {
    if (!isVisibleListing(listing, projectConfig)) return false;
    const unitArea = getUnitArea(listing);

    const areaMatches = unitArea == null || (
      unitArea >= minArea && unitArea <= maxArea
    );

    const rentMatches = listing.rent == null || listing.rent <= maxRent;
    const gastroMatches = filters.gastro === 'all' || listing.gastroSuitability === filters.gastro;
    const sourceMatches = filters.source === 'all' || getSourceFilterValue(listing) === filters.source;
    const statusMatches = filters.status === 'all' || normalizeText(listing.status) === filters.status;

    return areaMatches && rentMatches && gastroMatches && sourceMatches && statusMatches;
  });

  return result.sort((a, b) => {
    const baseDiff = getListingSortScore(b, projectConfig) - getListingSortScore(a, projectConfig);
    if (baseDiff) return baseDiff;

    const scoreA = scoreCalculator ? scoreCalculator(a, projectConfig).score ?? -1 : -1;
    const scoreB = scoreCalculator ? scoreCalculator(b, projectConfig).score ?? -1 : -1;
    if (scoreB !== scoreA) return scoreB - scoreA;

    const verifiedA = new Date(a.lastVerifiedAt || 0).getTime() || 0;
    const verifiedB = new Date(b.lastVerifiedAt || 0).getTime() || 0;
    return verifiedB - verifiedA;
  });
}

export function resetFilters() {
  return { ...defaultFilters };
}

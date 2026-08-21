export const defaultFilters = {
  minArea: '',
  maxArea: '',
  maxRent: '',
  gastro: 'all',
  source: 'all',
  status: 'all',
  presets: {
    top: false,
    budget: false
  }
};

function normalizeText(value) {
  return String(value ?? '').trim();
}

export function getAvailabilityStatus(listing) {
  if (listing.availabilityStatus) return listing.availabilityStatus;
  if (normalizeText(listing.status).toLowerCase() === 'lead') return 'lead';
  return 'unknown';
}

export function isVisibleListing(listing) {
  const availabilityStatus = getAvailabilityStatus(listing);
  return availabilityStatus === 'active' || availabilityStatus === 'lead';
}

export function isFreshVerifiedListing(listing, maxAgeHours = 48) {
  if (getAvailabilityStatus(listing) !== 'active') return false;
  if (!listing.lastVerifiedAt) return false;

  const verifiedAt = new Date(listing.lastVerifiedAt);
  if (Number.isNaN(verifiedAt.getTime())) return false;

  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  return Date.now() - verifiedAt.getTime() <= maxAgeMs;
}

export function applyListingFilters(listings, filters) {
  const minArea = Number(filters.minArea) || 0;
  const maxArea = Number(filters.maxArea) || 999;
  const maxRent = Number(filters.maxRent) || 999999;

  let result = listings.filter((listing) => {
    if (!isVisibleListing(listing)) return false;

    const areaMatches = listing.area == null || (
      listing.area >= minArea && listing.area <= maxArea
    );

    const rentMatches = listing.rent == null || listing.rent <= maxRent;
    const gastroMatches = filters.gastro === 'all' || listing.gastro === filters.gastro;
    const sourceMatches = filters.source === 'all' || normalizeText(listing.source) === filters.source;
    const statusMatches = filters.status === 'all' || normalizeText(listing.status) === filters.status;

    return areaMatches && rentMatches && gastroMatches && sourceMatches && statusMatches;
  });

  if (filters.presets.top) {
    result = result.filter((listing) => (listing.score || 0) >= 8.3);
  }

  if (filters.presets.budget) {
    result = result.filter((listing) => listing.rent != null && listing.rent <= 3000);
  }

  return result.sort((a, b) => (b.score || 0) - (a.score || 0));
}

export function togglePreset(presets, requestedPreset) {
  return {
    ...presets,
    [requestedPreset]: !presets[requestedPreset]
  };
}

export function resetFilters() {
  return {
    ...defaultFilters,
    presets: { ...defaultFilters.presets }
  };
}

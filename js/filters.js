export const defaultFilters = {
  minArea: 25,
  maxArea: 90,
  maxRent: 3500,
  preset: 'all'
};

export function applyListingFilters(listings, filters) {
  let result = listings.filter((listing) => {
    const areaMatches = listing.area == null || (
      listing.area >= filters.minArea && listing.area <= filters.maxArea
    );

    const rentMatches = listing.rent == null || listing.rent <= filters.maxRent;

    return areaMatches && rentMatches;
  });

  if (filters.preset === 'top') {
    result = result.filter((listing) => (listing.score || 0) >= 8.3);
  }

  if (filters.preset === 'budget') {
    result = result.filter((listing) => listing.rent != null && listing.rent <= 3000);
  }

  return result.sort((a, b) => (b.score || 0) - (a.score || 0));
}

export function togglePreset(currentPreset, requestedPreset) {
  return currentPreset === requestedPreset ? 'all' : requestedPreset;
}

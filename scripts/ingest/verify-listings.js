const { checkListing, stripRuntimeFields } = require('../check-listings');

async function verifyListings(listings, checkedAt, { delayMs = 1000 } = {}) {
  const verified = [];

  for (const listing of listings) {
    const checked = await checkListing({
      ...listing,
      source: listing.sourceName || listing.source,
      url: listing.sourceUrl || listing.url
    }, checkedAt);

    verified.push(stripRuntimeFields({
      ...checked,
      lastSeenAt: listing.lastSeenAt,
      discoveredAt: listing.discoveredAt,
      discoveryMethod: listing.discoveryMethod,
      canonicalUrl: listing.canonicalUrl,
      rawSourceData: {
        ...(listing.rawSourceData || {}),
        verificationFinalUrl: checked.finalUrl || listing.rawSourceData?.verificationFinalUrl || null
      },
      dedupeAction: listing.dedupeAction
    }));

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return verified;
}

module.exports = {
  verifyListings
};

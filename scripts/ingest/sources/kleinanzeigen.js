const {
  extractLinks,
  isDirectListingUrl,
  isMunichKleinanzeigenUrl,
  isPotentialMatchaListingUrl,
  sleep
} = require('../utils');

const SEARCHES = [
  'https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/c277l6411',
  'https://www.kleinanzeigen.de/s-muenchen/laden-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/cafe-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/gastronomie-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/imbiss-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/kiosk-mieten/k0l6411'
];

async function discover({ fetchPage, now, rateLimitMs = 2500 } = {}) {
  const candidates = [];
  const errors = [];

  for (const searchUrl of SEARCHES) {
    try {
      const response = await fetchPage(searchUrl);
      const html = response.body || '';
      const directLinks = extractLinks(
        html,
        response.finalUrl || searchUrl,
        (url) => isDirectListingUrl(url) && isMunichKleinanzeigenUrl(url) && isPotentialMatchaListingUrl(url)
      );

      for (const sourceUrl of directLinks.slice(0, 12)) {
        candidates.push({
          sourceFamily: 'portal',
          sourceName: 'Kleinanzeigen',
          sourceUrl,
          listingType: 'direct_listing',
          title: null,
          address: null,
          district: 'München',
          unitArea: null,
          rent: null,
          gastroSuitability: 'unknown',
          gastroEvidence: null,
          discoveryMethod: 'search-page',
          rawSourceData: {
            sourceTitle: null,
            sourcePriceText: null,
            sourceAreaText: null,
            detectedAt: now,
            searchUrl
          }
        });
      }
    } catch (error) {
      errors.push({ sourceUrl: searchUrl, message: error.message });
    }

    await sleep(rateLimitMs);
  }

  return { source: 'Kleinanzeigen', candidates, errors };
}

module.exports = { discover };

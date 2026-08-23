const { extractLinks, isDirectListingUrl, isPotentialMatchaListingUrl, sleep } = require('../utils');

const SEARCHES = [
  'https://www.immobilienscout24.de/Suche/de/bayern/muenchen/gewerbeimmobilien-mieten',
  'https://www.immobilienscout24.de/Suche/de/bayern/muenchen/gastronomie-mieten',
  'https://www.immobilienscout24.de/Suche/de/bayern/muenchen/laden-mieten'
];

async function discover({ fetchPage, now, rateLimitMs = 2500 } = {}) {
  const candidates = [];
  const errors = [];

  for (const searchUrl of SEARCHES) {
    try {
      const response = await fetchPage(searchUrl);
      const directLinks = extractLinks(
        response.body || '',
        response.finalUrl || searchUrl,
        (url) => isDirectListingUrl(url) && isPotentialMatchaListingUrl(url)
      );

      for (const sourceUrl of directLinks.slice(0, 12)) {
        candidates.push({
          sourceFamily: 'portal',
          sourceName: 'ImmoScout24',
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
          rawSourceData: { detectedAt: now, searchUrl }
        });
      }
    } catch (error) {
      errors.push({ sourceUrl: searchUrl, message: error.message });
    }

    await sleep(rateLimitMs);
  }

  return { source: 'ImmoScout24', candidates, errors };
}

module.exports = { discover };

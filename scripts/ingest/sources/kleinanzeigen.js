const {
  extractLinks,
  isDirectListingUrl,
  isMunichKleinanzeigenUrl,
  isPotentialMatchaListingUrl,
  sleep
} = require('../utils');

const SEARCHES = [
  'https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/c277l6411',
  'https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/ladenflaeche/k0c277l6411',
  'https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/laden/k0c277l6411',
  'https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/gastronomie/k0c277l6411',
  'https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/gastroflaeche/k0c277l6411',
  'https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/cafe/k0c277l6411',
  'https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/cafe-laden/k0c277l6411',
  'https://www.kleinanzeigen.de/s-muenchen/laden-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/cafe-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/ladenflaeche-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/gewerbeflaeche-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/gastroflaeche/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/einzelhandel-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/gastronomie-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/imbiss-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/take-away-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/kiosk-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/bistro-mieten/k0l6411',
  'https://www.kleinanzeigen.de/s-muenchen/laden-gastronomie/k0l6411'
];

function paginatedUrl(searchUrl, page) {
  if (page <= 1) return searchUrl;
  return searchUrl.replace(/\/([^/]+)$/, `/seite:${page}/$1`);
}

async function discover({ fetchPage, now, rateLimitMs = 1200, pageLimit = 3 } = {}) {
  const candidates = [];
  const errors = [];
  const seen = new Set();
  const meta = {
    queries: SEARCHES.length,
    pagesScanned: 0,
    duplicateLinks: 0
  };

  for (const searchUrl of SEARCHES) {
    let emptyPages = 0;
    for (let page = 1; page <= pageLimit; page += 1) {
      const pageUrl = paginatedUrl(searchUrl, page);
      try {
        const response = await fetchPage(pageUrl);
        meta.pagesScanned += 1;
        const html = response.body || '';
        const directLinks = extractLinks(
          html,
          response.finalUrl || pageUrl,
          (url) => isDirectListingUrl(url) && isMunichKleinanzeigenUrl(url) && isPotentialMatchaListingUrl(url)
        );

        if (!directLinks.length) emptyPages += 1;
        let newLinks = 0;
        for (const sourceUrl of directLinks.slice(0, 18)) {
          if (seen.has(sourceUrl)) {
            meta.duplicateLinks += 1;
            continue;
          }
          seen.add(sourceUrl);
          newLinks += 1;
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
              searchUrl,
              searchPageUrl: pageUrl
            }
          });
        }

        if (emptyPages >= 1 || newLinks === 0) break;
      } catch (error) {
        errors.push({ sourceUrl: pageUrl, message: error.message });
        break;
      }

      await sleep(rateLimitMs);
    }
  }

  return { source: 'Kleinanzeigen', candidates, errors, meta };
}

module.exports = { SEARCHES, discover, paginatedUrl };

const {
  extractLinks,
  isDirectListingUrl,
  isMunichKleinanzeigenUrl,
  isPotentialMatchaListingUrl,
  sleep
} = require('../utils');

const CITYWIDE_TERMS = [
  'laden-mieten',
  'cafe-mieten',
  'ladenflaeche-mieten',
  'gewerbeflaeche-mieten',
  'gewerberaum-mieten',
  'gastroflaeche',
  'einzelhandel-mieten',
  'gastronomie-mieten',
  'imbiss-mieten',
  'take-away-mieten',
  'kiosk-mieten',
  'nachmieter-laden',
  'geschaeftsuebernahme',
  'gastro-uebernahme'
];

const HIGH_INTENT_TERMS = [
  'ladenflaeche',
  'ladenlokal',
  'gewerbeflaeche',
  'gastronomie',
  'cafe',
  'kiosk',
  'imbiss',
  'einzelhandel',
  'uebernahme'
];

const LOCATION_TERMS = [
  'bahnhof',
  'einkaufsstrasse'
];

const DISTRICT_BATCH_TERMS = [
  'ladenlokal',
  'gewerbeflaeche',
  'cafe'
];

const DISTRICTS = [
  'pasing',
  'laim',
  'neuhausen',
  'nymphenburg',
  'moosach',
  'milbertshofen',
  'schwabing',
  'maxvorstadt',
  'altstadt-lehel',
  'ludwigsvorstadt-isarvorstadt',
  'haidhausen',
  'au',
  'berg-am-laim',
  'bogenhausen',
  'giesing',
  'sendling',
  'sendling-westpark',
  'hadern',
  'thalkirchen',
  'forstenried',
  'solln',
  'ramersdorf',
  'trudering',
  'riem',
  'obergiesing',
  'untergiesing',
  'westend',
  'aubing',
  'feldmoching',
  'hasenbergl'
];

const LOCATION_DISTRICTS = [
  'pasing',
  'laim',
  'moosach',
  'milbertshofen',
  'schwabing',
  'maxvorstadt',
  'altstadt-lehel',
  'ludwigsvorstadt-isarvorstadt',
  'haidhausen',
  'giesing',
  'sendling',
  'trudering',
  'riem'
];

function searchUrlFromTerm(term, locationSlug = 'muenchen') {
  return `https://www.kleinanzeigen.de/s-${locationSlug}/${term}/k0l6411`;
}

function commercialCategoryUrl(term) {
  return `https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/${term}/k0c277l6411`;
}

function buildSearchMatrix() {
  const searches = [
    {
      url: 'https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/c277l6411',
      tier: 'citywide-generic',
      district: 'München',
      term: 'gewerbeimmobilien'
    },
    ...HIGH_INTENT_TERMS.map((term) => ({
      url: commercialCategoryUrl(term),
      tier: 'high-intent-commercial',
      district: 'München',
      term
    })),
    ...CITYWIDE_TERMS.map((term) => ({
      url: searchUrlFromTerm(term),
      tier: 'citywide-term',
      district: 'München',
      term
    })),
    ...DISTRICTS.flatMap((district) => DISTRICT_BATCH_TERMS.map((term) => ({
      url: searchUrlFromTerm(`${term}-${district}`),
      tier: 'district-batch',
      district,
      term
    }))),
    ...LOCATION_DISTRICTS.flatMap((district) => LOCATION_TERMS.map((term) => ({
      url: searchUrlFromTerm(`${term}-${district}`),
      tier: 'location-combination',
      district,
      term
    })))
  ];

  const seen = new Set();
  return searches.filter((search) => {
    if (seen.has(search.url)) return false;
    seen.add(search.url);
    return true;
  });
}

const SEARCHES = buildSearchMatrix();

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
    queryTiers: {},
    districtQueries: {},
    pagesScanned: 0,
    duplicateLinks: 0
  };

  for (const search of SEARCHES) {
    const searchUrl = typeof search === 'string' ? search : search.url;
    const tier = typeof search === 'string' ? 'legacy' : search.tier;
    const searchDistrict = typeof search === 'string' ? 'München' : search.district;
    const searchTerm = typeof search === 'string' ? null : search.term;
    meta.queryTiers[tier] = (meta.queryTiers[tier] || 0) + 1;
    meta.districtQueries[searchDistrict] = (meta.districtQueries[searchDistrict] || 0) + 1;

    let emptyPages = 0;
    for (let page = 1; page <= pageLimit; page += 1) {
      const effectivePageLimit = tier === 'citywide-generic' || tier === 'citywide-term' || tier === 'high-intent-commercial'
        ? pageLimit
        : 1;
      if (page > effectivePageLimit) break;
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
            district: searchDistrict === 'München' ? 'München' : searchDistrict,
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
              searchTier: tier,
              searchDistrict,
              searchTerm,
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

module.exports = {
  CITYWIDE_TERMS,
  DISTRICTS,
  HIGH_INTENT_TERMS,
  LOCATION_TERMS,
  DISTRICT_BATCH_TERMS,
  SEARCHES,
  buildSearchMatrix,
  discover,
  paginatedUrl
};

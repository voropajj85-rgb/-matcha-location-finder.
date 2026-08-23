const BROKER_SEEDS = [
  {
    externalId: 'colliers-leopold',
    sourceName: 'Colliers',
    sourceUrl: 'https://www.colliers.de/gewerbeimmobilien/objekt/laden-muenchen-m-p4428-g1-e1/',
    listingType: 'broker_lead',
    title: 'Leopoldstraße broker lead',
    address: 'Leopoldstraße, München',
    district: 'Schwabing',
    gastroSuitability: 'possible',
    gastroEvidence: 'Broker lead can be relevant, but no concrete 25–80 m² unit is confirmed by discovery.'
  },
  {
    externalId: 'broker-cbre-muenchen-retail',
    sourceName: 'CBRE',
    sourceUrl: 'https://www.cbre.de/properties/properties-for-lease/retail',
    listingType: 'broker_lead',
    title: 'CBRE retail lead München',
    address: null,
    district: 'München',
    gastroSuitability: 'unknown',
    gastroEvidence: null
  }
];

async function discover({ fetchPage, now } = {}) {
  const candidates = [];
  const errors = [];

  for (const seed of BROKER_SEEDS) {
    try {
      const response = await fetchPage(seed.sourceUrl);
      candidates.push({
        ...seed,
        sourceFamily: 'broker',
        unitArea: null,
        projectTotalArea: null,
        rent: null,
        nebenkosten: null,
        discoveryMethod: 'broker-index',
        rawSourceData: {
          sourceTitle: seed.title,
          detectedAt: now,
          httpStatus: response.status,
          finalUrl: response.finalUrl
        }
      });
    } catch (error) {
      errors.push({ sourceUrl: seed.sourceUrl, message: error.message });
    }
  }

  return { source: 'Brokers', candidates, errors };
}

module.exports = { discover };

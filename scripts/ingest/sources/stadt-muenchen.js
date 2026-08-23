const SEEDS = [
  {
    externalId: 'stadt-fmq',
    sourceName: 'Stadt München',
    sourceUrl: 'https://stadt.muenchen.de/lhm-ms-wirtschaftsfoerderung/standort-muenchen/gewerbeflaechen-immobilien/gewerbeflaechen-angebote/buero-gewerbestandorte-FMQM%C3%BCnchen.html',
    listingType: 'project_lead',
    title: 'FMQ',
    address: 'Schwanthalerstraße 55–57, München',
    district: 'Schwanthalerhöhe',
    gastroSuitability: 'possible',
    gastroEvidence: 'Municipal project context can include retail/gastro use; concrete unit suitability is not confirmed.'
  },
  {
    externalId: 'stadt-amalie',
    sourceName: 'Stadt München / CBRE',
    sourceUrl: 'https://stadt.muenchen.de/lhm-ms-wirtschaftsfoerderung/standort-muenchen/gewerbeflaechen-immobilien/gewerbeflaechen-angebote/buero-gewerbestandorte-AMALIE.html',
    listingType: 'project_lead',
    title: 'AMALIE',
    address: 'Amalienstraße 33, München',
    district: 'Maxvorstadt',
    gastroSuitability: 'possible',
    gastroEvidence: 'Municipal/CBRE project context mentions retail/gastro; concrete Matcha-sized unit is not confirmed.'
  }
];

async function discover({ fetchPage, now } = {}) {
  const candidates = [];
  const errors = [];

  for (const seed of SEEDS) {
    try {
      const response = await fetchPage(seed.sourceUrl);
      candidates.push({
        ...seed,
        sourceFamily: 'municipal',
        unitArea: null,
        projectTotalArea: null,
        rent: null,
        nebenkosten: null,
        discoveryMethod: 'municipal-index',
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

  return { source: 'Stadt München', candidates, errors };
}

module.exports = { discover };

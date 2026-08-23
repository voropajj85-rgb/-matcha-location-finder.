const assert = require('assert');
const { deduplicateListings } = require('../deduplicate-listings');
const { calculateDataCompleteness, hasMeaningfulTitle } = require('../data-completeness');
const { areaFromText, enrichListing, meaningfulTitle, rentFromText } = require('../enrich-listing');
const { mergeExistingListing } = require('../merge-existing-listing');
const { normalizeListing } = require('../normalize-listing');
const { rowForListing } = require('../supabase-upsert');
const {
  getValidExternalUrl,
  isSafeForProduction,
  isUsableCandidate,
  summarizeValidation,
  validateSourceLink
} = require('../listing-validation');
const {
  extractExternalId,
  canonicalizeListingUrl,
  isMunichKleinanzeigenUrl,
  isPotentialMatchaListingUrl,
  isSearchPageUrl
} = require('../utils');
const { checkListing, classifyHtml } = require('../../check-listings');
const { calculateProjectRelevance } = require('../project-relevance');

async function run() {
  assert.strictEqual(
    canonicalizeListingUrl('http://www.kleinanzeigen.de/s-anzeige/demo/123-277-6411?utm_source=x&ref=foo#top'),
    'https://www.kleinanzeigen.de/s-anzeige/demo/123-277-6411'
  );

  assert.strictEqual(
    extractExternalId('Kleinanzeigen', 'https://www.kleinanzeigen.de/s-anzeige/demo/123-277-6411'),
    'klein-123-277-6411'
  );

  assert.strictEqual(isSearchPageUrl('https://www.kleinanzeigen.de/s-muenchen/kiosk-mieten/k0l6411'), true);
  assert.strictEqual(isPotentialMatchaListingUrl('https://www.kleinanzeigen.de/s-anzeige/bueroraum-in-muenchen/111-277-6411'), false);
  assert.strictEqual(isPotentialMatchaListingUrl('https://www.kleinanzeigen.de/s-anzeige/cafe-bar-in-muenchen/111-277-6411'), true);
  assert.strictEqual(isMunichKleinanzeigenUrl('https://www.kleinanzeigen.de/s-anzeige/cafe-bar-in-muenchen/111-277-6411'), true);
  assert.strictEqual(isMunichKleinanzeigenUrl('https://www.kleinanzeigen.de/s-anzeige/imbiss-anhaenger/111-276-6411'), false);
  assert.strictEqual(isMunichKleinanzeigenUrl('https://www.kleinanzeigen.de/s-anzeige/cafe-in-duesseldorf/111-277-2093'), false);

  const normalized = normalizeListing({
    sourceName: 'Kleinanzeigen',
    sourceUrl: 'https://www.kleinanzeigen.de/s-anzeige/demo/123-277-6411',
    listingType: 'direct_listing',
    title: 'Demo listing'
  }, '2026-08-23T10:00:00.000Z');

  assert.strictEqual(normalized.availabilityStatus, 'unknown');
  assert.strictEqual(normalized.externalId, 'klein-123-277-6411');

  const projectLead = normalizeListing({
    sourceName: 'Stadt München',
    sourceUrl: 'https://stadt.muenchen.de/lhm-ms-wirtschaftsfoerderung/standort-muenchen/gewerbeflaechen-immobilien/gewerbeflaechen-angebote/demo.html',
    listingType: 'project_lead',
    title: 'Project',
    projectTotalArea: 1200
  }, '2026-08-23T10:00:00.000Z');
  assert.strictEqual(projectLead.unitArea, null);
  assert.strictEqual(projectLead.area, null);
  assert.strictEqual(projectLead.projectTotalArea, 1200);
  assert.strictEqual(projectLead.availabilityStatus, 'lead');

  assert.strictEqual(normalizeListing({
    sourceName: 'Kleinanzeigen',
    sourceUrl: 'https://www.kleinanzeigen.de/s-muenchen/kiosk-mieten/k0l6411',
    listingType: 'direct_listing'
  }), null);

  const deduped = deduplicateListings([normalized], [{
    external_id: 'legacy-human-id',
    source_name: 'Kleinanzeigen',
    source_url: normalized.sourceUrl,
    availability_status: 'active',
    last_verified_at: '2026-08-23T09:00:00.000Z'
  }]);

  assert.strictEqual(deduped.listings[0].dedupeAction, 'updated');
  assert.strictEqual(deduped.listings[0].externalId, 'legacy-human-id');
  assert.strictEqual(deduped.listings[0].availabilityStatus, 'active');

  const existingFull = {
    external_id: 'klein-westend-66',
    title: 'Old title',
    address: 'Teststraße',
    district: 'Westend',
    source_name: 'Kleinanzeigen',
    source_url: 'https://www.kleinanzeigen.de/s-anzeige/demo/123-277-6411',
    listing_type: 'direct_listing',
    availability_status: 'active',
    unit_area: 50,
    rent: 1500,
    provision: { known: true, value: 'old provision' },
    abloese: { known: false, value: null },
    kaution: { known: false, value: null },
    gastro_suitability: 'confirmed',
    gastro_evidence: 'old evidence',
    verified_summary: 'old',
    key_facts: ['old fact'],
    unknowns: ['old unknown'],
    next_action: 'old action',
    discovered_at: '2026-08-01T10:00:00.000Z'
  };

  const nullMerge = mergeExistingListing(existingFull, {
    externalId: 'klein-westend-66',
    rent: null,
    unitArea: null,
    address: null,
    verifiedSummary: null,
    keyFacts: [],
    unknowns: [],
    lastSeenAt: '2026-08-23T10:00:00.000Z',
    gastroSuitability: 'unknown'
  });

  assert.strictEqual(nullMerge.rent, 1500);
  assert.strictEqual(nullMerge.unitArea, 50);
  assert.strictEqual(nullMerge.address, 'Teststraße');
  assert.strictEqual(nullMerge.verifiedSummary, 'old');
  assert.deepStrictEqual(nullMerge.keyFacts, ['old fact']);
  assert.deepStrictEqual(nullMerge.unknowns, ['old unknown']);
  assert.strictEqual(nullMerge.gastroSuitability, 'confirmed');
  assert.strictEqual(nullMerge.discoveredAt, '2026-08-01T10:00:00.000Z');
  assert.strictEqual(nullMerge.lastSeenAt, '2026-08-23T10:00:00.000Z');

  const updatedRent = mergeExistingListing(existingFull, {
    externalId: 'klein-westend-66',
    rent: 1600,
    keyFacts: ['new fact']
  });
  assert.strictEqual(updatedRent.rent, 1600);
  assert.deepStrictEqual(updatedRent.keyFacts, ['new fact']);

  const overrideMerge = mergeExistingListing({
    ...existingFull,
    availability_status: 'dead',
    verification_method: 'manual-override',
    verification_override: {
      status: 'dead',
      reason: 'manual dead',
      verifiedAt: '2026-08-23T10:00:00.000Z'
    }
  }, {
    externalId: 'klein-westend-66',
    availabilityStatus: 'active',
    verificationMethod: 'kleinanzeigen-strong-listing-check'
  });

  assert.strictEqual(overrideMerge.availabilityStatus, 'dead');
  assert.strictEqual(overrideMerge.verificationMethod, 'manual-override');

  const minimalCompleteness = calculateDataCompleteness({
    title: null,
    rent: null,
    unitArea: null,
    gastroSuitability: 'unknown'
  });
  assert.strictEqual(minimalCompleteness.dataQuality, 'minimal');

  const highCompleteness = calculateDataCompleteness({
    title: 'Cafe',
    rent: 1500,
    unitArea: 45,
    gastroSuitability: 'possible',
    gastroEvidence: 'Direct page says cafe',
    verifiedSummary: 'Useful description'
  });
  assert.strictEqual(highCompleteness.dataQuality, 'complete');
  assert.strictEqual(hasMeaningfulTitle('Kleinanzeigen'), false);
  assert.strictEqual(meaningfulTitle('Kleinanzeigen'), null);
  assert.strictEqual(meaningfulTitle('Cafe Laden | Kleinanzeigen.de'), 'Cafe Laden');

  assert.strictEqual(rentFromText('Ablöse 18.000 €').rent, null);
  assert.strictEqual(rentFromText('Kaution 4.800 €').rent, null);
  assert.strictEqual(rentFromText('€150 Ablöse').rent, null);
  assert.strictEqual(rentFromText('Kaltmiete 1.600 € pro Monat').rent, 1600);
  assert.strictEqual(rentFromText('Kaltmiete 1.600 € pro Monat').rentConfidence, 'high');
  assert.strictEqual(areaFromText('44 m² Kellerfläche und 57 m² Ladenfläche').unitArea, 57);
  assert.strictEqual(areaFromText('Projektfläche 1200 m²').unitArea, null);

  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    unitArea: 350,
    rent: 1700,
    gastroSuitability: 'possible'
  }).level, 'reject');
  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    unitArea: 110,
    rent: 6000,
    gastroSuitability: 'possible'
  }).level, 'reject');
  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    unitArea: 50,
    rent: 1700,
    gastroSuitability: 'confirmed'
  }).level, 'strong');
  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    unitArea: 7,
    rent: 1850,
    gastroSuitability: 'possible'
  }).level, 'reject');
  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    unitArea: 57,
    rent: 1600,
    gastroSuitability: 'possible',
    gastroEvidence: 'Kiosk, aber keine Küchenabluft'
  }).level, 'acceptable');

  const enriched = await enrichListing({
    externalId: 'klein-enrich',
    sourceName: 'Kleinanzeigen',
    sourceUrl: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411',
    listingType: 'direct_listing',
    lastSeenAt: '2026-08-23T10:00:00.000Z'
  }, {
    fetchPage: async () => ({
      status: 200,
      finalUrl: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411',
      body: '<title>Cafe Laden München | Kleinanzeigen.de</title><meta name="description" content="Cafe Laden mit Ladenfläche 45 m², Kaltmiete 1600 €, Kaution nach Absprache">'
    })
  });

  assert.strictEqual(enriched.title, 'Cafe Laden München');
  assert.strictEqual(enriched.rent, 1600);
  assert.strictEqual(enriched.unitArea, 45);
  assert.strictEqual(enriched.rawSourceData.rentConfidence, 'high');
  assert.strictEqual(enriched.gastroSuitability, 'possible');

  assert.strictEqual(getValidExternalUrl({ listingType: 'direct_listing', url: null }), null);
  assert.strictEqual(getValidExternalUrl({ listingType: 'direct_listing', url: '' }), null);
  assert.strictEqual(
    getValidExternalUrl({
      listingType: 'direct_listing',
      url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411'
    }),
    'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411'
  );

  assert.strictEqual(isUsableCandidate({
    listingType: 'direct_listing',
    availabilityStatus: 'active',
    url: null,
    dataCompleteness: 100,
    rent: 1500,
    title: 'Cafe'
  }), false);

  assert.strictEqual(isUsableCandidate({
    listingType: 'direct_listing',
    availabilityStatus: 'active',
    url: 'https://www.kleinanzeigen.de/s-muenchen/kiosk-mieten/k0l6411',
    dataCompleteness: 100,
    rent: 1500,
    title: 'Cafe'
  }), false);

  const leadWithoutUrl = {
    listingType: 'municipal_lead',
    availabilityStatus: 'lead',
    url: null,
    title: 'Municipal lead'
  };
  assert.strictEqual(validateSourceLink(leadWithoutUrl).sourceLinkValid, false);

  assert.strictEqual(isUsableCandidate({
    listingType: 'direct_listing',
    availabilityStatus: 'active',
    url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411',
    dataCompleteness: 100,
    rent: 1500,
    unitArea: 45,
    title: 'Cafe',
    verifiedSummary: 'Verified direct listing'
  }), true);
  assert.strictEqual(isSafeForProduction({
    listingType: 'direct_listing',
    availabilityStatus: 'active',
    url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411',
    dataCompleteness: 100,
    rent: 1500,
    unitArea: 45,
    title: 'Cafe',
    verifiedSummary: 'Verified direct listing'
  }), true);

  const validationCounts = summarizeValidation([
    {
      listingType: 'direct_listing',
      availabilityStatus: 'active',
      url: null,
      dataCompleteness: 100,
      rent: 1500,
      title: 'Cafe'
    },
    leadWithoutUrl
  ]);
  assert.strictEqual(validationCounts.missingUrls, 2);
  assert.strictEqual(validationCounts.activeButNotUsable, 1);

  const { buildListingCard, buildListingDetail } = await import('../../../js/listings.js');
  const cardWithoutUrl = buildListingCard({
    id: 'missing-url',
    listingType: 'municipal_lead',
    availabilityStatus: 'lead',
    sourceName: 'Manual',
    title: 'Manual lead'
  });
  assert.strictEqual(cardWithoutUrl.includes('href="#"'), false);
  assert.strictEqual(cardWithoutUrl.includes('target="_blank"'), false);
  assert.strictEqual(cardWithoutUrl.includes('Источник недоступен'), true);

  const detailWithoutUrl = buildListingDetail({
    id: 'missing-url',
    listingType: 'municipal_lead',
    availabilityStatus: 'lead',
    sourceName: 'Manual',
    title: 'Manual lead'
  });
  assert.strictEqual(detailWithoutUrl.includes('href="#"'), false);
  assert.strictEqual(detailWithoutUrl.includes('Ссылка на источник недоступна'), true);

  const cardWithUrl = buildListingCard({
    id: 'with-url',
    listingType: 'direct_listing',
    availabilityStatus: 'active',
    sourceName: 'Kleinanzeigen',
    title: 'Cafe',
    url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411'
  });
  assert.strictEqual(cardWithUrl.includes('href="https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411"'), true);

  const { applyListingFilters, resetFilters } = await import('../../../js/filters.js');
  const filtered = applyListingFilters([
    {
      id: 'active-ok',
      listingType: 'direct_listing',
      availabilityStatus: 'active',
      lastVerifiedAt: new Date().toISOString(),
      url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411',
      rent: 1500,
      unitArea: 45,
      gastroSuitability: 'possible',
      gastroEvidence: 'Direct source says cafe',
      verifiedSummary: 'Verified direct listing'
    },
    {
      id: 'active-reject',
      listingType: 'direct_listing',
      availabilityStatus: 'active',
      lastVerifiedAt: new Date().toISOString(),
      url: 'https://www.kleinanzeigen.de/s-anzeige/big-cafe/2-277-6411',
      rent: 7000,
      unitArea: 350,
      gastroSuitability: 'possible',
      gastroEvidence: 'Direct source says cafe',
      verifiedSummary: 'Verified direct listing'
    },
    { id: 'active-missing-url', listingType: 'direct_listing', availabilityStatus: 'active', lastVerifiedAt: new Date().toISOString() },
    { id: 'dead', listingType: 'direct_listing', availabilityStatus: 'dead' },
    { id: 'unknown', listingType: 'direct_listing', availabilityStatus: 'unknown' },
    { id: 'search', listingType: 'direct_listing', availabilityStatus: 'search_only' },
    { id: 'lead', listingType: 'project_lead', availabilityStatus: 'lead' }
  ], resetFilters());
  assert.deepStrictEqual(filtered.map((listing) => listing.id).sort(), ['active-ok', 'lead']);

  const insufficientScoreCard = buildListingCard({
    id: 'score-hidden',
    listingType: 'direct_listing',
    availabilityStatus: 'active',
    lastVerifiedAt: new Date().toISOString(),
    sourceName: 'Kleinanzeigen',
    title: 'Cafe',
    url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411',
    unitArea: 45,
    rent: null,
    gastroSuitability: 'possible',
    gastroEvidence: 'Direct source says cafe'
  });
  assert.strictEqual(insufficientScoreCard.includes('aria-label="Оценка пока невозможна"'), true);

  const override = await checkListing({
    id: 'manual-dead',
    source: 'ImmoScout24',
    url: 'https://www.immobilienscout24.de/expose/169993813',
    verificationOverride: {
      status: 'dead',
      reason: 'manual test',
      verifiedAt: '2026-08-23T10:00:00.000Z'
    }
  }, '2026-08-23T10:00:00.000Z');

  assert.strictEqual(override.availabilityStatus, 'dead');
  assert.strictEqual(override.verificationMethod, 'manual-override');

  const weakHttp200 = classifyHtml({
    id: 'weak-http-200',
    source: 'Kleinanzeigen',
    url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411',
    district: 'München'
  }, {
    ok: true,
    status: 200
  }, '<html><title>Kleinanzeigen</title><body>Gastronomie Mietpreis Anzeigen-ID</body></html>', 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411', '2026-08-23T10:00:00.000Z');
  assert.strictEqual(weakHttp200.availabilityStatus, 'unknown');

  const searchRedirect = classifyHtml({
    id: 'search-redirect',
    source: 'Kleinanzeigen',
    url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411'
  }, {
    ok: true,
    status: 200
  }, '<html><body>Suchergebnisse</body></html>', 'https://www.kleinanzeigen.de/s-muenchen/kiosk-mieten/k0l6411', '2026-08-23T10:00:00.000Z');
  assert.strictEqual(searchRedirect.availabilityStatus, 'search_only');

  const deleted = classifyHtml({
    id: 'deleted',
    source: 'Kleinanzeigen',
    url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411'
  }, {
    ok: true,
    status: 200
  }, '<html><body>Anzeige wurde gelöscht</body></html>', 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411', '2026-08-23T10:00:00.000Z');
  assert.strictEqual(deleted.availabilityStatus, 'dead');

  const blocked = classifyHtml({
    id: 'blocked',
    source: 'ImmoScout24',
    url: 'https://www.immobilienscout24.de/expose/123'
  }, {
    ok: false,
    status: 401
  }, '<html><body>blocked</body></html>', 'https://www.immobilienscout24.de/expose/123', '2026-08-23T10:00:00.000Z');
  assert.strictEqual(blocked.availabilityStatus, 'unknown');

  const row = rowForListing(normalized);
  assert.strictEqual(row.external_id, 'klein-123-277-6411');
  assert.strictEqual(row.availability_status, 'unknown');
  assert.strictEqual(row.canonical_url, normalized.canonicalUrl);

  console.log('ingestion tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

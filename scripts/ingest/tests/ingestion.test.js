const assert = require('assert');
const { deduplicateListings } = require('../deduplicate-listings');
const { calculateDataCompleteness, hasMeaningfulTitle } = require('../data-completeness');
const { areaFromText, collectAreaCandidates, compactSummary, conditionText, enrichListing, meaningfulTitle, rentFromText } = require('../enrich-listing');
const { mergeExistingListing } = require('../merge-existing-listing');
const { normalizeListing } = require('../normalize-listing');
const { rowForListing } = require('../supabase-upsert');
const {
  getValidExternalUrl,
  isVisibleCandidate,
  isSafeForProduction,
  isUsableCandidate,
  summarizeValidation,
  validateSourceLink
} = require('../listing-validation');
const {
  extractExternalId,
  canonicalizeListingUrl,
  isMunichKleinanzeigenUrl,
  isDirectListingUrl,
  isPotentialMatchaListingUrl,
  isSearchPageUrl
} = require('../utils');
const { checkListing, classifyHtml } = require('../../check-listings');
const { calculateBusinessFit } = require('../business-fit');
const { candidateFromPage: stadtCandidateFromPage } = require('../sources/stadt-muenchen');
const { candidateFromBrokerPage } = require('../sources/brokers');
const kleinanzeigenSource = require('../sources/kleinanzeigen');
const { calculateProjectRelevance } = require('../project-relevance');
const { isProductionPersistable } = require('../run-ingestion');

async function run() {
  assert.strictEqual(
    canonicalizeListingUrl('http://www.kleinanzeigen.de/s-anzeige/demo/123-277-6411?utm_source=x&ref=foo#top'),
    'https://www.kleinanzeigen.de/s-anzeige/demo/123-277-6411'
  );

  assert.strictEqual(
    extractExternalId('Kleinanzeigen', 'https://www.kleinanzeigen.de/s-anzeige/demo/123-277-6411'),
    'klein-123-277-6411'
  );
  assert.strictEqual(
    getValidExternalUrl({
      listingType: 'direct_listing',
      url: 'https://gewerbeimmobilien.jll.de/einzelhandel/demo-muenchen'
    }),
    'https://gewerbeimmobilien.jll.de/einzelhandel/demo-muenchen'
  );
  assert.strictEqual(isDirectListingUrl('https://www.colliers.de/gewerbeimmobilien/objekt/laden-muenchen-m-p4485-g1-e1/'), true);
  assert.strictEqual(isDirectListingUrl('https://www.colliers.de/gewerbeimmobilien/muenchen/einzelhandel/'), false);
  assert.strictEqual(isDirectListingUrl('https://www.engelvoelkers.com/de/de/exposes/11111111-2222-3333-4444-555555555555'), true);
  assert.strictEqual(isDirectListingUrl('https://www.immobilie1.de/80799-munchen-ladeneinzelhandel-premium-ladenflache-32834399'), true);

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

  const stadtDirect = stadtCandidateFromPage(
    'https://stadt.muenchen.de/service/info/stadtische-gewerbeflachen-verfugbare-objekte/1081087/n0/demo',
    '<h1>Ladenfläche in München zu vermieten</h1><p>Ladenfläche 47 m². Miete 1.900 €. Gastronomie möglich. Adresse Teststraße 1 München.</p>',
    '2026-08-23T10:00:00.000Z'
  );
  assert.strictEqual(stadtDirect.listingType, 'direct_listing');
  assert.strictEqual(stadtDirect.unitArea, 47);
  assert.strictEqual(stadtDirect.rent, 1900);

  const stadtLead = stadtCandidateFromPage(
    'https://stadt.muenchen.de/lhm-ms-wirtschaftsfoerderung/standort-muenchen/gewerbeflaechen-immobilien/gewerbeflaechen-angebote/project.html',
    '<h1>Projektentwicklung München</h1><p>Kontaktieren Sie uns für verfügbare Flächen.</p>',
    '2026-08-23T10:00:00.000Z'
  );
  assert.strictEqual(stadtLead.listingType, 'project_lead');

  const colliersParsed = candidateFromBrokerPage({
    sourceName: 'Colliers',
    sourceFamily: 'broker'
  }, 'https://www.colliers.de/gewerbeimmobilien/objekt/laden-muenchen-demo/', '<h1>Laden München</h1><p>Mietfläche 79 m². Miete 2.900 €. Einzelhandel München.</p>', '2026-08-23T10:00:00.000Z');
  assert.strictEqual(colliersParsed.unitArea, 79);
  assert.strictEqual(colliersParsed.rent, 2900);
  assert.strictEqual(colliersParsed.sourceName, 'Colliers');

  const colliersSmall = candidateFromBrokerPage({
    sourceName: 'Colliers',
    sourceFamily: 'broker'
  }, 'https://www.colliers.de/gewerbeimmobilien/objekt/laden-muenchen-small/', '<h1>Shop München</h1><p>Ladenfläche 47 m². Miete 1.900 €.</p>', '2026-08-23T10:00:00.000Z');
  assert.strictEqual(colliersSmall.unitArea, 47);
  assert.strictEqual(colliersSmall.rawSourceData.areaEvidence, 'Ladenfläche 47 m²');

  const colliersDivisible = candidateFromBrokerPage({
    sourceName: 'Colliers',
    sourceFamily: 'broker'
  }, 'https://www.colliers.de/gewerbeimmobilien/objekt/laden-muenchen-teilbar/', '<h1>Retail München</h1><p>Gesamtfläche 150 m². Teilbar ab 47 m². Mietpreis auf Anfrage.</p>', '2026-08-23T10:00:00.000Z');
  assert.strictEqual(colliersDivisible.unitArea, 47);
  assert.strictEqual(colliersDivisible.projectTotalArea, 150);
  assert.strictEqual(colliersDivisible.rent, null);
  assert.strictEqual(colliersDivisible.rawSourceData.rentEvidence, 'Preis auf Anfrage');

  const colliersSeventyNine = candidateFromBrokerPage({
    sourceName: 'Colliers',
    sourceFamily: 'broker'
  }, 'https://www.colliers.de/gewerbeimmobilien/objekt/laden-muenchen-79/', '<h1>Einzelhandel München</h1><p>Fläche 79 m 2 Mietpreis ab auf Anfrage Verfügbar ab sofort.</p>', '2026-08-23T10:00:00.000Z');
  assert.strictEqual(colliersSeventyNine.unitArea, 79);
  assert.strictEqual(colliersSeventyNine.rent, null);

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

  const phase3bMerge = mergeExistingListing({
    ...existingFull,
    raw_source_data: {
      financialEvidenceStructured: {
        kaution: { raw: 'Kaution 3 Monatsmieten', confidence: 'high' }
      },
      operationalEvidence: {
        abluft: { raw: 'Küchenabluft vorhanden', confidence: 'high' }
      }
    },
    provision: { status: 'free', amount: null },
    kaution: { status: 'known_relative', amount: null, months: 3 }
  }, {
    externalId: 'klein-westend-66',
    rawSourceData: {
      detectedAt: '2026-08-24T10:00:00.000Z',
      financialEvidenceStructured: {
        rent: { raw: 'Kaltmiete 1.600 €', confidence: 'high' }
      }
    },
    provision: { status: 'unknown', amount: null, evidence: null },
    kaution: { status: 'unknown', amount: null, evidence: null }
  });

  assert.strictEqual(phase3bMerge.rawSourceData.financialEvidenceStructured.kaution.raw, 'Kaution 3 Monatsmieten');
  assert.strictEqual(phase3bMerge.rawSourceData.financialEvidenceStructured.rent.raw, 'Kaltmiete 1.600 €');
  assert.strictEqual(phase3bMerge.rawSourceData.operationalEvidence.abluft.raw, 'Küchenabluft vorhanden');
  assert.strictEqual(phase3bMerge.provision.status, 'free');
  assert.strictEqual(phase3bMerge.kaution.months, 3);

  assert.strictEqual(isProductionPersistable({
    listingType: 'direct_listing',
    dedupeAction: 'updated',
    previousAvailabilityStatus: 'active',
    availabilityStatus: 'dead'
  }), true);
  assert.strictEqual(isProductionPersistable({
    listingType: 'direct_listing',
    dedupeAction: 'updated',
    previousAvailabilityStatus: 'active',
    availabilityStatus: 'unknown'
  }), true);
  assert.strictEqual(isProductionPersistable({
    listingType: 'direct_listing',
    dedupeAction: 'new',
    availabilityStatus: 'unknown'
  }), false);

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
  assert.strictEqual(areaFromText('Ladenfläche: ca. 57 m²').unitArea, 57);
  assert.strictEqual(areaFromText('Ladenfläche ca. 57 qm').unitArea, 57);
  assert.strictEqual(areaFromText('Ladenzeile mit ca. 57 m2').unitArea, 57);
  assert.strictEqual(areaFromText('Verkaufsraum mit circa 45 m²').unitArea, 45);
  assert.strictEqual(areaFromText('Gastrofläche ungefähr 45 m²').unitArea, 45);
  assert.strictEqual(areaFromText('44 m² Kellerfläche und 57 m² Ladenfläche').unitArea, 57);
  assert.strictEqual(areaFromText('Gesamtfläche ca. 100 qm: 85 qm Verkaufs-/Ladenfläche 15 qm zusätzlicher Raum im Obergeschoss').unitArea, 85);
  assert.strictEqual(areaFromText('Gesamtfläche ca. 100 qm: 85 qm Verkaufs-/Ladenfläche 15 qm zusätzlicher Raum im Obergeschoss').areaEvidence, '85 qm Verkaufs-/Ladenfläche');
  assert.strictEqual(areaFromText('Ladenfläche 57 m² Kellerfläche 44 m²').unitArea, 57);
  assert.strictEqual(areaFromText('Gesamtfläche 75 m² Verkaufsfläche 60 m²').unitArea, 60);
  assert.strictEqual(areaFromText('Terrasse 20 m² Ladenfläche 45 m²').unitArea, 45);
  assert.strictEqual(areaFromText('Projektfläche 1200 m²').unitArea, null);
  assert.strictEqual(areaFromText('Grundstücksfläche 500 m²').unitArea, null);
  assert.deepStrictEqual(
    collectAreaCandidates('85 qm Verkaufs-/Ladenfläche 15 qm zusätzlicher Raum').map((candidate) => candidate.areaType),
    ['sales_area']
  );
  assert.strictEqual(conditionText('Kaution: 4.800 €', 'kaution').amount, 4800);
  assert.strictEqual(conditionText('Kaution 3 Monatsmieten', 'kaution').amount, 3);
  assert.strictEqual(conditionText('Kaution 3 € Klimaanlage Küche vorhanden', 'kaution').amount, null);
  assert.strictEqual(conditionText('Provision nach Vereinbarung', 'provision').amount, null);
  assert.ok(compactSummary(`Cafe. Ladenfläche 57 m². Kaltmiete 1600 €. Keine Küchenabluft. Energieausweis sehr langer Text ${'x'.repeat(1000)}`).length < 700);

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
    unitArea: 19,
    rent: 1600,
    gastroSuitability: 'possible'
  }).level, 'reject');
  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    unitArea: 101,
    rent: 1600,
    gastroSuitability: 'possible'
  }).level, 'reject');
  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    unitArea: 100,
    rent: 2770,
    gastroSuitability: 'possible'
  }).level, 'weak');
  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    unitArea: 85,
    rent: 1600,
    gastroSuitability: 'possible'
  }).level, 'weak');
  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    unitArea: 75,
    rent: 2800,
    gastroSuitability: 'possible'
  }).level, 'acceptable');
  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    sourceName: 'Colliers',
    sourceFamily: 'broker',
    unitArea: 47,
    rent: null,
    priceStatus: 'request',
    gastroSuitability: 'possible',
    rawSourceData: { sourceQuality: 'high' }
  }).level, 'acceptable');
  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    sourceName: 'Kleinanzeigen',
    sourceFamily: 'portal',
    unitArea: 47,
    rent: null,
    priceStatus: 'request',
    gastroSuitability: 'possible',
    rawSourceData: { sourceQuality: 'medium' }
  }).level, 'reject');
  assert.strictEqual(calculateProjectRelevance({
    listingType: 'direct_listing',
    unitArea: 47,
    rent: 1900,
    gastroSuitability: 'possible',
    rawSourceData: { outsideMunich: true }
  }).level, 'reject');
  assert.ok(['strong', 'acceptable'].includes(calculateProjectRelevance({
    listingType: 'direct_listing',
    unitArea: 60,
    rent: 3000,
    gastroSuitability: 'possible'
  }).level));
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
      body: '<title>Cafe Laden München | Kleinanzeigen.de</title><main>Cafe Laden mit Ladenfläche 45 m², Kaltmiete 1600 €, Kaution 3 Monatsmieten, Provision 3,57 MM, provisionsfrei, Ablöse 25.000 €, Nebenkosten 450 €, zzgl. NK, Inventar gegen Ablöse</main>'
    })
  });

  assert.strictEqual(enriched.title, 'Cafe Laden München');
  assert.strictEqual(enriched.rent, 1600);
  assert.strictEqual(enriched.unitArea, 45);
  assert.strictEqual(enriched.rawSourceData.rentConfidence, 'high');
  assert.strictEqual(enriched.gastroSuitability, 'possible');
  assert.ok(enriched.rawSourceData.rawDescription.includes('Cafe Laden'));
  assert.ok(enriched.rawSourceData.financialEvidence.some((evidence) => /Kaution/i.test(evidence)));
  assert.ok(enriched.rawSourceData.financialEvidence.some((evidence) => /Provision 3,57 MM/i.test(evidence)));
  assert.ok(enriched.rawSourceData.financialEvidence.some((evidence) => /provisionsfrei/i.test(evidence)));
  assert.ok(enriched.rawSourceData.financialEvidence.some((evidence) => /Ablöse 25\.000 €/i.test(evidence)));
  assert.ok(enriched.rawSourceData.financialEvidence.some((evidence) => /Nebenkosten 450 €/i.test(evidence)));
  assert.ok(enriched.rawSourceData.financialEvidence.some((evidence) => /zzgl\. NK/i.test(evidence)));
  assert.ok(enriched.rawSourceData.financialEvidence.some((evidence) => /Inventar gegen Ablöse/i.test(evidence)));

  const brokerEvidence = candidateFromBrokerPage({
    sourceName: 'Engel & Völkers',
    sourceFamily: 'broker',
    sourceQuality: 'high'
  }, 'https://www.engelvoelkers.com/de/de/exposes/11111111-2222-3333-4444-555555555555', '<h1>Café Laden München</h1><p>Ladenfläche 48 m². Preis auf Anfrage. Kaution 3 Monatsmieten. Provision nach Vereinbarung. Ablöse 25000 €. Nebenkosten 450 €. Einzelhandel München.</p>', '2026-08-23T10:00:00.000Z');
  assert.strictEqual(brokerEvidence.priceStatus, 'request');
  assert.strictEqual(brokerEvidence.rent, null);
  assert.ok(brokerEvidence.rawSourceData.rawDescription.includes('Kaution 3 Monatsmieten'));
  assert.strictEqual(brokerEvidence.rawSourceData.sourceQuality, 'high');

  assert.strictEqual(
    kleinanzeigenSource.paginatedUrl('https://www.kleinanzeigen.de/s-muenchen/kiosk-mieten/k0l6411', 2),
    'https://www.kleinanzeigen.de/s-muenchen/kiosk-mieten/seite:2/k0l6411'
  );

  const seenPages = [];
  const kleinDiscovery = await kleinanzeigenSource.discover({
    now: '2026-08-23T10:00:00.000Z',
    rateLimitMs: 0,
    pageLimit: 2,
    fetchPage: async (url) => {
      seenPages.push(url);
      if (url.includes('seite:2')) return { finalUrl: url, body: '' };
      return {
        finalUrl: url,
        body: '<a href="https://www.kleinanzeigen.de/s-anzeige/cafe-laden-muenchen/123-277-6411">Cafe</a>'
      };
    }
  });
  assert.strictEqual(kleinDiscovery.candidates.length, 1);
  assert.ok(kleinDiscovery.meta.queries >= 10);
  assert.ok(kleinDiscovery.meta.pagesScanned >= 2);
  assert.ok(kleinDiscovery.meta.duplicateLinks > 0);
  assert.ok(seenPages.some((url) => url.includes('seite:2')));

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
  assert.strictEqual(isUsableCandidate({
    listingType: 'direct_listing',
    availabilityStatus: 'active',
    sourceName: 'Kleinanzeigen',
    sourceFamily: 'portal',
    url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411',
    dataCompleteness: 100,
    rent: null,
    priceStatus: 'request',
    unitArea: 45,
    title: 'Cafe',
    verifiedSummary: 'Verified direct listing',
    rawSourceData: { sourceQuality: 'medium', rentEvidence: 'Preis auf Anfrage' }
  }), false);
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
  assert.strictEqual(isVisibleCandidate({
    listingType: 'direct_listing',
    availabilityStatus: 'active',
    url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411',
    dataCompleteness: 100,
    rent: 2770,
    unitArea: 100,
    title: 'Large kiosk',
    verifiedSummary: 'Verified direct listing',
    gastroSuitability: 'possible'
  }), false);

  const visibleBase = {
    listingType: 'direct_listing',
    availabilityStatus: 'active',
    url: 'https://www.kleinanzeigen.de/s-anzeige/cafe/1-277-6411',
    dataCompleteness: 100,
    rent: 1700,
    unitArea: 50,
    lastVerifiedAt: new Date().toISOString(),
    gastroSuitability: 'confirmed',
    verifiedSummary: 'Verified direct listing'
  };
  assert.strictEqual(calculateBusinessFit({
    ...visibleBase,
    title: 'Dog Café Konzept sucht Betreiber'
  }).level, 'exclude');
  assert.strictEqual(calculateBusinessFit({
    ...visibleBase,
    externalId: 'klein-bogenhausen-prinzregent',
    title: 'Cafe am Prinzregentenplatz'
  }).level, 'exclude');
  assert.strictEqual(isVisibleCandidate({
    ...visibleBase,
    title: 'Dog Café Konzept sucht Betreiber'
  }), false);
  assert.notStrictEqual(calculateBusinessFit({
    ...visibleBase,
    title: 'Café / Take-away Laden'
  }).level, 'exclude');
  assert.notStrictEqual(calculateBusinessFit({
    ...visibleBase,
    title: 'Kiosk / Laden'
  }).level, 'exclude');
  assert.ok(['conditional', 'exclude'].includes(calculateBusinessFit({
    ...visibleBase,
    title: 'Kiosk mit Automatenaufsteller verpflichtend'
  }).level));
  assert.strictEqual(calculateBusinessFit({
    ...visibleBase,
    title: 'Shisha Bar'
  }).level, 'exclude');
  assert.notStrictEqual(calculateBusinessFit({
    ...visibleBase,
    title: 'Café ohne warme Küche',
    gastroEvidence: 'keine Küchenabluft'
  }).level, 'exclude');
  assert.notStrictEqual(calculateBusinessFit({
    ...visibleBase,
    title: 'Café Laden',
    abloese: { known: true, value: 'optional Ablöse verhandelbar', amount: 10000 }
  }).level, 'exclude');
  assert.strictEqual(calculateBusinessFit({
    ...visibleBase,
    title: 'Metzgerei & Imbiss zur Pacht mit Inventar Ablöse 65.000 Euro',
    abloese: { known: true, value: 'mandatory Ablöse 65.000 €', amount: 65000 }
  }).level, 'exclude');

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
  const { buildLeadCard } = await import('../../../js/listings.js');
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

  const { applyListingFilters, isVisibleLead, rankLeads, resetFilters } = await import('../../../js/filters.js');
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
  assert.deepStrictEqual(filtered.map((listing) => listing.id).sort(), ['active-ok']);
  assert.strictEqual(isVisibleLead({ id: 'lead', listingType: 'project_lead', availabilityStatus: 'lead' }), true);
  const leadCard = buildLeadCard({ id: 'lead', listingType: 'project_lead', availabilityStatus: 'lead', title: 'FMQ', sourceName: 'Stadt München' });
  assert.strictEqual(leadCard.includes('Это не подтверждённое помещение'), true);
  assert.strictEqual(leadCard.includes('Matcha Score'), false);
  const rankedLeads = rankLeads([
    { id: 'dead-lead', listingType: 'project_lead', availabilityStatus: 'dead', sourceName: 'Stadt München' },
    { id: 'low', listingType: 'project_lead', availabilityStatus: 'lead', sourceName: 'Manual' },
    { id: 'high', listingType: 'project_lead', availabilityStatus: 'lead', sourceName: 'Stadt München', sourceQuality: 'high', address: 'München', gastroEvidence: 'Gastronomie Laden', sourceUrl: 'https://stadt.muenchen.de/demo' }
  ]);
  assert.deepStrictEqual(rankedLeads.map((listing) => listing.id), ['high', 'low']);
  assert.strictEqual(rankedLeads.slice(0, 5).length, 2);
  const leadWithoutUrlCard = buildLeadCard({ id: 'lead-no-url', listingType: 'project_lead', availabilityStatus: 'lead', title: 'Lead' });
  assert.strictEqual(leadWithoutUrlCard.includes('Источник недоступен'), true);

  assert.strictEqual(isVisibleCandidate({
    id: 'colliers-visible',
    listingType: 'direct_listing',
    availabilityStatus: 'active',
    lastVerifiedAt: new Date().toISOString(),
    sourceName: 'Colliers',
    sourceUrl: 'https://www.colliers.de/gewerbeimmobilien/objekt/laden-muenchen-visible/',
    title: 'Ladenfläche München',
    rent: 1900,
    unitArea: 47,
    gastroSuitability: 'possible',
    gastroEvidence: 'Colliers object page mentions retail/gastro-compatible use.',
    verifiedSummary: 'Verified Colliers direct listing'
  }), true);

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

  const colliersArchived = classifyHtml({
    id: 'colliers-archived',
    source: 'Colliers',
    listingType: 'direct_listing',
    url: 'https://www.colliers.de/gewerbeimmobilien/objekt/laden-muenchen-archiviert/',
    title: 'Laden München'
  }, {
    ok: true,
    status: 200
  }, '<html><h1>Laden München</h1><p>Dieses Objekt ist nicht mehr verfügbar.</p></html>', 'https://www.colliers.de/gewerbeimmobilien/objekt/laden-muenchen-archiviert/', '2026-08-23T10:00:00.000Z');
  assert.strictEqual(colliersArchived.availabilityStatus, 'dead');

  const engelActive = classifyHtml({
    id: 'engel-active',
    source: 'Engel & Völkers',
    listingType: 'direct_listing',
    url: 'https://www.engelvoelkers.com/de/de/exposes/11111111-2222-3333-4444-555555555555',
    title: 'Café Laden München'
  }, {
    ok: true,
    status: 200
  }, '<html><h1>Café Laden München</h1><p>Exposé Einzelhandel Kontakt München Mietfläche 48 m²</p></html>', 'https://www.engelvoelkers.com/de/de/exposes/11111111-2222-3333-4444-555555555555', '2026-08-23T10:00:00.000Z');
  assert.strictEqual(engelActive.availabilityStatus, 'active');

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

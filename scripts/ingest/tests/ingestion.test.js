const assert = require('assert');
const { deduplicateListings } = require('../deduplicate-listings');
const { calculateDataCompleteness } = require('../data-completeness');
const { enrichListing } = require('../enrich-listing');
const { mergeExistingListing } = require('../merge-existing-listing');
const { normalizeListing } = require('../normalize-listing');
const { rowForListing } = require('../supabase-upsert');
const {
  extractExternalId,
  canonicalizeListingUrl,
  isMunichKleinanzeigenUrl,
  isPotentialMatchaListingUrl,
  isSearchPageUrl
} = require('../utils');
const { checkListing } = require('../../check-listings');

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
      body: '<title>Cafe Laden München</title><meta name="description" content="Cafe Laden mit 45 m², Kaltmiete 1600 €, Kaution nach Absprache">'
    })
  });

  assert.strictEqual(enriched.title, 'Cafe Laden München');
  assert.strictEqual(enriched.rent, 1600);
  assert.strictEqual(enriched.unitArea, 45);
  assert.strictEqual(enriched.gastroSuitability, 'possible');

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

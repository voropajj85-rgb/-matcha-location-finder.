const assert = require('assert');
const { deduplicateListings } = require('../deduplicate-listings');
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

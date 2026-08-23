#!/usr/bin/env node

const { calculateDataCompleteness } = require('./data-completeness');
const { mapExistingRow } = require('./merge-existing-listing');
const { fetchExistingRows } = require('./supabase-upsert');
const {
  isUsableCandidate,
  summarizeValidation,
  validateSourceLink,
  validationIssues
} = require('./listing-validation');

function isVisibleStatus(listing) {
  return listing.availabilityStatus === 'active' || listing.availabilityStatus === 'lead';
}

async function main() {
  const rows = await fetchExistingRows({ publicReadOnly: true });
  const listings = rows.map((row) => {
    const mapped = mapExistingRow(row);
    return { ...mapped, ...calculateDataCompleteness(mapped) };
  });
  const visible = listings.filter(isVisibleStatus);
  const validation = summarizeValidation(visible);

  console.log('existing Supabase audit');
  console.log(`  total: ${listings.length}`);
  console.log(`  visible_active_or_lead: ${visible.length}`);
  console.log(`  usable_direct_listings: ${validation.usableDirectListings}`);
  console.log(`  active_but_not_usable: ${validation.activeButNotUsable}`);
  console.log(`  leads: ${validation.leads}`);
  console.log(`  valid_direct_urls: ${validation.validDirectUrls}`);
  console.log(`  missing_urls: ${validation.missingUrls}`);
  console.log(`  invalid_urls: ${validation.invalidUrls}`);
  console.log(`  search_urls_rejected: ${validation.searchUrlsRejected}`);

  console.log('\nissues');
  for (const listing of visible) {
    const issues = validationIssues(listing);
    if (!issues.length) continue;
    const link = validateSourceLink(listing);
    console.log(`${listing.externalId || listing.id}`);
    console.log(`  source: ${listing.sourceName || listing.source}`);
    console.log(`  listingType: ${listing.listingType}`);
    console.log(`  availabilityStatus: ${listing.availabilityStatus}`);
    console.log(`  sourceUrl: ${listing.sourceUrl || listing.url || 'missing'}`);
    console.log(`  sourceLinkValid: ${link.sourceLinkValid}`);
    console.log(`  usable: ${isUsableCandidate(listing)}`);
    console.log(`  issues: ${issues.join('; ')}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main };

#!/usr/bin/env node

const { calculateDataCompleteness } = require('./data-completeness');
const { checkListing } = require('../check-listings');
const { mapExistingRow } = require('./merge-existing-listing');
const { fetchExistingRows } = require('./supabase-upsert');
const {
  isSafeForProduction,
  isVisibleCandidate,
  isUsableCandidate,
  summarizeValidation,
  validateSourceLink,
  validationIssues
} = require('./listing-validation');
const { calculateBusinessFit, withBusinessFit } = require('./business-fit');
const { calculateProjectRelevance } = require('./project-relevance');

function isVisibleStatus(listing) {
  return listing.availabilityStatus === 'active' || listing.availabilityStatus === 'lead';
}

async function main() {
  const verifyCurrent = process.argv.includes('--verify-current');
  const checkedAt = new Date().toISOString();
  const rows = await fetchExistingRows({ publicReadOnly: true });
  let listings = rows.map((row) => {
    const mapped = mapExistingRow(row);
    return withBusinessFit({ ...mapped, ...calculateDataCompleteness(mapped) });
  });

  if (verifyCurrent) {
    const checked = [];
    for (const listing of listings) {
      const result = await checkListing({
        ...listing,
        source: listing.sourceName || listing.source,
        url: listing.sourceUrl || listing.url
      }, checkedAt);
      checked.push({ ...listing, checkedAvailabilityStatus: result.availabilityStatus, checkedReason: result.reason });
    }
    listings = checked;
  }

  const visible = listings.filter(isVisibleStatus);
  const validation = summarizeValidation(listings);
  const visibleValidation = summarizeValidation(visible);
  const byStatus = listings.reduce((counts, listing) => {
    const status = listing.availabilityStatus || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});

  console.log('existing Supabase audit');
  console.log(`  total: ${listings.length}`);
  console.log(`  visible_active_or_lead: ${visible.length}`);
  console.log(`  active: ${byStatus.active || 0}`);
  console.log(`  dead: ${byStatus.dead || 0}`);
  console.log(`  unknown: ${byStatus.unknown || 0}`);
  console.log(`  search_only: ${byStatus.search_only || 0}`);
  console.log(`  lead: ${byStatus.lead || 0}`);
  console.log(`  usable_direct_listings: ${visibleValidation.usableDirectListings}`);
  console.log(`  active_but_not_usable: ${visibleValidation.activeButNotUsable}`);
  console.log(`  leads: ${visibleValidation.leads}`);
  console.log(`  valid_direct_urls: ${validation.validDirectUrls}`);
  console.log(`  missing_urls: ${validation.missingUrls}`);
  console.log(`  invalid_urls: ${validation.invalidUrls}`);
  console.log(`  search_urls_rejected: ${validation.searchUrlsRejected}`);
  console.log(`  safe_for_production: ${validation.safeForProduction}`);
  console.log(`  visible_candidates: ${validation.visibleCandidates}`);

  console.log('\nissues');
  for (const listing of listings) {
    const issues = validationIssues(listing);
    if (!issues.length) continue;
    const link = validateSourceLink(listing);
    console.log(`${listing.externalId || listing.id}`);
    console.log(`  source: ${listing.sourceName || listing.source}`);
    console.log(`  listingType: ${listing.listingType}`);
    console.log(`  availabilityStatus: ${listing.availabilityStatus}`);
    console.log(`  sourceUrl: ${listing.sourceUrl || listing.url || 'missing'}`);
    console.log(`  sourceLinkValid: ${link.sourceLinkValid}`);
    const relevance = calculateProjectRelevance(listing);
    const businessFit = calculateBusinessFit(listing);
    console.log(`  projectRelevance: ${relevance.level}`);
    console.log(`  relevanceReasons: ${relevance.reasons.join('; ')}`);
    console.log(`  businessFit: ${businessFit.level}`);
    console.log(`  businessFitReasons: ${businessFit.reasons.join('; ')}`);
    console.log(`  sourceQuality: ${listing.sourceQuality || 'unknown'}`);
    console.log(`  usable: ${isUsableCandidate(listing)}`);
    console.log(`  safeForProduction: ${isSafeForProduction(listing)}`);
    console.log(`  visibleCandidate: ${isVisibleCandidate(listing)}`);
    if (verifyCurrent) {
      console.log(`  checkedStatus: ${listing.checkedAvailabilityStatus}`);
      console.log(`  checkedReason: ${listing.checkedReason}`);
    }
    console.log(`  issues: ${issues.join('; ')}`);
  }

  const auditIds = new Set([
    'klein-3470636624-277-16373',
    'klein-3471053348-277-16388',
    'klein-3484241799-277-6451',
    'klein-3484404879-277-6459',
    'klein-3484857394-277-6451',
    'klein-bogenhausen-prinzregent',
    'klein-westend-66'
  ]);

  console.log('\ncurrent active audit');
  for (const listing of listings.filter((item) => auditIds.has(item.externalId || item.id))) {
    const relevance = calculateProjectRelevance(listing);
    const businessFit = calculateBusinessFit(listing);
    console.log(`${listing.externalId || listing.id}`);
    console.log(`  projectRelevance: ${relevance.level}`);
    console.log(`  businessFit: ${businessFit.level}`);
    console.log(`  businessFitReasons: ${businessFit.reasons.join('; ')}`);
    console.log(`  visibleCandidate: ${isVisibleCandidate(listing)}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { main };

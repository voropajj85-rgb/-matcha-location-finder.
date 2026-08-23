#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const { deduplicateListings } = require('./deduplicate-listings');
const { calculateDataCompleteness, summarizeDataQuality } = require('./data-completeness');
const { enrichListings } = require('./enrich-listing');
const { normalizeListing } = require('./normalize-listing');
const { fetchExistingRows, upsertListings } = require('./supabase-upsert');
const {
  isSafeForProduction,
  isUsableCandidate,
  summarizeValidation,
  validateSourceLink,
  validationIssues
} = require('./listing-validation');
const { verifyListings } = require('./verify-listings');

const SOURCES = {
  kleinanzeigen: require('./sources/kleinanzeigen'),
  immowelt: require('./sources/immowelt'),
  immoscout24: require('./sources/immoscout24'),
  'stadt-muenchen': require('./sources/stadt-muenchen'),
  brokers: require('./sources/brokers')
};

const REQUEST_TIMEOUT_MS = 15000;
const REPORT_PATH = path.join(__dirname, 'reports', 'latest-validation.json');

function parseArgs(argv) {
  const sourceArg = argv.find((arg) => arg.startsWith('--source='));
  return {
    dryRun: argv.includes('--dry-run'),
    source: sourceArg ? sourceArg.split('=')[1] : null,
    skipVerification: argv.includes('--skip-verification'),
    validationReport: argv.includes('--validation-report')
  };
}

async function fetchPage(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'MatchaLocationFinder/1.0 (+light discovery; no scraping bypass)'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  const body = await response.text();
  if (response.status === 401 || response.status === 403 || response.status === 429) {
    throw new Error(`HTTP ${response.status} blocks discovery`);
  }

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { status: response.status, finalUrl: response.url, body };
}

function summarize(listings) {
  const counts = { active: 0, dead: 0, unknown: 0, search_only: 0, lead: 0 };
  for (const listing of listings) {
    if (Object.hasOwn(counts, listing.availabilityStatus)) counts[listing.availabilityStatus] += 1;
  }
  return counts;
}

function printSourceSummary(results) {
  console.log('sources');
  for (const result of results) {
    const status = result.errors.length ? 'partial' : 'success';
    console.log(`  ${result.source}: ${status}, found ${result.candidates.length}, errors ${result.errors.length}`);
    for (const error of result.errors.slice(0, 3)) {
      console.log(`    error: ${error.sourceUrl} - ${error.message}`);
    }
  }
}

function printListingPreview(listings) {
  for (const listing of listings.slice(0, 30)) {
    console.log(`${listing.externalId || listing.id}`);
    console.log(`  source: ${listing.sourceName || listing.source}`);
    console.log(`  action: ${listing.dedupeAction || 'unknown'}`);
    console.log(`  status: ${listing.availabilityStatus}`);
    console.log(`  dataCompleteness: ${listing.dataCompleteness} (${listing.dataQuality})`);
    console.log(`  rent: ${listing.rent ?? 'unknown'}`);
    console.log(`  unitArea: ${listing.unitArea ?? listing.area ?? 'unknown'}`);
    console.log(`  verificationMethod: ${listing.verificationMethod}`);
    console.log(`  url: ${listing.sourceUrl || listing.url}`);
  }
}

function printValidationReport(listings) {
  console.log('\nvalidation report');
  for (const listing of listings) {
    const link = validateSourceLink(listing);
    console.log(`${listing.externalId || listing.id}`);
    console.log(`  sourceName: ${listing.sourceName || listing.source}`);
    console.log(`  listingType: ${listing.listingType}`);
    console.log(`  title: ${listing.title || 'unknown'}`);
    console.log(`  location: ${listing.address || listing.district || 'unknown'}`);
    console.log(`  sourceUrl: ${listing.sourceUrl || listing.url || 'missing'}`);
    console.log(`  canonicalUrl: ${link.canonicalUrl || 'missing'}`);
    console.log(`  availabilityStatus: ${listing.availabilityStatus}`);
    console.log(`  verificationMethod: ${listing.verificationMethod}`);
    console.log(`  dataCompleteness: ${listing.dataCompleteness}`);
    console.log(`  dataQuality: ${listing.dataQuality}`);
    console.log(`  rent: ${listing.rent ?? 'unknown'}`);
    console.log(`  unitArea: ${listing.unitArea ?? listing.area ?? 'unknown'}`);
    console.log(`  gastroSuitability: ${listing.gastroSuitability || 'unknown'}`);
    console.log(`  gastroEvidence: ${listing.gastroEvidence || 'unknown'}`);
    console.log(`  dedupeAction: ${listing.dedupeAction || 'unknown'}`);
    console.log(`  sourceLinkValid: ${link.sourceLinkValid}`);
    console.log(`  usable: ${isUsableCandidate(listing)}`);
    console.log(`  safeForProduction: ${isSafeForProduction(listing)}`);
    console.log(`  reason: ${listing.reason || listing.rawSourceData?.enrichmentStatus || 'n/a'}`);
  }
}

function validationRecord(listing) {
  const link = validateSourceLink(listing);
  const issues = validationIssues(listing);
  return {
    externalId: listing.externalId || listing.id,
    source: listing.sourceName || listing.source || null,
    url: listing.sourceUrl || listing.url || null,
    canonicalUrl: link.canonicalUrl,
    previousStatus: listing.previousAvailabilityStatus || null,
    proposedStatus: listing.availabilityStatus || 'unknown',
    reason: listing.reason || listing.rawSourceData?.enrichmentStatus || null,
    httpState: listing.rawSourceData?.httpStatus || listing.rawSourceData?.enrichmentStatus || null,
    finalUrl: listing.finalUrl || listing.rawSourceData?.verificationFinalUrl || listing.rawSourceData?.finalUrl || null,
    directListingConfirmed: listing.listingType === 'direct_listing' && link.sourceLinkValid && isUsableCandidate(listing),
    sourceLinkValid: link.sourceLinkValid,
    issues,
    dataCompleteness: listing.dataCompleteness ?? calculateDataCompleteness(listing).dataCompleteness,
    dataQuality: listing.dataQuality ?? calculateDataCompleteness(listing).dataQuality,
    lastVerifiedAt: listing.lastVerifiedAt || null,
    safeForProduction: isSafeForProduction(listing),
    listingType: listing.listingType,
    rent: listing.rent ?? null,
    unitArea: listing.unitArea ?? null,
    gastroSuitability: listing.gastroSuitability || 'unknown',
    verificationMethod: listing.verificationMethod || null,
    dedupeAction: listing.dedupeAction || null
  };
}

function enforceStrictProductionStatus(listing) {
  if (listing.listingType === 'direct_listing' && listing.availabilityStatus === 'active' && !isUsableCandidate(listing)) {
    const issues = validationIssues(listing);
    return {
      ...listing,
      availabilityStatus: 'unknown',
      verificationMethod: 'insufficient-production-evidence',
      reason: issues.length ? issues.join('; ') : 'active evidence is insufficient for production use'
    };
  }

  return listing;
}

async function writeValidationReport({ sourceResults, listings, counts, qualityCounts, validationCounts, skipped, discoveredCount, now }) {
  const report = {
    generatedAt: now,
    dryRunSafe: true,
    counts: {
      discovered: discoveredCount,
      ...counts,
      complete: qualityCounts.complete,
      partial: qualityCounts.partial,
      minimal: qualityCounts.minimal,
      usableDirectListings: validationCounts.usableDirectListings,
      activeButNotUsable: validationCounts.activeButNotUsable,
      validDirectUrls: validationCounts.validDirectUrls,
      missingUrls: validationCounts.missingUrls,
      invalidUrls: validationCounts.invalidUrls,
      searchUrlsRejected: validationCounts.searchUrlsRejected,
      safeForProduction: validationCounts.safeForProduction,
      skippedDuplicates: skipped.length
    },
    blockedSources: sourceResults.flatMap((result) => result.errors.map((error) => ({
      source: result.source,
      sourceUrl: error.sourceUrl,
      message: error.message
    }))),
    listings: listings.map(validationRecord),
    skippedDuplicates: skipped
  };

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return REPORT_PATH;
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const selected = args.source ? [args.source] : Object.keys(SOURCES);
  const unknownSource = selected.find((name) => !SOURCES[name]);
  if (unknownSource) throw new Error(`Unknown source: ${unknownSource}`);

  const now = new Date().toISOString();
  const sourceResults = [];

  for (const sourceName of selected) {
    try {
      const result = await SOURCES[sourceName].discover({ fetchPage, now });
      sourceResults.push({
        source: result.source || sourceName,
        candidates: result.candidates || [],
        errors: result.errors || []
      });
    } catch (error) {
      sourceResults.push({
        source: sourceName,
        candidates: [],
        errors: [{ sourceUrl: sourceName, message: error.message }]
      });
    }
  }

  const normalized = sourceResults
    .flatMap((result) => result.candidates)
    .map((candidate) => normalizeListing(candidate, now))
    .filter(Boolean);
  const enriched = await enrichListings(normalized, { fetchPage });

  let existingRows = [];
  try {
    existingRows = await fetchExistingRows();
  } catch (error) {
    console.log(`existingRows: unavailable (${error.message})`);
  }

  const { listings: deduped, skipped } = deduplicateListings(enriched, existingRows);
  const verifiedRaw = args.skipVerification ? deduped : await verifyListings(deduped, now);
  const verified = verifiedRaw.map((listing) => enforceStrictProductionStatus({
    ...listing,
    ...calculateDataCompleteness(listing)
  }));
  const counts = summarize(verified);
  const qualityCounts = summarizeDataQuality(verified);
  const validationCounts = summarizeValidation(verified);
  const productionReady = verified.filter(isSafeForProduction);

  printSourceSummary(sourceResults);
  console.log('\nsummary');
  console.log(`  discovered: ${normalized.length}`);
  console.log(`  new: ${verified.filter((listing) => listing.dedupeAction === 'new').length}`);
  console.log(`  updated: ${verified.filter((listing) => listing.dedupeAction === 'updated').length}`);
  console.log(`  skipped_duplicates: ${skipped.length}`);
  console.log(`  active: ${counts.active}`);
  console.log(`  dead: ${counts.dead}`);
  console.log(`  unknown: ${counts.unknown}`);
  console.log(`  search_only: ${counts.search_only}`);
  console.log(`  lead: ${counts.lead}`);
  console.log(`  complete: ${qualityCounts.complete}`);
  console.log(`  partial: ${qualityCounts.partial}`);
  console.log(`  minimal: ${qualityCounts.minimal}`);
  console.log(`  usable_direct_listings: ${validationCounts.usableDirectListings}`);
  console.log(`  active_but_not_usable: ${validationCounts.activeButNotUsable}`);
  console.log(`  valid_direct_urls: ${validationCounts.validDirectUrls}`);
  console.log(`  missing_urls: ${validationCounts.missingUrls}`);
  console.log(`  invalid_urls: ${validationCounts.invalidUrls}`);
  console.log(`  search_urls_rejected: ${validationCounts.searchUrlsRejected}`);
  console.log(`  safe_for_production: ${validationCounts.safeForProduction}`);

  console.log('\npreview');
  printListingPreview(verified);
  if (args.validationReport) {
    printValidationReport(verified);
    const reportPath = await writeValidationReport({
      sourceResults,
      listings: verified,
      counts,
      qualityCounts,
      validationCounts,
      skipped,
      discoveredCount: normalized.length,
      now
    });
    console.log(`\nvalidation_report: ${reportPath}`);
  }

  if (args.dryRun) {
    console.log('\ndry-run: no Supabase writes performed');
    return { sourceResults, listings: verified, counts, upserted: [] };
  }

  const upserted = await upsertListings(productionReady);
  console.log(`\nupserted: ${upserted.length}`);
  return { sourceResults, listings: verified, counts, upserted };
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  run,
  summarize
};

#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const { deduplicateListings } = require('./deduplicate-listings');
const { calculateDataCompleteness, summarizeDataQuality } = require('./data-completeness');
const { enrichListings } = require('./enrich-listing');
const { mapExistingRow } = require('./merge-existing-listing');
const { normalizeListing } = require('./normalize-listing');
const { fetchExistingRows, upsertListings } = require('./supabase-upsert');
const { calculateBusinessFit, withBusinessFit } = require('./business-fit');
const {
  isSafeForProduction,
  isVisibleCandidate,
  isVisibleLead,
  isUsableCandidate,
  summarizeValidation,
  validateSourceLink,
  validationIssues
} = require('./listing-validation');
const { calculateProjectRelevance } = require('./project-relevance');
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
  const production = argv.includes('--production');
  return {
    dryRun: !production,
    production,
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

function summarizeRelevance(listings) {
  const counts = { strong: 0, acceptable: 0, weak: 0, reject: 0 };
  for (const listing of listings) {
    if (listing.listingType !== 'direct_listing') continue;
    const relevance = calculateProjectRelevance(listing);
    counts[relevance.level] += 1;
  }
  return counts;
}

function summarizeBusinessFit(listings) {
  const counts = { ideal: 0, good: 0, conditional: 0, exclude: 0 };
  for (const listing of listings) {
    if (listing.listingType !== 'direct_listing') continue;
    const fit = calculateBusinessFit(listing);
    counts[fit.level] += 1;
  }
  return counts;
}

function summarizeAreaExtraction(listings) {
  const direct = listings.filter((listing) => listing.listingType === 'direct_listing');
  return {
    areaParsed: direct.filter((listing) => listing.unitArea != null && listing.rawSourceData?.areaEvidence).length,
    areaMissing: direct.filter((listing) => listing.unitArea == null || !listing.rawSourceData?.areaEvidence).length
  };
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

function normalizeSourceBucket(source) {
  const value = String(source || 'Unknown');
  const lower = value.toLowerCase();
  if (lower.includes('kleinanzeigen')) return 'Kleinanzeigen';
  if (lower.includes('stadt')) return 'Stadt München';
  if (lower.includes('colliers')) return 'Colliers';
  if (lower.includes('jll')) return 'JLL';
  if (lower.includes('immowelt')) return 'Immowelt';
  if (lower.includes('immoscout')) return 'ImmoScout24';
  if (lower.includes('broker')) return 'Brokers';
  return value;
}

function emptySourceOutcome() {
  return {
    found: 0,
    verifiedActive: 0,
    rejected: 0,
    blocked: 0,
    errors: 0,
    visibleDirectCandidates: 0,
    leads: 0
  };
}

function getSourceOutcome(outcomes, source) {
  const bucket = normalizeSourceBucket(source);
  if (!outcomes[bucket]) outcomes[bucket] = emptySourceOutcome();
  return outcomes[bucket];
}

function isBlockedError(error) {
  return /HTTP (401|403|429)|blocks discovery|blocked|timeout|fetch failed|no individual object URLs/i.test(error.message || '');
}

function summarizeSourceOutcomes(sourceResults, listings) {
  const outcomes = {};

  for (const result of sourceResults) {
    for (const candidate of result.candidates) {
      getSourceOutcome(outcomes, candidate.sourceName || candidate.source || result.source).found += 1;
    }

    const sourceErrors = {};
    for (const error of result.errors) {
      const source = error.source || result.source;
      if (!sourceErrors[source]) sourceErrors[source] = [];
      sourceErrors[source].push(error);
    }

    for (const [source, errors] of Object.entries(sourceErrors)) {
      const outcome = getSourceOutcome(outcomes, source);
      outcome.errors += errors.length;
      outcome.blocked += errors.filter(isBlockedError).length;
    }
  }

  for (const listing of listings) {
    const outcome = getSourceOutcome(outcomes, listing.sourceName || listing.source);
    if (listing.availabilityStatus === 'active') outcome.verifiedActive += 1;
    if (isVisibleCandidate(listing)) outcome.visibleDirectCandidates += 1;
    if (isVisibleLead(listing)) outcome.leads += 1;

    const relevance = calculateProjectRelevance(listing);
    const businessFit = calculateBusinessFit(listing);
    if (
      listing.listingType === 'direct_listing' &&
      (listing.availabilityStatus !== 'active' ||
        relevance.level === 'reject' ||
        businessFit.level === 'exclude' ||
        !validateSourceLink(listing).sourceLinkValid)
    ) {
      outcome.rejected += 1;
    }
  }

  return outcomes;
}

function printSourceOutcomes(outcomes) {
  console.log('\nsource outcomes');
  for (const [source, outcome] of Object.entries(outcomes)) {
    console.log(
      `  ${source}: found ${outcome.found}, verified_active ${outcome.verifiedActive}, rejected ${outcome.rejected}, blocked ${outcome.blocked}, errors ${outcome.errors}, visible_direct ${outcome.visibleDirectCandidates}, leads ${outcome.leads}`
    );
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
    const relevance = calculateProjectRelevance(listing);
    console.log(`  relevanceLevel: ${relevance.level}`);
    console.log(`  relevanceReasons: ${relevance.reasons.join('; ')}`);
    const businessFit = calculateBusinessFit(listing);
    console.log(`  businessFit: ${businessFit.level}`);
    console.log(`  businessFitReasons: ${businessFit.reasons.join('; ')}`);
    console.log(`  sourceQuality: ${listing.sourceQuality || 'unknown'}`);
    console.log(`  usable: ${isUsableCandidate(listing)}`);
    console.log(`  safeForProduction: ${isSafeForProduction(listing)}`);
    console.log(`  visibleCandidate: ${isVisibleCandidate(listing)}`);
    console.log(`  reason: ${listing.reason || listing.rawSourceData?.enrichmentStatus || 'n/a'}`);
  }
}

function validationRecord(listing) {
  const link = validateSourceLink(listing);
  const issues = validationIssues(listing);
  const relevance = calculateProjectRelevance(listing);
  const businessFit = calculateBusinessFit(listing);
  return {
    externalId: listing.externalId || listing.id,
    source: listing.sourceName || listing.source || null,
    url: listing.sourceUrl || listing.url || null,
    title: listing.title || null,
    location: listing.address || listing.district || null,
    verifiedSummary: listing.verifiedSummary || null,
    nextAction: listing.nextAction || null,
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
    rentEvidence: listing.rawSourceData?.rentEvidence || null,
    rentConfidence: listing.rawSourceData?.rentConfidence || (listing.rent == null ? 'low' : 'medium'),
    areaEvidence: listing.rawSourceData?.areaEvidence || null,
    areaType: listing.rawSourceData?.areaType || null,
    projectRelevance: relevance.level,
    relevanceReasons: relevance.reasons,
    businessFit: businessFit.level,
    businessFitReasons: businessFit.reasons,
    sourceQuality: listing.sourceQuality || listing.rawSourceData?.sourceQuality || null,
    lastVerifiedAt: listing.lastVerifiedAt || null,
    safeForProduction: isSafeForProduction(listing),
    visibleCandidate: isVisibleCandidate(listing),
    listingType: listing.listingType,
    rent: listing.rent ?? null,
    unitArea: listing.unitArea ?? null,
    gastroSuitability: listing.gastroSuitability || 'unknown',
    gastroEvidence: listing.gastroEvidence || null,
    verificationMethod: listing.verificationMethod || null,
    dedupeAction: listing.dedupeAction || null
  };
}

function existingCleanupActions(existingRows) {
  return existingRows
    .map(mapExistingRow)
    .filter((listing) => listing.listingType === 'direct_listing' && listing.availabilityStatus === 'active')
    .filter((listing) => !validateSourceLink(listing).sourceLinkValid)
    .map((listing) => ({
      ...listing,
      availabilityStatus: 'unknown',
      previousAvailabilityStatus: listing.availabilityStatus,
      verificationMethod: 'production-cleanup-invalid-source-url',
      reason: 'active direct listing cannot remain active without a valid direct source URL',
      lastVerifiedAt: null,
      dedupeAction: 'cleanup'
    }));
}

async function writeValidationReport({ sourceResults, listings, cleanupActions, counts, qualityCounts, validationCounts, relevanceCounts, businessFitCounts, areaCounts, sourceOutcomes, skipped, discoveredCount, now }) {
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
      visibleCandidates: validationCounts.visibleCandidates,
      visibleLeads: validationCounts.visibleLeads,
      strong: relevanceCounts.strong,
      acceptable: relevanceCounts.acceptable,
      weak: relevanceCounts.weak,
      reject: relevanceCounts.reject,
      businessFitIdeal: businessFitCounts.ideal,
      businessFitGood: businessFitCounts.good,
      businessFitConditional: businessFitCounts.conditional,
      businessFitExclude: businessFitCounts.exclude,
      areaParsed: areaCounts.areaParsed,
      areaMissing: areaCounts.areaMissing,
      skippedDuplicates: skipped.length
    },
    blockedSources: sourceResults.flatMap((result) => result.errors.map((error) => ({
      source: result.source,
      sourceUrl: error.sourceUrl,
      message: error.message
    }))),
    sourceOutcomes,
    listings: listings.map(validationRecord),
    cleanupActions: cleanupActions.map(validationRecord),
    skippedDuplicates: skipped
  };

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return REPORT_PATH;
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.production && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('--production requires SUPABASE_SERVICE_ROLE_KEY; dry-run is the default safe mode.');
  }
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
  const cleanupActions = existingCleanupActions(existingRows).map((listing) => ({
    ...listing,
    ...calculateDataCompleteness(listing)
  }));
  const verifiedRaw = args.skipVerification ? deduped : await verifyListings(deduped, now);
  const verified = verifiedRaw.map((listing) => withBusinessFit({
    ...listing,
    ...calculateDataCompleteness(listing)
  }));
  const counts = summarize(verified);
  const qualityCounts = summarizeDataQuality(verified);
  const validationCounts = summarizeValidation(verified);
  const relevanceCounts = summarizeRelevance(verified);
  const businessFitCounts = summarizeBusinessFit(verified);
  const areaCounts = summarizeAreaExtraction(verified);
  const sourceOutcomes = summarizeSourceOutcomes(sourceResults, verified);
  const productionReady = [...verified.filter(isSafeForProduction), ...cleanupActions];

  printSourceSummary(sourceResults);
  printSourceOutcomes(sourceOutcomes);
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
  console.log(`  visible_candidates: ${validationCounts.visibleCandidates}`);
  console.log(`  visible_leads: ${validationCounts.visibleLeads}`);
  console.log(`  strong: ${relevanceCounts.strong}`);
  console.log(`  acceptable: ${relevanceCounts.acceptable}`);
  console.log(`  weak: ${relevanceCounts.weak}`);
  console.log(`  reject: ${relevanceCounts.reject}`);
  console.log(`  business_fit_ideal: ${businessFitCounts.ideal}`);
  console.log(`  business_fit_good: ${businessFitCounts.good}`);
  console.log(`  business_fit_conditional: ${businessFitCounts.conditional}`);
  console.log(`  business_fit_exclude: ${businessFitCounts.exclude}`);
  console.log(`  area_parsed: ${areaCounts.areaParsed}`);
  console.log(`  area_missing: ${areaCounts.areaMissing}`);
  console.log(`  cleanup_actions: ${cleanupActions.length}`);

  console.log('\npreview');
  printListingPreview(verified);
  if (args.validationReport) {
    printValidationReport(verified);
    const reportPath = await writeValidationReport({
      sourceResults,
      listings: verified,
      cleanupActions,
      counts,
      qualityCounts,
      validationCounts,
      relevanceCounts,
      businessFitCounts,
      areaCounts,
      sourceOutcomes,
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

  console.log('\nproduction mode');
  console.log(`  rows_before: ${existingRows.length}`);
  console.log(`  safe_rows_to_upsert: ${productionReady.length}`);
  console.log(`  cleanup_actions: ${cleanupActions.length}`);
  const upserted = await upsertListings(productionReady);
  console.log(`\nupserted: ${upserted.length}`);
  console.log(`  rows_after_estimate: ${existingRows.length + verified.filter((listing) => listing.dedupeAction === 'new').length}`);
  return { sourceResults, listings: verified, cleanupActions, counts, upserted };
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

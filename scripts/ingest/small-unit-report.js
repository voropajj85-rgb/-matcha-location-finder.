#!/usr/bin/env node
// Reproducible Phase 3C.3 review artifact; reads dry-run reports only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const reportPath = process.argv[2] || path.join(__dirname, 'reports/latest-validation.json');
const outputPath = process.argv[3] || path.join(__dirname, '../../docs/phase3c3.md');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'reports/phase3c3-baseline.json'), 'utf8'));
assert.equal(report.dryRunSafe, true, 'Only dry-run evidence belongs in this report');
assert.ok(report.small_unit_funnel && report.small_source_tests);
const funnel = report.small_unit_funnel;
const targets = report.listings.filter((row) => row.smallUnitMetrics.area_25_60);
const oldIds = new Set(baseline.target_listings.map((row) => row.externalId));
const newIds = new Set(targets.map((row) => row.externalId));
const gained = targets.filter((row) => !oldIds.has(row.externalId));
const lost = baseline.target_listings.filter((row) => !newIds.has(row.externalId));
const stable = targets.filter((row) => oldIds.has(row.externalId));
assert.equal(stable.length + gained.length, targets.length);
assert.equal(baseline.area_25_60 + gained.length - lost.length, targets.length);
const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const table = (headers, rows) => [headers, headers.map(() => '---'), ...rows]
  .map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n');
const rent = (row) => row.rent != null ? `€${row.rent}/month` : row.priceStatus === 'request' ? 'On request' : 'Unknown';
const sources = Object.entries(funnel.by_source).filter(([, row]) => row.verified_direct > 0);
const candidateOrder = (a, b) => Number(a.temporaryTenancy) - Number(b.temporaryTenancy)
  || Number(b.visibleCandidate) - Number(a.visibleCandidate) || Number(b.rent != null) - Number(a.rent != null);
const lines = [
  '# Phase 3C.3 — Small Unit Source Expansion', '',
  `Dry-run generated: ${report.generatedAt}. Baseline: ${baseline.generated_at}, merged main ${baseline.baseline_sha}.`, '',
  `Verified 25–60 m² listings: **${baseline.area_25_60} → ${funnel.area_25_60}**. ${stable.length} retained, ${gained.length} newly in the target cohort, ${lost.length} no longer in the cohort.`, '',
  `The current target cohort contains **${funnel.by_tenancy.standard_or_unspecified.area_25_60} standard or unspecified-tenancy listings and ${funnel.by_tenancy.temporary.area_25_60} temporary pop-up listings**. Temporary inventory is not evidence of growth in ordinary long-term leases. Best: ${baseline.visible_best} → ${funnel.visible_best}.`, '',
  `Of the ${gained.length} new target-range listings, ${gained.filter((row) => row.temporaryTenancy).length} are temporary and ${gained.filter((row) => !row.temporaryTenancy && row.gastroSuitability === 'no').length} standard/unspecified listings explicitly prohibit gastronomy. ${gained.filter((row) => row.visibleCandidate).length} new target-range listings pass the unchanged Best gates.`, '',
  '## Scope and safeguards', '',
  '- Expanded Kleinanzeigen small-shop, 20/30/40/50/60 qm, kiosk, takeover, successor-tenant, ground-floor, café, tea and bistro searches, plus all existing district combinations. District terms remain discovery hints only.',
  '- Corrected Kleinanzeigen keyword pagination to the public /seite:2/term/k... route. Duplicate page-one results no longer suppress later small-unit pages. Explicit Nachmieter-gesucht offers are discoverable without admitting shop-wanted ads.',
  '- Added Emslander and RaumForm33 public catalog adapters with exact host/path and same-object redirect checks. Only 20–60 m² units are emitted; an explicit total above 60 m² is excluded even when a smaller room is mentioned.',
  '- Listing title/location/area must be present on the actual object page. Related offers and generic FAQs are excluded from extraction. Conflicting pop-up object IDs are quarantined.',
  '- Daily, weekly and package prices are not converted to monthly rent. Emslander’s explicit Miete/Monat label uses the existing rent parser. Explicit gastro prohibitions remain prohibitions.',
  '- Existing Best, business-fit, freshness, Munich, lifecycle and Supabase write gates were retained. Market diagnostics recognize retail/pop-up-store wording. No frontend changes, production writes or merge.', '',
  '## Small-unit funnel by source', '',
  'All figures count deduplicated direct listing URLs/IDs, not proven distinct physical premises across sources. Verified requires active verification within 48 hours. Area columns additionally require confirmed Munich commercial Market evidence. “Known/request rent” and “usable use” are independent subsets of 25–60 m², not successive gates. Known/request does not assert rent ≤€3,000, trusted request pricing, or Suitable/Best status. Usable use means extracted commercial/gastro evidence and no explicit gastro prohibition.', '',
  table(['Source', 'Verified', '≤60 m²', '25–60 m²', '25–60 + known/request', '25–60 + usable use', 'Best'],
    [...sources.map(([source, row]) => [source, row.verified_direct, row.area_leq_60, row.area_25_60,
      row.area_25_60_known_or_request_rent, row.area_25_60_usable_commercial_gastro, row.visible_best]),
    ['Total', funnel.verified_direct, funnel.area_leq_60, funnel.area_25_60, funnel.area_25_60_known_or_request_rent,
      funnel.area_25_60_usable_commercial_gastro, funnel.visible_best]]), '',
  '## New sources and routes tested', '',
  report.small_source_tests.method, '',
  'For kept sources, page counts come from the full live catalog scan. Rejected/deferred page counts are the bounded research probe. Rent ≤€3,000 and request-price columns cover pipeline-verified listings of any area. Zero verified means not admitted and verified by this pipeline; it does not claim the source has no inventory.', '',
  table(['Source', 'Decision', 'Pages discovered', 'Verified', '25–60', '≤€3,000 known', 'Request', 'Best'],
    report.small_source_tests.sources.map((row) => [`[${row.source}](${row.evidence_url})`, row.decision,
      row.pages_discovered, row.verified_direct, row.area_25_60, row.rent_leq_3000_known, row.price_on_request, row.visible_best])), '',
  ...report.small_source_tests.sources.map((row) => `- **${row.source}:** ${row.reason} Access: ${row.access_problems.length ? row.access_problems.join('; ') : 'No access problem observed in the scoped probe.'}`), '',
  '## Newly found target-range examples', '',
  'These are verified target-area listings, not a claim that all are viable Matcha Bar candidates. Temporary status, unknown rent and use restrictions are shown explicitly.', '',
  table(['Listing', 'Source', 'm²', 'Monthly rent', 'Tenancy', 'Use evidence', 'Best'],
    [...gained].sort(candidateOrder).map((row) => [`[${row.title}](${row.url})`, row.source, row.unitArea,
      rent(row), row.temporaryTenancy ? 'Temporary pop-up' : 'Standard/unspecified', row.gastroSuitability,
      row.visibleCandidate ? 'Yes' : 'No'])), '',
  '## Baseline overlap and losses', '',
  `Retained IDs: ${stable.map((row) => row.externalId).join(', ') || 'none'}.`, '',
  ...(lost.length ? lost.map((row) => {
    const current = report.listings.find((item) => item.externalId === row.externalId);
    return `- [${row.externalId}](${row.url}): ${current ? `${current.proposedStatus}; current area ${current.unitArea ?? 'unknown'} m²; ${current.reason}` : 'Not rediscovered in this bounded live run.'}`;
  }) : ['No baseline target listing lost.']), '',
  '## Validation', '',
  'Run from the repository root:', '',
  '```sh',
  'node scripts/ingest/tests/ingestion.test.js',
  'node scripts/ingest/tests/phase3b-extraction.test.js',
  'node scripts/ingest/run-ingestion.js --dry-run --validation-report',
  'node scripts/ingest/phase3b-report.js',
  'node scripts/ingest/tests/validation-report.test.js',
  'node scripts/ingest/small-unit-report.js',
  '```', '',
  'The checked-in JSON contains per-listing extraction evidence, district confirmation, URL verification, all source errors, small-unit metrics and source investigation decisions. Live results can change with availability or access conditions.', ''
];
fs.writeFileSync(outputPath, lines.join('\n'));
console.log(`Small-unit report: ${outputPath}`);

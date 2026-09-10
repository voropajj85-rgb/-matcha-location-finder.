const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const report = JSON.parse(fs.readFileSync(process.argv[2]
  || path.join(__dirname, '../reports/latest-validation.json'), 'utf8'));
const funnel = report.market_funnel;
assert.ok(funnel, 'Regenerate the validation report with market diagnostics');
assert.equal(report.dryRunSafe, true);
const sum = (rows, field) => Object.values(rows).reduce((n, row) => n + row[field], 0);
assert.equal(funnel.discovered, report.sourceResults.reduce((n, row) => n + row.found, 0));
assert.equal(funnel.verified_direct, report.listings.filter((row) => row.listingType === 'direct_listing'
  && row.proposedStatus === 'active' && row.sourceLinkValid).length);
assert.equal(funnel.visible_best, report.counts.visibleCandidates);
assert.equal(sum(report.district_coverage.confirmed, 'verified'), funnel.verified_direct);
assert.equal(sum(report.district_coverage.confirmed, 'visible'), funnel.visible_best);
assert.ok(funnel.suitable_parameters <= funnel.market);
assert.ok(funnel.market <= funnel.verified_direct);
assert.ok(funnel.area_25_60 <= funnel.with_area);
for (const metric of ['verified_direct', 'with_area', 'area_25_60', 'rent_leq_3000_known', 'price_on_request',
  'suitable_parameters', 'visible_best', 'market', 'best_outside_suitable']) {
  assert.equal(funnel[metric], report.listings.filter((row) => row.marketClassification.metrics[metric]).length, metric);
  assert.equal(sum(funnel.by_source, metric), funnel[metric], `source reconciliation: ${metric}`);
  assert.equal(sum(funnel.by_confirmed_district, metric), funnel[metric], `district reconciliation: ${metric}`);
  for (const [source, districts] of Object.entries(funnel.by_source_and_confirmed_district)) {
    assert.equal(sum(districts, metric), funnel.by_source[source][metric], `${source}: ${metric}`);
  }
}
for (const [cohort, scope] of Object.entries(funnel.exclusions)) {
  const rows = report.listings.filter((row) => row.listingType === 'direct_listing'
    && (cohort === 'all_direct' || row.marketClassification.metrics.verified_direct));
  for (const stage of ['suitable', 'best']) {
    assert.equal(scope[stage].excluded, rows.filter((row) => !row.marketClassification[stage]).length);
    assert.equal(Object.values(scope[stage].primary).reduce((a, b) => a + b, 0), scope[stage].excluded);
    for (const breakdown of ['by_source', 'by_confirmed_district']) {
      assert.equal(Object.values(scope[breakdown]).reduce((n, row) => n + row[stage].excluded, 0), scope[stage].excluded);
    }
  }
}
for (const [group, ids] of Object.entries(funnel.groups)) {
  assert.equal(new Set(ids).size, ids.length, `${group} contains duplicate IDs`);
  assert.equal(ids.length, report.listings.filter((row) => row.marketClassification[group]).length);
}
for (const row of report.listings.filter((item) => item.source === 'Kleinanzeigen')) {
  if (!['unknown', 'München unspecified'].includes(row.confirmedDistrict)) {
    assert.ok(row.districtEvidence?.raw, `${row.externalId}: district requires page evidence`);
    assert.equal(row.district, row.districtEvidence.value);
    assert.ok(row.districtEvidence.raw.includes(row.districtEvidence.value));
  }
}
for (const hint of Object.values(report.district_coverage.discovery_search_hints)) {
  assert.equal(hint.verified, undefined, 'Search hints must not count as verified districts');
}
console.log('Validation report reconciliation passed.');
const small = report.small_unit_funnel;
assert.ok(small, 'Regenerate the report with small-unit diagnostics');
for (const metric of Object.keys(report.listings[0].smallUnitMetrics)) {
  assert.equal(small[metric], report.listings.filter((row) => row.smallUnitMetrics[metric]).length, metric);
  assert.equal(sum(small.by_source, metric), small[metric], `small source reconciliation: ${metric}`);
  assert.equal(sum(small.by_tenancy, metric), small[metric], `tenancy reconciliation: ${metric}`);
}
assert.ok(small.area_25_60 <= small.area_leq_60);
assert.ok(small.area_leq_60 <= small.verified_direct);
assert.ok(small.area_25_60_known_or_request_rent <= small.area_25_60);
assert.ok(small.area_25_60_usable_commercial_gastro <= small.area_25_60);
for (const row of report.listings.filter((item) => item.source === 'RaumForm33')) {
  assert.equal(row.temporaryTenancy, true);
  assert.equal(row.rent, null, 'Pop-up day/week/package prices must not become monthly rents');
}
console.log('Small-unit funnel reconciliation passed.');
assert.ok(report.small_source_tests?.sources.length);
for (const source of report.small_source_tests.sources) {
  const rows = report.listings.filter((row) => row.source === source.source);
  for (const metric of ['verified_direct', 'area_25_60', 'visible_best']) {
    assert.equal(source[metric], rows.filter((row) => row.smallUnitMetrics[metric]).length, `${source.source}: ${metric}`);
  }
  assert.ok(source.rent_leq_3000_known <= source.verified_direct);
  assert.ok(source.price_on_request <= source.verified_direct);
  assert.ok(Array.isArray(source.access_problems));
}
console.log('New-source investigation counts reconciled.');

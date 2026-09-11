const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { classifyMarketListing } = require('../ingest/market-funnel');
const { isVisibleCandidate } = require('../ingest/listing-validation');
const { report, listings, edgeCases, databaseRows } = require('./ui-fixtures');
const load = (name) => import(pathToFileURL(path.resolve(__dirname, '../../js', name)).href);
(async () => {
  execFileSync(process.execPath, ['scripts/build-ui-policy.js', '--check'], { stdio: 'inherit' });
  const policy = await load('generated/market-policy.js');
  const ui = await load('inventory.js');
  const { mapDatabaseListing } = await load('data/listings-mapper.js');
  const { buildDecisionCard, buildDecisionDetail } = await load('decision-cards.js');
  const now = report.generatedAt;
  // Every branch of the browser policy must agree with the unmodified backend.
  const variants = edgeCases().concat(listings);
  for (const listing of variants) {
    assert.deepEqual(policy.classifyMarketListing(listing, now), classifyMarketListing(listing, now), listing.id);
  }
  const mapped = databaseRows(listings).map(mapDatabaseListing);
  const rows = ui.classifyInventory(mapped, now);
  for (const row of rows) {
    assert.equal(row.best, isVisibleCandidate(row.listing), `Best parity: ${row.listing.id}`);
    assert.equal(row.suitable, classifyMarketListing(row.listing, now).suitable);
  }
  const totals = ui.inventoryCounts(rows);
  assert.equal(totals.best, report.market_funnel.visible_best, 'Persisted fields preserve report Best count');
  assert.equal(totals.suitable, report.market_funnel.suitable_parameters);
  assert.equal(totals.market, report.market_funnel.market);
  for (const group of ui.GROUPS) {
    assert.equal(ui.selectInventory(rows, group, ui.emptyFilters()).length, totals[group]);
  }
  const edge = ui.classifyInventory(databaseRows(edgeCases()).map(mapDatabaseListing), now);
  const byId = Object.fromEntries(edge.map((row) => [row.listing.id, row]));
  assert.equal(byId['test-small'].district, 'Laim', 'Pasing query cannot override physical Laim');
  assert.equal(byId['test-unknown'].district, ui.UNKNOWN_DISTRICT, 'Bare query district is never physical evidence');
  for (const id of ['test-large', 'test-unknown', 'test-prohibited', 'test-temporary', 'test-long']) {
    assert.equal(byId[id].market, true, `${id} remains in broad Market`);
    assert.equal(byId[id].suitable, false);
  }
  for (const id of ['test-stale', 'test-invalid']) for (const group of ui.GROUPS) assert.equal(byId[id][group], false);
  assert.equal(byId['test-prohibited'].best, false);
  assert.equal(isVisibleCandidate(byId['test-stale'].listing), true, 'Freshness remains separate from backend Best parameter gates');
  assert.equal(byId['test-stale'].best, false, 'Existing 48-hour frontend freshness gate remains enforced');
  assert.match(buildDecisionCard(byId['test-large']), /Nicht Suitable: 138 m²/);
  assert.match(buildDecisionCard(byId['test-prohibited']), /Nicht erlaubt/);
  assert.match(buildDecisionCard(byId['test-prohibited']), /Gastronomie ist nicht erlaubt/);
  assert.match(buildDecisionCard(byId['test-unknown']), /Miete nicht bestätigt/);
  assert.match(buildDecisionCard(byId['test-temporary']), /Temporär · Pop-up/);
  assert.match(buildDecisionDetail(byId['test-temporary']), /Keine bestätigte langfristige Mietoption/);
  assert.match(buildDecisionCard(byId['test-long']), /<dd>Nicht bestätigt<\/dd>/);
  const request = rows.find((row) => row.suitable && row.listing.rent == null);
  assert.ok(request, 'Trusted request-rent example exists');
  assert.match(buildDecisionCard(request), /Budget noch offen/);
  assert.doesNotMatch(buildDecisionCard(request), /Budget passen/);
  const unknown = mapDatabaseListing({ rent: null, price: 42 });
  assert.equal(unknown.rent, null, 'Explicit unknown rent must not fall back to legacy price');
  assert.equal(ui.rentLabel(unknown), 'Nicht bestätigt');
  assert.equal(ui.rentLabel({ rent: 30, rentType: 'per_sqm' }), 'Nicht bestätigt');
  assert.equal(ui.rentLabel({ rent: 2200, rawSourceData: { rentConfidence: 'low' } }), 'Nicht bestätigt');
  const filters = { ...ui.emptyFilters(), district: 'Laim', minArea: '25', maxArea: '60', maxRent: '3000', gastro: 'possible', source: 'Kleinanzeigen' };
  assert.deepEqual(ui.selectInventory(edge, 'market', filters).map((row) => row.listing.id), ['test-small']);
  assert.equal(ui.selectInventory(edge, 'market', ui.emptyFilters()).length, 6, 'Reset restores broad inventory');
  assert.equal(ui.selectInventory(edge, 'market', { ...ui.emptyFilters(), district: ui.UNKNOWN_DISTRICT }).length, 1);
  assert.equal(ui.classifyInventory([mapped[0], mapped[0]], now).length, 1, 'Duplicate IDs cannot inflate counts');
  const malicious = { ...byId['test-small'], listing: { ...byId['test-small'].listing, title: '<img src=x onerror=alert(1)>' } };
  assert.doesNotMatch(buildDecisionCard(malicious), /<img/);
  assert.match(buildDecisionCard(malicious), /&lt;img/);
  assert.match(buildDecisionCard(byId['test-small']), /target="_blank" rel="noopener noreferrer"/);
  console.log(`Frontend policy, mapper, counts, filters and decision cards passed (${rows.length} report rows; ${JSON.stringify(totals)}).`);
})().catch((error) => { console.error(error); process.exitCode = 1; });

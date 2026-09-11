// Test-only reconstruction of the checked-in dry-run report. Never imported by the app.
const report = require('../ingest/reports/latest-validation.json');
const { rowForListing } = require('../ingest/supabase-upsert');
function reportListing(row) {
  return { ...row, id: row.externalId, sourceName: row.source, sourceUrl: row.url,
    address: row.location, availabilityStatus: row.proposedStatus,
    rawSourceData: { ...row.rawSourceData, rawDescription: row.rawDescription,
      rentConfidence: row.rentConfidence, rentEvidence: row.rentEvidence,
      priceStatus: row.priceStatus, districtEvidence: row.districtEvidence,
      outsideMunich: row.outsideMunich, sourceQuality: row.sourceQuality,
      temporaryTenancy: row.temporaryTenancy } };
}
const listings = report.listings.map(reportListing);
function edgeCases() {
  // Deliberately synthetic regression inputs, isolated from live UI/runtime inventory.
  const base = listings.find((row) => row.marketClassification.suitable && row.source === 'Kleinanzeigen');
  function make(id, changes = {}) {
    return { ...base, id, externalId: id, title: 'TEST Ladenfläche für Café in München',
      district: 'Pasing', address: '80687 München - Laim', unitArea: 42, rent: 2300,
      gastroSuitability: 'possible', ...changes,
      rawSourceData: { rawDescription: 'Ladenfläche mit Schaufenster, Café möglich.', rentConfidence: 'high',
        searchDistrict: 'Pasing', ...changes.rawSourceData } };
  }
  return [make('test-small'), make('test-large', { unitArea: 138 }),
    make('test-unknown', { rent: null, gastroSuitability: 'unknown', address: 'München' }),
    make('test-prohibited', { gastroSuitability: 'no', gastroEvidence: 'Gastronomie nicht erlaubt' }),
    make('test-temporary', { rent: null, rawSourceData: { temporaryTenancy: true } }),
    make('test-stale', { lastVerifiedAt: '2020-01-01T00:00:00Z' }),
    make('test-invalid', { sourceUrl: 'javascript:alert(1)' }),
    make('test-long', { title: 'TEST Sehr lange Ladenflächenbeschreibung '.repeat(9), unitArea: null })];
}
module.exports = { report, listings, edgeCases, databaseRows: (items) => items.map(rowForListing) };

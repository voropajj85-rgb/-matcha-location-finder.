const assert = require('node:assert/strict');
const { sourceForUrl, parseSmallSourcePage, SOURCES } = require('../small-source-pages');
const { discover } = require('../sources/small-local');
const ka = require('../sources/kleinanzeigen');
const { normalizeListing } = require('../normalize-listing');
const { enrichListing } = require('../enrich-listing');
const { classifyHtml } = require('../../check-listings');
const { smallUnitMetrics, summarizeSmallUnitFunnel } = require('../small-unit-funnel');

async function runSmallUnitTests() {
  const now = '2026-09-10T14:00:00.000Z';
  const ems = 'https://www.emslander-co.de/objekte/charmanter-laden/';
  const popup = 'https://raumform33.de/pop-up-store/pop-up-mieten-muenchen/store-id-176/';
  const emsHtml = '<h1>Charmanter Laden</h1><p>Gesamtfläche 50m² Miete/Monat 1.680€ Ladenfläche zur Miete in München-Haidhausen. Eine gastronomische Nutzung ist nicht möglich.</p>'
    + '<h2>Weitere Immobilien</h2><h3>VERMIETET Laden 30m² München</h3>';
  const popupHtml = '<h1>Pop Up Store Fläche</h1><p>München, Innenstadt (Location ID 176) 25 m² große Verkaufsfläche mit 30 m² Lager. Preis pro Tag 577 EUR, pro Woche 2.310 EUR.</p>'
    + '<h2>Jetzt unverbindlich anfragen</h2><p>FAQs: Gastronomie möglich. Monatsmiete 900 €. Preis auf Anfrage.</p>';
  assert.equal(sourceForUrl(ems)?.name, 'Emslander');
  for (const url of [ems.replace('www.emslander-co.de', 'www.emslander-co.de.evil.example'), ems + '?object=other',
    ems.replace('https://', 'https://user:pass@'), SOURCES[0].catalog, SOURCES[1].catalog]) assert.equal(sourceForUrl(url), null);

  const parsed = parseSmallSourcePage(ems, emsHtml);
  assert.equal(parsed.unitArea, 50);
  assert.equal(parsed.rent, 1680);
  assert.equal(parsed.district, 'Haidhausen');
  assert.equal(parsed.gastroSuitability, 'no');
  assert.match(parsed.verifiedSummary, /50 m².*1680 €.*nicht gestattet/);
  assert.equal(parsed.rawSourceData.explicitDead, false, 'Related sold objects must not kill the current object');
  const temp = parseSmallSourcePage(popup, popupHtml);
  assert.equal(temp.unitArea, 25, 'Adjacent storage must not replace the sales area');
  assert.match(temp.verifiedSummary, /^25 m²/);
  assert.doesNotMatch(temp.verifiedSummary, /30 m²|577|2\.310/);
  assert.equal(temp.rent, null, 'Never convert daily/weekly prices or related FAQs to monthly rent');
  assert.equal(temp.priceStatus, null, 'Generic request-price FAQ is not object evidence');
  assert.equal(temp.rawSourceData.temporaryTenancy, true);
  assert.equal(parseSmallSourcePage(popup, popupHtml.replace('München, Innenstadt (Location ID 176)', 'Dachau (Location ID 176)')), null);
  assert.equal(parseSmallSourcePage(ems, emsHtml.replace('Charmanter Laden', 'Bürofläche')), null, 'Nearby shops do not make an office a retail offer');
  const active = normalizeListing(parsed, now);
  const checked = classifyHtml(active, { status: 200, ok: true }, emsHtml, ems, now);
  const finalized = require('../run-ingestion').finalizeListing(checked);
  assert.match(finalized.verifiedSummary, /Gastronomische Nutzung nicht gestattet/);
  assert.match(finalized.nextAction, /explicitly prohibits/);
  assert.equal(checked.availabilityStatus, 'active');
  assert.equal(classifyHtml(active, { status: 403, ok: false }, emsHtml, ems, now).availabilityStatus, 'unknown');
  assert.notEqual(classifyHtml(active, { status: 200, ok: true }, emsHtml, ems.replace('charmanter-laden', 'anderer-laden'), now).availabilityStatus, 'active');
  assert.notEqual(classifyHtml(active, { status: 200, ok: true }, emsHtml, SOURCES[0].catalog, now).availabilityStatus, 'active');
  assert.notEqual(classifyHtml(active, { status: 200, ok: true }, '<h1>Laden</h1><p>München</p>', ems, now).availabilityStatus, 'active');
  assert.equal(classifyHtml(active, { status: 200, ok: true }, emsHtml.replace('Charmanter Laden', 'VERMIETET Charmanter Laden'), ems, now).availabilityStatus, 'dead');
  const refreshed = await enrichListing(normalizeListing(temp, now), { fetchPage: async () => ({ status: 200, finalUrl: popup, body: popupHtml }) });
  assert.equal(refreshed.rent, null);
  assert.equal(refreshed.unitArea, 25);

  const local = await discover({ now, rateLimitMs: 0, fetchPage: async (url) => {
    if (url === SOURCES[0].catalog) return { body: `<a href="${ems}">object</a>` };
    if (url === SOURCES[1].catalog) return { body: `<a href="${popup}">object</a><a href="${popup.replace('176', '999')}">large</a>` };
    return { body: url === ems ? emsHtml : popupHtml.replace('ID 176', url.includes('999') ? 'ID 999' : 'ID 176').replace('25 m²', url.includes('999') ? 'Gesamtfläche 150 qm. 25 m²' : '25 m²') };
  }});
  assert.equal(local.candidates.length, 2, 'A small sales room inside a large total must not inflate discovery');
  assert.equal(local.meta.sources.RaumForm33.excludedLargeOrMissingArea, 1);
  assert.equal(parseSmallSourcePage(popup, popupHtml.replace('ID 176', 'ID 145')).rawSourceData.sourceObjectConfirmed, false);

  const metrics = smallUnitMetrics(checked, now);
  assert.equal(metrics.area_25_60, true);
  assert.equal(metrics.area_25_60_known_or_request_rent, true);
  assert.equal(metrics.area_25_60_usable_commercial_gastro, false, 'Explicit gastro prohibition remains visible in diagnostics');
  assert.equal(metrics.visible_best, false);
  assert.equal(smallUnitMetrics({ ...checked, lastVerifiedAt: '2026-09-01T00:00:00.000Z' }, now).verified_direct, false);
  assert.equal(smallUnitMetrics({ ...checked, address: 'Dachau', district: null, rawSourceData: { outsideMunich: true } }, now).area_25_60, false);
  const requested = { ...checked, rent: null, priceStatus: 'request', rawSourceData: { ...checked.rawSourceData, temporaryTenancy: true } };
  assert.equal(smallUnitMetrics(requested, now).area_25_60_known_or_request_rent, true);
  assert.equal(smallUnitMetrics(requested, now).visible_best, false, 'Request-price diagnostic must not relax Best trust gates');
  const summary = summarizeSmallUnitFunnel([local], [checked, requested], now);
  assert.equal(summary.area_25_60, 2);
  assert.equal(summary.by_tenancy.temporary.area_25_60, 1);
  assert.equal(summary.by_source.RaumForm33.verified_direct, 0);

  for (const term of ka.SMALL_UNIT_TERMS) assert.ok(ka.SEARCHES.some((row) => row.term === term));
  assert.equal(ka.smallUnitDiscoveryUrl('https://www.kleinanzeigen.de/s-anzeige/cafe-nachmieter-gesucht/123-277-6411'), true);
  assert.equal(ka.smallUnitDiscoveryUrl('https://www.kleinanzeigen.de/s-anzeige/cafe-gesucht/123-277-6411'), false);
  assert.equal(ka.smallUnitDiscoveryUrl('https://www.kleinanzeigen.de/s-anzeige/buero-nachmieter-gesucht/123-277-6411'), false);
  for (const district of ka.DISTRICTS) assert.ok(ka.SEARCHES.some((row) => row.tier === 'small-unit-district' && row.district === district));
  const url1 = 'https://www.kleinanzeigen.de/s-anzeige/laden-muenchen/123-277-6411';
  const url2 = url1.replace('123-', '456-');
  assert.equal(ka.paginatedUrl('https://www.kleinanzeigen.de/s-muenchen/cafe/k0l6411', 2), 'https://www.kleinanzeigen.de/s-muenchen/seite:2/cafe/k0l6411');
  assert.equal(ka.paginatedUrl('https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/c277l6411', 2), 'https://www.kleinanzeigen.de/s-gewerbeimmobilien/muenchen/seite:2/c277l6411');
  const discoveries = await ka.discover({ now, rateLimitMs: 0, pageLimit: 2,
    searches: [{ url: 'https://www.kleinanzeigen.de/s-muenchen/laden/k0l6411', tier: 'legacy', district: 'München' },
      { url: 'https://www.kleinanzeigen.de/s-muenchen/laden-pasing/k0l6411', tier: 'small-unit-citywide', district: 'Pasing' }],
    fetchPage: async (url) => ({ body: `<a href="${url.includes('seite:2/laden-pasing') ? url2 : url1}">Laden</a>` }) });
  assert.equal(discoveries.candidates.length, 2, 'Duplicate page one must not suppress new small-unit results on page two');
  assert.equal(discoveries.candidates[1].district, null);
  assert.equal(discoveries.candidates[1].rawSourceData.searchDistrict, 'Pasing');
  console.log('Small-unit discovery, extraction, URL and funnel regressions passed.');
}

if (require.main === module) runSmallUnitTests().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { runSmallUnitTests };

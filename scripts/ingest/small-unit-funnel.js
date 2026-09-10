const { classifyMarketListing } = require('./market-funnel');
const { isPriceOnRequest } = require('./project-relevance');
const investigations = require('./small-source-investigations.json');

const FIELDS = ['verified_direct', 'area_leq_60', 'area_25_60',
  'area_25_60_known_or_request_rent', 'area_25_60_usable_commercial_gastro', 'visible_best'];
const empty = () => Object.fromEntries(FIELDS.map((key) => [key, 0]));

function smallUnitMetrics(listing, now) {
  const market = classifyMarketListing(listing, now);
  const age = Date.parse(now) - Date.parse(listing.lastVerifiedAt || '');
  const verified = market.metrics.verified_direct && age >= 0 && age <= 48 * 60 * 60 * 1000;
  const area = listing.unitArea ?? listing.area;
  const small = verified && market.market && Number.isFinite(area) && area >= 25 && area <= 60;
  const known = Number.isFinite(listing.rent) && listing.rent > 0 && listing.rentType !== 'per_sqm'
    && listing.rawSourceData?.rentConfidence !== 'low';
  const request = listing.rent == null && isPriceOnRequest(listing);
  const usableUse = Boolean((['possible', 'confirmed'].includes(listing.gastroSuitability) && listing.gastroEvidence)
    || listing.rawSourceData?.commercialEvidence) && listing.gastroSuitability !== 'no';
  return {
    verified_direct: verified,
    area_leq_60: verified && market.market && Number.isFinite(area) && area > 0 && area <= 60,
    area_25_60: small,
    area_25_60_known_or_request_rent: small && (known || request),
    area_25_60_usable_commercial_gastro: small && usableUse,
    visible_best: verified && market.best
  };
}

function summarizeSmallUnitFunnel(sourceResults, listings, now) {
  const total = empty(), bySource = {}, byTenancy = { temporary: empty(), standard_or_unspecified: empty() };
  for (const result of sourceResults) {
    for (const source of result.meta?.sources ? Object.keys(result.meta.sources) : [result.source]) bySource[source] ||= empty();
  }
  for (const listing of listings) {
    const source = listing.sourceName || listing.source || 'Unknown';
    const tenancy = listing.rawSourceData?.temporaryTenancy ? 'temporary' : 'standard_or_unspecified';
    const buckets = [total, bySource[source] ||= empty(), byTenancy[tenancy]];
    for (const [field, pass] of Object.entries(smallUnitMetrics(listing, now))) {
      if (pass) for (const bucket of buckets) bucket[field] += 1;
    }
  }
  return {
    definitions: {
      cohort: 'Fresh (48h), active verified direct URLs. Area columns additionally require the Munich commercial Market evidence gate.',
      parameters: 'Rent/use columns are independent subsets of 25–60 m², not successive steps. Explicit request rent is diagnostic; existing Best source-trust gates remain unchanged.',
      tenancy: 'Temporary pop-up units are reported separately and must not be presented as growth in standard tenancy supply.',
      visible_best: 'Existing backend Best predicate, additionally fresh; no Best gates changed.'
    }, ...total, by_source: bySource, by_tenancy: byTenancy
  };
}

function summarizeSmallSourceTests(sourceResults, listings, now) {
  return { tested_at: investigations.tested_at, method: investigations.method,
    sources: investigations.sources.map((investigation) => {
      const result = sourceResults.find((row) => row.meta?.sources?.[investigation.source]);
      const meta = result?.meta.sources[investigation.source];
      const rows = listings.filter((row) => (row.sourceName || row.source) === investigation.source);
      const metrics = rows.map((row) => smallUnitMetrics(row, now));
      return { ...investigation,
        pages_discovered: meta?.pagesDiscovered ?? investigation.pages_discovered,
        discovery_details: meta || null,
        verified_direct: metrics.filter((row) => row.verified_direct).length,
        area_25_60: metrics.filter((row) => row.area_25_60).length,
        rent_leq_3000_known: rows.filter((row, i) => metrics[i].verified_direct && classifyMarketListing(row, now).metrics.rent_leq_3000_known).length,
        price_on_request: rows.filter((row, i) => metrics[i].verified_direct && row.rent == null && isPriceOnRequest(row)).length,
        visible_best: metrics.filter((row) => row.visible_best).length,
        access_problems: [...investigation.access_problems, ...(result?.errors || [])
          .filter((error) => error.source === investigation.source).map((error) => `${error.sourceUrl}: ${error.message}`)]
      };
    }) };
}

module.exports = { smallUnitMetrics, summarizeSmallUnitFunnel, summarizeSmallSourceTests };

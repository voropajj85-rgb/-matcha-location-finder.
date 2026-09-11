const { isVisibleCandidate, isUsableCandidate, validateSourceLink, validationIssues } = require('./listing-validation');
const { calculateProjectRelevance, isPriceOnRequest, isTrustedPriceOnRequestSource } = require('./project-relevance');
const { calculateBusinessFit } = require('./business-fit');
const { districtBucket } = require('./district-coverage');
const { isNearbyExcludedLocation } = require('./utils');

const METRICS = ['discovered', 'verified_direct', 'with_area', 'area_25_60', 'rent_leq_3000_known',
  'price_on_request', 'suitable_parameters', 'visible_best'];
const REASONS = ['> 60 m²', '<25 m²', 'rent >3000', 'rent missing', 'gastro/use uncertainty',
  'missing area', 'weak business fit', 'stale / invalid URL'];
const emptyCounts = () => Object.fromEntries([...METRICS, 'market', 'best_outside_suitable'].map((key) => [key, 0]));
const emptyReasons = () => Object.fromEntries(REASONS.map((key) => [key, 0]));
const inc = (counts, key) => { counts[key] = (counts[key] || 0) + 1; };

// Diagnostic policy only: does not change ingestion visibility, production writes or frontend gates.
function classifyMarketListing(listing, now = new Date().toISOString()) {
  const direct = listing.listingType === 'direct_listing';
  const verified = direct && listing.availabilityStatus === 'active' && validateSourceLink(listing).sourceLinkValid;
  const age = Date.parse(now) - Date.parse(listing.lastVerifiedAt || '');
  const fresh = Number.isFinite(age) && age >= 0 && age <= 48 * 60 * 60 * 1000;
  const district = districtBucket(listing);
  const location = [listing.address, listing.location, listing.rawSourceData?.locationEvidence].filter(Boolean).join(' ');
  const outside = Boolean(listing.rawSourceData?.outsideMunich) || isNearbyExcludedLocation(location);
  const munich = !outside && (district !== 'unknown' || /m[uü]nchen|muenchen|munich/i.test(location));
  const text = [listing.title, listing.gastroEvidence, listing.rawSourceData?.rawDescription].filter(Boolean).join(' ');
  const commercial = /laden|gewerbe|einzelhandel|retail|pop.up.store|kiosk|gastronom|caf[eé]|bistro|imbiss|restaurant|verkaufs|büro|b[uü]ro|praxis|lager/i.test(text)
    || /\/\d+-277-\d+(?:[/?#]|$)|\/gewerbeimmobilien\/|\/einzelhandel\//i.test(listing.sourceUrl || listing.url || '');
  const usableData = Boolean(listing.title && (listing.address || listing.rawSourceData?.rawDescription || listing.gastroEvidence));
  const market = verified && fresh && munich && commercial && usableData;
  const area = listing.unitArea ?? listing.area;
  const withArea = Number.isFinite(area) && area > 0;
  const rent = listing.rent;
  const knownRent = Number.isFinite(rent) && rent > 0 && listing.rentType !== 'per_sqm'
    && listing.rawSourceData?.rentConfidence !== 'low';
  const request = rent == null && isPriceOnRequest(listing);
  const trustedRequest = request && isTrustedPriceOnRequestSource(listing);
  const fit = calculateBusinessFit(listing);
  const relevance = calculateProjectRelevance(listing);
  const useFit = ['confirmed', 'possible'].includes(listing.gastroSuitability);
  const suitableReasons = [];
  if (!verified || !fresh) suitableReasons.push('stale / invalid URL');
  if (!munich) suitableReasons.push('outside / unconfirmed München');
  if (!commercial || !usableData) suitableReasons.push('commercial / usable data unconfirmed');
  if (!withArea) suitableReasons.push('missing area');
  else if (area > 60) suitableReasons.push('> 60 m²');
  else if (area < 25) suitableReasons.push('<25 m²');
  if (knownRent && rent > 3000) suitableReasons.push('rent >3000');
  if (!knownRent && !trustedRequest) suitableReasons.push('rent missing');
  if (!useFit) suitableReasons.push('gastro/use uncertainty');
  if (fit.level === 'exclude') suitableReasons.push('weak business fit');
  const suitable = market && suitableReasons.length === 0;
  const best = isVisibleCandidate(listing); // Keep the existing Best gates exactly.
  const bestReasons = [];
  if (!best && direct) {
    if (!verified) bestReasons.push('stale / invalid URL');
    if (relevance.reasons.some((reason) => /outside Munich/.test(reason))) bestReasons.push('outside / unconfirmed München');
    if (!withArea) bestReasons.push('missing area');
    else if (area > 60) bestReasons.push('> 60 m²');
    else if (area < 25) bestReasons.push('<25 m²');
    if (rent > 3000) bestReasons.push('rent >3000');
    if ((rent == null && !trustedRequest) || (rent != null && listing.rawSourceData?.rentConfidence === 'low')) bestReasons.push('rent missing');
    if (listing.gastroSuitability === 'no' || (relevance.level === 'weak' && !useFit)) bestReasons.push('gastro/use uncertainty');
    if (fit.level === 'exclude') bestReasons.push('weak business fit');
    if (!isUsableCandidate(listing) && !bestReasons.length) bestReasons.push('insufficient usable data');
    if (!bestReasons.length) bestReasons.push('weak relevance score');
  }
  return {
    district, market, suitable, best,
    metrics: {
      verified_direct: verified, with_area: verified && withArea,
      area_25_60: verified && withArea && area >= 25 && area <= 60,
      rent_leq_3000_known: verified && knownRent && rent <= 3000,
      price_on_request: verified && request, suitable_parameters: suitable, visible_best: best,
      market, best_outside_suitable: best && !suitable
    },
    suitableReasons: direct && !suitable ? suitableReasons : [], bestReasons,
    reviewFlags: [!useFit && 'gastro/use uncertainty', fit.level === 'conditional' && 'conditional business fit',
      request && !trustedRequest && 'untrusted price on request', trustedRequest && 'budget requires confirmation'].filter(Boolean),
    bestGateDetails: best ? [] : [...validationIssues(listing), ...relevance.reasons, ...fit.reasons]
  };
}

function summarizeMarketFunnel(sourceResults, listings, now, normalizeSource = (source) => source || 'Unknown') {
  const total = emptyCounts();
  const bySource = {};
  const byDistrict = {};
  const bySourceDistrict = {};
  const exclusions = {};
  const groups = { market: [], suitable: [], best: [] };
  const get = (map, key) => map[key] ||= emptyCounts();
  const reasonBucket = () => ({ excluded: 0, reasons: emptyReasons(), primary: {} });
  for (const cohort of ['all_direct', 'verified_direct']) exclusions[cohort] = {
    suitable: reasonBucket(), best: reasonBucket(), by_source: {}, by_confirmed_district: {}
  };
  for (const result of sourceResults) {
    // Keep zero-result sources visible in diagnostics.
    get(bySource, normalizeSource(result.source));
    for (const candidate of result.candidates || []) {
      const source = normalizeSource(candidate.sourceName || candidate.source || result.source);
      inc(total, 'discovered'); inc(get(bySource, source), 'discovered');
      // Join discovery to final physical district by URL, never by search hint.
      const final = listings.find((item) => (item.sourceUrl || item.url) === (candidate.sourceUrl || candidate.url));
      const district = districtBucket(final || candidate);
      inc(get(byDistrict, district), 'discovered');
      inc(get(bySourceDistrict[source] ||= {}, district), 'discovered');
    }
  }
  for (const listing of listings) {
    const source = normalizeSource(listing.sourceName || listing.source);
    const result = classifyMarketListing(listing, now);
    const buckets = [total, get(bySource, source), get(byDistrict, result.district),
      get(bySourceDistrict[source] ||= {}, result.district)];
    for (const [metric, yes] of Object.entries(result.metrics)) if (yes) for (const bucket of buckets) inc(bucket, metric);
    for (const group of Object.keys(groups)) if (result[group]) groups[group].push(listing.externalId || listing.id || listing.sourceUrl);
    if (listing.listingType !== 'direct_listing') continue;
    for (const cohort of ['all_direct', ...(result.metrics.verified_direct ? ['verified_direct'] : [])]) {
      const scope = exclusions[cohort];
      const sourceReasons = scope.by_source[source] ||= { suitable: reasonBucket(), best: reasonBucket() };
      const districtReasons = scope.by_confirmed_district[result.district] ||= { suitable: reasonBucket(), best: reasonBucket() };
      for (const stage of ['suitable', 'best']) {
        const reasons = result[`${stage}Reasons`];
        if (!reasons.length) continue;
        for (const bucket of [scope[stage], sourceReasons[stage], districtReasons[stage]]) {
          bucket.excluded += 1;
          inc(bucket.primary, reasons[0]);
          for (const reason of reasons) inc(bucket.reasons, reason);
        }
      }
    }
  }
  return {
    definitions: {
      discovered: 'Raw discovery candidates including leads and duplicates; downstream counts are deduplicated direct listings.',
      verified_direct: 'Active direct listing with a valid direct URL. Parameter columns are independent subsets of this cohort, not successive steps.',
      market: 'Verified direct, verified within 48 hours, München location/category evidence, commercial use and usable title/location or page data.',
      suitable_parameters: 'Diagnostic Market subset: 25–60 m², positive confirmed monthly rent <=3000 or trusted explicit price-on-request, possible/confirmed use, business fit not exclude. Conditional fit requires review.',
      visible_best: 'Unmodified backend isVisibleCandidate result. Existing Best policy can differ from proposed Suitable; best_outside_suitable exposes this.',
      exclusions: 'Overlapping diagnostic reasons among excluded listings; primary gives an exclusive reconciliation in policy-check order. rent >3000 counts all over-budget excluded rows; the unchanged Best hard ceiling remains 3500, so this signal alone need not block Best. rent missing includes unusable/unconfirmed rent.',
      district: 'Physical district from extracted location evidence; discovery counts joined to final listings. unknown and München unspecified are not confirmed districts.'
    },
    ...total, by_source: bySource, by_confirmed_district: byDistrict,
    by_source_and_confirmed_district: bySourceDistrict, exclusions, groups
  };
}

module.exports = { classifyMarketListing, summarizeMarketFunnel };

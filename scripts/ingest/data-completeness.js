function hasValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function calculateDataCompleteness(listing) {
  let score = 0;
  const reasons = [];

  if (hasValue(listing.title) || hasValue(listing.address) || hasValue(listing.district)) {
    score += 20;
    reasons.push('context');
  }

  if (hasValue(listing.rent)) {
    score += 20;
    reasons.push('rent');
  }

  if (hasValue(listing.unitArea) || hasValue(listing.area)) {
    score += 20;
    reasons.push('unitArea');
  }

  if (
    ['confirmed', 'possible'].includes(listing.gastroSuitability)
    && hasValue(listing.gastroEvidence)
  ) {
    score += 20;
    reasons.push('gastroEvidence');
  }

  if (
    hasValue(listing.verifiedSummary)
    || hasValue(listing.keyFacts)
    || hasValue(listing.nextAction)
    || hasValue(listing.provision?.value)
    || hasValue(listing.abloese?.value)
    || hasValue(listing.kaution?.value)
  ) {
    score += 20;
    reasons.push('facts');
  }

  const dataQuality = score >= 80 ? 'complete' : score >= 40 ? 'partial' : 'minimal';
  return { dataCompleteness: score, dataQuality, dataCompletenessReasons: reasons };
}

function summarizeDataQuality(listings) {
  const counts = { complete: 0, partial: 0, minimal: 0 };
  for (const listing of listings) {
    const quality = listing.dataQuality || calculateDataCompleteness(listing).dataQuality;
    counts[quality] += 1;
  }
  return counts;
}

module.exports = {
  calculateDataCompleteness,
  summarizeDataQuality
};

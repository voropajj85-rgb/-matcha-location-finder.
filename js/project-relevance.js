const defaultProjectConfig = {
  targetArea: {
    preferredMin: 35,
    preferredMax: 60,
    acceptableMin: 25,
    acceptableMax: 80
  },
  targetRent: {
    preferredMax: 3000
  }
};

const SOFT_RENT_MAX = 3500;
const HARD_MIN_AREA = 20;
const HARD_MAX_AREA = 100;
const NEGATIVE_GASTRO_PATTERNS = [
  /keine abluft/i,
  /keine k[uü]chenabluft/i,
  /keine warme k[uü]che/i,
  /warme speisen nicht m[oö]glich/i,
  /keine gastronomie/i,
  /gastro nicht erlaubt/i
];

function unitArea(listing) {
  return listing.unitArea ?? listing.area ?? null;
}

function hasNegativeGastroSignal(listing) {
  const evidence = `${listing.gastroEvidence || ''} ${listing.verifiedSummary || ''} ${(listing.keyFacts || []).join(' ')}`;
  return NEGATIVE_GASTRO_PATTERNS.some((pattern) => pattern.test(evidence));
}

export function calculateProjectRelevance(listing, projectConfig = defaultProjectConfig) {
  if (listing.listingType !== 'direct_listing') {
    return { relevant: false, level: 'weak', reasons: ['lead/project source, not a confirmed direct unit'] };
  }

  const config = {
    ...defaultProjectConfig,
    ...projectConfig,
    targetArea: { ...defaultProjectConfig.targetArea, ...(projectConfig.targetArea || {}) },
    targetRent: { ...defaultProjectConfig.targetRent, ...(projectConfig.targetRent || {}) }
  };
  const area = unitArea(listing);
  const rent = listing.rent ?? null;
  const reasons = [];
  const rejectReasons = [];
  let score = 0;

  if (area == null) rejectReasons.push('unit area is not confirmed');
  else if (area < HARD_MIN_AREA) rejectReasons.push(`area ${area} m² < hard minimum ${HARD_MIN_AREA} m²`);
  else if (area > HARD_MAX_AREA) rejectReasons.push(`area ${area} m² > hard maximum ${HARD_MAX_AREA} m²`);
  else if (area >= config.targetArea.preferredMin && area <= config.targetArea.preferredMax) {
    reasons.push(`area ${area} m² in preferred range`);
    score += 2;
  } else if (area >= config.targetArea.acceptableMin && area <= config.targetArea.acceptableMax) {
    reasons.push(`area ${area} m² in acceptable range`);
    score += 1;
  } else {
    reasons.push(`area ${area} m² outside target range`);
  }

  if (rent == null) rejectReasons.push('rent is not confirmed');
  else if (rent > SOFT_RENT_MAX) rejectReasons.push(`rent €${rent} > soft maximum €${SOFT_RENT_MAX}`);
  else if (rent <= config.targetRent.preferredMax) {
    reasons.push(`rent €${rent} within preferred budget`);
    score += 2;
  } else {
    reasons.push(`rent €${rent} over preferred budget`);
  }

  if (listing.gastroSuitability === 'confirmed') {
    reasons.push('gastro use confirmed');
    score += 2;
  } else if (listing.gastroSuitability === 'possible') {
    reasons.push('gastro/cafe use appears possible');
    score += 1;
  } else if (listing.gastroSuitability === 'no') {
    rejectReasons.push('gastro use is not allowed');
  } else {
    reasons.push('gastro suitability needs confirmation');
  }

  if (hasNegativeGastroSignal(listing)) {
    reasons.push('gastro limitation found in source evidence');
    score -= 1;
  }

  if (rejectReasons.length) return { relevant: false, level: 'reject', reasons: [...rejectReasons, ...reasons] };
  if (score >= 5) return { relevant: true, level: 'strong', reasons };
  if (score >= 3) return { relevant: true, level: 'acceptable', reasons };
  return { relevant: false, level: 'weak', reasons };
}

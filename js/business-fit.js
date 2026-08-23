const HIGH_ABLOESE_THRESHOLD = 20000;

function textForBusinessFit(listing) {
  return [
    listing.title,
    listing.verifiedSummary,
    listing.gastroEvidence,
    listing.nextAction,
    ...(Array.isArray(listing.keyFacts) ? listing.keyFacts : []),
    ...(Array.isArray(listing.unknowns) ? listing.unknowns : [])
  ].filter(Boolean).join(' ');
}

function conditionText(condition) {
  if (!condition) return '';
  if (typeof condition === 'string') return condition;
  return [condition.value, condition.amount].filter((value) => value != null).join(' ');
}

function hasPattern(text, patterns) {
  return patterns.find((pattern) => pattern.test(text));
}

function isMandatoryContext(text) {
  return /(pflicht|verpflichtend|muss|zwingend|übernahme erforderlich|zu übernehmen|uebernahme erforderlich|mandatory|required)/i.test(text);
}

function isOptionalContext(text) {
  return /(optional|freiwillig|nach absprache|verhandelbar|VB|auf wunsch|kann übernommen werden|kann uebernommen werden)/i.test(text);
}

export function calculateBusinessFit(listing) {
  if (listing.businessFitLevel) {
    return {
      level: listing.businessFitLevel,
      reasons: Array.isArray(listing.businessFitReasons) ? listing.businessFitReasons : []
    };
  }

  if (listing.listingType !== 'direct_listing') {
    return { level: 'conditional', reasons: ['lead/project source, not a confirmed direct operating unit'] };
  }

  const externalId = listing.externalId || listing.id;
  if (externalId === 'klein-bogenhausen-prinzregent') {
    return {
      level: 'exclude',
      reasons: ['specific existing Dog Café operator concept confirmed for this listing']
    };
  }

  const text = `${textForBusinessFit(listing)} ${conditionText(listing.abloese)} ${conditionText(listing.provision)}`;
  const reasons = [];
  let level = 'good';
  let positiveScore = 0;

  const exclusionPattern = hasPattern(text, [
    /dog\s*caf[eé]/i,
    /hunde\s*caf[eé]/i,
    /tiercaf[eé]/i,
    /\bshisha\b/i,
    /\bspielothek\b/i,
    /\bspielautomaten\b/i,
    /\bnachtbar\b/i,
    /\bclub\b/i,
    /\bmetzgerei\b/i,
    /vollst[aä]ndige\s+konzept[uü]bernahme/i,
    /franchisebindung/i,
    /betreiber\s+f[uü]r\s+bestehendes\s+spezialkonzept\s+gesucht/i,
    /pflicht[uü]bernahme\s+eines\s+bestehenden\s+betriebsmodells/i
  ]);

  if (exclusionPattern) {
    level = 'exclude';
    reasons.push(/dog|hunde|tier/i.test(String(exclusionPattern))
      ? 'specific existing Dog/Tier Café operator concept'
      : 'specialized existing concept or nightlife/use constraint is not a neutral Matcha Bar unit');
  }

  if (/(automatenaufsteller|automatenbetrieb|automatenbindung)/i.test(text)) {
    reasons.push('automated gaming/operator context needs business-model review');
    if (level !== 'exclude') level = isMandatoryContext(text) ? 'exclude' : 'conditional';
  }

  if (/(brauereibindung|brauerei\s*bindung)/i.test(text)) {
    reasons.push('Brauereibindung may limit beverage concept freedom');
    if (level !== 'exclude') level = 'conditional';
  }

  const abloeseAmount = listing.abloese?.amount ?? null;
  const abloeseEvidence = conditionText(listing.abloese) || text;
  if (abloeseAmount != null && abloeseAmount >= HIGH_ABLOESE_THRESHOLD && !isOptionalContext(abloeseEvidence)) {
    reasons.push(`high mandatory Ablöse/entry cost signal (€${abloeseAmount})`);
    if (level !== 'exclude') level = 'conditional';
  } else if (/abl[oö]se/i.test(abloeseEvidence) && isMandatoryContext(abloeseEvidence) && !isOptionalContext(abloeseEvidence)) {
    reasons.push('mandatory Ablöse or equipment takeover needs review');
    if (level !== 'exclude') level = 'conditional';
  } else if (/abl[oö]se/i.test(abloeseEvidence) && isOptionalContext(abloeseEvidence)) {
    reasons.push('optional Ablöse/takeover mentioned, not an automatic exclusion');
  }

  const positiveSignals = [
    [/caf[eé]/i, 'café format signal'],
    [/\btea\b|tee|matcha/i, 'tea/Matcha-compatible concept signal'],
    [/take[-\s]?away/i, 'take-away use signal'],
    [/kiosk/i, 'small kiosk format signal'],
    [/b[aä]ckerei[-\s]?verkauf|b[aä]ckerei/i, 'bakery/retail counter signal'],
    [/ladenfl[aä]che|verkaufsfl[aä]che|verkaufsraum/i, 'customer-facing retail area signal'],
    [/getr[aä]nke/i, 'beverage use signal'],
    [/bistro/i, 'small bistro signal'],
    [/einzelhandel.*gastro|gastro.*einzelhandel/i, 'retail with gastro possibility signal']
  ];

  for (const [pattern, reason] of positiveSignals) {
    if (pattern.test(text)) {
      positiveScore += 1;
      reasons.push(reason);
    }
  }

  if (/(keine\s+k[uü]chenabluft|keine\s+warme\s+k[uü]che|warme\s+speisen\s+nicht\s+m[oö]glich)/i.test(text)) {
    reasons.push('hot kitchen limitation noted; not an automatic Matcha Bar exclusion');
  }

  if (level !== 'exclude') {
    if (level === 'conditional') {
      // Keep conditional when entry cost or operating-model risks exist.
    } else if (positiveScore >= 3 && listing.gastroSuitability === 'confirmed') {
      level = 'ideal';
    } else {
      level = 'good';
    }
  }

  if (!reasons.length) reasons.push('no special concept constraint detected');
  return { level, reasons: [...new Set(reasons)] };
}

export function isBusinessFitVisible(listing) {
  return calculateBusinessFit(listing).level !== 'exclude';
}

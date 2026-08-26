const HIGH_ABLOESE_THRESHOLD = 20000;

function textForBusinessFit(listing) {
  return [
    listing.title,
    listing.verifiedSummary,
    listing.gastroEvidence,
    listing.nextAction,
    ...(Array.isArray(listing.keyFacts) ? listing.keyFacts : []),
    ...(Array.isArray(listing.unknowns) ? listing.unknowns : []),
    listing.rawSourceData?.rentEvidence,
    listing.rawSourceData?.areaEvidence
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

function calculateBusinessFit(listing) {
  if (listing.businessFitLevel) {
    return {
      level: listing.businessFitLevel,
      reasons: Array.isArray(listing.businessFitReasons) ? listing.businessFitReasons : []
    };
  }

  if (listing.listingType !== 'direct_listing') {
    return {
      level: 'conditional',
      reasons: ['lead/project source, not a confirmed direct operating unit']
    };
  }

  const externalId = listing.externalId || listing.id;
  if (externalId === 'klein-bogenhausen-prinzregent') {
    return {
      level: 'exclude',
      reasons: ['specific existing Dog Café operator concept confirmed for this listing']
    };
  }

  const text = textForBusinessFit(listing);
  const abloeseText = conditionText(listing.abloese);
  const provisionText = conditionText(listing.provision);
  const lowerEvidence = `${text} ${abloeseText} ${provisionText}`;
  const reasons = [];
  let level = 'good';
  let positiveScore = 0;

  const exclusionPattern = hasPattern(lowerEvidence, [
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
    if (/dog|hunde|tier/i.test(String(exclusionPattern))) {
      reasons.push('specific existing Dog/Tier Café operator concept');
    } else {
      reasons.push('specialized existing concept or nightlife/use constraint is not a neutral Matcha Bar unit');
    }
  }

  const automatenBinding = /(automatenaufsteller|automatenbetrieb|automatenbindung)/i.test(lowerEvidence);
  if (automatenBinding) {
    reasons.push('automated gaming/operator context needs business-model review');
    if (level !== 'exclude') level = isMandatoryContext(lowerEvidence) ? 'exclude' : 'conditional';
  }

  if (/(brauereibindung|brauerei\s*bindung)/i.test(lowerEvidence)) {
    reasons.push('Brauereibindung may limit beverage concept freedom');
    if (level !== 'exclude') level = 'conditional';
  }

  const abloeseAmount = listing.abloese?.amount ?? null;
  const abloeseEvidence = abloeseText || lowerEvidence;
  if (abloeseAmount != null && abloeseAmount >= HIGH_ABLOESE_THRESHOLD && !isOptionalContext(abloeseEvidence)) {
    reasons.push(`high mandatory Ablöse/entry cost signal (€${abloeseAmount})`);
    if (level !== 'exclude') level = 'conditional';
  } else if (/abl[oö]se/i.test(abloeseEvidence) && isMandatoryContext(abloeseEvidence) && !isOptionalContext(abloeseEvidence)) {
    reasons.push('mandatory Ablöse or equipment takeover needs review');
    if (level !== 'exclude') level = 'conditional';
  } else if (/abl[oö]se/i.test(abloeseEvidence) && isOptionalContext(abloeseEvidence)) {
    reasons.push('optional Ablöse/takeover mentioned, not an automatic exclusion');
  }

  if (/provision/i.test(provisionText) && /(hoch|[4-9][,.]?\d*\s*monats|[1-9][0-9]\.?[0-9]{3})/i.test(provisionText)) {
    reasons.push('high provision should be checked before committing');
    if (level !== 'exclude') level = 'conditional';
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
    if (pattern.test(lowerEvidence)) {
      positiveScore += 1;
      reasons.push(reason);
    }
  }

  if (/(keine\s+k[uü]chenabluft|keine\s+warme\s+k[uü]che|warme\s+speisen\s+nicht\s+m[oö]glich)/i.test(lowerEvidence)) {
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

function isBusinessFitVisible(listing) {
  return calculateBusinessFit(listing).level !== 'exclude';
}

function sourceQuality(listing) {
  if (['high', 'medium', 'low'].includes(listing.rawSourceData?.sourceQuality)) {
    return listing.rawSourceData.sourceQuality;
  }

  const source = `${listing.sourceName || listing.source || ''} ${listing.sourceFamily || ''}`.toLowerCase();
  if (listing.rawSourceData?.enrichmentStatus === 'failed') return 'low';
  if (listing.availabilityStatus === 'unknown') return 'low';
  if (/stadt|municipal|cbre|colliers/.test(source)) return 'high';
  if (/engel/.test(source)) return 'high';
  if (/broker/.test(source)) return 'medium';
  if (/kleinanzeigen/.test(source) && listing.listingType === 'direct_listing') return 'medium';
  if (listing.listingType === 'direct_listing') return 'medium';
  return 'low';
}

function practicalSummary(listing) {
  if (listing.listingType !== 'direct_listing') return listing.verifiedSummary || listing.note || null;
  const area = listing.unitArea == null ? 'Площадь не опубликована' : `${listing.unitArea} м²`;
  const rent = listing.rent == null ? 'аренда не опубликована' : `€${Number(listing.rent).toLocaleString('de-DE')}/мес.`;
  const place = listing.address || listing.district || listing.title || 'локация требует уточнения';
  const fit = calculateBusinessFit(listing);
  const format = listing.gastroSuitability === 'confirmed'
    ? 'Gastro-разрешение выглядит подтверждённым источником.'
    : 'Gastro/Café-разрешение нужно уточнить у источника.';
  const fitNote = fit.level === 'exclude'
    ? 'Есть сильный business-fit риск: объект не должен идти в обычный shortlist.'
    : fit.level === 'conditional'
      ? 'Формат условно подходит, но входные условия или модель эксплуатации нужно проверить.'
      : 'Формат выглядит применимым для компактного beverage/café concept.';
  return `${area} в ${place}, ${rent}. ${fitNote} ${format}`;
}

function nextAction(listing) {
  if (listing.listingType !== 'direct_listing') {
    return listing.nextAction || 'Запросить конкретную доступную unit 25–80 м², rent, Nebenkosten и разрешённые use cases.';
  }
  const fit = calculateBusinessFit(listing);
  if (fit.level === 'exclude') return 'Не включать в основной shortlist; оставить как историю и проверить только если стратегия изменится.';
  if (fit.level === 'conditional') return 'Уточнить обязательность Ablöse/оборудования/концепта и можно ли запустить независимый Matcha/Tea-Bar.';
  if (/keine\s+k[uü]chenabluft|keine\s+warme\s+k[uü]che/i.test(textForBusinessFit(listing))) {
    return 'Уточнить, разрешён ли Café/Tea-Bar без тёплой кухни, cold prep и напитки на вынос.';
  }
  if (listing.gastroSuitability !== 'confirmed') return 'Уточнить у владельца разрешён ли Café/Tea-Bar, cold prep, drinks и take-away.';
  return 'Запросить точный адрес, Nebenkosten, Kaution, Ablöse и условия передачи.';
}

function withBusinessFit(listing) {
  const fit = calculateBusinessFit(listing);
  return {
    ...listing,
    businessFitLevel: fit.level,
    businessFitReasons: fit.reasons,
    sourceQuality: sourceQuality(listing),
    verifiedSummary: practicalSummary({ ...listing, businessFitLevel: fit.level, businessFitReasons: fit.reasons }) || listing.verifiedSummary,
    nextAction: nextAction({ ...listing, businessFitLevel: fit.level, businessFitReasons: fit.reasons }),
    rawSourceData: {
      ...(listing.rawSourceData || {}),
      businessFitLevel: fit.level,
      businessFitReasons: fit.reasons,
      sourceQuality: sourceQuality(listing)
    }
  };
}

module.exports = {
  calculateBusinessFit,
  isBusinessFitVisible,
  nextAction,
  practicalSummary,
  sourceQuality,
  withBusinessFit
};

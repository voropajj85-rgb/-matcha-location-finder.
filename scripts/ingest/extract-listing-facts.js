const { parseNumberFromText } = require('./utils');

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function evidence(raw, confidence = 'high', method = 'text-pattern') {
  return raw ? { raw: clean(raw).slice(0, 220), confidence, method } : null;
}

function euroValue(raw) {
  const match = clean(raw).match(/([0-9][0-9.\s]*(?:,[0-9]{1,2})?)\s*(?:€|EUR)\b/i);
  if (!match) return null;
  const value = parseNumberFromText(match[1].replace(/\s/g, ''));
  return Number.isFinite(value) ? value : null;
}

function decimalValue(raw) {
  const match = clean(raw).match(/([0-9]+(?:[,.][0-9]+)?)/);
  return match ? parseNumberFromText(match[1]) : null;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = clean(text).match(pattern);
    if (match) return match[0];
  }
  return null;
}

function extractRent(text) {
  const source = clean(text);
  const request = firstMatch(source, [
    /(?:kaltmiete|nettokaltmiete|nettomiete|monatsmiete|mietpreis|miete|pacht)\s*:?[\s-]*(?:preis\s+)?auf\s+anfrage/i,
    /preis\s+auf\s+anfrage/i
  ]);
  if (request) return { amount: null, status: 'request', type: 'monthly', evidence: evidence(request) };

  const blocked = /(kaufpreis|kaution|provision|courtage|abl[oö]se|abstand|inventar|nebenkosten|betriebskosten)/i;
  const patterns = [
    /(?:kaltmiete|nettokaltmiete|nettomiete|monatsmiete|mietpreis|miete|pacht)\s*:?[\s-]*([0-9][0-9.\s]*(?:,[0-9]{1,2})?)\s*(?:€|EUR)/ig,
    /([0-9][0-9.\s]*(?:,[0-9]{1,2})?)\s*(?:€|EUR)\s*(?:\/\s*monat|monatlich|pro\s+monat)/ig
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const context = source.slice(Math.max(0, match.index - 45), Math.min(source.length, match.index + match[0].length + 45));
      if (blocked.test(context)) continue;
      const amount = parseNumberFromText(match[1].replace(/\s/g, ''));
      if (Number.isFinite(amount) && amount >= 100 && amount <= 30000) {
        return { amount, status: 'known', type: 'monthly', evidence: evidence(match[0], 'high') };
      }
    }
  }
  return { amount: null, status: 'unknown', type: null, evidence: null };
}

function extractNebenkosten(text) {
  const source = clean(text);
  const included = firstMatch(source, [/(?:nebenkosten|betriebskosten)\s+(?:sind\s+)?(?:in\s+der\s+miete\s+)?inkludiert/i, /inkl\.?\s*(?:nebenkosten|nk)/i]);
  if (included) return { amount: null, status: 'included', evidence: evidence(included) };
  const numeric = firstMatch(source, [
    /(?:nebenkosten|nebenkostenvorauszahlung|betriebskosten|\bNK\b)\s*:?[\s-]*[0-9][0-9.\s]*(?:,[0-9]{1,2})?\s*(?:€|EUR)/i
  ]);
  if (numeric) return { amount: euroValue(numeric), status: 'known', evidence: evidence(numeric) };
  const mentioned = firstMatch(source, [/(?:zzgl\.?|zuzüglich)\s*(?:nebenkosten|\bNK\b)/i, /(?:nebenkosten|betriebskosten)\s+(?:nach\s+vereinbarung|auf\s+anfrage)/i]);
  if (mentioned) return { amount: null, status: 'mentioned', evidence: evidence(mentioned) };
  return { amount: null, status: 'unknown', evidence: null };
}

function extractKaution(text) {
  const source = clean(text);
  const relative = firstMatch(source, [
    /(?:kaution|mietkaution)\s*:?[\s-]*[0-9]+(?:[,.][0-9]+)?\s*(?:monatsmieten|monatsmiete|MM|nettokaltmieten|kaltmieten)/i,
    /[0-9]+(?:[,.][0-9]+)?\s*(?:monatsmieten|monatsmiete|MM|nettokaltmieten|kaltmieten)\s+(?:kaution|mietkaution)/i
  ]);
  if (relative) return { amount: null, months: decimalValue(relative), basis: 'monthly_rent', status: 'known_relative', evidence: evidence(relative) };
  const numeric = firstMatch(source, [/(?:kaution|mietkaution)\s*:?[\s-]*[0-9][0-9.\s]*(?:,[0-9]{1,2})?\s*(?:€|EUR)/i]);
  if (numeric) return { amount: euroValue(numeric), months: null, basis: null, status: 'known_numeric', evidence: evidence(numeric) };
  const mentioned = firstMatch(source, [/(?:kaution|mietkaution)\s+(?:nach\s+vereinbarung|auf\s+anfrage)/i]);
  if (mentioned) return { amount: null, months: null, basis: null, status: 'mentioned', evidence: evidence(mentioned) };
  return { amount: null, months: null, basis: null, status: 'unknown', evidence: null };
}

function extractProvision(text) {
  const source = clean(text);
  const free = firstMatch(source, [/provisionsfrei/i, /keine\s+(?:mieter)?provision/i, /ohne\s+provision/i]);
  if (free) return { amount: null, months: null, status: 'free', vat: null, evidence: evidence(free) };
  const relative = firstMatch(source, [
    /(?:provision|mieterprovision|maklercourtage|courtage)\s*:?[\s-]*[0-9]+(?:[,.][0-9]+)?\s*(?:MM|monatsmieten?)(?:[^.;]{0,50}(?:zzgl\.?|inkl\.?)\s*(?:MwSt\.?|USt\.?))?/i,
    /[0-9]+(?:[,.][0-9]+)?\s*(?:MM|monatsmieten?)\s*(?:zzgl\.?|inkl\.?)?\s*(?:MwSt\.?|USt\.?)?\s*(?:provision|courtage)?/i
  ]);
  if (relative) {
    const vat = /zzgl\.?\s*(?:MwSt|USt)/i.test(relative) ? 'plus_vat' : (/inkl\.?\s*(?:MwSt|USt)/i.test(relative) ? 'incl_vat' : null);
    return { amount: null, months: decimalValue(relative), status: 'known_relative', vat, evidence: evidence(relative) };
  }
  const numeric = firstMatch(source, [/(?:provision|mieterprovision|maklercourtage|courtage)\s*:?[\s-]*[0-9][0-9.\s]*(?:,[0-9]{1,2})?\s*(?:€|EUR)/i]);
  if (numeric) return { amount: euroValue(numeric), months: null, status: 'known_numeric', vat: null, evidence: evidence(numeric) };
  const mentioned = firstMatch(source, [/(?:provision|mieterprovision|maklercourtage|courtage)\s+(?:auf\s+anfrage|nach\s+vereinbarung)/i]);
  if (mentioned) return { amount: null, months: null, status: 'mentioned', vat: null, evidence: evidence(mentioned) };
  return { amount: null, months: null, status: 'unknown', vat: null, evidence: null };
}

function extractAbloese(text) {
  const source = clean(text);
  const numeric = firstMatch(source, [/(?:abl[oö]se|abloese|abstandszahlung)\s*:?[\s-]*[0-9][0-9.\s]*(?:,[0-9]{1,2})?\s*(?:€|EUR)(?:\s*VB)?/i]);
  if (numeric) return { amount: euroValue(numeric), status: /\bVB\b/i.test(numeric) ? 'negotiable_numeric' : 'known_numeric', evidence: evidence(numeric) };
  const negotiable = firstMatch(source, [/(?:abl[oö]se|abloese)\s*:?[\s-]*(?:VB|verhandlungsbasis)/i]);
  if (negotiable) return { amount: null, status: 'negotiable', evidence: evidence(negotiable) };
  const mentioned = firstMatch(source, [/(?:inventar|übernahme|uebernahme)\s+(?:gegen|mit)\s+abl[oö]se/i, /(?:abl[oö]se|abloese|abstandszahlung)\s+(?:nach\s+vereinbarung|auf\s+anfrage)/i]);
  if (mentioned) return { amount: null, status: 'mentioned', evidence: evidence(mentioned) };
  const none = firstMatch(source, [/keine\s+abl[oö]se/i, /abl[oö]sefrei/i]);
  if (none) return { amount: null, status: 'none', evidence: evidence(none) };
  return { amount: null, status: 'unknown', evidence: null };
}

const AREA_RULES = [
  { type: 'sales_area', priority: 100, re: /(?:ladenfl[aä]che|verkaufsfl[aä]che|gastrofl[aä]che|gastraumfl[aä]che)\s*:?[\s-]*(?:ca\.?\s*)?([0-9][0-9.,]*)\s*(?:m²|qm|m2)/ig },
  { type: 'divisible_minimum', priority: 95, re: /(?:teilbar\s+ab|teilfl[aä]che\s+ab)\s*:?[\s-]*(?:ca\.?\s*)?([0-9][0-9.,]*)\s*(?:m²|qm|m2)/ig },
  { type: 'usable_area', priority: 80, re: /(?:nutzfl[aä]che|gewerbefl[aä]che)\s*:?[\s-]*(?:ca\.?\s*)?([0-9][0-9.,]*)\s*(?:m²|qm|m2)/ig },
  { type: 'total_area', priority: 30, re: /(?:gesamtfl[aä]che)\s*:?[\s-]*(?:ca\.?\s*)?([0-9][0-9.,]*)\s*(?:m²|qm|m2)/ig }
];

function extractArea(text) {
  const source = clean(text);
  const candidates = [];
  for (const rule of AREA_RULES) {
    for (const match of source.matchAll(rule.re)) {
      const value = parseNumberFromText(match[1]);
      if (!Number.isFinite(value) || value < 5 || value > 5000) continue;
      candidates.push({ value, areaType: rule.type, priority: rule.priority, evidence: evidence(match[0], 'high', 'labelled-area') });
    }
  }
  candidates.sort((a, b) => b.priority - a.priority);
  const exact = candidates.find((c) => c.areaType !== 'total_area');
  const total = candidates.find((c) => c.areaType === 'total_area');
  return {
    unitArea: exact?.value ?? null,
    areaType: exact?.areaType ?? null,
    projectTotalArea: total?.value ?? null,
    evidence: exact?.evidence ?? null,
    candidates
  };
}

function extractGastro(text) {
  const source = clean(text);
  const no = firstMatch(source, [/gastronomie\s+(?:ist\s+)?ausgeschlossen/i, /keine\s+gastronomie/i, /keine\s+imbissnutzung/i, /nur\s+einzelhandel/i]);
  if (no) return { status: 'no', evidence: evidence(no) };
  const confirmed = firstMatch(source, [/gastronomie\s+genehmigt/i, /genehmigung\s+f[uü]r\s+gastronomie/i, /gastronomienutzung/i, /geeignet\s+f[uü]r\s+caf[eé]/i, /gastronomische\s+nutzung/i]);
  if (confirmed) return { status: 'confirmed', evidence: evidence(confirmed) };
  const possible = firstMatch(source, [/\bcaf[eé]\b/i, /\bimbiss\b/i, /\bbistro\b/i, /\brestaurant\b/i, /take-?away/i, /ladenfl[aä]che/i, /einzelhandel/i]);
  if (possible) return { status: 'possible', evidence: evidence(possible, /ladenfl[aä]che|einzelhandel/i.test(possible) ? 'medium' : 'high') };
  return { status: 'unknown', evidence: null };
}

function stateFact(text, positivePatterns, negativePatterns = []) {
  const source = clean(text);
  const negative = firstMatch(source, negativePatterns);
  if (negative) return { status: 'no', evidence: evidence(negative) };
  const positive = firstMatch(source, positivePatterns);
  if (positive) return { status: 'confirmed', evidence: evidence(positive) };
  return { status: 'unknown', evidence: null };
}

function extractOperations(text) {
  const source = clean(text);
  const abluft = stateFact(source,
    [/k[uü]chenabluft\s+(?:ist\s+)?vorhanden/i, /abluftanlage\s+(?:ist\s+)?vorhanden/i, /fettabluft/i, /l[uü]ftungsanlage\s+(?:ist\s+)?vorhanden/i],
    [/keine\s+(?:k[uü]chen)?abluft/i, /ohne\s+abluft/i]);
  const terrace = stateFact(source, [/au[sß]engastronomie\s+m[oö]glich/i, /freischankfl[aä]che/i, /terrasse\s+(?:vorhanden|verf[uü]gbar|m[oö]glich)/i, /au[sß]enfl[aä]che/i]);
  const opening = firstMatch(source, [/(?:nur|betrieb)\s+bis\s+[0-2]?[0-9](?::[0-5][0-9])?\s*uhr/i, /kein\s+nachtbetrieb/i, /keine\s+abendgastronomie/i, /nur\s+tagesgastronomie/i, /[oö]ffnungszeiten\s+bis\s+[0-2]?[0-9](?::[0-5][0-9])?/i]);
  const wc = stateFact(source, [/g[aä]ste-?wc/i, /\bwc\s+vorhanden/i]);
  const water = stateFact(source, [/wasseranschluss\s+vorhanden/i, /wasseranschl[uü]sse?\s+vorhanden/i]);
  return { abluft, terrace, openingHours: opening ? { status: 'restricted', evidence: evidence(opening) } : { status: 'unknown', evidence: null }, wc, waterConnection: water };
}

function extractExistingBusiness(text) {
  const source = clean(text);
  const confirmed = firstMatch(source, [/laufender\s+betrieb/i, /gesch[aä]fts[uü]bernahme/i, /nachfolger\s+gesucht/i, /bestehendes\s+caf[eé]/i, /gegen\s+abl[oö]se\s+zu\s+[uü]bernehmen/i]);
  const takeover = firstMatch(source, [/inventar[uü]bernahme/i, /[uü]bernahme\s+(?:des\s+)?(?:betriebs|inventars|konzepts)/i, /gegen\s+abl[oö]se\s+zu\s+[uü]bernehmen/i]);
  const inventory = firstMatch(source, [/inventar\s+(?:inklusive|inkl\.?|vorhanden|gegen\s+abl[oö]se)/i]);
  return {
    existingBusiness: confirmed ? 'confirmed' : (takeover ? 'possible' : 'none'),
    takeoverRequired: takeover ? true : 'unknown',
    inventoryIncluded: inventory ? true : 'unknown',
    evidence: evidence(confirmed || takeover || inventory)
  };
}

function factLabel(name, value) {
  return value?.evidence?.raw ? `${name}: ${value.evidence.raw}` : null;
}

function buildUnknowns(facts) {
  const result = [];
  if (facts.rent.status === 'unknown' || facts.rent.status === 'request') result.push('Monatsmiete?');
  if (facts.nebenkosten.status === 'unknown' || facts.nebenkosten.status === 'mentioned') result.push('Nebenkosten?');
  if (facts.kaution.status === 'unknown' || facts.kaution.status === 'mentioned') result.push('Höhe der Kaution?');
  if (facts.provision.status === 'unknown' || facts.provision.status === 'mentioned') result.push('Provision?');
  if (facts.gastro.status === 'unknown' || facts.gastro.status === 'possible') result.push('Café-/Gastronomienutzung genehmigt?');
  if (facts.operations.abluft.status === 'unknown') result.push('Abluft vorhanden?');
  return result.slice(0, 5);
}

function buildNextAction(facts) {
  if (facts.rent.status === 'request' || facts.rent.status === 'unknown') return 'Monatsmiete und Nebenkosten beim Anbieter anfragen.';
  if (facts.gastro.status !== 'confirmed') return 'Café-/Tea-Bar-Nutzung und erforderliche Genehmigungen klären.';
  if (facts.provision.status === 'unknown' || facts.kaution.status === 'unknown') return 'Provision und Kaution vor der Besichtigung klären.';
  if (facts.operations.abluft.status === 'unknown') return 'Abluft und technische Voraussetzungen für den Betrieb klären.';
  return 'Besichtigung anfragen und Vertragsbedingungen prüfen.';
}

function buildSummary(facts, context = {}) {
  const parts = [];
  if (facts.area.unitArea) parts.push(`${facts.area.unitArea} m² ${facts.area.areaType === 'sales_area' ? 'Laden-/Verkaufsfläche' : 'Gewerbefläche'}`);
  if (context.district || context.address) parts.push(`in ${context.district || context.address}`);
  if (facts.rent.status === 'known') parts.push(`Miete ${Math.round(facts.rent.amount).toLocaleString('de-DE')} € / Monat.`);
  else if (facts.rent.status === 'request') parts.push('Miete auf Anfrage.');
  else parts.push('Miete nicht angegeben.');
  if (facts.nebenkosten.status === 'known') parts.push(`Nebenkosten ${Math.round(facts.nebenkosten.amount).toLocaleString('de-DE')} €.`);
  if (facts.gastro.status === 'confirmed') parts.push('Gastronomienutzung ist ausdrücklich bestätigt.');
  else if (facts.gastro.status === 'no') parts.push('Gastronomienutzung ist ausgeschlossen.');
  else parts.push('Gastronomienutzung ist nicht bestätigt.');
  if (facts.provision.status === 'free') parts.push('Provisionsfrei.');
  if (facts.kaution.status === 'known_relative') parts.push(`Kaution: ${facts.kaution.months} Monatsmieten.`);
  else if (facts.kaution.status === 'known_numeric') parts.push(`Kaution: ${Math.round(facts.kaution.amount).toLocaleString('de-DE')} €.`);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function extractListingFacts(text, context = {}) {
  const source = clean(text);
  const facts = {
    rent: extractRent(source),
    nebenkosten: extractNebenkosten(source),
    kaution: extractKaution(source),
    provision: extractProvision(source),
    abloese: extractAbloese(source),
    area: extractArea(source),
    gastro: extractGastro(source),
    operations: extractOperations(source),
    existing: extractExistingBusiness(source)
  };
  facts.financialEvidence = {
    rent: facts.rent.evidence,
    nebenkosten: facts.nebenkosten.evidence,
    kaution: facts.kaution.evidence,
    provision: facts.provision.evidence,
    abloese: facts.abloese.evidence
  };
  facts.operationalEvidence = {
    gastro: facts.gastro.evidence,
    abluft: facts.operations.abluft.evidence,
    terrace: facts.operations.terrace.evidence,
    openingHours: facts.operations.openingHours.evidence
  };
  facts.unknowns = buildUnknowns(facts);
  facts.nextAction = buildNextAction(facts);
  facts.verifiedSummary = buildSummary(facts, context);
  facts.keyFacts = [
    factLabel('Provision', facts.provision),
    factLabel('Kaution', facts.kaution),
    factLabel('Ablöse', facts.abloese),
    factLabel('Abluft', facts.operations.abluft),
    factLabel('Außenfläche', facts.operations.terrace)
  ].filter(Boolean).slice(0, 6);
  return facts;
}

module.exports = {
  extractListingFacts,
  extractRent,
  extractNebenkosten,
  extractKaution,
  extractProvision,
  extractAbloese,
  extractArea,
  extractGastro,
  extractOperations,
  extractExistingBusiness
};

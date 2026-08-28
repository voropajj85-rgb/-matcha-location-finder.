const { parseNumberFromText } = require('./utils');

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function ev(raw, confidence = 'high', method = 'text-pattern') {
  return raw ? { raw: clean(raw).slice(0, 220), confidence, method } : null;
}

function num(raw) {
  const match = clean(raw).match(/([0-9]+(?:[,.][0-9]+)?)/);
  return match ? parseNumberFromText(match[1]) : null;
}

function euro(raw) {
  const match = clean(raw).match(/([0-9][0-9.\s]*(?:,[0-9]{1,2})?)\s*(?:€|EUR)/i);
  if (!match) return null;
  const value = parseNumberFromText(match[1].replace(/\s/g, ''));
  return Number.isFinite(value) ? value : null;
}

function first(text, patterns) {
  const source = clean(text);
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function extractRent(text) {
  const source = clean(text);
  const request = first(source, [
    /(?:kaltmiete|nettokaltmiete|nettomiete|monatsmiete|mietpreis|miete|pacht)\s*:?[\s-]*(?:preis\s+)?auf\s+anfrage/i,
    /preis\s+auf\s+anfrage/i
  ]);
  if (request) return { amount: null, status: 'request', type: 'monthly', evidence: ev(request) };

  const blocked = /(kaufpreis|kaution|provision|courtage|abl[oö]se|abstand|inventar|nebenkosten|betriebskosten)/i;
  const patterns = [
    /(?:kaltmiete|nettokaltmiete|nettomiete|monatsmiete|mietpreis|miete|pacht)\s*(?:für\s+(?:die\s+)?(?:gesamt)?fl[aä]che)?\s*:?[\s-]*([0-9][0-9.\s]*(?:,[0-9]{1,2})?)\s*(?:€|EUR)/ig,
    /([0-9][0-9.\s]*(?:,[0-9]{1,2})?)\s*(?:€|EUR)\s*(?:\/\s*monat|monatlich|pro\s+monat)/ig
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const prefix = source.slice(Math.max(0, match.index - 60), match.index);
      const labelled = /^(?:kaltmiete|nettokaltmiete|nettomiete|monatsmiete|mietpreis|miete|pacht)/i.test(match[0]);
      if (!labelled && blocked.test(prefix)) continue;
      const amount = parseNumberFromText(match[1].replace(/\s/g, ''));
      if (Number.isFinite(amount) && amount >= 100 && amount <= 30000) {
        return { amount, status: 'known', type: 'monthly', evidence: ev(match[0]) };
      }
    }
  }
  return { amount: null, status: 'unknown', type: null, evidence: null };
}

function extractNebenkosten(text) {
  const source = clean(text);
  const included = first(source, [/(?:nebenkosten|betriebskosten)\s+(?:sind\s+)?(?:in\s+der\s+miete\s+)?inkludiert/i, /inkl\.?\s*(?:nebenkosten|nk)/i]);
  if (included) return { amount: null, status: 'included', evidence: ev(included) };
  const numeric = first(source, [/(?:nebenkosten|nebenkostenvorauszahlung|betriebskosten|\bNK\b)\s*:?[\s-]*[0-9][0-9.\s]*(?:,[0-9]{1,2})?\s*(?:€|EUR)/i]);
  if (numeric) return { amount: euro(numeric), status: 'known', evidence: ev(numeric) };
  const mentioned = first(source, [/(?:zzgl\.?|zuzüglich)\s*(?:nebenkosten|\bNK\b)/i, /(?:nebenkosten|betriebskosten)\s+(?:nach\s+vereinbarung|auf\s+anfrage)/i]);
  if (mentioned) return { amount: null, status: 'mentioned', evidence: ev(mentioned) };
  return { amount: null, status: 'unknown', evidence: null };
}

function extractKaution(text) {
  const source = clean(text);
  const relative = first(source, [
    /(?:kaution|mietkaution)\s*:?[\s-]*[0-9]+(?:[,.][0-9]+)?\s*(?:monatsmieten|monatsmiete|MM|nettokaltmieten|kaltmieten)/i,
    /[0-9]+(?:[,.][0-9]+)?\s*(?:monatsmieten|monatsmiete|MM|nettokaltmieten|kaltmieten)\s+(?:kaution|mietkaution)/i
  ]);
  if (relative) return { amount: null, months: num(relative), basis: 'monthly_rent', status: 'known_relative', evidence: ev(relative) };
  const numeric = first(source, [/(?:kaution|mietkaution)\s*:?[\s-]*[0-9][0-9.\s]*(?:,[0-9]{1,2})?\s*(?:€|EUR)/i]);
  if (numeric) return { amount: euro(numeric), months: null, basis: null, status: 'known_numeric', evidence: ev(numeric) };
  const mentioned = first(source, [/(?:kaution|mietkaution)\s+(?:nach\s+vereinbarung|auf\s+anfrage)/i]);
  if (mentioned) return { amount: null, months: null, basis: null, status: 'mentioned', evidence: ev(mentioned) };
  return { amount: null, months: null, basis: null, status: 'unknown', evidence: null };
}

function extractProvision(text) {
  const source = clean(text);
  const free = first(source, [/provisionsfrei/i, /keine\s+(?:mieter)?provision/i, /ohne\s+provision/i]);
  if (free) return { amount: null, months: null, status: 'free', vat: null, evidence: ev(free) };
  const relative = first(source, [
    /(?:provision|mieterprovision|maklercourtage|courtage)\s*:?[\s-]*[0-9]+(?:[,.][0-9]+)?\s*(?:MM|monatsmieten?)(?:[^.;]{0,50}(?:zzgl\.?|inkl\.?)\s*(?:MwSt\.?|USt\.?))?/i,
    /[0-9]+(?:[,.][0-9]+)?\s*(?:MM|monatsmieten?)\s*(?:zzgl\.?|inkl\.?)?\s*(?:MwSt\.?|USt\.?)?\s*(?:provision|courtage)?/i
  ]);
  if (relative) {
    const months = num(relative);
    if (Number.isFinite(months) && months > 0 && months <= 12) {
      const vat = /zzgl\.?\s*(?:MwSt|USt)/i.test(relative) ? 'plus_vat' : (/inkl\.?\s*(?:MwSt|USt)/i.test(relative) ? 'incl_vat' : null);
      return { amount: null, months, status: 'known_relative', vat, evidence: ev(relative) };
    }
  }
  const numeric = first(source, [/(?:provision|mieterprovision|maklercourtage|courtage)\s*:?[\s-]*[0-9][0-9.\s]*(?:,[0-9]{1,2})?\s*(?:€|EUR)/i]);
  if (numeric) return { amount: euro(numeric), months: null, status: 'known_numeric', vat: null, evidence: ev(numeric) };
  const mentioned = first(source, [/(?:provision|mieterprovision|maklercourtage|courtage)\s+(?:auf\s+anfrage|nach\s+vereinbarung)/i]);
  if (mentioned) return { amount: null, months: null, status: 'mentioned', vat: null, evidence: ev(mentioned) };
  return { amount: null, months: null, status: 'unknown', vat: null, evidence: null };
}

function extractAbloese(text) {
  const source = clean(text);
  const none = first(source, [/keine\s+abl[oö]se/i, /abl[oö]sefrei/i]);
  if (none) return { amount: null, status: 'none', evidence: ev(none) };
  const numeric = first(source, [/(?:abl[oö]se|abloese|abstandszahlung)\s*:?[\s-]*[0-9][0-9.\s]*(?:,[0-9]{1,2})?\s*(?:€|EUR)(?:\s*VB)?/i]);
  if (numeric) return { amount: euro(numeric), status: /\bVB\b/i.test(numeric) ? 'negotiable_numeric' : 'known_numeric', evidence: ev(numeric) };
  const negotiable = first(source, [/(?:abl[oö]se|abloese)\s*:?[\s-]*(?:VB|verhandlungsbasis)/i]);
  if (negotiable) return { amount: null, status: 'negotiable', evidence: ev(negotiable) };
  const mentioned = first(source, [/(?:inventar|übernahme|uebernahme)\s+(?:gegen|mit)\s+abl[oö]se/i, /(?:abl[oö]se|abloese|abstandszahlung)\s+(?:nach\s+vereinbarung|auf\s+anfrage)/i]);
  if (mentioned) return { amount: null, status: 'mentioned', evidence: ev(mentioned) };
  return { amount: null, status: 'unknown', evidence: null };
}

const LABEL = '(?:verkaufs[\\s\\/-]*ladenfl[aä]che|verkaufsfl[aä]che|ladenfl[aä]che|ladenzeile|verkaufsraum|gastrofl[aä]che|gastraumfl[aä]che)';
const MEDIUM = '(?:nutzfl[aä]che|gewerbefl[aä]che)';

function extractArea(text) {
  const source = clean(text);
  const candidates = [];
  const add = (regex, areaType, priority, method) => {
    for (const match of source.matchAll(regex)) {
      const rawValue = match.groups?.value || match[1];
      const value = parseNumberFromText(rawValue);
      if (!Number.isFinite(value) || value < 5 || value > 5000) continue;
      candidates.push({ value, areaType, priority, evidence: ev(match[0], 'high', method) });
    }
  };

  add(new RegExp(`${LABEL}\\s*(?::|mit)?\\s*(?:ca\\.?|circa|ungef[aä]hr)?\\s*(?<value>[0-9][0-9.,]*)\\s*(?:m²|qm|m2)`, 'ig'), 'sales_area', 110, 'label-before-area');
  add(new RegExp(`(?<value>[0-9][0-9.,]*)\\s*(?:m²|qm|m2)\\s*verkaufs[\\s\\/-]+ladenfl[aä]che`, 'ig'), 'sales_area', 125, 'compound-area-before-label');
  add(new RegExp(`(?<value>[0-9][0-9.,]*)\\s*(?:m²|qm|m2)\\s*${LABEL}`, 'ig'), 'sales_area', 105, 'area-before-label');
  add(/(?:teilbar\s+ab|teilfl[aä]che\s+ab)\s*:?[\s-]*(?:ca\.?\s*)?(?<value>[0-9][0-9.,]*)\s*(?:m²|qm|m2)/ig, 'divisible_minimum', 100, 'divisible-area');
  add(new RegExp(`${MEDIUM}\\s*:?[\\s-]*(?:ca\\.?|circa|ungef[aä]hr)?\\s*(?<value>[0-9][0-9.,]*)\\s*(?:m²|qm|m2)`, 'ig'), 'usable_area', 80, 'usable-area');
  add(/(?:^|\s)fl[aä]che\s*:?\s*(?:ca\.?|circa|ungef[aä]hr)?\s*(?<value>[0-9][0-9.,]*)\s*(?:m²|qm|m2)/ig, 'listed_area', 90, 'listed-area-field');
  add(/gesamtfl[aä]che\s*:?[\s-]*(?:ca\.?|circa|ungef[aä]hr)?\s*(?<value>[0-9][0-9.,]*)\s*(?:m²|qm|m2)/ig, 'total_area', 30, 'total-area');

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates.sort((a, b) => b.priority - a.priority)) {
    const key = `${candidate.value}:${candidate.areaType}:${candidate.evidence.raw.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }
  const exact = unique.find((item) => item.areaType !== 'total_area');
  const total = unique.find((item) => item.areaType === 'total_area');
  return {
    unitArea: exact?.value ?? null,
    areaType: exact?.areaType ?? null,
    projectTotalArea: total?.value ?? null,
    evidence: exact?.evidence ?? null,
    candidates: unique
  };
}

function extractGastro(text) {
  const source = clean(text);
  const no = first(source, [/gastronomie\s+(?:ist\s+)?ausgeschlossen/i, /keine\s+gastronomie/i, /keine\s+imbissnutzung/i, /nur\s+einzelhandel/i]);
  if (no) return { status: 'no', evidence: ev(no) };
  const confirmed = first(source, [/gastronomie\s+genehmigt/i, /genehmigung\s+f[uü]r\s+gastronomie/i, /gastronomienutzung/i, /geeignet\s+f[uü]r\s+caf[eé]/i, /gastronomische\s+nutzung/i]);
  if (confirmed) return { status: 'confirmed', evidence: ev(confirmed) };
  const possible = first(source, [/\bcaf[eé]\b/i, /\bimbiss\b/i, /\bbistro\b/i, /\brestaurant\b/i, /take-?away/i, /ladenfl[aä]che/i, /einzelhandel/i]);
  if (possible) return { status: 'possible', evidence: ev(possible, /ladenfl[aä]che|einzelhandel/i.test(possible) ? 'medium' : 'high') };
  return { status: 'unknown', evidence: null };
}

function stateFact(text, positive, negative = []) {
  const source = clean(text);
  const no = first(source, negative);
  if (no) return { status: 'no', evidence: ev(no) };
  const yes = first(source, positive);
  if (yes) return { status: 'confirmed', evidence: ev(yes) };
  return { status: 'unknown', evidence: null };
}

function extractOperations(text) {
  const source = clean(text);
  const abluft = stateFact(source,
    [/k[uü]chenabluft\s+(?:ist\s+)?vorhanden/i, /abluftanlage\s+(?:ist\s+)?vorhanden/i, /fettabluft/i, /l[uü]ftungsanlage\s+(?:ist\s+)?vorhanden/i],
    [/keine\s+(?:k[uü]chen)?abluft/i, /ohne\s+abluft/i]);
  const terrace = stateFact(source, [/au[sß]engastronomie\s+m[oö]glich/i, /freischankfl[aä]che/i, /terrasse\s+(?:vorhanden|verf[uü]gbar|m[oö]glich)/i, /au[sß]enfl[aä]che/i]);
  const opening = first(source, [/(?:nur|betrieb)\s+bis\s+[0-2]?[0-9](?::[0-5][0-9])?\s*uhr/i, /kein\s+nachtbetrieb/i, /keine\s+abendgastronomie/i, /nur\s+tagesgastronomie/i, /[oö]ffnungszeiten\s+bis\s+[0-2]?[0-9](?::[0-5][0-9])?/i]);
  return {
    abluft,
    terrace,
    openingHours: opening ? { status: 'restricted', evidence: ev(opening) } : { status: 'unknown', evidence: null },
    wc: stateFact(source, [/g[aä]ste-?wc/i, /\bwc\s+vorhanden/i]),
    waterConnection: stateFact(source, [/wasseranschluss\s+vorhanden/i, /wasseranschl[uü]sse?\s+vorhanden/i])
  };
}

function extractExistingBusiness(text) {
  const source = clean(text);
  const confirmed = first(source, [/laufender\s+betrieb/i, /gesch[aä]fts[uü]bernahme/i, /nachfolger\s+gesucht/i, /bestehendes\s+caf[eé]/i, /gegen\s+abl[oö]se\s+zu\s+[uü]bernehmen/i]);
  const takeover = first(source, [/inventar[uü]bernahme/i, /[uü]bernahme\s+(?:des\s+)?(?:betriebs|inventars|konzepts)/i, /gegen\s+abl[oö]se\s+zu\s+[uü]bernehmen/i]);
  const inventory = first(source, [/inventar\s+(?:inklusive|inkl\.?|vorhanden|gegen\s+abl[oö]se)/i]);
  return {
    existingBusiness: confirmed ? 'confirmed' : (takeover ? 'possible' : 'none'),
    takeoverRequired: takeover ? true : 'unknown',
    inventoryIncluded: inventory ? true : 'unknown',
    evidence: ev(confirmed || takeover || inventory)
  };
}

function unknowns(f) {
  const out = [];
  if (f.rent.status === 'unknown' || f.rent.status === 'request') out.push('Monatsmiete?');
  if (f.nebenkosten.status === 'unknown' || f.nebenkosten.status === 'mentioned') out.push('Nebenkosten?');
  if (f.kaution.status === 'unknown' || f.kaution.status === 'mentioned') out.push('Höhe der Kaution?');
  if (f.provision.status === 'unknown' || f.provision.status === 'mentioned') out.push('Provision?');
  if (f.gastro.status !== 'confirmed') out.push('Café-/Gastronomienutzung genehmigt?');
  if (f.operations.abluft.status === 'unknown') out.push('Abluft vorhanden?');
  return out.slice(0, 5);
}

function nextAction(f) {
  if (f.rent.status === 'request' || f.rent.status === 'unknown') return 'Monatsmiete und Nebenkosten beim Anbieter anfragen.';
  if (f.gastro.status !== 'confirmed') return 'Café-/Tea-Bar-Nutzung und erforderliche Genehmigungen klären.';
  if (f.provision.status === 'unknown' || f.kaution.status === 'unknown') return 'Provision und Kaution vor der Besichtigung klären.';
  if (f.operations.abluft.status === 'unknown') return 'Abluft und technische Voraussetzungen für den Betrieb klären.';
  return 'Besichtigung anfragen und Vertragsbedingungen prüfen.';
}

function summary(f, context) {
  const out = [];
  if (f.area.unitArea) out.push(`${f.area.unitArea} m² ${f.area.areaType === 'sales_area' ? 'Laden-/Verkaufsfläche' : 'Gewerbefläche'}`);
  if (context.district || context.address) out.push(`in ${context.district || context.address}`);
  if (f.rent.status === 'known') out.push(`Miete ${Math.round(f.rent.amount).toLocaleString('de-DE')} € / Monat.`);
  else if (f.rent.status === 'request') out.push('Miete auf Anfrage.');
  else out.push('Miete nicht angegeben.');
  if (f.nebenkosten.status === 'known') out.push(`Nebenkosten ${Math.round(f.nebenkosten.amount).toLocaleString('de-DE')} €.`);
  if (f.gastro.status === 'confirmed') out.push('Gastronomienutzung ist ausdrücklich bestätigt.');
  else if (f.gastro.status === 'no') out.push('Gastronomienutzung ist ausgeschlossen.');
  else out.push('Gastronomienutzung ist nicht bestätigt.');
  if (f.provision.status === 'free') out.push('Provisionsfrei.');
  if (f.kaution.status === 'known_relative') out.push(`Kaution: ${f.kaution.months} Monatsmieten.`);
  else if (f.kaution.status === 'known_numeric') out.push(`Kaution: ${Math.round(f.kaution.amount).toLocaleString('de-DE')} €.`);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function extractListingFacts(text, context = {}) {
  const f = {
    rent: extractRent(text),
    nebenkosten: extractNebenkosten(text),
    kaution: extractKaution(text),
    provision: extractProvision(text),
    abloese: extractAbloese(text),
    area: extractArea(text),
    gastro: extractGastro(text),
    operations: extractOperations(text),
    existing: extractExistingBusiness(text)
  };
  f.financialEvidence = {
    rent: f.rent.evidence,
    nebenkosten: f.nebenkosten.evidence,
    kaution: f.kaution.evidence,
    provision: f.provision.evidence,
    abloese: f.abloese.evidence
  };
  f.operationalEvidence = {
    gastro: f.gastro.evidence,
    abluft: f.operations.abluft.evidence,
    terrace: f.operations.terrace.evidence,
    openingHours: f.operations.openingHours.evidence
  };
  f.unknowns = unknowns(f);
  f.nextAction = nextAction(f);
  f.verifiedSummary = summary(f, context);
  f.keyFacts = [f.provision.evidence?.raw, f.kaution.evidence?.raw, f.abloese.evidence?.raw, f.operations.abluft.evidence?.raw, f.operations.terrace.evidence?.raw].filter(Boolean).slice(0, 6);
  return f;
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

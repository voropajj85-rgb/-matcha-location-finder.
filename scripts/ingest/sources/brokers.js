const { extractLinks, parseNumberFromText } = require('../utils');

const ADAPTERS = [
  {
    name: 'Colliers',
    catalogUrl: 'https://www.colliers.de/gewerbeimmobilien/muenchen/einzelhandel/',
    directPattern: /colliers\.de\/gewerbeimmobilien\/objekt\//i,
    sourceFamily: 'broker',
    sourceName: 'Colliers'
  },
  {
    name: 'JLL',
    catalogUrl: 'https://gewerbeimmobilien.jll.de/einzelhandel/ladenflaechen-mieten-muenchen',
    directPattern: /gewerbeimmobilien\.jll\.de\/einzelhandel\/(?!ladenflaechen-mieten-muenchen)([^/?#]+)/i,
    sourceFamily: 'broker',
    sourceName: 'JLL'
  }
];

const CURATED_LEADS = [
  {
    externalId: 'colliers-leopold',
    sourceName: 'Colliers',
    sourceUrl: 'https://www.colliers.de/gewerbeimmobilien/objekt/laden-muenchen-m-p4428-g1-e1/',
    listingType: 'broker_lead',
    title: 'Leopoldstraße broker lead',
    address: 'Leopoldstraße, München',
    district: 'Schwabing',
    gastroSuitability: 'possible',
    gastroEvidence: 'Broker lead can be relevant, but no concrete 25–80 m² unit is confirmed by discovery.'
  }
];

function plain(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleFromHtml(html) {
  return html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
    || null;
}

function matchEvidence(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { value: parseNumberFromText(match[1]), evidence: match[0] };
  }
  return { value: null, evidence: null };
}

function extractColliersArea(text) {
  const primary = matchEvidence(text, [
    /(?:^|\s)Fl[aä]che\s+([0-9][0-9.,]*)\s*m\s*2/i,
    /(?:^|\s)Fl[aä]che\s+([0-9][0-9.,]*)\s*(?:m²|qm|m2)/i,
    /(?:mietfl[aä]che|verkaufsfl[aä]che|ladenfl[aä]che|retailfl[aä]che)[^\d]{0,80}(?:ca\.\s*)?([0-9][0-9.,]*)\s*(?:m²|qm|m2)/i
  ]);

  const divisible = matchEvidence(text, [
    /(?:teilbar\s+ab|teilfl[aä]che\s+ab|ab)\s+(?:ca\.\s*)?([0-9][0-9.,]*)\s*(?:m²|qm|m2)/i
  ]);

  const total = matchEvidence(text, [
    /(?:gesamtfl[aä]che|gesamt)\s+(?:ca\.\s*)?([0-9][0-9.,]*)\s*(?:m²|qm|m2)/i
  ]);

  if (divisible.value && total.value && total.value > divisible.value) {
    return {
      unitArea: divisible.value,
      projectTotalArea: total.value,
      areaEvidence: divisible.evidence,
      projectAreaEvidence: total.evidence,
      areaType: 'divisible-from'
    };
  }

  return {
    unitArea: primary.value ?? divisible.value ?? total.value,
    projectTotalArea: total.value && primary.value && total.value !== primary.value ? total.value : null,
    areaEvidence: primary.evidence ?? divisible.evidence ?? total.evidence,
    projectAreaEvidence: total.evidence,
    areaType: primary.value ? 'unit-area' : (divisible.value ? 'divisible-from' : (total.value ? 'total-area' : null))
  };
}

function extractColliersRent(text) {
  if (/preis\s+auf\s+anfrage|miete\s*:\s*auf\s+anfrage|mietpreis\s+(?:ab\s+)?auf\s+anfrage/i.test(text)) {
    return { rent: null, rentEvidence: 'Preis auf Anfrage', rentConfidence: 'low' };
  }

  const monthly = matchEvidence(text, [
    /(?:miete|mietpreis|nettomiete|pacht)[^\d]{0,80}([0-9][0-9.,]*)\s*(?:€|eur)[^.;]{0,40}(?:monat|monatl)/i,
    /(?:miete|mietpreis|nettomiete|pacht)[^\d]{0,80}([0-9][0-9.,]*)\s*(?:€|eur)/i
  ]);

  if (!monthly.value) return { rent: null, rentEvidence: null, rentConfidence: 'low' };
  return { rent: monthly.value, rentEvidence: monthly.evidence, rentConfidence: 'high' };
}

function extractAvailability(text) {
  return text.match(/verf[uü]gbar(?:\s+ab)?[^.;]{0,80}/i)?.[0] || null;
}

function extractLocation(text) {
  const address = text.match(/(?:adresse|anschrift|lage)[^\w]{0,20}([^.;]{0,120}M[uü]nchen[^.;]{0,80})/i)?.[1]
    || text.match(/([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\-\s]+,\s*\d{5}\s*M[uü]nchen)/)?.[1]
    || text.match(/(M[uü]nchen[^.;,]{0,80})/i)?.[1]
    || 'München';
  return address.replace(/\s+/g, ' ').trim();
}

function candidateFromBrokerPage(adapter, sourceUrl, html, now) {
  const text = plain(html);
  const title = titleFromHtml(html);
  const adapterName = adapter.name || adapter.sourceName;
  const area = adapterName === 'Colliers'
    ? extractColliersArea(text)
    : {
      unitArea: parseNumberFromText(text.match(/(?:mietfl[aä]che|ladenfl[aä]che|verkaufsfl[aä]che|fl[aä]che|ab)[^\d]{0,50}([0-9][0-9.,]*)\s*(?:m²|qm|m2)/i)?.[1]),
      projectTotalArea: null,
      areaEvidence: null,
      projectAreaEvidence: null,
      areaType: null
    };
  const rent = adapterName === 'Colliers'
    ? extractColliersRent(text)
    : {
      rent: parseNumberFromText(text.match(/(?:miete|nettokaltmiete|pacht)[^\d]{0,60}([0-9][0-9.,]*)\s*(?:€|eur)/i)?.[1]),
      rentEvidence: null,
      rentConfidence: 'medium'
    };
  const availability = extractAvailability(text);
  const location = extractLocation(text);
  const usageType = text.match(/(?:nutzung|nutzungsart|objektart)[^.;]{0,90}/i)?.[0] || null;
  const retailSignal = /gastronomie|cafe|caf[eé]|laden|einzelhandel|retail|verkaufsfl[aä]che/i.test(text);

  return {
    sourceFamily: adapter.sourceFamily,
    sourceName: adapter.sourceName,
    sourceUrl,
    listingType: 'direct_listing',
    title,
    address: location,
    district: 'München',
    unitArea: area.unitArea,
    projectTotalArea: area.projectTotalArea,
    rent: rent.rent,
    provision: text.match(/provision[^.;]{0,120}/i)?.[0] || null,
    gastroSuitability: retailSignal ? 'possible' : 'unknown',
    gastroEvidence: retailSignal ? `${adapter.sourceName} object page mentions retail/gastro-compatible use.` : null,
    verifiedSummary: [
      title,
      area.areaEvidence ? `Fläche: ${area.areaEvidence}` : null,
      rent.rentEvidence ? `Miete: ${rent.rentEvidence}` : null,
      availability
    ].filter(Boolean).join(' · '),
    nextAction: rent.rent == null
      ? 'Mietpreis und verfügbare Teilfläche direkt beim Makler anfragen.'
      : 'Besichtigung und Gastro-/Retail-Nutzung mit dem Makler prüfen.',
    discoveryMethod: `${adapter.sourceName.toLowerCase()}-catalog-direct`,
    rawSourceData: {
      detectedAt: now,
      sourceTitle: title,
      sourceAreaText: area.areaEvidence,
      sourcePriceText: rent.rentEvidence,
      areaEvidence: area.areaEvidence,
      projectAreaEvidence: area.projectAreaEvidence,
      areaType: area.areaType,
      rentEvidence: rent.rentEvidence,
      rentConfidence: rent.rentConfidence,
      availability,
      usageType,
      sourceQuality: adapterName === 'Colliers' ? 'high' : 'medium'
    }
  };
}

async function discoverAdapter(adapter, { fetchPage, now }) {
  const candidates = [];
  const errors = [];

  try {
    const response = await fetchPage(adapter.catalogUrl);
    const objectUrls = extractLinks(response.body || '', response.finalUrl || adapter.catalogUrl, (url) => adapter.directPattern.test(url));
    if (!objectUrls.length) {
      errors.push({ sourceUrl: adapter.catalogUrl, message: `${adapter.name} catalog returned no individual object URLs` });
    }

    for (const sourceUrl of objectUrls.slice(0, 12)) {
      try {
        const page = await fetchPage(sourceUrl);
        candidates.push(candidateFromBrokerPage(adapter, page.finalUrl || sourceUrl, page.body || '', now));
      } catch (error) {
        errors.push({ sourceUrl, message: error.message });
      }
    }
  } catch (error) {
    errors.push({ sourceUrl: adapter.catalogUrl, message: error.message });
  }

  return { candidates, errors };
}

async function discover({ fetchPage, now } = {}) {
  const candidates = CURATED_LEADS.map((lead) => ({
    ...lead,
    sourceFamily: 'broker',
    unitArea: null,
    rent: null,
    discoveryMethod: 'broker-curated-lead',
    rawSourceData: { detectedAt: now, sourceTitle: lead.title }
  }));
  const errors = [];

  for (const adapter of ADAPTERS) {
    const result = await discoverAdapter(adapter, { fetchPage, now });
    candidates.push(...result.candidates);
    errors.push(...result.errors.map((error) => ({ ...error, source: adapter.name })));
  }

  return { source: 'Brokers', candidates, errors };
}

module.exports = { ADAPTERS, candidateFromBrokerPage, discover };

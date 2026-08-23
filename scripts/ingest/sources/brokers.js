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

function candidateFromBrokerPage(adapter, sourceUrl, html, now) {
  const text = plain(html);
  const title = titleFromHtml(html);
  const area = parseNumberFromText(text.match(/(?:mietfl[aä]che|ladenfl[aä]che|verkaufsfl[aä]che|fl[aä]che|ab)[^\d]{0,50}([0-9][0-9.,]*)\s*(?:m²|qm|m2)/i)?.[1]);
  const rent = parseNumberFromText(text.match(/(?:miete|nettokaltmiete|pacht)[^\d]{0,60}([0-9][0-9.,]*)\s*(?:€|eur)/i)?.[1]);
  const location = text.match(/(München[^.;,]{0,80})/i)?.[1] || 'München';

  return {
    sourceFamily: adapter.sourceFamily,
    sourceName: adapter.sourceName,
    sourceUrl,
    listingType: 'direct_listing',
    title,
    address: location,
    district: 'München',
    unitArea: area,
    rent,
    provision: text.match(/provision[^.;]{0,120}/i)?.[0] || null,
    gastroSuitability: /gastronomie|cafe|caf[eé]|laden|einzelhandel|retail/i.test(text) ? 'possible' : 'unknown',
    gastroEvidence: /gastronomie|cafe|caf[eé]|laden|einzelhandel|retail/i.test(text) ? `${adapter.sourceName} object page mentions retail/gastro-compatible use.` : null,
    discoveryMethod: `${adapter.sourceName.toLowerCase()}-catalog-direct`,
    rawSourceData: {
      detectedAt: now,
      sourceTitle: title,
      sourceAreaText: area == null ? null : String(area),
      sourcePriceText: rent == null ? null : String(rent)
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

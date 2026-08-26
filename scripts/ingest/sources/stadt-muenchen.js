const { extractLinks, parseNumberFromText } = require('../utils');

const CATALOG_URLS = [
  'https://stadt.muenchen.de/lhm-ms-wirtschaftsfoerderung/standort-muenchen/gewerbeflaechen-immobilien/gewerbeflaechen-angebote.html',
  'https://stadt.muenchen.de/service/info/stadtische-gewerbeflachen-verfugbare-objekte/1081087/n0/'
];

const SEEDS = [
  {
    externalId: 'stadt-fmq',
    sourceName: 'Stadt München',
    sourceUrl: 'https://stadt.muenchen.de/lhm-ms-wirtschaftsfoerderung/standort-muenchen/gewerbeflaechen-immobilien/gewerbeflaechen-angebote/buero-gewerbestandorte-FMQM%C3%BCnchen.html',
    listingType: 'project_lead',
    title: 'FMQ',
    address: 'Schwanthalerstraße 55–57, München',
    district: 'Schwanthalerhöhe',
    gastroSuitability: 'possible',
    gastroEvidence: 'Municipal project context can include retail/gastro use; concrete unit suitability is not confirmed.'
  },
  {
    externalId: 'stadt-amalie',
    sourceName: 'Stadt München / CBRE',
    sourceUrl: 'https://stadt.muenchen.de/lhm-ms-wirtschaftsfoerderung/standort-muenchen/gewerbeflaechen-immobilien/gewerbeflaechen-angebote/buero-gewerbestandorte-AMALIE.html',
    listingType: 'project_lead',
    title: 'AMALIE',
    address: 'Amalienstraße 33, München',
    district: 'Maxvorstadt',
    gastroSuitability: 'possible',
    gastroEvidence: 'Municipal/CBRE project context mentions retail/gastro; concrete Matcha-sized unit is not confirmed.'
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

function candidateFromPage(sourceUrl, html, now) {
  const text = plain(html);
  const title = titleFromHtml(html);
  const area = parseNumberFromText(text.match(/(?:ladenfl[aä]che|verkaufsfl[aä]che|gastronomie|fl[aä]che)[^\d]{0,40}([0-9][0-9.,]*)\s*(?:m²|qm|m2)/i)?.[1]);
  const rent = parseNumberFromText(text.match(/(?:miete|pacht|nettokaltmiete|monatlich)[^\d]{0,50}([0-9][0-9.,]*)\s*(?:€|eur)/i)?.[1]);
  const concrete = area != null && rent != null && /(laden|einzelhandel|gastronomie|kiosk|verkauf)/i.test(`${title} ${text}`);

  return {
    sourceFamily: 'municipal',
    sourceName: 'Stadt München',
    sourceUrl,
    listingType: concrete ? 'direct_listing' : 'project_lead',
    title,
    address: text.match(/([A-ZÄÖÜ][^.;]{3,80}(?:straße|str\.|platz|allee|weg)[^.;]{0,40}München)/i)?.[1] || null,
    district: 'München',
    unitArea: concrete ? area : null,
    rent: concrete ? rent : null,
    gastroSuitability: /gastronomie|cafe|caf[eé]|kiosk|imbiss/i.test(text) ? 'possible' : 'unknown',
    gastroEvidence: /gastronomie|cafe|caf[eé]|kiosk|imbiss/i.test(text) ? 'Municipal page mentions retail/gastro-compatible use.' : null,
    discoveryMethod: concrete ? 'municipal-catalog-direct' : 'municipal-catalog-lead',
    verifiedSummary: concrete ? null : 'Municipal/project source; concrete Matcha-sized unit must be requested or confirmed.',
    nextAction: concrete ? null : 'Kontakt aufnehmen und konkrete verfügbare Gastro/Retail-Flächen 25–80 m² mit Miete anfragen.',
    rawSourceData: {
      detectedAt: now,
      sourceTitle: title,
      sourceAreaText: area == null ? null : String(area),
      sourcePriceText: rent == null ? null : String(rent),
      sourceQuality: 'high'
    }
  };
}

async function discover({ fetchPage, now } = {}) {
  const candidates = [];
  const errors = [];
  const urls = new Set(SEEDS.map((seed) => seed.sourceUrl));

  for (const catalogUrl of CATALOG_URLS) {
    try {
      const response = await fetchPage(catalogUrl);
      const links = extractLinks(response.body || '', response.finalUrl || catalogUrl, (url) => (
        /stadt\.muenchen\.de/i.test(url)
        && /(gewerbeflaechen|gewerbeflachen|laden|gastronomie|einzelhandel)/i.test(url)
      ));
      for (const link of links) urls.add(link);
    } catch (error) {
      errors.push({ sourceUrl: catalogUrl, message: error.message });
    }
  }

  for (const seed of SEEDS) {
    candidates.push({
      ...seed,
      sourceFamily: 'municipal',
      unitArea: null,
      rent: null,
      discoveryMethod: 'municipal-curated-lead',
      rawSourceData: { detectedAt: now, sourceTitle: seed.title, sourceQuality: 'high' }
    });
  }

  for (const sourceUrl of [...urls].filter((url) => !SEEDS.some((seed) => seed.sourceUrl === url)).slice(0, 12)) {
    try {
      const response = await fetchPage(sourceUrl);
      candidates.push(candidateFromPage(response.finalUrl || sourceUrl, response.body || '', now));
    } catch (error) {
      errors.push({ sourceUrl, message: error.message });
    }
  }

  return { source: 'Stadt München', candidates, errors };
}

module.exports = { CATALOG_URLS, candidateFromPage, discover };

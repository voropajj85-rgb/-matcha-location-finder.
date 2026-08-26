const { canonicalizeListingUrl, extractLinks, isMunichTargetText, parseNumberFromText } = require('../utils');

const ADAPTERS = [
  {
    name: 'Colliers',
    catalogUrls: [
      'https://www.colliers.de/gewerbeimmobilien/muenchen/einzelhandel/',
      'https://www.colliers.de/gewerbeimmobilien/muenchen/'
    ],
    directPattern: /colliers\.de\/gewerbeimmobilien\/objekt\//i,
    sourceFamily: 'broker',
    sourceName: 'Colliers',
    sourceQuality: 'high',
    pageLimit: 3
  },
  {
    name: 'JLL',
    catalogUrls: ['https://gewerbeimmobilien.jll.de/einzelhandel/ladenflaechen-mieten-muenchen'],
    directPattern: /gewerbeimmobilien\.jll\.de\/einzelhandel\/(?!ladenflaechen-mieten-muenchen)([^/?#]+)/i,
    sourceFamily: 'broker',
    sourceName: 'JLL',
    sourceQuality: 'medium'
  },
  {
    name: 'Engel & Völkers',
    catalogUrls: [
      'https://www.engelvoelkers.com/de/de/immobilien/com/mieten/gewerbeimmobilien/bayern/muenchen',
      'https://www.engelvoelkers.com/de/de/immobilien/com/mieten/laden/bayern'
    ],
    directPattern: /engelvoelkers\.com\/de\/de\/exposes\//i,
    sourceFamily: 'broker',
    sourceName: 'Engel & Völkers',
    sourceQuality: 'high',
    pageLimit: 2
  },
  {
    name: 'immobilie1',
    catalogUrls: [
      'https://www.immobilie1.de/immobilien/bayern/muenchen/einzelhandel/mieten',
      'https://www.immobilie1.de/immobilien/bayern/muenchen/gastgewerbe/mieten'
    ],
    directPattern: /immobilie1\.de\/(?:\d{5}-)?[^/]+-\d{6,}/i,
    sourceFamily: 'broker',
    sourceName: 'immobilie1',
    sourceQuality: 'medium',
    pageLimit: 2
  },
  {
    name: 'Aigner Immobilien',
    catalogUrls: ['https://aigner-immobilien.de/immobilie/buero-praxis-ausstellungsraeume-80469-muenchen-glockenbachviertel-44299/'],
    directPattern: /aigner-immobilien\.de\/immobilie\//i,
    sourceFamily: 'broker',
    sourceName: 'Aigner Immobilien',
    sourceQuality: 'medium'
  },
  {
    name: 'Rohrer Immobilien',
    catalogUrls: ['https://www.rohrer-immobilien.de/gewerbeimmobilien/'],
    directPattern: /rohrer-immobilien\.de\/.*(?:gewerbe|immobilie)/i,
    sourceFamily: 'broker',
    sourceName: 'Rohrer Immobilien',
    sourceQuality: 'medium'
  },
  {
    name: 'BNP Paribas Real Estate',
    catalogUrls: ['https://www.bnppre.de/immobilien-mieten/gewerbe/muenchen/'],
    directPattern: /bnppre\.de\/.*(?:mieten|immobilie|gewerbe)/i,
    sourceFamily: 'broker',
    sourceName: 'BNP Paribas Real Estate',
    sourceQuality: 'medium'
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

function rawDescription(text) {
  return String(text || '').slice(0, 9000).trim() || null;
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
    return { rent: null, rentPerSqm: null, rentType: 'request', rentEvidence: 'Preis auf Anfrage', rentConfidence: 'low', priceStatus: 'request' };
  }

  const perSqm = matchEvidence(text, [
    /(?:miete|mietpreis|nettomiete|nettokaltmiete)[^\d]{0,80}([0-9][0-9.,]*)\s*(?:€|eur)\s*(?:\/|pro)?\s*(?:m\s*2|m²|m2|qm)/i,
    /(?:zur\s+miete|miete)\s*:\s*([0-9][0-9.,]*)\s*(?:€|eur)\s*(?:\/|pro)?\s*(?:m\s*2|m²|m2|qm)/i
  ]);
  if (perSqm.value) return { rent: null, rentPerSqm: perSqm.value, rentType: 'per_sqm', rentEvidence: perSqm.evidence, rentConfidence: 'high', priceStatus: 'unit_price' };

  const monthly = matchEvidence(text, [
    /(?:miete|mietpreis|nettomiete|pacht)[^\d]{0,80}([0-9][0-9.,]*)\s*(?:€|eur)[^.;]{0,40}(?:monat|monatl)/i,
    /(?:miete|mietpreis|nettomiete|pacht)[^\d]{0,80}([0-9][0-9.,]*)\s*(?:€|eur)/i
  ]);

  if (!monthly.value) return { rent: null, rentPerSqm: null, rentType: null, rentEvidence: null, rentConfidence: 'low', priceStatus: null };
  return { rent: monthly.value, rentPerSqm: null, rentType: 'monthly', rentEvidence: monthly.evidence, rentConfidence: 'high', priceStatus: 'confirmed' };
}

function extractGenericRent(text) {
  if (/preis\s+auf\s+anfrage|miete\s*:\s*auf\s+anfrage|mietpreis\s+(?:ab\s+)?auf\s+anfrage/i.test(text)) {
    return { rent: null, rentPerSqm: null, rentType: 'request', rentEvidence: 'Preis auf Anfrage', rentConfidence: 'low', priceStatus: 'request' };
  }

  const perSqm = matchEvidence(text, [
    /(?:gesamtmiete|nettokaltmiete|nettomiete|monatsmiete|miete|pacht)[^\d]{0,80}([0-9][0-9.,]*)\s*(?:€|eur)\s*(?:\/|pro)?\s*(?:m\s*2|m²|m2|qm)/i,
    /(?:nettokaltmiete|miete)\s*\/\s*(?:m\s*2|m²|m2|qm)[^\d]{0,30}([0-9][0-9.,]*)\s*(?:€|eur)/i
  ]);
  if (perSqm.value) return { rent: null, rentPerSqm: perSqm.value, rentType: 'per_sqm', rentEvidence: perSqm.evidence, rentConfidence: 'high', priceStatus: 'unit_price' };

  const monthly = matchEvidence(text, [
    /(?:gesamtmiete|nettokaltmiete|nettomiete|monatsmiete|miete|pacht)[^\d]{0,80}([0-9][0-9.,]*)\s*(?:€|eur)/i,
    /([0-9][0-9.,]*)\s*(?:€|eur)[^.;]{0,80}(?:gesamtmiete|nettokaltmiete|nettomiete|monatsmiete|miete|pacht)/i
  ]);

  if (!monthly.value) return { rent: null, rentPerSqm: null, rentType: null, rentEvidence: null, rentConfidence: 'low', priceStatus: null };
  return { rent: monthly.value, rentPerSqm: null, rentType: 'monthly', rentEvidence: monthly.evidence, rentConfidence: 'medium', priceStatus: 'confirmed' };
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
    : extractGenericRent(text);
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
    rentPerSqm: rent.rentPerSqm ?? null,
    rentType: rent.rentType || (rent.rent != null ? 'monthly' : null),
    priceStatus: rent.priceStatus,
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
      rawDescription: rawDescription(text),
      sourceAreaText: area.areaEvidence,
      sourcePriceText: rent.rentEvidence,
      areaEvidence: area.areaEvidence,
      projectAreaEvidence: area.projectAreaEvidence,
      areaType: area.areaType,
      rentEvidence: rent.rentEvidence,
      rentConfidence: rent.rentConfidence,
      availability,
      usageType,
      locationEvidence: location,
      sourceQuality: adapter.sourceQuality || 'medium'
    }
  };
}

function paginatedCatalogUrl(catalogUrl, page) {
  if (page <= 1) return catalogUrl;
  const url = canonicalizeListingUrl(catalogUrl);
  if (!url) return catalogUrl;
  if (/colliers\.de/i.test(url)) return url.replace(/\/$/, `/seite/${page}/`);
  if (/engelvoelkers\.com/i.test(url)) return `${url}${url.includes('?') ? '&' : '?'}page=${page}`;
  if (/immobilie1\.de/i.test(url)) return `${url}${url.includes('?') ? '&' : '?'}page=${page}`;
  return url;
}

async function discoverAdapter(adapter, { fetchPage, now }) {
  const candidates = [];
  const errors = [];
  const seen = new Set();
  const meta = { pagesScanned: 0, duplicateLinks: 0, catalogs: (adapter.catalogUrls || [adapter.catalogUrl]).length };

  for (const catalogUrl of adapter.catalogUrls || [adapter.catalogUrl]) {
    for (let page = 1; page <= (adapter.pageLimit || 1); page += 1) {
      const pageUrl = paginatedCatalogUrl(catalogUrl, page);
      try {
        const response = await fetchPage(pageUrl);
        meta.pagesScanned += 1;
        const objectUrls = extractLinks(response.body || '', response.finalUrl || pageUrl, (url) => adapter.directPattern.test(url));
        if (!objectUrls.length) {
          if (page === 1) errors.push({ sourceUrl: pageUrl, message: `${adapter.name} catalog returned no individual object URLs` });
          break;
        }

        let newLinks = 0;
        for (const sourceUrl of objectUrls.slice(0, 24)) {
          if (seen.has(sourceUrl)) {
            meta.duplicateLinks += 1;
            continue;
          }
          seen.add(sourceUrl);
          newLinks += 1;
          try {
            const pageResponse = await fetchPage(sourceUrl);
            const candidate = candidateFromBrokerPage(adapter, pageResponse.finalUrl || sourceUrl, pageResponse.body || '', now);
            candidate.rawSourceData = {
              ...(candidate.rawSourceData || {}),
              catalogUrl,
              catalogPageUrl: pageUrl,
              outsideMunich: !isMunichTargetText(`${candidate.title || ''} ${candidate.address || ''} ${candidate.rawSourceData?.locationEvidence || ''}`)
            };
            candidates.push(candidate);
          } catch (error) {
            errors.push({ sourceUrl, message: error.message });
          }
        }
        if (newLinks === 0) break;
      } catch (error) {
        errors.push({ sourceUrl: pageUrl, message: error.message });
        break;
      }
    }
  }

  return { candidates, errors, meta };
}

async function discover({ fetchPage, now } = {}) {
  const candidates = CURATED_LEADS.map((lead) => ({
    ...lead,
    sourceFamily: 'broker',
    unitArea: null,
    rent: null,
    discoveryMethod: 'broker-curated-lead',
    rawSourceData: { detectedAt: now, sourceTitle: lead.title, sourceQuality: 'high' }
  }));
  const errors = [];
  const meta = {
    adapters: ADAPTERS.length,
    pagesScanned: 0,
    sources: {}
  };

  for (const adapter of ADAPTERS) {
    const result = await discoverAdapter(adapter, { fetchPage, now });
    candidates.push(...result.candidates);
    errors.push(...result.errors.map((error) => ({ ...error, source: adapter.name })));
    meta.sources[adapter.name] = result.meta;
    meta.pagesScanned += result.meta?.pagesScanned || 0;
  }

  return { source: 'Brokers', candidates, errors, meta };
}

module.exports = { ADAPTERS, candidateFromBrokerPage, discover };

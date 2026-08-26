const { parseNumberFromText } = require('./utils');
const { extractListingFacts, extractRent, extractArea } = require('./extract-listing-facts');

function textContent(html, pattern) {
  const match = String(html || '').match(pattern);
  return match?.[1]?.replace(/\s+/g, ' ').trim() || null;
}

function meaningfulTitle(value) {
  const title = String(value || '')
    .replace(/\s*\|\s*Kleinanzeigen(?:\.de)?\s*$/i, '')
    .replace(/\s*-\s*Kleinanzeigen(?:\.de)?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return !title || /^kleinanzeigen(?:\.de)?$/i.test(title) ? null : title;
}

function titleFromHtml(html) {
  const h1 = textContent(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const og = textContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || textContent(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const title = textContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  return meaningfulTitle(h1) || meaningfulTitle(og) || meaningfulTitle(title);
}

function descriptionFromHtml(html) {
  return textContent(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || textContent(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || textContent(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
}

function plainTextFromHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&euro;/gi, '€')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSummary(value, maxLength = 700) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\b(Energieausweis|Energiebedarf|Endenergieverbrauch)\b[\s\S]*$/i, '')
    .replace(/\b(RE\/MAX|Karriere|Immobilienmakler)\b[\s\S]*$/i, '')
    .trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function scopedListingText(plainText, title) {
  const text = String(plainText || '').replace(/\s+/g, ' ').trim();
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  if (!cleanTitle || cleanTitle.length < 8) return text.slice(0, 9000);
  const index = text.toLowerCase().indexOf(cleanTitle.toLowerCase().slice(0, 80));
  if (index < 0) return text.slice(0, 9000);
  const markers = ['Das könnte dich auch interessieren', 'Weitere Anzeigen', 'Ähnliche Anzeigen', 'Empfohlene Anzeigen'];
  let end = Math.min(text.length, index + 9000);
  for (const marker of markers) {
    const markerIndex = text.indexOf(marker, index + cleanTitle.length);
    if (markerIndex > index) end = Math.min(end, markerIndex);
  }
  return text.slice(index, end);
}

function jsonLdFacts(html) {
  const facts = {};
  const blocks = String(html || '').match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim());
      for (const item of (Array.isArray(parsed) ? parsed : [parsed])) {
        if (!facts.title && meaningfulTitle(item?.name)) facts.title = meaningfulTitle(item.name);
        if (!facts.description && item?.description) facts.description = String(item.description);
        if (!facts.address && typeof item?.address === 'string') facts.address = item.address;
        if (!facts.address && item?.address?.streetAddress) facts.address = item.address.streetAddress;
      }
    } catch {
      // Malformed JSON-LD is ignored safely.
    }
  }
  return facts;
}

function collectRawFinancialEvidence(text) {
  const patterns = [
    /kaution[^.;|]{0,100}/gi,
    /provision[^.;|]{0,100}/gi,
    /provisionsfrei[^.;|]{0,80}/gi,
    /abl[oö]se[^.;|]{0,100}/gi,
    /nebenkosten[^.;|]{0,100}/gi,
    /zzgl\.\s*NK[^.;|]{0,80}/gi,
    /inventar\s+gegen\s+abl[oö]se[^.;|]{0,80}/gi
  ];
  const out = [];
  const seen = new Set();
  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      const value = match[0].replace(/\s+/g, ' ').trim();
      if (value && !seen.has(value.toLowerCase())) {
        seen.add(value.toLowerCase());
        out.push(value);
      }
    }
  }
  return out.slice(0, 12);
}

function legacyCondition(fact) {
  if (!fact || fact.status === 'unknown') return null;
  return { known: true, value: fact.evidence?.raw || null, amount: fact.amount ?? null, ...fact };
}

function rentFromText(text) {
  const fact = extractRent(text);
  return {
    rent: fact.amount,
    rentEvidence: fact.evidence?.raw || null,
    rentConfidence: fact.evidence?.confidence || 'low',
    priceStatus: fact.status === 'request' ? 'request' : null
  };
}

function conditionText(text, label) {
  const match = String(text || '').match(new RegExp(`(${label}[^\\n|;]{0,120})`, 'i'));
  if (!match) return null;
  const value = match[1].trim();
  const euro = value.match(/([0-9][0-9.,]*)\s*(?:€|EUR)/i);
  const months = value.match(/([0-9][0-9.,]*)\s*(?:MM|monatsmieten?|nettokaltmieten?|kaltmieten?)/i);
  let amount = null;
  if (euro) {
    const parsed = parseNumberFromText(euro[1]);
    amount = parsed != null && parsed >= 50 ? parsed : null;
  } else if (months) amount = parseNumberFromText(months[1]);
  return { known: true, value, amount };
}

// Compatibility helpers used by the pre-Phase-3B test suite. Production enrichment below uses extractArea().
function collectAreaCandidates(text) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const candidates = [];
  const high = '(?:verkaufs[\\s\\/-]*ladenfl[aä]che|verkaufsfl[aä]che|ladenfl[aä]che|ladenzeile|verkaufsraum|gastrofl[aä]che|gastraumfl[aä]che|gastraum)';
  const medium = '(?:nutzfl[aä]che|gesamtfl[aä]che|gewerbefl[aä]che)';
  const add = (regex, areaType, priority) => {
    for (const match of source.matchAll(regex)) {
      const value = parseNumberFromText(match.groups?.value || match[1]);
      if (!Number.isFinite(value) || value < 5 || value > 500) continue;
      candidates.push({ value, evidence: match[0].trim(), areaType, priority });
    }
  };
  add(new RegExp(`${high}\\s*(?::|mit)?\\s*(?:ca\\.?|circa|ungef[aä]hr)?\\s*(?<value>[0-9][0-9.,]*)\\s*(?:m²|qm|m2)`, 'ig'), 'sales_area', 110);
  add(new RegExp(`(?<value>[0-9][0-9.,]*)\\s*(?:m²|qm|m2)\\s*${high}`, 'ig'), 'sales_area', 105);
  add(new RegExp(`${medium}\\s*:?[\\s-]*(?:ca\\.?|circa|ungef[aä]hr)?\\s*(?<value>[0-9][0-9.,]*)\\s*(?:m²|qm|m2)`, 'ig'), 'main_unit_area', 60);
  const seen = new Set();
  return candidates.sort((a, b) => b.priority - a.priority).filter((candidate) => {
    const key = `${candidate.value}:${candidate.areaType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function areaFromText(text) {
  const candidates = collectAreaCandidates(text);
  const best = candidates[0];
  if (best) return { unitArea: best.value, areaEvidence: best.evidence, areaType: best.areaType, areaCandidates: candidates };
  const modern = extractArea(text);
  return {
    unitArea: modern.unitArea,
    projectTotalArea: modern.projectTotalArea,
    areaEvidence: modern.evidence?.raw || null,
    areaType: modern.areaType,
    areaCandidates: modern.candidates || []
  };
}

async function enrichListing(listing, { fetchPage } = {}) {
  if (listing.listingType !== 'direct_listing' || !listing.sourceUrl || !fetchPage) return listing;
  try {
    const response = await fetchPage(listing.sourceUrl);
    const html = response.body || '';
    const plainText = plainTextFromHtml(html);
    const jsonLd = jsonLdFacts(html);
    const title = jsonLd.title || titleFromHtml(html) || listing.title;
    const metaDescription = compactSummary(jsonLd.description || descriptionFromHtml(html));
    const scopedText = scopedListingText(plainText, title);
    const extractionText = `${title || ''} ${metaDescription || ''} ${scopedText}`;
    const facts = extractListingFacts(extractionText, {
      title,
      address: jsonLd.address || listing.address,
      district: listing.district
    });

    const unitArea = facts.area.unitArea ?? listing.unitArea ?? listing.area ?? null;
    return {
      ...listing,
      title,
      address: jsonLd.address || listing.address,
      rent: facts.rent.amount ?? listing.rent ?? null,
      rentType: facts.rent.type || listing.rentType || null,
      priceStatus: facts.rent.status === 'request' ? 'request' : (listing.priceStatus || null),
      unitArea,
      area: unitArea,
      areaType: facts.area.areaType || listing.areaType || listing.rawSourceData?.areaType || null,
      projectTotalArea: facts.area.projectTotalArea ?? listing.projectTotalArea ?? null,
      nebenkosten: legacyCondition(facts.nebenkosten) || listing.nebenkosten,
      provision: legacyCondition(facts.provision) || listing.provision,
      abloese: legacyCondition(facts.abloese) || listing.abloese,
      kaution: legacyCondition(facts.kaution) || listing.kaution,
      gastroSuitability: facts.gastro.status !== 'unknown' ? facts.gastro.status : (listing.gastroSuitability || 'unknown'),
      gastroEvidence: facts.gastro.evidence?.raw || listing.gastroEvidence || null,
      abluft: facts.operations.abluft,
      terrace: facts.operations.terrace,
      openingHoursRestrictions: facts.operations.openingHours.status === 'restricted' ? facts.operations.openingHours : null,
      wc: facts.operations.wc,
      waterConnection: facts.operations.waterConnection,
      existingBusiness: facts.existing.existingBusiness,
      inventoryIncluded: facts.existing.inventoryIncluded,
      takeoverRequired: facts.existing.takeoverRequired,
      verifiedSummary: facts.verifiedSummary || metaDescription || compactSummary(listing.verifiedSummary),
      keyFacts: facts.keyFacts,
      unknowns: facts.unknowns,
      nextAction: facts.nextAction,
      rawSourceData: {
        ...(listing.rawSourceData || {}),
        sourceTitle: title || null,
        rawDescription: scopedText.slice(0, 9000) || null,
        financialEvidence: collectRawFinancialEvidence(scopedText),
        financialEvidenceStructured: facts.financialEvidence,
        operationalEvidence: facts.operationalEvidence,
        phase3bFacts: facts,
        sourcePriceText: facts.rent.evidence?.raw || listing.rawSourceData?.sourcePriceText || null,
        sourceAreaText: facts.area.evidence?.raw || listing.rawSourceData?.sourceAreaText || null,
        rentEvidence: facts.rent.evidence?.raw || listing.rawSourceData?.rentEvidence || null,
        rentConfidence: facts.rent.evidence?.confidence || listing.rawSourceData?.rentConfidence || null,
        areaEvidence: facts.area.evidence?.raw || listing.rawSourceData?.areaEvidence || null,
        areaType: facts.area.areaType || listing.rawSourceData?.areaType || null,
        areaCandidates: facts.area.candidates,
        extractionVersion: 'phase3b-v1',
        enrichmentStatus: 'success',
        httpStatus: response.status,
        finalUrl: response.finalUrl
      }
    };
  } catch (error) {
    return { ...listing, rawSourceData: { ...(listing.rawSourceData || {}), enrichmentStatus: 'failed', enrichmentError: error.message } };
  }
}

async function enrichListings(listings, options) {
  const enriched = [];
  for (const listing of listings) enriched.push(await enrichListing(listing, options));
  return enriched;
}

module.exports = {
  enrichListing,
  enrichListings,
  rentFromText,
  areaFromText,
  collectAreaCandidates,
  compactSummary,
  conditionText,
  meaningfulTitle
};

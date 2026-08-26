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
  if (!title || /^kleinanzeigen(?:\.de)?$/i.test(title)) return null;
  return title;
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
    const body = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try {
      const parsed = JSON.parse(body);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!facts.title && meaningfulTitle(item?.name)) facts.title = meaningfulTitle(item.name);
        if (!facts.description && item?.description) facts.description = String(item.description);
        if (!facts.address && typeof item?.address === 'string') facts.address = item.address;
        if (!facts.address && item?.address?.streetAddress) facts.address = item.address.streetAddress;
      }
    } catch {
      // Ignore malformed third-party JSON-LD.
    }
  }
  return facts;
}

function legacyCondition(fact) {
  if (!fact || fact.status === 'unknown') return null;
  return {
    known: true,
    value: fact.evidence?.raw || null,
    amount: fact.amount ?? null,
    ...fact
  };
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
      const key = value.toLowerCase();
      if (value && !seen.has(key)) {
        seen.add(key);
        out.push(value);
      }
      if (out.length >= 12) return out;
    }
  }
  return out;
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

const HIGH_AREA = /verkaufs[\s\/-]*ladenfl[aä]che|verkaufsfl[aä]che|ladenfl[aä]che|ladenzeile|verkaufsraum|gastrofl[aä]che|gastraumfl[aä]che|gastraum/i;
const MEDIUM_AREA = /nutzfl[aä]che|gesamtfl[aä]che|gewerbefl[aä]che/i;
const SECONDARY_AREA = /kellerfl[aä]che|lagerfl[aä]che|nebenfl[aä]che|nebenraum|zus[aä]tzlicher\s+raum|terrasse|au[sß]enfl[aä]che|grundst[uü]ck|projektfl[aä]che|geb[aä]udefl[aä]che/i;

function collectAreaCandidates(text) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  const matches = [...source.matchAll(/(?:ca\.?|circa|ungef[aä]hr)?\s*([0-9][0-9.,]*)\s*(?:m²|qm|m2)/gi)];
  const candidates = [];
  for (const match of matches) {
    const value = parseNumberFromText(match[1]);
    if (!Number.isFinite(value) || value < 5 || value > 500) continue;
    const before = source.slice(Math.max(0, match.index - 65), match.index);
    const after = source.slice(match.index + match[0].length, Math.min(source.length, match.index + match[0].length + 65));
    const context = `${before} ${match[0]} ${after}`;
    const beforeSecondary = SECONDARY_AREA.test(before) && !/\b(?:und|oder|,|;)\s*$/i.test(before);
    const afterSecondary = SECONDARY_AREA.test(after.split(/\b(?:und|oder|,|;)/i)[0]);
    if (beforeSecondary || (afterSecondary && !HIGH_AREA.test(before))) continue;
    let priority = 0;
    let areaType = 'unknown_area';
    if (HIGH_AREA.test(before) || HIGH_AREA.test(after)) {
      priority = 100;
      areaType = 'sales_area';
    } else if (MEDIUM_AREA.test(before) || MEDIUM_AREA.test(after)) {
      priority = 60;
      areaType = 'main_unit_area';
    }
    if (priority === 0) continue;
    let evidence = match[0].trim();
    const postLabel = after.match(/^\s*(verkaufs[\s\/-]*ladenfl[aä]che|verkaufsfl[aä]che|ladenfl[aä]che|ladenzeile|verkaufsraum|gastrofl[aä]che|gastraumfl[aä]che)/i);
    const preLabel = before.match(/(verkaufs[\s\/-]*ladenfl[aä]che|verkaufsfl[aä]che|ladenfl[aä]che|ladenzeile|verkaufsraum|gastrofl[aä]che|gastraumfl[aä]che)(?:\s*:\s*|\s+mit\s+)?$/i);
    if (postLabel) evidence = `${match[0].trim()} ${postLabel[1]}`;
    else if (preLabel) evidence = `${preLabel[1]} ${match[0].trim()}`;
    candidates.push({ value, evidence, areaType, priority });
  }
  return candidates.sort((a, b) => b.priority - a.priority);
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
  } else if (months) {
    amount = parseNumberFromText(months[1]);
  }
  return { known: true, value, amount };
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
    const legacyArea = areaFromText(extractionText);

    const rent = facts.rent.amount ?? listing.rent ?? null;
    const unitArea = facts.area.unitArea ?? legacyArea.unitArea ?? listing.unitArea ?? listing.area ?? null;
    const projectTotalArea = facts.area.projectTotalArea ?? listing.projectTotalArea ?? null;

    return {
      ...listing,
      title,
      address: jsonLd.address || listing.address,
      rent,
      rentType: facts.rent.type || listing.rentType || null,
      priceStatus: facts.rent.status === 'request' ? 'request' : (listing.priceStatus || null),
      unitArea,
      area: unitArea,
      areaType: facts.area.areaType || legacyArea.areaType || listing.areaType || listing.rawSourceData?.areaType || null,
      projectTotalArea,
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
        sourceAreaText: facts.area.evidence?.raw || legacyArea.areaEvidence || listing.rawSourceData?.sourceAreaText || null,
        rentEvidence: facts.rent.evidence?.raw || listing.rawSourceData?.rentEvidence || null,
        rentConfidence: facts.rent.evidence?.confidence || listing.rawSourceData?.rentConfidence || null,
        areaEvidence: facts.area.evidence?.raw || legacyArea.areaEvidence || listing.rawSourceData?.areaEvidence || null,
        areaType: facts.area.areaType || legacyArea.areaType || listing.rawSourceData?.areaType || null,
        areaCandidates: facts.area.candidates?.length ? facts.area.candidates : legacyArea.areaCandidates,
        extractionVersion: 'phase3b-v1',
        enrichmentStatus: 'success',
        httpStatus: response.status,
        finalUrl: response.finalUrl
      }
    };
  } catch (error) {
    return {
      ...listing,
      rawSourceData: {
        ...(listing.rawSourceData || {}),
        enrichmentStatus: 'failed',
        enrichmentError: error.message
      }
    };
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

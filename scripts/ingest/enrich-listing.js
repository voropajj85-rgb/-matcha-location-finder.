const { parseNumberFromText } = require('./utils');

function textContent(html, pattern) {
  const match = html.match(pattern);
  return match?.[1]?.replace(/\s+/g, ' ').trim() || null;
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
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function rawDescriptionFromText(plainText, title, maxLength = 9000) {
  const scoped = scopedListingText(plainText, title);
  return scoped.slice(0, maxLength).trim() || plainText.slice(0, maxLength).trim() || null;
}

function financialEvidenceFromText(text) {
  const patterns = [
    /kaution\s+\d+(?:[,.]\d+)?\s*monatsmieten/gi,
    /provision\s+\d+(?:[,.]\d+)?\s*MM/gi,
    /abl[oö]se\s+\d{1,3}(?:\.\d{3})*(?:,\d+)?\s*(?:€|eur)/gi,
    /nebenkosten\s+\d{1,3}(?:\.\d{3})*(?:,\d+)?\s*(?:€|eur)/gi,
    /zzgl\.\s*NK/gi,
    /inventar\s+gegen\s+abl[oö]se/gi,
    /kaution[^.;|]{0,100}/gi,
    /provision[^.;|]{0,100}/gi,
    /provisionsfrei[^.;|]{0,80}/gi,
    /abl[oö]se[^.;|]{0,100}/gi,
    /nebenkosten[^.;|]{0,100}/gi,
    /zzgl\.\s*NK[^.;|]{0,80}/gi,
    /inventar[^.;|]{0,100}/gi
  ];
  const seen = new Set();
  const evidence = [];
  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      const value = match[0].replace(/\s+/g, ' ').trim();
      const key = value.toLowerCase();
      if (value.length >= 5 && !seen.has(key)) {
        seen.add(key);
        evidence.push(value);
      }
      if (evidence.length >= 12) return evidence;
    }
  }
  return evidence;
}

function compactSummary(value, maxLength = 700) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\b(Energieausweis|Energiebedarf|Endenergieverbrauch)\b[\s\S]*$/i, '')
    .replace(/\b(RE\/MAX|Karriere|Immobilienmakler)\b[\s\S]*$/i, '')
    .trim();
  if (!text) return null;

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 5);
  const summary = sentences.join(' ') || text;
  return summary.length > maxLength ? `${summary.slice(0, maxLength).trim()}...` : summary;
}

function scopedListingText(plainText, title) {
  const text = String(plainText || '').replace(/\s+/g, ' ').trim();
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  if (!cleanTitle || cleanTitle.length < 8) return text.slice(0, 5000);

  const index = text.toLowerCase().indexOf(cleanTitle.toLowerCase().slice(0, 80));
  if (index < 0) return text.slice(0, 5000);

  const nextListingMarkers = [
    'Das könnte dich auch interessieren',
    'Weitere Anzeigen',
    'Ähnliche Anzeigen',
    'Empfohlene Anzeigen'
  ];
  let end = Math.min(text.length, index + 5000);
  for (const marker of nextListingMarkers) {
    const markerIndex = text.indexOf(marker, index + cleanTitle.length);
    if (markerIndex > index) end = Math.min(end, markerIndex);
  }

  return text.slice(index, end);
}

function jsonLdFacts(html) {
  const facts = {};
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];

  for (const block of blocks) {
    const body = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    try {
      const parsed = JSON.parse(body);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!facts.title && meaningfulTitle(item.name)) facts.title = meaningfulTitle(item.name);
        if (!facts.verifiedSummary && item.description) facts.verifiedSummary = item.description;
        if (!facts.address && typeof item.address === 'string') facts.address = item.address;
        if (!facts.address && item.address?.streetAddress) facts.address = item.address.streetAddress;
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        if (!facts.rent && offer?.price) facts.rent = Number(offer.price);
      }
    } catch {
      // Third-party pages often contain malformed JSON-LD; ignore safely.
    }
  }

  return facts;
}

function rentFromText(text) {
  const blockedContext = /(abl[oö]se|kaution|provision|inventar|kaufpreis|umsatz|gewinn|automaten|nebenkosten)/i;
  const patterns = [
    /((?:kaltmiete|nettokaltmiete|nettomiete|monatsmiete|miete|pacht|monatlich|pro monat)[^.|\n;€]{0,80}?([0-9][0-9.,]*)\s*(?:€|eur))/i,
    /(([0-9][0-9.,]*)\s*(?:€|eur)[^.|\n;]{0,80}?(?:kaltmiete|nettokaltmiete|nettomiete|monatsmiete|miete|pacht|monatlich|pro monat))/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match || blockedContext.test(match[1])) continue;
    const beforeMatch = text.slice(Math.max(0, match.index - 30), match.index);
    if (blockedContext.test(beforeMatch)) continue;
    const value = parseNumberFromText(match[2]);
    if (value != null && value >= 100 && value <= 20000) {
      return { rent: value, rentEvidence: match[1].trim(), rentConfidence: /kaltmiete|nettokaltmiete|nettomiete|monatsmiete|pacht/i.test(match[1]) ? 'high' : 'medium' };
    }
  }

  return { rent: null, rentEvidence: null, rentConfidence: 'low' };
}

const HIGH_AREA_PATTERN = /verkaufs[\s-/]*ladenfl[aä]che|verkaufsfl[aä]che|ladenfl[aä]che|ladenzeile|verkaufsraum|gastrofl[aä]che|gastraumfl[aä]che|gastraum/i;
const MEDIUM_AREA_PATTERN = /nutzfl[aä]che|gesamtfl[aä]che|gewerbefl[aä]che|(?:^|[^a-zäöüß])fl[aä]che(?:$|[^a-zäöüß])/i;
const SECONDARY_AREA_PATTERN = /kellerfl[aä]che|lagerfl[aä]che|nebenfl[aä]che|nebenraum|zus[aä]tzlicher\s+raum|obergeschoss[-\s]*zusatzraum|terrasse|terrassenfl[aä]che|au[sß]enfl[aä]che|grundst[uü]ck|grundst[uü]cksfl[aä]che|projektfl[aä]che|geb[aä]udefl[aä]che/i;

function classifyAreaContext(context, { allowSecondary = true } = {}) {
  if (HIGH_AREA_PATTERN.test(context)) return { areaType: 'sales_area', priority: 100 };
  if (MEDIUM_AREA_PATTERN.test(context) && !SECONDARY_AREA_PATTERN.test(context)) return { areaType: 'main_unit_area', priority: 60 };
  if (allowSecondary && SECONDARY_AREA_PATTERN.test(context)) return { areaType: 'secondary_area', priority: -100 };
  return { areaType: 'unknown_area', priority: 0 };
}

function classifyAreaCandidate(beforeContext, afterContext, { hasPreviousArea = false } = {}) {
  const secondaryBefore = SECONDARY_AREA_PATTERN.test(beforeContext);
  const separatedFromSecondary = /\b(?:und|oder|,|;)\s*$/i.test(beforeContext);
  if (secondaryBefore && !separatedFromSecondary) {
    return { areaType: 'secondary_area', priority: -100 };
  }

  if (hasPreviousArea && SECONDARY_AREA_PATTERN.test(afterContext)) {
    return { areaType: 'secondary_area', priority: -100 };
  }

  const before = classifyAreaContext(beforeContext, { allowSecondary: false });
  if (before.priority !== 0) return before;
  if (SECONDARY_AREA_PATTERN.test(afterContext)) {
    return { areaType: 'secondary_area', priority: -100 };
  }
  const after = classifyAreaContext(afterContext, { allowSecondary: false });
  if (after.priority !== 0) return after;
  return classifyAreaContext(`${beforeContext} ${afterContext}`);
}

function compactAreaEvidence(value, context) {
  const text = String(context || '').replace(/\s+/g, ' ').trim();
  const valuePattern = String(value).replace('.', '[,.]');
  const unitPattern = new RegExp(`(?:ca\\.?\\s*)?${valuePattern}\\s*(?:m²|qm|m2)`, 'i');
  const valueMatch = text.match(unitPattern);
  if (!valueMatch) return text.slice(0, 160);

  const start = Math.max(0, valueMatch.index - 45);
  const end = Math.min(text.length, valueMatch.index + valueMatch[0].length + 55);
  return text.slice(start, end).replace(/^[\s:;,\-)]+/, '').trim();
}

function collectAreaCandidates(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const candidates = [];
  const areaRegex = /(?:ca\.?|circa|ungef[aä]hr)?\s*([0-9][0-9.,]*)\s*(?:m²|qm|m2)/gi;
  const matches = [...normalized.matchAll(areaRegex)];

  for (const [index, match] of matches.entries()) {
    const value = parseNumberFromText(match[1]);
    if (value == null || value < 5 || value > 500) continue;

    const previousEnd = index > 0 ? matches[index - 1].index + matches[index - 1][0].length : 0;
    const nextStart = index < matches.length - 1 ? matches[index + 1].index : normalized.length;
    const start = Math.max(previousEnd, match.index - 70);
    const end = Math.min(nextStart, match.index + match[0].length + 80);
    const beforeContext = normalized.slice(start, match.index);
    const afterContext = normalized.slice(match.index, end);
    const context = normalized.slice(start, end);
    const classified = classifyAreaCandidate(beforeContext, afterContext, { hasPreviousArea: index > 0 });
    if (classified.priority < 0) continue;

    candidates.push({
      value,
      evidence: compactAreaEvidence(value, context),
      areaType: classified.areaType,
      priority: classified.priority,
      index: match.index
    });
  }

  return candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.index - b.index;
  });
}

function areaFromText(text) {
  const candidates = collectAreaCandidates(text);
  const best = candidates[0];
  if (!best) return { unitArea: null, areaEvidence: null, areaType: null, areaCandidates: [] };

  return {
    unitArea: best.value,
    areaEvidence: best.evidence,
    areaType: best.areaType,
    areaCandidates: candidates.map(({ value, evidence, areaType, priority }) => ({
      value,
      evidence,
      areaType,
      priority
    }))
  };
}

function conditionText(text, label) {
  const pattern = new RegExp(`(${label}[^\\n|;]{0,100})`, 'i');
  const value = text.match(pattern)?.[1]?.trim() || null;
  if (!value) return null;

  let amount = null;
  const euroMatch = value.match(/([0-9][0-9.,]*)\s*(?:€|eur)/i);
  const monthMatch = value.match(/([0-9][0-9.,]*)\s*(?:monatsmieten|monatsmiete|nettokaltmieten|kaltmieten)/i);
  if (euroMatch) {
    const parsed = parseNumberFromText(euroMatch[1]);
    amount = parsed != null && parsed >= 50 ? parsed : null;
  }
  else if (monthMatch) amount = parseNumberFromText(monthMatch[1]);

  return { known: true, value, amount };
}

function gastroSignal(text) {
  const negative = text.match(/(keine abluft|keine k[uü]chenabluft|keine warme k[uü]che|warme speisen nicht m[oö]glich|keine gastronomie|gastro nicht erlaubt)/i);
  const match = text.match(/(caf[eé]|gastronomie|gastst[aä]tte|imbiss|kiosk|bistro|te ilgastro|teilgastro|laden)/i);
  if (negative && match) {
    return {
      gastroSuitability: 'possible',
      gastroEvidence: `Direct page has relevant use signal (${match[1]}) but limitation: ${negative[1]}`
    };
  }
  if (negative) {
    return {
      gastroSuitability: 'unknown',
      gastroEvidence: `Direct page contains gastro limitation: ${negative[1]}`
    };
  }
  if (!match) return {};
  return {
    gastroSuitability: 'possible',
    gastroEvidence: `Direct page text contains relevant use signal: ${match[1]}`
  };
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

async function enrichListing(listing, { fetchPage } = {}) {
  if (listing.listingType !== 'direct_listing' || !listing.sourceUrl || !fetchPage) return listing;

  try {
    const response = await fetchPage(listing.sourceUrl);
    const html = response.body || '';
    const plainText = plainTextFromHtml(html);
    const jsonLd = jsonLdFacts(html);
    const title = jsonLd.title || titleFromHtml(html);
    const description = compactSummary(jsonLd.verifiedSummary || descriptionFromHtml(html));
    const scopedText = scopedListingText(plainText, title);
    const rawDescription = rawDescriptionFromText(plainText, title);
    const extractableText = `${title || ''} ${description || ''} ${scopedText}`;
    const rentResult = jsonLd.rent
      ? { rent: jsonLd.rent, rentEvidence: 'structured offer price', rentConfidence: 'medium' }
      : rentFromText(extractableText);
    const areaResult = areaFromText(extractableText);
    const gastro = gastroSignal(`${title || ''} ${description || ''} ${plainText.slice(0, 2000)}`);

    return {
      ...listing,
      title: title || listing.title,
      address: jsonLd.address || listing.address,
      rent: rentResult.rent ?? listing.rent,
      unitArea: areaResult.unitArea ?? listing.unitArea,
      area: areaResult.unitArea ?? listing.area,
      verifiedSummary: description || compactSummary(listing.verifiedSummary),
      provision: conditionText(plainText, 'provision') || listing.provision,
      abloese: conditionText(plainText, 'ablöse|abloese') || listing.abloese,
      kaution: conditionText(plainText, 'kaution') || listing.kaution,
      gastroSuitability: gastro.gastroSuitability || listing.gastroSuitability,
      gastroEvidence: gastro.gastroEvidence || listing.gastroEvidence,
      rawSourceData: {
        ...(listing.rawSourceData || {}),
        sourceTitle: title || listing.rawSourceData?.sourceTitle || null,
        rawDescription: rawDescription || listing.rawSourceData?.rawDescription || null,
        financialEvidence: financialEvidenceFromText(rawDescription || plainText),
        sourcePriceText: rentResult.rent == null ? listing.rawSourceData?.sourcePriceText || null : String(rentResult.rent),
        sourceAreaText: areaResult.unitArea == null ? listing.rawSourceData?.sourceAreaText || null : String(areaResult.unitArea),
        rentEvidence: rentResult.rentEvidence || listing.rawSourceData?.rentEvidence || null,
        rentConfidence: rentResult.rentConfidence || listing.rawSourceData?.rentConfidence || null,
        areaEvidence: areaResult.areaEvidence || listing.rawSourceData?.areaEvidence || null,
        areaType: areaResult.areaType || listing.rawSourceData?.areaType || null,
        areaCandidates: areaResult.areaCandidates,
        detectedAt: listing.rawSourceData?.detectedAt || listing.lastSeenAt,
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
  for (const listing of listings) {
    enriched.push(await enrichListing(listing, options));
  }
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

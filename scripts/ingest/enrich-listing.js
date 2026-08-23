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

function areaFromText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ');
  const blockedContext = /(kellerfl[aä]che|grundst[uü]cksfl[aä]che|terrassenfl[aä]che|projektfl[aä]che|b[uü]rofl[aä]che|gesamtgeb[aä]ude|geb[aä]udefl[aä]che|grundst[uü]ck)/i;
  const groups = [
    /ladenfl[aä]che|ladenzeile/i,
    /verkaufsfl[aä]che|verkaufsraum/i,
    /gastrofl[aä]che|gastraumfl[aä]che|gastraum/i,
    /nutzfl[aä]che/i,
    /gesamtfl[aä]che|fl[aä]che/i
  ];

  for (const keyword of groups) {
    const keywordMatches = [...normalized.matchAll(new RegExp(keyword.source, 'gi'))];
    for (const keywordMatch of keywordMatches) {
      const start = Math.max(0, keywordMatch.index - 35);
      const end = Math.min(normalized.length, keywordMatch.index + keywordMatch[0].length + 95);
      const context = normalized.slice(start, end);
      const genericKeyword = /^(gesamtfl[aä]che|fl[aä]che)$/i.test(keywordMatch[0]);
      if (genericKeyword && blockedContext.test(context)) continue;
      const afterKeyword = normalized.slice(keywordMatch.index, end);
      const beforeKeyword = normalized.slice(start, keywordMatch.index + keywordMatch[0].length);
      const areaMatch = afterKeyword.match(/(?:ca\.?|circa|ungef[aä]hr|mit)?\s*[:\s-]{0,12}(?:ca\.?|circa|ungef[aä]hr)?\s*([0-9][0-9.,]*)\s*(?:m²|qm|m2)/i)
        || [...beforeKeyword.matchAll(/(?:ca\.?|circa|ungef[aä]hr)?\s*([0-9][0-9.,]*)\s*(?:m²|qm|m2)/gi)].at(-1);
      const value = parseNumberFromText(areaMatch?.[1]);
      if (value != null && value >= 5 && value <= 500) {
        return { unitArea: value, areaEvidence: context.trim() };
      }
    }
  }

  return { unitArea: null, areaEvidence: null };
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
    const plainText = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const jsonLd = jsonLdFacts(html);
    const title = jsonLd.title || titleFromHtml(html);
    const description = compactSummary(jsonLd.verifiedSummary || descriptionFromHtml(html));
    const scopedText = scopedListingText(plainText, title);
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
        sourcePriceText: rentResult.rent == null ? listing.rawSourceData?.sourcePriceText || null : String(rentResult.rent),
        sourceAreaText: areaResult.unitArea == null ? listing.rawSourceData?.sourceAreaText || null : String(areaResult.unitArea),
        rentEvidence: rentResult.rentEvidence,
        rentConfidence: rentResult.rentConfidence,
        areaEvidence: areaResult.areaEvidence,
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
  compactSummary,
  conditionText,
  meaningfulTitle
};

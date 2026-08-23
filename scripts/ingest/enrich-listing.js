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
    /((?:kaltmiete|nettokaltmiete|nettomiete|monatsmiete|miete|pacht|monatlich|pro monat)[^.|\n;]{0,80}?([0-9][0-9.,]*)\s*(?:€|eur))/i,
    /(([0-9][0-9.,]*)\s*(?:€|eur)[^.|\n;]{0,80}?(?:kaltmiete|nettokaltmiete|nettomiete|monatsmiete|miete|pacht|monatlich|pro monat))/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match || blockedContext.test(match[1])) continue;
    const value = parseNumberFromText(match[2]);
    if (value != null && value >= 100 && value <= 20000) {
      return { rent: value, rentEvidence: match[1].trim(), rentConfidence: /kaltmiete|nettokaltmiete|nettomiete|monatsmiete|pacht/i.test(match[1]) ? 'high' : 'medium' };
    }
  }

  return { rent: null, rentEvidence: null, rentConfidence: 'low' };
}

function areaFromText(text) {
  const blockedContext = /(kellerfl[aä]che|grundst[uü]cksfl[aä]che|projektfl[aä]che|gesamtgeb[aä]ude|grundst[uü]ck)/i;
  const patterns = [
    /((?:ladenfl[aä]che|verkaufsfl[aä]che|gastrofl[aä]che|gastraumfl[aä]che|nutzfl[aä]che|gesamtfl[aä]che)\s*[:\s-]{0,12}([0-9][0-9.,]*)\s*(?:m²|qm|m2))/gi,
    /(([0-9][0-9.,]*)\s*(?:m²|qm|m2)\s*(?:ladenfl[aä]che|verkaufsfl[aä]che|gastrofl[aä]che|gastraumfl[aä]che|nutzfl[aä]che|gesamtfl[aä]che))/gi,
    /((?:ladenfl[aä]che|verkaufsfl[aä]che|gastrofl[aä]che|gastraumfl[aä]che|nutzfl[aä]che|gesamtfl[aä]che)[^.|\n;]{0,80}?([0-9][0-9.,]*)\s*(?:m²|qm|m2))/gi
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (!match || blockedContext.test(match[1])) continue;
      const value = parseNumberFromText(match[2]);
      if (value != null && value >= 5 && value <= 500) return { unitArea: value, areaEvidence: match[1].trim() };
    }
  }

  return { unitArea: null, areaEvidence: null };
}

function conditionText(text, label) {
  const pattern = new RegExp(`(${label}[^.\\n|;]{0,80})`, 'i');
  const value = text.match(pattern)?.[1]?.trim() || null;
  return value ? { known: true, value, amount: parseNumberFromText(value) } : null;
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
    const description = jsonLd.verifiedSummary || descriptionFromHtml(html);
    const extractableText = `${title || ''} ${description || ''} ${plainText}`;
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
      verifiedSummary: description || listing.verifiedSummary,
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
  meaningfulTitle
};

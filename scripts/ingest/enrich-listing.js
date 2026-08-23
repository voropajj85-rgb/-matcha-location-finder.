const { parseNumberFromText } = require('./utils');

function textContent(html, pattern) {
  const match = html.match(pattern);
  return match?.[1]?.replace(/\s+/g, ' ').trim() || null;
}

function titleFromHtml(html) {
  return textContent(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
    || textContent(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || textContent(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
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
        if (!facts.title && item.name) facts.title = item.name;
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
  const match = text.match(/(?:kaltmiete|nettomiete|monatsmiete|miete)\s*[:\s-]{0,12}(?:ca\.\s*)?([0-9.,]+)\s*(?:€|eur)/i)
    || text.match(/([0-9.,]+)\s*(?:€|eur)\s*(?:kaltmiete|nettomiete|monatsmiete|miete)/i);
  const value = parseNumberFromText(match?.[1]);
  if (value == null || value < 100 || value > 20000) return null;
  return value;
}

function areaFromText(text) {
  const match = text.match(/([0-9.,]+)\s*(?:m²|qm|m2)/i);
  const value = parseNumberFromText(match?.[1]);
  if (value == null || value < 5 || value > 500) return null;
  return value;
}

function conditionText(text, label) {
  const pattern = new RegExp(`(${label}[^.\\n|;]{0,80})`, 'i');
  const value = text.match(pattern)?.[1]?.trim() || null;
  return value ? { known: true, value, amount: parseNumberFromText(value) } : null;
}

function gastroSignal(text) {
  const match = text.match(/(caf[eé]|gastronomie|gastst[aä]tte|imbiss|kiosk|bistro|te ilgastro|teilgastro|laden)/i);
  if (!match) return {};
  return {
    gastroSuitability: 'possible',
    gastroEvidence: `Direct page text contains relevant use signal: ${match[1]}`
  };
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
    const rent = jsonLd.rent ?? rentFromText(extractableText);
    const unitArea = areaFromText(extractableText);
    const gastro = gastroSignal(`${title || ''} ${description || ''} ${plainText.slice(0, 2000)}`);

    return {
      ...listing,
      title: title || listing.title,
      address: jsonLd.address || listing.address,
      rent: rent ?? listing.rent,
      unitArea: unitArea ?? listing.unitArea,
      area: unitArea ?? listing.area,
      verifiedSummary: description || listing.verifiedSummary,
      provision: conditionText(plainText, 'provision') || listing.provision,
      abloese: conditionText(plainText, 'ablöse|abloese') || listing.abloese,
      kaution: conditionText(plainText, 'kaution') || listing.kaution,
      gastroSuitability: gastro.gastroSuitability || listing.gastroSuitability,
      gastroEvidence: gastro.gastroEvidence || listing.gastroEvidence,
      rawSourceData: {
        ...(listing.rawSourceData || {}),
        sourceTitle: title || listing.rawSourceData?.sourceTitle || null,
        sourcePriceText: rent == null ? listing.rawSourceData?.sourcePriceText || null : String(rent),
        sourceAreaText: unitArea == null ? listing.rawSourceData?.sourceAreaText || null : String(unitArea),
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
  enrichListings
};

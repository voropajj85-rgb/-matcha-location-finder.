const crypto = require('crypto');

const TRACKING_PARAMS = [
  /^utm_/i,
  /^pk_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_/i,
  /^session/i,
  /^ref$/i,
  /^referrer$/i
];

const DIRECT_URL_PATTERNS = [
  /kleinanzeigen\.de\/s-anzeige\//i,
  /immowelt\.de\/expose\//i,
  /immobilienscout24\.de\/expose\/\d+/i,
  /colliers\.de\/gewerbeimmobilien\/objekt\//i,
  /engelvoelkers\.com\/de\/de\/exposes\//i,
  /immobilie1\.de\/(?:\d{5}-)?[^/]*(?:muenchen|munchen|münchen)[^/]*-\d{6,}/i,
  /stadt\.muenchen\.de\/.*gewerbeflaechen-angebote/i,
  /stadt\.muenchen\.de\/service\/info\/stadtische-gewerbeflachen-verfugbare-objekte/i,
  /gewerbeimmobilien\.jll\.de\/einzelhandel\//i
];

const SEARCH_URL_PATTERNS = [
  /kleinanzeigen\.de\/s-[^/]+/i,
  /\/suche\//i,
  /search/i,
  /gewerbeimmobilien.*mieten/i,
  /immobilien\/.*\/mieten$/i
];

const MATCHA_RELEVANT_URL_PATTERNS = [
  /cafe|caf[eé]/i,
  /gastro|gastronomie|gaststaette|imbiss|kiosk/i,
  /laden|verkauf|einzelhandel|teilgastro/i,
  /kaffee|kaffeeroesterei|bar|bistro/i
];

const IRRELEVANT_URL_PATTERNS = [
  /office|buero|bueroraum|bueroflaeche|coworking|arbeitsplatz|schreibtisch/i,
  /praxis|coaching|psychotherapie/i,
  /lager|lagerraum|lagerflaeche|werkstatt/i,
  /self-storage|storage|logistikzentrum|palettenwerk/i,
  /investment|kapitalanlage|rendite/i,
  /stellplatz|garage|virtuelles-buero|regus|design-offices|spaces/i,
  /friseur|friseursalon/i
];

const NON_OFFER_URL_PATTERNS = [
  /dhl-paketshop|paketshop/i,
  /gesucht|suche-|wir-sind-auf-der-suche|nachmieter-gesucht/i,
  /zu-verkaufen|zu-verkauf|verkauf-voll|gewerbeinvestment/i
];

const NEARBY_EXCLUDED_LOCATION_PATTERN = /(penzberg|ottobrunn|dachau|freising|unterhaching|karlsfeld|gauting|fürstenfeldbruck|furstenfeldbruck|grünwald|gruenwald|haar|aschheim|asheim|germering)/i;

function canonicalizeListingUrl(input) {
  if (!input) return null;
  try {
    const url = new URL(input);
    url.hash = '';
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, 'www.');

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) {
        url.searchParams.delete(key);
      }
    }

    const params = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right));
    url.search = '';
    for (const [key, value] of params) url.searchParams.append(key, value);
    return url.toString();
  } catch {
    return null;
  }
}

function isDirectListingUrl(input) {
  const canonical = canonicalizeListingUrl(input);
  if (!canonical) return false;
  return DIRECT_URL_PATTERNS.some((pattern) => pattern.test(canonical))
    && !isSearchPageUrl(canonical);
}

function isSearchPageUrl(input) {
  const canonical = canonicalizeListingUrl(input);
  if (!canonical) return true;

  if (/kleinanzeigen\.de/i.test(canonical)) {
    return !/\/s-anzeige\//i.test(canonical);
  }

  return SEARCH_URL_PATTERNS.some((pattern) => pattern.test(canonical))
    && !/\/expose\/|\/objekt\//i.test(canonical);
}

function isPotentialMatchaListingUrl(input) {
  const canonical = canonicalizeListingUrl(input);
  if (!canonical) return false;
  if (IRRELEVANT_URL_PATTERNS.some((pattern) => pattern.test(canonical))) return false;
  if (NON_OFFER_URL_PATTERNS.some((pattern) => pattern.test(canonical))) return false;
  return MATCHA_RELEVANT_URL_PATTERNS.some((pattern) => pattern.test(canonical));
}

function isMunichKleinanzeigenUrl(input) {
  const canonical = canonicalizeListingUrl(input);
  if (!canonical || !/kleinanzeigen\.de/i.test(canonical)) return false;
  const idParts = canonical.match(/\/(\d+)-(\d+)-(\d+)$/);
  if (!idParts) return false;
  const categoryId = idParts[2];
  const locationId = idParts[3];
  if (categoryId !== '277') return false;
  return /^64\d{2}$/.test(locationId) || /^163\d{2}$/.test(locationId);
}

function isMunichTargetText(value) {
  const text = String(value || '').toLowerCase();
  if (!/(münchen|muenchen|munich|\b80\d{3}\b|\b81\d{3}\b)/i.test(text)) return false;
  return !NEARBY_EXCLUDED_LOCATION_PATTERN.test(text);
}

function isNearbyExcludedLocation(value) {
  return NEARBY_EXCLUDED_LOCATION_PATTERN.test(String(value || '').toLowerCase());
}

function extractExternalId(sourceName, sourceUrl) {
  const canonicalUrl = canonicalizeListingUrl(sourceUrl);
  if (!canonicalUrl) return null;

  const klein = canonicalUrl.match(/\/s-anzeige\/[^/]+\/(\d+-\d+-\d+)/i);
  if (klein) return `klein-${klein[1]}`;

  const scout = canonicalUrl.match(/immobilienscout24\.de\/expose\/(\d+)/i);
  if (scout) return `is24-${scout[1]}`;

  const immowelt = canonicalUrl.match(/immowelt\.de\/expose\/([a-f0-9-]+)/i);
  if (immowelt) return `immowelt-${immowelt[1]}`;

  const colliers = canonicalUrl.match(/colliers\.de\/gewerbeimmobilien\/objekt\/([^/?#]+)/i);
  if (colliers) return `colliers-${colliers[1].toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  const engel = canonicalUrl.match(/engelvoelkers\.com\/de\/de\/exposes\/([a-f0-9-]+)/i);
  if (engel) return `engel-${engel[1].toLowerCase()}`;

  const immobilie1 = canonicalUrl.match(/immobilie1\.de\/([^/?#]+-(\d{6,}))/i);
  if (immobilie1) return `immobilie1-${immobilie1[2]}`;

  const jll = canonicalUrl.match(/gewerbeimmobilien\.jll\.de\/einzelhandel\/([^/?#]+)/i);
  if (jll) return `jll-${jll[1].toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  const slug = crypto
    .createHash('sha256')
    .update(`${sourceName || 'source'}:${canonicalUrl}`)
    .digest('hex')
    .slice(0, 14);

  return `${String(sourceName || 'source').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${slug}`;
}

function extractLinks(html, baseUrl, matcher) {
  const links = [];
  const seen = new Set();
  const pattern = /href\s*=\s*["']([^"']+)["']/gi;
  let match;

  while ((match = pattern.exec(html))) {
    try {
      const absolute = new URL(match[1], baseUrl).toString();
      const canonical = canonicalizeListingUrl(absolute);
      if (canonical && matcher(canonical) && !seen.has(canonical)) {
        seen.add(canonical);
        links.push(canonical);
      }
    } catch {
      // Ignore malformed links from third-party pages.
    }
  }

  return links;
}

function parseNumberFromText(text) {
  if (!text) return null;
  const match = String(text).replace(/\./g, '').replace(',', '.').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  canonicalizeListingUrl,
  extractExternalId,
  extractLinks,
  isDirectListingUrl,
  isMunichTargetText,
  isMunichKleinanzeigenUrl,
  isNearbyExcludedLocation,
  isPotentialMatchaListingUrl,
  isSearchPageUrl,
  parseNumberFromText,
  sleep
};

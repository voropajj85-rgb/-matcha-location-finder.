const DIRECT_SOURCE_PATTERNS = [
  /kleinanzeigen\.de\/s-anzeige\//i,
  /immowelt\.de\/expose\//i,
  /immobilienscout24\.de\/expose\/\d+/i,
  /colliers\.de\/gewerbeimmobilien\/objekt\//i,
  /stadt\.muenchen\.de\/.*gewerbeflaechen-angebote/i
];

function canonicalUrl(input) {
  if (!input || input === '#') return null;
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (typeof window !== 'undefined' && window.location) {
      const current = new URL(window.location.href);
      if (url.origin === current.origin && url.pathname === current.pathname) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isSearchUrl(url) {
  if (/kleinanzeigen\.de/i.test(url)) return !/\/s-anzeige\//i.test(url);
  return /\/suche\/|search|gewerbeimmobilien.*mieten/i.test(url)
    && !/\/expose\/|\/objekt\//i.test(url);
}

function isDirectUrl(url) {
  return DIRECT_SOURCE_PATTERNS.some((pattern) => pattern.test(url)) && !isSearchUrl(url);
}

export function getValidExternalUrl(listing) {
  const url = canonicalUrl(listing?.sourceUrl || listing?.url || listing?.canonicalUrl);
  if (!url) return null;
  if (listing?.listingType === 'direct_listing' && !isDirectUrl(url)) return null;
  return url;
}

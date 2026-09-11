import { classifyMarketListing, districtBucket, getValidExternalUrl, isPriceOnRequest } from './generated/market-policy.js';

export const GROUPS = ['market', 'suitable', 'best'];
export const UNKNOWN_DISTRICT = 'München · Stadtteil nicht bestätigt';
export const emptyFilters = () => ({ district: 'all', minArea: '', maxArea: '', maxRent: '', gastro: 'all', source: 'all' });

export function confirmedDistrict(listing) {
  // A bare legacy district is not sufficient physical evidence. Address/evidence only.
  const district = districtBucket({ ...listing, district: null });
  return ['unknown', 'München unspecified'].includes(district) ? UNKNOWN_DISTRICT : district;
}

export function listingUrl(listing) {
  const raw = listing.sourceUrl || listing.url || listing.canonicalUrl;
  try {
    const parsed = new URL(raw);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return getValidExternalUrl(listing);
  } catch { return null; }
}

export function classifyInventory(listings, now = new Date().toISOString()) {
  const seen = new Set();
  return listings.filter((listing) => {
    const key = listing.externalId || listing.id || listingUrl(listing);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).map((listing) => {
    const classification = classifyMarketListing(listing, now);
    const age = Date.parse(now) - Date.parse(listing.lastVerifiedAt || '');
    const fresh = Number.isFinite(age) && age >= 0 && age <= 48 * 60 * 60 * 1000;
    const url = listingUrl(listing);
    return { listing, classification, url,
      district: confirmedDistrict(listing),
      temporary: listing.rawSourceData?.temporaryTenancy === true,
      market: classification.market && Boolean(url),
      suitable: classification.suitable && Boolean(url),
      best: classification.best && fresh && Boolean(url) };
  });
}

export function filterInventory(rows, filters) {
  return rows.filter(({ listing: l, district }) => {
    const area = l.unitArea ?? l.area;
    if (filters.district !== 'all' && district !== filters.district) return false;
    if (filters.source !== 'all' && (l.sourceName || l.source) !== filters.source) return false;
    if (filters.gastro !== 'all' && (l.gastroSuitability || 'unknown') !== filters.gastro) return false;
    // Unknown is included in unfiltered Market, but cannot satisfy an explicit numeric limit.
    if (filters.minArea !== '' && (!Number.isFinite(area) || area < Number(filters.minArea))) return false;
    if (filters.maxArea !== '' && (!Number.isFinite(area) || area > Number(filters.maxArea))) return false;
    if (filters.maxRent !== '' && (!Number.isFinite(l.rent) || l.rent <= 0 || l.rentType === 'per_sqm'
      || l.rawSourceData?.rentConfidence === 'low' || l.rent > Number(filters.maxRent))) return false;
    return true;
  });
}

export function inventoryCounts(rows) {
  return { ...Object.fromEntries(GROUPS.map((group) => [group, rows.filter((row) => row[group]).length])),
    targetArea: rows.filter(({ market, listing }) => market && (listing.unitArea ?? listing.area) >= 25 && (listing.unitArea ?? listing.area) <= 60).length,
    temporary: rows.filter((row) => row.market && row.temporary).length };
}

export function selectInventory(rows, group, filters) {
  return filterInventory(rows, filters).filter((row) => row[group]).sort((a, b) =>
    Number(a.temporary) - Number(b.temporary) || Number(b.best) - Number(a.best)
    || Number(b.suitable) - Number(a.suitable) || (Date.parse(b.listing.lastVerifiedAt) - Date.parse(a.listing.lastVerifiedAt))
    || String(a.listing.id).localeCompare(String(b.listing.id)));
}

export function rentLabel(listing) {
  if (Number.isFinite(listing.rent) && listing.rent > 0 && listing.rentType !== 'per_sqm' && listing.rawSourceData?.rentConfidence !== 'low') {
    return `€${listing.rent.toLocaleString('de-DE')} / Monat`;
  }
  return isPriceOnRequest(listing) && listing.rent == null ? 'Preis auf Anfrage' : 'Nicht bestätigt';
}

export function reasonLabel(reason, listing) {
  const labels = {
    '> 60 m²': `${listing.unitArea ?? listing.area} m² · über 60 m²`,
    '<25 m²': `${listing.unitArea ?? listing.area} m² · unter 25 m²`,
    'rent >3000': `${rentLabel(listing)} · über Zielbudget`,
    'rent missing': isPriceOnRequest(listing) ? 'Mietbudget auf Anfrage · nicht bestätigt' : 'Miete nicht bestätigt',
    'gastro/use uncertainty': listing.gastroSuitability === 'no' ? 'Gastronomie nicht erlaubt' : 'Gastronomie nicht bestätigt',
    'missing area': 'Fläche nicht bestätigt',
    'weak business fit': 'Nutzungskonzept passt nicht',
    'stale / invalid URL': 'Aktualität oder Link nicht bestätigt',
    'weak relevance score': 'Eignung nicht ausreichend belegt',
    'insufficient usable data': 'Angaben nicht ausreichend belegt'
  };
  return labels[reason] || 'Eignung nicht bestätigt';
}

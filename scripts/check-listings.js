const fs = require('fs/promises');
const path = require('path');

const LISTINGS_PATH = path.join(__dirname, '..', 'data', 'listings.json');
const CHECK_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 15000;
const FRESH_VERIFICATION_HOURS = 48;

const SOURCE_TYPES = {
  IMMOSCOUT: 'immoscout24',
  IMMOWELT: 'immowelt',
  KLEINANZEIGEN: 'kleinanzeigen',
  LEAD: 'lead',
  UNKNOWN: 'unknown'
};

const DEAD_PATTERNS = {
  common: [
    /angebot wurde deaktiviert/i,
    /angebot (ist )?nicht mehr verf[uü]gbar/i,
    /objekt (ist )?nicht verf[uü]gbar/i,
    /anbieter kann nicht mehr kontaktiert werden/i,
    /expose (deactivated|archived)/i,
    /listing deleted/i,
    /deleted listing/i,
    /page not found/i,
    /seite wurde nicht gefunden/i
  ],
  immowelt: [
    /anzeige gel[oö]scht/i,
    /dieses angebot ist nicht mehr verf[uü]gbar/i,
    /listing deleted state/i
  ],
  kleinanzeigen: [
    /anzeige nicht mehr verf[uü]gbar/i,
    /anzeige wurde gel[oö]scht/i,
    /diese anzeige ist nicht mehr verf[uü]gbar/i
  ]
};

const SEARCH_PATTERNS = [
  /suchergebnisse/i,
  /search results/i,
  /anzeigen suchen/i,
  /gewerbeimmobilien mieten/i
];

const LEAD_SOURCES = [/stadt münchen/i, /colliers/i, /cbre/i];

function nowIsoWithOffset() {
  const date = new Date();
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  const local = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  return `${local.toISOString().slice(0, 19)}${sign}${hours}:${minutes}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSourceType(listing) {
  const source = `${listing.source || ''} ${listing.url || ''}`.toLowerCase();
  if (source.includes('immobilienscout24') || source.includes('immoscout')) return SOURCE_TYPES.IMMOSCOUT;
  if (source.includes('immowelt')) return SOURCE_TYPES.IMMOWELT;
  if (source.includes('kleinanzeigen')) return SOURCE_TYPES.KLEINANZEIGEN;
  if (isLead(listing)) return SOURCE_TYPES.LEAD;
  return SOURCE_TYPES.UNKNOWN;
}

function isLead(listing) {
  return listing.availabilityStatus === 'lead'
    || listing.status === 'LEAD'
    || LEAD_SOURCES.some((pattern) => pattern.test(listing.source || ''));
}

function isFreshVerifiedListing(listing, checkedAt = new Date()) {
  if (!listing.lastVerifiedAt) return false;
  const verifiedAt = new Date(listing.lastVerifiedAt);
  if (Number.isNaN(verifiedAt.getTime())) return false;

  const maxAgeMs = FRESH_VERIFICATION_HOURS * 60 * 60 * 1000;
  return checkedAt.getTime() - verifiedAt.getTime() <= maxAgeMs;
}

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isKleinanzeigenListingUrl(url) {
  const parsed = parseUrl(url);
  return Boolean(parsed?.hostname.includes('kleinanzeigen.de') && parsed.pathname.includes('/s-anzeige/'));
}

function isKleinanzeigenSearchUrl(url) {
  const parsed = parseUrl(url);
  return Boolean(parsed?.hostname.includes('kleinanzeigen.de') && !parsed.pathname.includes('/s-anzeige/'));
}

function isImmoScoutListingUrl(url) {
  const parsed = parseUrl(url);
  return Boolean(parsed?.hostname.includes('immobilienscout24.de') && /\/expose\/\d+/.test(parsed.pathname));
}

function isImmoweltListingUrl(url) {
  const parsed = parseUrl(url);
  return Boolean(parsed?.hostname.includes('immowelt.de') && /\/expose\//.test(parsed.pathname));
}

function getLastPathSegment(url) {
  const parsed = parseUrl(url);
  if (!parsed) return '';
  return parsed.pathname.split('/').filter(Boolean).at(-1) || '';
}

function isSameConcreteListing(sourceType, originalUrl, finalUrl) {
  if (sourceType === SOURCE_TYPES.KLEINANZEIGEN) {
    if (!isKleinanzeigenListingUrl(finalUrl)) return false;
    return getLastPathSegment(originalUrl) === getLastPathSegment(finalUrl);
  }

  if (sourceType === SOURCE_TYPES.IMMOSCOUT) {
    return isImmoScoutListingUrl(finalUrl) && getLastPathSegment(originalUrl) === getLastPathSegment(finalUrl);
  }

  if (sourceType === SOURCE_TYPES.IMMOWELT) {
    return isImmoweltListingUrl(finalUrl) && getLastPathSegment(originalUrl) === getLastPathSegment(finalUrl);
  }

  return false;
}

function hasAnyPattern(html, patterns) {
  return patterns.some((pattern) => pattern.test(html));
}

function hasDeadSignal(sourceType, html) {
  const sourcePatterns = DEAD_PATTERNS[sourceType] || [];
  return hasAnyPattern(html, DEAD_PATTERNS.common) || hasAnyPattern(html, sourcePatterns);
}

function isFallbackOrSearchPage(sourceType, html, finalUrl) {
  if (sourceType === SOURCE_TYPES.KLEINANZEIGEN && isKleinanzeigenSearchUrl(finalUrl)) return true;
  return hasAnyPattern(html, SEARCH_PATTERNS);
}

function hasStrongListingEvidence(sourceType, listing, html, finalUrl) {
  const expectedId = getLastPathSegment(listing.url || '');
  const normalizedDistrict = String(listing.district || '').split('·')[0].trim().toLowerCase();
  const lowerHtml = html.toLowerCase();

  if (!isSameConcreteListing(sourceType, listing.url, finalUrl)) return false;
  if (expectedId && !lowerHtml.includes(expectedId.toLowerCase())) return false;

  if (sourceType === SOURCE_TYPES.KLEINANZEIGEN) {
    const hasKleinanzeigenShell = /<title[^>]*>[^<]+\|\s*kleinanzeigen\.de/i.test(html)
      || /"@type"\s*:\s*"product"/i.test(html)
      || /data-adid/i.test(html);
    const hasListingSpecificText = normalizedDistrict && lowerHtml.includes(normalizedDistrict);
    return hasKleinanzeigenShell && hasListingSpecificText;
  }

  if (sourceType === SOURCE_TYPES.IMMOSCOUT) {
    const hasExposeShell = /expose/i.test(html) && /immobilienscout24/i.test(html);
    const hasContactOrAddress = /kontakt|anbieter|adresse|objektadresse/i.test(html);
    return hasExposeShell && hasContactOrAddress;
  }

  if (sourceType === SOURCE_TYPES.IMMOWELT) {
    const hasExposeShell = /immowelt/i.test(html) && /expose/i.test(html);
    const hasObjectShell = /kontakt|anbieter|adresse|objektbeschreibung|ausstattung/i.test(html);
    return hasExposeShell && hasObjectShell;
  }

  return false;
}

function applyManualOverride(listing, checkedAt) {
  const override = listing.verificationOverride;
  if (!override?.status) return null;

  return {
    ...listing,
    availabilityStatus: override.status,
    lastVerifiedAt: override.verifiedAt || checkedAt,
    verificationMethod: 'manual-override',
    reason: override.reason || 'manual override'
  };
}

function result(listing, fields, reason) {
  return {
    ...listing,
    ...fields,
    reason
  };
}

function classifyHtml(listing, response, html, finalUrl, checkedAt) {
  const sourceType = getSourceType(listing);

  if (isFallbackOrSearchPage(sourceType, html, finalUrl)) {
    return result(listing, {
      availabilityStatus: 'search_only',
      lastVerifiedAt: checkedAt,
      directUrl: false,
      verificationMethod: 'search-or-fallback-page',
      finalUrl
    }, 'final URL or page content is search/fallback');
  }

  if (response.status === 404 || response.status === 410 || hasDeadSignal(sourceType, html)) {
    return result(listing, {
      availabilityStatus: 'dead',
      lastVerifiedAt: checkedAt,
      directUrl: true,
      verificationMethod: 'direct-page-dead-signal',
      finalUrl
    }, 'dead/deactivated text or terminal HTTP status');
  }

  if (response.status === 401 || response.status === 403 || response.status === 429) {
    return result(listing, {
      availabilityStatus: 'unknown',
      lastVerifiedAt: checkedAt,
      directUrl: true,
      verificationMethod: 'blocked-or-inconclusive',
      finalUrl
    }, `HTTP ${response.status} blocks verification`);
  }

  if (!response.ok) {
    return result(listing, {
      availabilityStatus: 'unknown',
      lastVerifiedAt: checkedAt,
      directUrl: true,
      verificationMethod: `http-${response.status}`,
      finalUrl
    }, `HTTP ${response.status} is not a reliable active signal`);
  }

  if (hasStrongListingEvidence(sourceType, listing, html, finalUrl)) {
    return result(listing, {
      availabilityStatus: 'active',
      lastVerifiedAt: checkedAt,
      directUrl: true,
      verificationMethod: `${sourceType}-strong-listing-check`,
      finalUrl
    }, 'same concrete listing URL with source-specific listing evidence');
  }

  return result(listing, {
    availabilityStatus: 'unknown',
    lastVerifiedAt: checkedAt,
    directUrl: true,
    verificationMethod: 'insufficient-active-evidence',
    finalUrl
  }, 'insufficient source-specific evidence for active listing');
}

async function checkListing(listing, checkedAt) {
  const overrideResult = applyManualOverride(listing, checkedAt);
  if (overrideResult) return overrideResult;

  if (!listing.url) {
    return result(listing, {
      availabilityStatus: isLead(listing) ? 'lead' : 'unknown',
      lastVerifiedAt: null,
      directUrl: false,
      verificationMethod: 'missing-url',
      finalUrl: null
    }, 'missing URL');
  }

  if (isLead(listing)) {
    return result(listing, {
      availabilityStatus: 'lead',
      lastVerifiedAt: checkedAt,
      directUrl: !isKleinanzeigenSearchUrl(listing.url),
      verificationMethod: 'lead-page-check',
      finalUrl: listing.url
    }, 'lead source is not treated as confirmed market listing');
  }

  if (isKleinanzeigenSearchUrl(listing.url)) {
    return result(listing, {
      availabilityStatus: 'search_only',
      lastVerifiedAt: checkedAt,
      directUrl: false,
      verificationMethod: 'search-url-detected',
      finalUrl: listing.url
    }, 'URL is search page');
  }

  try {
    const response = await fetch(listing.url, {
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'MatchaLocationFinder/1.0 (+availability check; no scraping bypass)'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const html = await response.text();
    return classifyHtml(listing, response, html, response.url, checkedAt);
  } catch (error) {
    if (listing.availabilityStatus === 'search_only') {
      return result(listing, {
        availabilityStatus: 'search_only',
        lastVerifiedAt: checkedAt,
        directUrl: Boolean(listing.directUrl),
        verificationMethod: listing.verificationMethod || 'previous-search-only-preserved',
        finalUrl: listing.url
      }, `request failed; preserving previous search_only: ${error.name || 'Error'}`);
    }

    return result(listing, {
      availabilityStatus: 'unknown',
      lastVerifiedAt: checkedAt,
      directUrl: true,
      verificationMethod: 'request-failed',
      finalUrl: listing.url
    }, `request failed: ${error.name || 'Error'}`);
  }
}

function summarize(listings) {
  const counts = {
    active: 0,
    dead: 0,
    unknown: 0,
    search_only: 0,
    lead: 0
  };

  for (const listing of listings) {
    if (Object.hasOwn(counts, listing.availabilityStatus)) {
      counts[listing.availabilityStatus] += 1;
    }
  }

  return counts;
}

function printableReportLine(oldListing, checked) {
  const transition = `${oldListing.availabilityStatus || 'missing'} -> ${checked.availabilityStatus}`;
  const finalUrlNote = checked.finalUrl && checked.finalUrl !== oldListing.url
    ? `\n  finalUrl: ${checked.finalUrl}`
    : '';

  return `${checked.id}
  source: ${checked.source || 'unknown'}
  status: ${transition}
  verificationMethod: ${checked.verificationMethod}
  reason: ${checked.reason || 'n/a'}${finalUrlNote}`;
}

function stripRuntimeFields(listing) {
  const { reason, finalUrl, ...persisted } = listing;
  return persisted;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const checkedAt = nowIsoWithOffset();
  const listings = JSON.parse(await fs.readFile(LISTINGS_PATH, 'utf8'));
  const updated = [];

  for (const listing of listings) {
    const checked = await checkListing(listing, checkedAt);
    updated.push(stripRuntimeFields(checked));
    console.log(printableReportLine(listing, checked));
    await sleep(CHECK_DELAY_MS);
  }

  const counts = summarize(updated);
  console.log('\nsummary');
  console.log(`  active: ${counts.active}`);
  console.log(`  dead: ${counts.dead}`);
  console.log(`  unknown: ${counts.unknown}`);
  console.log(`  search_only: ${counts.search_only}`);
  console.log(`  lead: ${counts.lead}`);

  if (!dryRun) {
    await fs.writeFile(LISTINGS_PATH, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

const fs = require('fs/promises');
const path = require('path');

const LISTINGS_PATH = path.join(__dirname, '..', 'data', 'listings.json');
const DEAD_PATTERNS = [
  /angebot wurde deaktiviert/i,
  /anzeige gel[oö]scht/i,
  /angebot nicht mehr verf[uü]gbar/i,
  /objekt nicht verf[uü]gbar/i,
  /seite wurde nicht gefunden/i,
  /page not found/i,
  /not found/i
];
const ACTIVE_PATTERNS = [
  /anzeigen-id/i,
  /#\s*laden zur miete/i,
  /#\s*[^<\n]*(gastro|laden|caf|gewerbe|einzelhandel)/i,
  /mietpreis ab/i,
  /typ:\s*(büros|büro|gastronomie|einzelhandel)/i,
  /objekt-id:/i
];
const LEAD_SOURCES = [/stadt münchen/i, /colliers/i, /cbre/i];

function nowIsoWithOffset() {
  const date = new Date();
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `${date.toISOString().slice(0, 19)}${sign}${hours}:${minutes}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSearchUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('kleinanzeigen.de') && !parsed.pathname.includes('/s-anzeige/');
  } catch {
    return false;
  }
}

function isLead(listing) {
  return listing.status === 'LEAD' || LEAD_SOURCES.some((pattern) => pattern.test(listing.source || ''));
}

function isRedirectedToSearch(finalUrl) {
  try {
    const parsed = new URL(finalUrl);
    return parsed.hostname.includes('kleinanzeigen.de')
      && parsed.pathname.startsWith('/s-')
      && !parsed.pathname.includes('/s-anzeige/');
  } catch {
    return false;
  }
}

function classifyHtml(response, html, finalUrl) {
  if (isRedirectedToSearch(finalUrl)) {
    return {
      availabilityStatus: 'search_only',
      directUrl: false,
      verificationMethod: 'redirected-to-search-page'
    };
  }

  if (response.status === 404 || response.status === 410 || DEAD_PATTERNS.some((pattern) => pattern.test(html))) {
    return {
      availabilityStatus: 'dead',
      directUrl: true,
      verificationMethod: 'direct-page-dead-signal'
    };
  }

  if (response.status === 401 || response.status === 403 || response.status === 429) {
    return {
      availabilityStatus: 'unknown',
      directUrl: true,
      verificationMethod: 'blocked-or-inconclusive'
    };
  }

  if (!response.ok) {
    return {
      availabilityStatus: 'unknown',
      directUrl: true,
      verificationMethod: `http-${response.status}`
    };
  }

  if (ACTIVE_PATTERNS.some((pattern) => pattern.test(html))) {
    return {
      availabilityStatus: 'active',
      directUrl: true,
      verificationMethod: 'direct-page-check'
    };
  }

  return {
    availabilityStatus: 'unknown',
    directUrl: true,
    verificationMethod: 'blocked-or-inconclusive'
  };
}

async function checkListing(listing, checkedAt) {
  if (!listing.url) {
    return {
      ...listing,
      availabilityStatus: isLead(listing) ? 'lead' : 'unknown',
      lastVerifiedAt: null,
      directUrl: false,
      verificationMethod: 'missing-url'
    };
  }

  if (isLead(listing)) {
    return {
      ...listing,
      availabilityStatus: 'lead',
      lastVerifiedAt: checkedAt,
      directUrl: !isSearchUrl(listing.url),
      verificationMethod: 'lead-page-check'
    };
  }

  if (isSearchUrl(listing.url)) {
    return {
      ...listing,
      availabilityStatus: 'search_only',
      lastVerifiedAt: checkedAt,
      directUrl: false,
      verificationMethod: 'search-url-detected'
    };
  }

  try {
    const response = await fetch(listing.url, {
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'MatchaLocationFinder/1.0 (+manual availability check)'
      },
      signal: AbortSignal.timeout(15000)
    });
    const html = await response.text();

    return {
      ...listing,
      ...classifyHtml(response, html, response.url),
      lastVerifiedAt: checkedAt
    };
  } catch {
    return {
      ...listing,
      availabilityStatus: 'unknown',
      lastVerifiedAt: checkedAt,
      directUrl: true,
      verificationMethod: 'request-failed'
    };
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const checkedAt = nowIsoWithOffset();
  const listings = JSON.parse(await fs.readFile(LISTINGS_PATH, 'utf8'));
  const updated = [];

  for (const listing of listings) {
    const checked = await checkListing(listing, checkedAt);
    updated.push(checked);
    console.log(`${checked.id}: ${checked.availabilityStatus} (${checked.verificationMethod})`);
    await sleep(1000);
  }

  if (!dryRun) {
    await fs.writeFile(LISTINGS_PATH, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

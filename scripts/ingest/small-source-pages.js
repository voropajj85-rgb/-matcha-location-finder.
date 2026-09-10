const { extractListingFacts } = require('./extract-listing-facts');
const { districtMatch } = require('./district-coverage');

const SOURCES = [
  { name: 'Emslander', host: 'www.emslander-co.de', catalog: 'https://www.emslander-co.de/immobilien?filter=gewerbe',
    path: /^\/objekte\/[a-z0-9-]+\/$/, temporary: false },
  { name: 'RaumForm33', host: 'raumform33.de', catalog: 'https://raumform33.de/pop-up-store/pop-up-mieten-muenchen/',
    path: /^\/pop-up-store\/pop-up-mieten-muenchen\/[a-z0-9-]+\/$/, temporary: true }
];

function sourceForUrl(input) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search) return null;
    return SOURCES.find((source) => url.hostname === source.host && source.path.test(url.pathname)) || null;
  } catch { return null; }
}

function plain(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;|&#038;/g, '&')
    .replace(/&euro;/g, '€').replace(/&sup2;/g, '²').replace(/\s+/g, ' ').trim();
}

function parseSmallSourcePage(sourceUrl, html) {
  const source = sourceForUrl(sourceUrl);
  if (!source) return null;
  const heading = String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!heading) return null;
  const title = plain(heading[1]);
  // Scope to the actual object, before enquiry forms, generic FAQs and related inventory.
  let text = plain(String(html).slice(heading.index));
  for (const marker of ['Jetzt unverbindlich anfragen', 'Weitere Immobilien', 'Das könnte auch passen']) {
    const index = text.indexOf(marker);
    if (index > 0) text = text.slice(0, index);
  }
  const dead = /\b(?:vermietet|verkauft|reserviert)\b|nicht mehr (?:verfügbar|verfuegbar)/i.test(title)
    || /(?:dieses objekt|diese immobilie|diese fläche) (?:ist )?(?:bereits )?(?:vermietet|verkauft|nicht mehr verfügbar)/i.test(text);
  const commercial = /laden|store|café|cafe|verkaufsfl[aä]che|einzelhandel|retail/i.test(title);
  const location = source.temporary
    ? text.match(/\bMünchen,\s*[^()]{1,80}(?=\s*\(Location ID)/i)?.[0]?.trim()
    : text.match(/\bMünchen(?:[ -](?:Haidhausen|Schwabing|Westend|Glockenbachviertel|Maxvorstadt|Lehel|Giesing|Innenstadt))?/i)?.[0];
  if (!location || !commercial) return null;
  const match = districtMatch(location);
  const objectId = source.temporary ? text.match(/\(Location ID\s+(\d+)\)/i)?.[1] : null;
  const pathId = source.temporary ? sourceUrl.match(/-id-?(\d+)\/$/i)?.[1] : null;
  const identityConflict = Boolean(objectId && pathId && Number(objectId) !== Number(pathId));
  const facts = extractListingFacts(text, { title, address: location, district: match?.value });
  // Monthly rent labels only. Daily/week/package prices are never converted to monthly rent.
  const monthlyLabel = source.name === 'Emslander' ? text.match(/Miete\/Monat\s*([\d.,]+)\s*€/i) : null;
  const monthly = monthlyLabel ? extractListingFacts(`Monatsmiete ${monthlyLabel[1]} €`).rent : facts.rent;
  const request = /Preis\s+auf\s+Anfrage/i.test(text);
  const sales = text.match(/([\d.,]+)\s*(?:m²|qm)\s*(?:große\s+)?(?:Verkaufs(?:-\s*und\s*Präsentations)?fläche|Storefläche|Ladenfläche)/i);
  const total = text.match(/(?:Gesamtfläche\s*:?|insg\.?|insgesamt)\s*(?:ca\.?\s*)?([\d.,]+)\s*(?:m²|qm)/i);
  const number = (value) => Number(value.replace(/\./g, '').replace(',', '.'));
  // Source-specific single-unit totals are usable; never pick a small room in a large event venue.
  const area = sales ? number(sales[1]) : facts.area.unitArea ?? (total ? number(total[1]) : null);
  const areaEvidence = sales?.[0] || facts.area.evidence?.raw || total?.[0];
  const noGastro = /gastronomische\s+Nutzung\s+ist\s+nicht\s+möglich|Gastronomiebetriebe\s+nicht\s+gestattet/i.test(text);
  const gastro = noGastro ? 'no' : facts.gastro.status;
  const rent = source.temporary ? null : monthly.amount;
  // Summaries must use the same source-specific facts as the structured fields.
  const summary = [area ? `${area} m² Laden-/Verkaufsfläche in ${location}.` : `Ladenfläche in ${location}; Fläche unbestätigt.`,
    source.temporary ? 'Temporäre Pop-up-Vermietung.' : null,
    rent != null ? `Monatsmiete ${rent} €.` : request ? 'Preis auf Anfrage; Monatsbudget unbestätigt.' : 'Keine bestätigte Monatsmiete.',
    gastro === 'no' ? 'Gastronomische Nutzung nicht gestattet.' : gastro === 'unknown' ? 'Gastronomienutzung nicht bestätigt.' : 'Gastronomiehinweis vorhanden; konkrete Nutzung prüfen.'
  ].filter(Boolean).join(' ');
  return {
    sourceFamily: 'broker', sourceName: source.name, sourceUrl, listingType: 'direct_listing', title,
    address: location, district: match?.value || null, unitArea: area, area,
    projectTotalArea: total ? number(total[1]) : facts.area.projectTotalArea,
    rent, rentType: source.temporary ? null : monthly.type,
    priceStatus: request ? 'request' : null, gastroSuitability: gastro,
    gastroEvidence: noGastro ? text.match(/(?:Eine )?gastronomische Nutzung[^.]+|[^.]*Gastronomiebetriebe nicht gestattet[^.]*/i)?.[0] : facts.gastro.evidence?.raw,
    verifiedSummary: summary, keyFacts: facts.keyFacts,
    unknowns: facts.unknowns.filter((question) => !(rent != null && /Monatsmiete/i.test(question))),
    nextAction: noGastro ? 'Exclude from café plans: the listing explicitly prohibits gastronomy.'
      : source.temporary ? 'Confirm tenancy duration, monthly rent and permitted café use; temporary pop-up inventory.' : facts.nextAction,
    rawSourceData: {
      sourceQuality: 'medium', rawDescription: text.slice(0, 9000), locationEvidence: location,
      districtEvidence: match ? { value: match.value, raw: location, method: 'listing-location', sourceUrl } : null,
      areaEvidence, areaType: sales ? 'sales_area' : facts.area.areaType || 'single_unit_total',
      rentEvidence: request ? 'Preis auf Anfrage' : (source.temporary ? null : monthly.evidence?.raw),
      rentConfidence: source.temporary ? 'low' : monthly.evidence?.confidence,
      sourcePriceText: text.match(/(?:Preis|Miete\/Monat)[\s\S]{0,200}/)?.[0],
      temporaryTenancy: source.temporary, explicitDead: dead,
      sourceObjectId: objectId, identityConflict,
      commercialEvidence: text.match(/[^.]{0,70}(?:Ladenfläche|Verkaufsfläche|Retail|Pop.Up.Store)[^.]{0,120}/i)?.[0],
      sourceObjectConfirmed: Boolean(area > 0 && areaEvidence && !dead && !identityConflict),
      extractionVersion: 'phase3c3-small-pages-v1'
    }
  };
}

module.exports = { SOURCES, sourceForUrl, parseSmallSourcePage, plain };

const { SOURCES, sourceForUrl, parseSmallSourcePage } = require('../small-source-pages');
const { extractLinks, sleep } = require('../utils');

async function discover({ fetchPage, now, rateLimitMs = 1200 } = {}) {
  const candidates = [], errors = [], meta = { sources: {} };
  for (const source of SOURCES) {
    const stats = meta.sources[source.name] = { catalogs: 1, pagesScanned: 0, pagesDiscovered: 0,
      directPagesFetched: 0, excludedLargeOrMissingArea: 0, excludedNotCommercialOrMunich: 0, excludedDead: 0, excludedIdentityConflict: 0 };
    try {
      const catalog = await fetchPage(source.catalog);
      stats.pagesScanned += 1;
      const urls = extractLinks(catalog.body, catalog.finalUrl || source.catalog,
        (url) => sourceForUrl(url)?.name === source.name);
      stats.pagesDiscovered = urls.length;
      // Catalog links only, never related-listing recursion or search-engine snippets.
      for (const url of urls.slice(0, 80)) {
        await sleep(rateLimitMs);
        try {
          const page = await fetchPage(url);
          stats.directPagesFetched += 1;
          if ((page.finalUrl || url).replace(/#.*$/, '') !== url) throw new Error('Direct object redirected; not verified');
          const candidate = parseSmallSourcePage(url, page.body);
          if (!candidate) { stats.excludedNotCommercialOrMunich += 1; continue; }
          if (candidate.rawSourceData.explicitDead) { stats.excludedDead += 1; continue; }
          if (candidate.rawSourceData.identityConflict) { stats.excludedIdentityConflict += 1; continue; }
          if (!(candidate.unitArea >= 20 && candidate.unitArea <= 60) || candidate.projectTotalArea > 60) {
            stats.excludedLargeOrMissingArea += 1; continue;
          }
          candidates.push({ ...candidate, discoveryMethod: 'small-unit-public-catalog',
            rawSourceData: { ...candidate.rawSourceData, catalogUrl: source.catalog, detectedAt: now } });
        } catch (error) { errors.push({ source: source.name, sourceUrl: url, message: error.message }); }
      }
    } catch (error) { errors.push({ source: source.name, sourceUrl: source.catalog, message: error.message }); }
  }
  return { source: 'Small local sources', candidates, errors, meta };
}

module.exports = { discover };

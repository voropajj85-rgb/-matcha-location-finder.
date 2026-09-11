// Offline browser regression: real app + mapper; isolated report/edge-case responses.
// Run with installed Playwright, optionally PLAYWRIGHT_MODULE_PATH / BROWSER_CHANNEL.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { report, listings, edgeCases, databaseRows } = require('./ui-fixtures');
const root = path.resolve(__dirname, '../..');
const server = http.createServer((request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${relative === '/' ? '/index.html' : relative}`);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  fs.readFile(file, (error, content) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
    response.end(content);
  });
});
let browser;
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, timezoneId: 'Europe/Berlin' });
    const errors = [], networkViolations = [];
    let data = databaseRows(listings), fail = false;
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/') || request.method() !== 'GET') {
        networkViolations.push(`${request.method()} ${request.url()}`); return route.abort();
      }
      if (request.url().includes('/js/supabase.js')) return route.fulfill({ contentType: 'text/javascript', body:
        `export function getSupabaseClient() { return { from(table) { if(table !== 'listings') throw Error('Unexpected table'); return { select(fields) { if(fields !== '*') throw Error('Unexpected fields'); return { async order() { return (await fetch('/__ui-fixtures')).json(); } }; } }; } }; }` });
      if (request.url().endsWith('/__ui-fixtures')) return route.fulfill({ json: fail ? { data: null, error: { message: 'Test read failure' } } : { data, error: null } });
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date(report.generatedAt) });
    async function load(expected) {
      await page.goto(origin);
      await page.waitForFunction((n) => document.querySelector('#count-market').textContent === String(n), expected);
    }
    async function noOverflow() {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow at ${width}`);
    }
    async function tab(group, expected) {
      await page.click(`#tab-${group}`);
      assert.equal(await page.locator('#list .decision-card').count(), expected);
      assert.equal(await page.locator(`#tab-${group}`).getAttribute('aria-selected'), 'true');
    }
    await load(report.market_funnel.market);
    assert.equal(await page.locator('#tab-market').getAttribute('aria-selected'), 'true');
    await noOverflow();
    assert.ok((await page.locator('.inventory-tabs').boundingBox()).y < 500, 'Tabs on first mobile screen');
    await tab('suitable', report.market_funnel.suitable_parameters);
    await tab('best', report.market_funnel.visible_best);
    await page.locator('#tab-best').press('Home');
    assert.equal(await page.locator('#tab-market').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#marketCount').textContent(), String(report.market_funnel.market));
    const districts = await page.locator('#fDistrict option').allTextContents();
    assert.ok(districts.includes('Laim') && districts.includes('Pasing') && districts.includes('Ganz München'));
    await page.selectOption('#fDistrict', 'Laim');
    const districtCards = await page.locator('#list .decision-location').allTextContents();
    assert.ok(districtCards.length > 0 && districtCards.every((text) => text.startsWith('Laim')));
    assert.equal(await page.locator('#count-market').textContent(), String(districtCards.length));
    await page.click('#resetInventory');
    assert.equal(await page.locator('#list .decision-card').count(), report.market_funnel.market);
    data = databaseRows(edgeCases());
    await load(6);
    const card = (id) => page.locator(`#list [data-listing-id="${id}"]`);
    assert.match(await card('test-large').textContent(), /Nicht Suitable: 138 m²/);
    assert.match(await card('test-unknown').textContent(), /Miete nicht bestätigt/);
    assert.match(await card('test-prohibited').textContent(), /Nicht erlaubt/);
    assert.match(await card('test-temporary').textContent(), /Temporär · Pop-up/);
    assert.equal(await page.locator('#list [data-listing-id="test-stale"]').count(), 0);
    assert.equal(await page.locator('#list [data-listing-id="test-invalid"]').count(), 0);
    await noOverflow();
    await card('test-temporary').getByRole('button', { name: 'Details' }).click();
    assert.match(await page.locator('#detail').textContent(), /Keine bestätigte langfristige Mietoption/);
    await noOverflow();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#detailSheet').evaluate((el) => el.classList.contains('open')), false);
    const href = await card('test-small').getByRole('link').getAttribute('href');
    assert.ok(href.startsWith('https://www.kleinanzeigen.de/s-anzeige/'));
    await context.route(href, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Test external destination</title>' }));
    const popupPromise = page.waitForEvent('popup');
    await card('test-small').getByRole('link').click();
    const popup = await popupPromise; await popup.waitForLoadState();
    assert.equal(popup.url(), href); await popup.close();
    await page.selectOption('#fDistrict', 'Laim');
    await page.locator('.inventory-toolbar [data-open-sheet]').click();
    await page.fill('#fMin', '25'); await page.fill('#fMax', '60'); await page.fill('#fRent', '3000');
    await page.selectOption('#fGastro', 'possible'); await page.selectOption('#fSource', 'Kleinanzeigen');
    await noOverflow();
    await page.click('#applyFilters');
    assert.equal(await page.locator('#list .decision-card').count(), 1);
    assert.equal(await page.locator('#count-market').textContent(), '1');
    await tab('suitable', 1); await tab('best', 1);
    await page.click('#resetInventory');
    assert.equal(await page.locator('#fDistrict').inputValue(), 'all');
    await tab('market', 6);
    assert.ok((await card('test-small').getByRole('link').boundingBox()).height >= 44, 'Touch-friendly primary CTA');
    fail = true;
    await page.reload();
    await page.getByText('Angebote konnten nicht geladen werden.').waitFor();
    assert.equal(await page.locator('#marketCount').textContent(), '—');
    assert.equal(await page.locator('#list .decision-card').count(), 0, 'No stale/fixture fallback after load failure');
    fail = false;
    await page.getByRole('button', { name: 'Erneut versuchen' }).click();
    await page.waitForFunction(() => document.querySelector('#count-market').textContent === '6');
    assert.deepEqual(errors, []); assert.deepEqual(networkViolations, [], 'No external API calls or writes in regression tests');
    console.log(`Browser checks passed at ${width}px: tabs, counts, cards, uncertainties, temporary units, district/combined/reset filters, details, external URL, keyboard, retry, overflow.`);
    await context.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server.close();
});

import { isVisibleLead, rankLeads } from './filters.js';
import { buildLeadCard, buildListingDetail, escapeHtml as esc } from './listings.js';
import { fetchListings } from './data/listings-repository.js?v=phase3c4';
import { addUserListing, loadUserListings } from './storage.js';
import { GROUPS, emptyFilters, classifyInventory, filterInventory, inventoryCounts, selectInventory } from './inventory.js';
import { buildDecisionCard, buildDecisionDetail } from './decision-cards.js';

const state = { listings: [], rows: [], group: 'market', filters: emptyFilters(), loading: true, error: null };
const el = (id) => document.getElementById(id);
const descriptions = {
  market: 'Der bekannte Münchner Markt – auch größere Flächen, hohe Mieten und offene Angaben bleiben sichtbar.',
  suitable: 'Zielgröße und Nutzung passen grundsätzlich. Bei Miete auf Anfrage bleibt das Budget offen; Genehmigungen sind zu prüfen.',
  best: 'Die stärkste Vorauswahl aus dem bekannten Markt. Best ist eine eigene Bewertung und nicht zwingend Teil von Suitable.'
};
function allListings() { return [...state.listings, ...loadUserListings()]; }
function optionValues(id, values, label) {
  el(id).innerHTML = `<option value="all">${label}</option>` + values.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
}
function syncOptions() {
  const rows = state.rows.filter((row) => row.market);
  optionValues('fDistrict', [...new Set(rows.map((row) => row.district))].sort(), 'Ganz München');
  optionValues('fSource', [...new Set(rows.map(({ listing }) => listing.sourceName || listing.source).filter(Boolean))].sort(), 'Alle Quellen');
  syncFilterForm();
}
function syncFilterForm() {
  for (const [id, key] of Object.entries({ fDistrict: 'district', fMin: 'minArea', fMax: 'maxArea', fRent: 'maxRent', fGastro: 'gastro', fSource: 'source' })) el(id).value = state.filters[key];
}
function renderState(text, retry = false) {
  el('list').innerHTML = `<div class="state-card"><strong>${esc(text)}</strong>${retry ? '<button class="state-action" type="button" data-action="retry-load">Erneut versuchen</button>' : ''}</div>`;
}
function renderListings() {
  if (state.loading || state.error) {
    for (const id of ['marketCount', 'targetCount', 'suitableCount', 'bestCount', ...GROUPS.map((g) => `count-${g}`)]) el(id).textContent = '—';
    renderState(state.error ? 'Angebote konnten nicht geladen werden.' : 'Angebote werden geladen …', Boolean(state.error));
    el('dataMeta').textContent = state.error ? 'Daten derzeit nicht verfügbar. Es werden keine Beispielangebote eingesetzt.' : 'Daten werden geladen …';
    el('leadList').innerHTML = ''; return;
  }
  state.rows = classifyInventory(state.listings);
  const totals = inventoryCounts(state.rows);
  const counts = inventoryCounts(filterInventory(state.rows, state.filters));
  for (const [id, key] of Object.entries({ marketCount: 'market', targetCount: 'targetArea', suitableCount: 'suitable', bestCount: 'best' })) el(id).textContent = totals[key];
  const dates = state.listings.map((row) => Date.parse(row.lastVerifiedAt)).filter((value) => Number.isFinite(value) && value <= Date.now());
  el('dataMeta').textContent = `${dates.length ? `Zuletzt verifiziert: ${new Date(Math.max(...dates)).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}` : 'Prüfzeitpunkt nicht bestätigt'} · ${totals.temporary} temporäre Angebote im Markt · Kein vollständiges Marktverzeichnis`;
  document.querySelectorAll('[data-group]').forEach((button) => {
    const active = button.dataset.group === state.group;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    el(`count-${button.dataset.group}`).textContent = counts[button.dataset.group];
  });
  const rows = selectInventory(state.rows, state.group, state.filters);
  el('inventoryPanel').setAttribute('aria-labelledby', `tab-${state.group}`);
  el('listHeading').textContent = state.group[0].toUpperCase() + state.group.slice(1);
  el('listMeta').textContent = `${rows.length} von ${totals[state.group]} Angeboten`;
  el('groupDescription').textContent = descriptions[state.group];
  const filterCount = Object.values(state.filters).filter((v) => v !== '' && v !== 'all').length;
  el('filterCount').textContent = filterCount ? `(${filterCount})` : '';
  el('list').innerHTML = rows.map((row) => buildDecisionCard(row)).join('');
  if (!rows.length) renderState(totals[state.group] ? 'Keine Angebote für diese Filter. Filter zurücksetzen, um mehr zu sehen.' : 'Derzeit keine aktuell verifizierten Angebote in dieser Auswahl.');
  const leads = rankLeads(allListings().filter(isVisibleLead));
  el('leadMeta').textContent = `(${leads.length})`;
  el('leadList').innerHTML = leads.map((l) => buildLeadCard(l)).join('');
}
async function loadListings() {
  state.loading = true; state.error = null; renderListings();
  try { state.listings = await fetchListings({ allowFixtureFallback: false }); state.rows = classifyInventory(state.listings); syncOptions(); }
  catch (error) { console.error('Listing load failed', error); state.error = error; }
  state.loading = false; renderListings();
}
let focusBeforeSheet;
function openSheet(id) {
  focusBeforeSheet = document.activeElement;
  if (id === 'filterSheet') syncFilterForm();
  el(id).classList.add('open'); document.body.style.overflow = 'hidden';
  el(id).querySelector('button, input, select')?.focus();
}
function closeSheet(id) {
  el(id).classList.remove('open'); document.body.style.overflow = ''; focusBeforeSheet?.focus();
}
function openDetails(id) {
  const row = state.rows.find(({ listing }) => (listing.id || listing.externalId) === id);
  const listing = allListings().find((l) => l.id === id); if (!listing) return;
  el('detail').innerHTML = row ? buildDecisionDetail(row) : buildListingDetail(listing);
  openSheet('detailSheet');
}
function resetFilterForm() {
  state.filters = emptyFilters(); syncFilterForm();
  if (el('filterSheet').classList.contains('open')) closeSheet('filterSheet');
  renderListings();
}
function applyFilterForm() {
  if (['fMin', 'fMax', 'fRent'].some((id) => !el(id).reportValidity())) return;
  for (const [id, key] of Object.entries({ fMin: 'minArea', fMax: 'maxArea', fRent: 'maxRent', fGastro: 'gastro', fSource: 'source' })) state.filters[key] = el(id).value;
  closeSheet('filterSheet'); renderListings();
}
function bindEvents() {
  document.addEventListener('click', (event) => {
    const group = event.target.closest('[data-group]'); if (group) { state.group = group.dataset.group; renderListings(); }
    const open = event.target.closest('[data-open-sheet]'); if (open) openSheet(open.dataset.openSheet);
    const close = event.target.closest('[data-close-sheet]'); if (close) closeSheet(close.dataset.closeSheet);
    const detail = event.target.closest('[data-action="details"]'); if (detail) openDetails(detail.dataset.id);
    if (event.target.closest('[data-action="retry-load"]')) loadListings();
  });
  document.querySelector('.inventory-tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const index = GROUPS.indexOf(state.group);
    state.group = event.key === 'Home' ? 'market' : event.key === 'End' ? 'best' : GROUPS[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    renderListings(); el(`tab-${state.group}`).focus();
  });
  document.addEventListener('keydown', (event) => {
    const sheet = document.querySelector('.sheet-backdrop.open'); if (!sheet) return;
    if (event.key === 'Escape') closeSheet(sheet.id);
    if (event.key === 'Tab') {
      const focusable = [...sheet.querySelectorAll('button, a[href], input, select, textarea, summary')].filter((node) => node.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.querySelectorAll('.sheet-backdrop').forEach((sheet) => sheet.addEventListener('click', (event) => { if (event.target === sheet) closeSheet(sheet.id); }));
  el('fDistrict').addEventListener('change', () => { state.filters.district = el('fDistrict').value; renderListings(); });
  el('applyFilters').addEventListener('click', applyFilterForm);
  el('resetFilters').addEventListener('click', resetFilterForm);
  el('resetInventory').addEventListener('click', resetFilterForm);
  el('saveListing').addEventListener('click', saveManualListing);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderListings(); });
}
bindEvents();
loadListings();

function saveManualListing() {
  const district = el('aDistrict').value.trim();
  const area = Number(el('aArea').value);
  const rent = Number(el('aRent').value) || null;
  const nk = Number(el('aNk').value) || null;

  if (!district || !area) {
    alert('Нужны район и площадь.');
    return;
  }

  addUserListing({
    id: `own-${Date.now()}`,
    source: 'manual',
    sourceName: 'Manual',
    sourceFamily: 'manual',
    listingType: 'manual_lead',
    district,
    address: el('aAddress').value.trim(),
    area,
    unitArea: area,
    projectTotalArea: null,
    rent,
    nk,
    gastro: el('aGastro').value,
    gastroSuitability: el('aGastro').value === 'yes' ? 'possible' : 'unknown',
    gastroEvidence: 'Manual user entry; gastro suitability is not source-verified.',
    status: 'LEAD',
    availabilityStatus: 'lead',
    lastVerifiedAt: null,
    directUrl: Boolean(el('aUrl').value.trim()),
    verificationMethod: 'manual-user-entry',
    url: el('aUrl').value.trim(),
    fees: el('aFees').value.trim() || '',
    provision: { value: null, known: false },
    abloese: { value: null, known: false },
    kaution: { value: null, known: false },
    nebenkosten: { value: nk, known: nk != null },
    verifiedSummary: el('aNote').value.trim() || 'Manual lead added by user. Source facts still need verification.',
    keyFacts: ['Manual lead'],
    unknowns: ['source verification', 'full entry costs', 'current availability', 'permission for Matcha/Café use'],
    nextAction: 'Verify the source and request current conditions before treating this as a working candidate.',
    note: el('aNote').value.trim()
  });

  closeSheet('addSheet');
  document.querySelectorAll('#addSheet input, #addSheet textarea').forEach((field) => {
    field.value = '';
  });
  el('aGastro').value = 'check';
  renderListings();
}

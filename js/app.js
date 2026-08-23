import { applyListingFilters, defaultProjectConfig, isVisibleListing, resetFilters } from './filters.js?v=business-fit-2';
import { buildListingCard, buildListingDetail, calculateMatchaScore, escapeHtml } from './listings.js?v=business-fit-2';
import { fetchListings } from './data/listings-repository.js?v=business-fit-2';
import { addUserListing, loadUserListings } from './storage.js?v=info-model-1';

const state = {
  baseListings: [],
  projectConfig: defaultProjectConfig,
  filters: resetFilters(),
  mode: 'list',
  loading: true,
  loadError: null
};

function el(id) {
  return document.getElementById(id);
}

function allListings() {
  return [...loadUserListings(), ...state.baseListings];
}

function getVisibleBaseListings() {
  return state.baseListings.filter((listing) => isVisibleListing(listing, state.projectConfig));
}

function formatVerificationDate(value) {
  if (!value) return 'не проверено';

  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  } catch {
    return 'не проверено';
  }
}

function getLastVerifiedAt(listings) {
  const timestamps = listings
    .map((listing) => listing.lastVerifiedAt)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);

  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function loadJson(url) {
  const cacheBustedUrl = `${url}?v=${Date.now()}`;

  if (typeof window.fetch === 'function') {
    return window.fetch(url, { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
      return response.json();
    });
  }

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', cacheBustedUrl, true);
    request.setRequestHeader('Cache-Control', 'no-store');
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(`${url} HTTP ${request.status}`));
        return;
      }

      try {
        resolve(JSON.parse(request.responseText));
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => reject(new Error(`${url} request failed`));
    request.send();
  });
}

async function loadListings() {
  state.loading = true;
  state.loadError = null;
  renderListings();

  try {
    const [projectConfig, listings] = await Promise.all([
      loadJson('./data/project-config.json'),
      fetchListings()
    ]);
    state.projectConfig = { ...defaultProjectConfig, ...projectConfig };
    state.baseListings = Array.isArray(listings) ? listings : [];
  } catch (error) {
    console.error('Не удалось загрузить объявления', error);
    state.loadError = error;
  } finally {
    state.loading = false;
  }
}

function renderSummary(listings) {
  const confirmed = listings.filter((listing) => listing.listingType === 'direct_listing').length;
  const leads = listings.filter((listing) => listing.listingType !== 'direct_listing').length;
  el('sCount').textContent = listings.length;
  el('sAvg').textContent = confirmed;
  el('sTop').textContent = leads;
}

function renderStateCard(type, message, action = '') {
  const actionMarkup = action
    ? `<button class="state-action" type="button" data-action="${action}">Повторить</button>`
    : '';

  return `
    <article class="state-card ${type}">
      <strong>${message}</strong>
      ${actionMarkup}
    </article>
  `;
}

function renderSelectOptions(selectId, values) {
  const select = el(selectId);
  const currentValue = select.value;
  const options = ['<option value="all">Все</option>']
    .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`));

  select.innerHTML = options.join('');
  select.value = values.includes(currentValue) ? currentValue : 'all';
}

function syncFilterOptions() {
  const listings = allListings();
  const sources = [...new Set(listings.map((listing) => listing.sourceName || listing.source).filter(Boolean))].sort();
  const statuses = [...new Set(listings.map((listing) => listing.status).filter(Boolean))].sort();

  renderSelectOptions('fSource', sources);
  renderSelectOptions('fStatus', statuses);
}

function syncFilterForm() {
  el('fMin').value = state.filters.minArea;
  el('fMax').value = state.filters.maxArea;
  el('fRent').value = state.filters.maxRent;
  el('fGastro').value = state.filters.gastro;
  setSelectValue('fSource', state.filters.source);
  setSelectValue('fStatus', state.filters.status);
}

function setSelectValue(id, value) {
  const select = el(id);
  select.value = value;
  if (select.value !== value) select.value = 'all';
}

function renderMap(listings) {
  const withCoordinates = listings.filter((listing) => {
    const coords = listing.coordinates || listing.coords || {};
    return coords.lat != null && coords.lng != null;
  });

  if (!withCoordinates.length) {
    el('mapContainer').innerHTML = `
      <div class="map-empty">
        <strong>Карта появится для объектов с координатами</strong>
        <span>Контейнер готов для Leaflet + OpenStreetMap без переписывания UI.</span>
      </div>
    `;
    return;
  }

  el('mapContainer').innerHTML = `
    <div class="map-empty">
      <strong>${withCoordinates.length} объектов с координатами</strong>
      <span>Следующий шаг — подключить Leaflet и отрисовать маркеры.</span>
    </div>
  `;
}

function renderListings() {
  if (state.loading) {
    renderSummary([]);
    el('list').innerHTML = renderStateCard('loading', 'Загружаю объявления...');
    renderMap([]);
    return;
  }

  if (state.loadError) {
    renderSummary([]);
    el('list').innerHTML = renderStateCard('error', 'Не удалось загрузить объявления.', 'retry-load');
    renderMap([]);
    return;
  }

  const listings = applyListingFilters(allListings(), state.filters, state.projectConfig, calculateMatchaScore);
  renderSummary(listings);
  const visibleBaseListings = getVisibleBaseListings();
  el('listMeta').textContent = `${visibleBaseListings.length} активных/лидов · проверено ${formatVerificationDate(getLastVerifiedAt(state.baseListings))}`;

  el('list').innerHTML = listings.length
    ? listings.map((listing) => buildListingCard(listing, state.projectConfig)).join('')
    : renderStateCard('empty', 'Нет объектов под текущий фильтр.');

  renderMap(listings);
}

function showMode(mode) {
  state.mode = mode;

  el('listMode').classList.toggle('hidden', mode !== 'list');
  el('mapMode').classList.toggle('hidden', mode !== 'map');

  el('tabList').classList.toggle('active', mode === 'list');
  el('tabMap').classList.toggle('active', mode === 'map');

  el('tabList').setAttribute('aria-selected', String(mode === 'list'));
  el('tabMap').setAttribute('aria-selected', String(mode === 'map'));

  document.querySelectorAll('[data-nav-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.navMode === mode);
  });
}

function openSheet(id) {
  if (id === 'filterSheet') {
    syncFilterOptions();
    syncFilterForm();
  }

  el(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSheet(id) {
  el(id).classList.remove('open');
  document.body.style.overflow = '';
}

function openDetails(listingId) {
  const listing = allListings().find((item) => item.id === listingId);
  if (!listing) return;

  el('detail').innerHTML = buildListingDetail(listing, state.projectConfig);

  openSheet('detailSheet');
}

function applyFilterForm() {
  state.filters.minArea = el('fMin').value.trim();
  state.filters.maxArea = el('fMax').value.trim();
  state.filters.maxRent = el('fRent').value.trim();
  state.filters.gastro = el('fGastro').value;
  state.filters.source = el('fSource').value;
  state.filters.status = el('fStatus').value;
  closeSheet('filterSheet');
  renderListings();
}

function resetFilterForm() {
  state.filters = resetFilters();
  syncFilterForm();
  closeSheet('filterSheet');
  renderListings();
}

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

function bindEvents() {
  document.addEventListener('click', (event) => {
    const modeButton = event.target.closest('[data-mode]');
    if (modeButton) showMode(modeButton.dataset.mode);

    const retryButton = event.target.closest('[data-action="retry-load"]');
    if (retryButton) loadListings().then(renderListings);

    const detailsButton = event.target.closest('[data-action="details"]');
    if (detailsButton) openDetails(detailsButton.dataset.id);

    const openSheetButton = event.target.closest('[data-open-sheet]');
    if (openSheetButton) openSheet(openSheetButton.dataset.openSheet);

    const closeSheetButton = event.target.closest('[data-close-sheet]');
    if (closeSheetButton) closeSheet(closeSheetButton.dataset.closeSheet);
  });

  document.querySelectorAll('.sheet-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeSheet(backdrop.id);
    });
  });

  el('applyFilters').addEventListener('click', applyFilterForm);
  el('resetFilters').addEventListener('click', resetFilterForm);
  el('saveListing').addEventListener('click', saveManualListing);
}

async function start() {
  bindEvents();
  await loadListings();
  syncFilterOptions();
  renderListings();
  showMode('list');
}

start();
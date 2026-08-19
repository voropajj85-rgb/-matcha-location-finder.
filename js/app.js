import { applyListingFilters, isVisibleListing, resetFilters, togglePreset } from './filters.js';
import { buildListingCard, buildListingDetail, calculateDealScore, escapeHtml } from './listings.js';
import { addUserListing, loadUserListings } from './storage.js';

const state = {
  baseListings: [],
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
  return state.baseListings.filter(isVisibleListing);
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

async function loadListings() {
  state.loading = true;
  state.loadError = null;
  renderListings();

  try {
    const response = await fetch('./data/listings.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const listings = await response.json();
    state.baseListings = Array.isArray(listings) ? listings : [];
  } catch (error) {
    console.error('Не удалось загрузить listings.json', error);
    state.loadError = error;
  } finally {
    state.loading = false;
  }
}

function renderSummary(listings) {
  const knownRent = listings.filter((listing) => listing.rent != null);

  el('sCount').textContent = listings.length;
  el('sAvg').textContent = knownRent.length
    ? `€${Math.round(knownRent.reduce((sum, listing) => sum + listing.rent, 0) / knownRent.length)}`
    : '—';
  el('sTop').textContent = listings.length
    ? Math.max(...listings.map((listing) => listing.score || 0)).toFixed(1)
    : '—';
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

function renderQuickFilters() {
  document.querySelectorAll('[data-preset]').forEach((button) => {
    const active = Boolean(state.filters.presets[button.dataset.preset]);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
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
  const sources = [...new Set(listings.map((listing) => listing.source).filter(Boolean))].sort();
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
    el('dealsList').innerHTML = renderStateCard('loading', 'Загружаю выгодные объекты...');
    renderMap([]);
    renderQuickFilters();
    return;
  }

  if (state.loadError) {
    renderSummary([]);
    el('list').innerHTML = renderStateCard('error', 'Не удалось загрузить объявления.', 'retry-load');
    el('dealsList').innerHTML = renderStateCard('error', 'Не удалось загрузить объявления.', 'retry-load');
    renderMap([]);
    renderQuickFilters();
    return;
  }

  const listings = applyListingFilters(allListings(), state.filters);
  renderSummary(listings);
  const visibleBaseListings = getVisibleBaseListings();
  el('listMeta').textContent = `${visibleBaseListings.length} активных/лидов · проверено ${formatVerificationDate(getLastVerifiedAt(state.baseListings))}`;

  el('list').innerHTML = listings.length
    ? listings.map(buildListingCard).join('')
    : renderStateCard('empty', 'Нет объектов под текущий фильтр.');

  const deals = applyListingFilters(allListings(), state.filters)
    .filter((listing) => calculateDealScore(listing).score >= 20)
    .sort((a, b) => calculateDealScore(b).score - calculateDealScore(a).score);

  el('dealsList').innerHTML = deals.length
    ? deals.map(buildListingCard).join('')
    : renderStateCard('empty', 'Пока нет выгодных условий под текущий фильтр.');

  renderMap(listings);
  renderQuickFilters();
}

function showMode(mode) {
  state.mode = mode;

  el('listMode').classList.toggle('hidden', mode !== 'list');
  el('dealsMode').classList.toggle('hidden', mode !== 'deals');
  el('mapMode').classList.toggle('hidden', mode !== 'map');

  el('tabList').classList.toggle('active', mode === 'list');
  el('tabDeals').classList.toggle('active', mode === 'deals');
  el('tabMap').classList.toggle('active', mode === 'map');

  el('tabList').setAttribute('aria-selected', String(mode === 'list'));
  el('tabDeals').setAttribute('aria-selected', String(mode === 'deals'));
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

  el('detail').innerHTML = buildListingDetail(listing);

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
    district,
    address: el('aAddress').value.trim(),
    area,
    rent,
    nk,
    gastro: el('aGastro').value,
    score: 7,
    status: 'LEAD',
    availabilityStatus: 'lead',
    lastVerifiedAt: null,
    directUrl: Boolean(el('aUrl').value.trim()),
    verificationMethod: 'manual-user-entry',
    url: el('aUrl').value.trim(),
    fees: el('aFees').value.trim() || 'уточнить',
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

    const presetButton = event.target.closest('[data-preset]');
    if (presetButton) {
      state.filters.presets = togglePreset(state.filters.presets, presetButton.dataset.preset);
      renderListings();
    }

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

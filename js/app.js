import { applyListingFilters, defaultFilters, togglePreset } from './filters.js';
import { buildListingCard, calculateDealScore, escapeHtml } from './listings.js';
import { addUserListing, loadUserListings } from './storage.js';

const state = {
  baseListings: [],
  filters: { ...defaultFilters },
  mode: 'list'
};

function el(id) {
  return document.getElementById(id);
}

function allListings() {
  return [...loadUserListings(), ...state.baseListings];
}

async function loadListings() {
  try {
    const response = await fetch('./data/listings.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.baseListings = await response.json();
  } catch (error) {
    console.error('Не удалось загрузить listings.json', error);
    state.baseListings = [];
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

function renderListings() {
  const listings = applyListingFilters(allListings(), state.filters);
  renderSummary(listings);

  el('list').innerHTML = listings.length
    ? listings.map(buildListingCard).join('')
    : '<article class="card"><div class="card-body">Нет объектов под текущий фильтр.</div></article>';

  const deals = allListings()
    .filter((listing) => calculateDealScore(listing).score >= 20)
    .sort((a, b) => calculateDealScore(b).score - calculateDealScore(a).score);

  el('dealsList').innerHTML = deals.length
    ? deals.map(buildListingCard).join('')
    : '<article class="card"><div class="card-body">Пока нет выгодных условий.</div></article>';
}

function showMode(mode) {
  state.mode = mode;

  el('listMode').classList.toggle('hidden', mode !== 'list');
  el('dealsMode').classList.toggle('hidden', mode !== 'deals');
  el('mapMode').classList.toggle('hidden', mode !== 'map');

  el('tabList').classList.toggle('active', mode === 'list');
  el('tabDeals').classList.toggle('active', mode === 'deals');
  el('tabMap').classList.toggle('active', mode === 'map');

  document.querySelectorAll('[data-nav-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.navMode === mode);
  });
}

function openSheet(id) {
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

  const price = listing.rent == null
    ? 'Цена по запросу'
    : `€${Number(listing.rent).toLocaleString('de-DE')}`;

  el('detail').innerHTML = `
    <h3>${escapeHtml(listing.district)}</h3>
    <p class="card-meta">${escapeHtml(listing.source || '')}</p>
    <div class="price">${price}</div>
    <div class="tags">
      <span class="tag">${listing.area == null ? '?' : listing.area} м²</span>
      <span class="tag">${Number(listing.score || 0).toFixed(1)}/10</span>
    </div>
    <div class="card-note">${escapeHtml(listing.note || '')}</div>
    <div class="card-note"><strong>Ablöse / Provision:</strong> ${escapeHtml(listing.fees || 'уточнить')}</div>
    <p>
      <a class="primary-button" style="display:block;text-align:center;text-decoration:none" target="_blank" rel="noopener" href="${escapeHtml(listing.url || '#')}">
        Открыть объявление
      </a>
    </p>
  `;

  openSheet('detailSheet');
}

function applyFilterForm() {
  state.filters.minArea = Number(el('fMin').value) || 0;
  state.filters.maxArea = Number(el('fMax').value) || 999;
  state.filters.maxRent = Number(el('fRent').value) || 999999;
  closeSheet('filterSheet');
  renderListings();
}

function saveManualListing() {
  const district = el('aDistrict').value.trim();
  const area = Number(el('aArea').value);
  const rent = Number(el('aRent').value) || null;

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
    nk: null,
    gastro: 'check',
    score: 7,
    status: '📌 Свой',
    url: el('aUrl').value.trim(),
    fees: 'уточнить',
    note: el('aNote').value.trim()
  });

  closeSheet('addSheet');
  renderListings();
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const modeButton = event.target.closest('[data-mode]');
    if (modeButton) showMode(modeButton.dataset.mode);

    const presetButton = event.target.closest('[data-preset]');
    if (presetButton) {
      state.filters.preset = togglePreset(state.filters.preset, presetButton.dataset.preset);
      renderListings();
    }

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
  el('saveListing').addEventListener('click', saveManualListing);
}

async function start() {
  bindEvents();
  await loadListings();
  renderListings();
  showMode('list');
}

start();

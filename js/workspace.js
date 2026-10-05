const STORAGE = {
  supplier: 'matcha_workspace_supplier_status',
  equipment: 'matcha_workspace_equipment_selected',
  economics: 'matcha_workspace_economics',
  launch: 'matcha_workspace_launch',
  notes: 'matcha_workspace_notes'
};

const titles = {
  dashboard: 'Панель проекта', locations: 'Поиск помещения', suppliers: 'Поставщики',
  equipment: 'Оснащение', menu: 'Меню и маржа', launch: 'План запуска'
};
const state = { data: null, supplierFilter: 'all', supplierSearch: '', equipmentFilter: 'all', equipmentSearch: '' };
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (v, digits = 0) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v || 0);
const load = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
const save = (key, value) => { localStorage.setItem(key, JSON.stringify(value)); flashSaved(); };

function flashSaved() {
  const el = $('saveState'); if (!el) return;
  el.textContent = 'Сохранено локально'; el.classList.add('is-saved');
  clearTimeout(flashSaved.timer); flashSaved.timer = setTimeout(() => { el.textContent = 'Изменения сохраняются локально'; el.classList.remove('is-saved'); }, 1200);
}

function setPage(page) {
  document.querySelectorAll('[data-page-panel]').forEach((el) => el.classList.toggle('is-active', el.dataset.pagePanel === page));
  document.querySelectorAll('[data-page]').forEach((el) => el.classList.toggle('is-active', el.dataset.page === page));
  $('pageTitle').textContent = titles[page] || titles.dashboard;
  localStorage.setItem('matcha_workspace_page', page);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function statusStore() { return load(STORAGE.supplier, {}); }
function equipmentStore() { return load(STORAGE.equipment, {}); }
function launchStore() { return load(STORAGE.launch, {}); }

function renderDashboard() {
  const suppliers = state.data.suppliers;
  const sStore = statusStore();
  const eStore = equipmentStore();
  const lStore = launchStore();
  const completed = state.data.launch.filter((x) => lStore[x.id]).length;
  const progress = Math.round((completed / state.data.launch.length) * 100);
  const selected = state.data.equipment.filter((x) => eStore[x.id]).reduce((sum, x) => sum + x.estimate, 0);
  const approved = suppliers.filter((x) => (sStore[x.id] || x.status) === 'approved').length;
  $('launchProgressBar').style.width = `${progress}%`;
  $('launchProgressText').textContent = `${progress}% задач запуска отмечено`;
  $('launchProgressBig').textContent = `${progress}%`;
  $('dashboardMetrics').innerHTML = [
    ['Поставщики', `${approved}/${suppliers.length}`, 'одобрено / всего кандидатов'],
    ['Оснащение', money(selected), 'выбрано в закупку'],
    ['Стартовое меню', '5', 'напитков для пилота'],
    ['План запуска', `${completed}/${state.data.launch.length}`, 'задач закрыто']
  ].map(([label, value, note]) => `<article class="metric-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');

  const next = state.data.launch.filter((x) => !lStore[x.id]).slice(0, 5);
  $('priorityList').innerHTML = next.length ? next.map((x, i) => `<button type="button" class="priority-item" data-page-jump="launch"><span>${String(i + 1).padStart(2, '0')}</span><div><strong>${esc(x.title)}</strong><small>${esc(x.group)}${x.blocking ? ' · блокирующая' : ''}</small></div><b>→</b></button>`).join('') : '<div class="empty-state">Все задачи отмечены. Можно переходить к следующему этапу.</div>';
}

function renderSuppliers() {
  const categories = [['all','Все'],['matcha','Matcha'],['syrup','Сиропы'],['packaging','Упаковка'],['equipment','Оборудование']];
  $('supplierFilters').innerHTML = categories.map(([id, label]) => `<button type="button" class="${state.supplierFilter === id ? 'is-active' : ''}" data-supplier-filter="${id}">${label}</button>`).join('');
  const store = statusStore();
  const query = state.supplierSearch.trim().toLowerCase();
  const rows = state.data.suppliers.filter((x) => (state.supplierFilter === 'all' || x.category === state.supplierFilter) && (!query || `${x.name} ${x.category} ${x.fit} ${x.note}`.toLowerCase().includes(query)));
  $('supplierGrid').innerHTML = rows.map((x) => {
    const status = store[x.id] || x.status;
    return `<article class="catalog-card">
      <div class="catalog-card__top"><span class="status-pill ${esc(status)}">${status === 'approved' ? 'ОДОБРЕН' : status === 'testing' ? 'ТЕСТ' : 'КАНДИДАТ'}</span><span class="country-pill">${esc(x.country)}</span></div>
      <h3>${esc(x.name)}</h3><p class="catalog-fit">${esc(x.fit)}</p><p>${esc(x.note)}</p>
      <div class="card-controls"><select data-supplier-status="${esc(x.id)}" aria-label="Статус ${esc(x.name)}"><option value="candidate" ${status === 'candidate' ? 'selected' : ''}>Кандидат</option><option value="testing" ${status === 'testing' ? 'selected' : ''}>Тест</option><option value="approved" ${status === 'approved' ? 'selected' : ''}>Одобрен</option></select><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Сайт ↗</a></div>
    </article>`;
  }).join('') || '<div class="empty-state">Ничего не найдено по этому фильтру.</div>';
}

function renderEquipment() {
  const categories = [['all','Всё'],['test-kit','Пилот'],['bar','Бар'],['packaging','Упаковка']];
  $('equipmentFilters').innerHTML = categories.map(([id,label]) => `<button type="button" class="${state.equipmentFilter === id ? 'is-active' : ''}" data-equipment-filter="${id}">${label}</button>`).join('');
  const store = equipmentStore();
  const query = state.equipmentSearch.trim().toLowerCase();
  const rows = state.data.equipment.filter((x) => (state.equipmentFilter === 'all' || x.category === state.equipmentFilter) && (!query || `${x.name} ${x.note}`.toLowerCase().includes(query)));
  $('equipmentGrid').innerHTML = rows.map((x) => `<label class="equipment-card ${store[x.id] ? 'is-selected' : ''}"><div class="equipment-check"><input type="checkbox" data-equipment-id="${esc(x.id)}" ${store[x.id] ? 'checked' : ''}><span></span></div><div><div class="equipment-card__meta"><span>${x.phase === 'test' ? 'ПИЛОТ' : 'ЗАПУСК'}</span>${x.required ? '<b>нужно</b>' : '<b>опция</b>'}</div><h3>${esc(x.name)}</h3><p>${esc(x.note)}</p></div><strong>${money(x.estimate)}</strong></label>`).join('') || '<div class="empty-state">Ничего не найдено.</div>';
  const selected = state.data.equipment.filter((x) => store[x.id]).reduce((sum, x) => sum + x.estimate, 0);
  $('equipmentSelectedTotal').textContent = money(selected);
}

function economicsValues() {
  const defaults = Object.fromEntries(state.data.economics.assumptions.map((x) => [x.id, x.value]));
  return { ...defaults, ...load(STORAGE.economics, {}) };
}

function drinkCost(drink, values) {
  let cost = drink.matchaG * values.matchaPerGram;
  if (drink.milk === 'milk') cost += drink.milkMl * values.milkPerMl;
  if (drink.milk === 'alt') cost += drink.milkMl * values.altMilkPerMl;
  cost += drink.syrupMl * values.syrupPerMl;
  cost += typeof drink.extra === 'string' ? Number(values[drink.extra] || 0) : Number(drink.extra || 0);
  cost += drink.packaging === 'hot' ? values.packagingHot : values.packagingCold;
  return cost;
}

function renderEconomics() {
  const values = economicsValues();
  $('assumptionFields').innerHTML = state.data.economics.assumptions.map((x) => `<label><span>${esc(x.label)}</span><input type="number" min="0" step="${x.step}" value="${Number(values[x.id]).toFixed(String(x.step).split('.')[1]?.length || 0)}" data-economic-id="${esc(x.id)}"></label>`).join('');
  let marginSum = 0;
  $('menuGrid').innerHTML = state.data.economics.menu.map((drink) => {
    const cost = drinkCost(drink, values); const margin = ((drink.price - cost) / drink.price) * 100; marginSum += margin;
    return `<article class="menu-card"><div class="menu-card__top"><span>${esc(drink.tag)}</span><strong>${money(drink.price, 2)}</strong></div><h3>${esc(drink.name)}</h3><div class="menu-numbers"><div><span>Себестоимость</span><b>${money(cost, 2)}</b></div><div><span>Валовая маржа</span><b>${margin.toFixed(1)}%</b></div></div><div class="margin-bar"><span style="width:${Math.max(0, Math.min(100, margin))}%"></span></div><small>${drink.matchaG} g matcha${drink.milkMl ? ` · ${drink.milkMl} ml milk` : ''}</small></article>`;
  }).join('');
  $('averageMargin').textContent = `${(marginSum / state.data.economics.menu.length).toFixed(1)}%`;
}

function renderLaunch() {
  const store = launchStore();
  const groups = [...new Set(state.data.launch.map((x) => x.group))];
  $('launchBoard').innerHTML = groups.map((group) => `<section class="launch-group"><div class="launch-group__heading"><h3>${esc(group)}</h3><span>${state.data.launch.filter((x) => x.group === group && store[x.id]).length}/${state.data.launch.filter((x) => x.group === group).length}</span></div>${state.data.launch.filter((x) => x.group === group).map((x) => `<label class="task-row ${store[x.id] ? 'is-done' : ''}"><input type="checkbox" data-launch-id="${esc(x.id)}" ${store[x.id] ? 'checked' : ''}><span class="task-check"></span><div><strong>${esc(x.title)}</strong><small>${x.blocking ? 'Блокирующая задача' : 'Можно делать параллельно'}</small></div></label>`).join('')}</section>`).join('');
  renderDashboard();
}

function bind() {
  document.addEventListener('click', (event) => {
    const page = event.target.closest('[data-page]'); if (page) setPage(page.dataset.page);
    const jump = event.target.closest('[data-page-jump]'); if (jump) setPage(jump.dataset.pageJump);
    const sf = event.target.closest('[data-supplier-filter]'); if (sf) { state.supplierFilter = sf.dataset.supplierFilter; renderSuppliers(); }
    const ef = event.target.closest('[data-equipment-filter]'); if (ef) { state.equipmentFilter = ef.dataset.equipmentFilter; renderEquipment(); }
  });
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-supplier-status]')) { const store = statusStore(); store[event.target.dataset.supplierStatus] = event.target.value; save(STORAGE.supplier, store); renderSuppliers(); renderDashboard(); }
    if (event.target.matches('[data-equipment-id]')) { const store = equipmentStore(); store[event.target.dataset.equipmentId] = event.target.checked; save(STORAGE.equipment, store); renderEquipment(); renderDashboard(); }
    if (event.target.matches('[data-economic-id]')) { const store = load(STORAGE.economics, {}); store[event.target.dataset.economicId] = Number(event.target.value) || 0; save(STORAGE.economics, store); renderEconomics(); }
    if (event.target.matches('[data-launch-id]')) { const store = launchStore(); store[event.target.dataset.launchId] = event.target.checked; save(STORAGE.launch, store); renderLaunch(); }
  });
  $('supplierSearch').addEventListener('input', (e) => { state.supplierSearch = e.target.value; renderSuppliers(); });
  $('equipmentSearch').addEventListener('input', (e) => { state.equipmentSearch = e.target.value; renderEquipment(); });
  $('resetEconomics').addEventListener('click', () => { localStorage.removeItem(STORAGE.economics); renderEconomics(); flashSaved(); });
  $('projectNotes').addEventListener('input', (e) => localStorage.setItem(STORAGE.notes, e.target.value));
}

async function init() {
  const response = await fetch('./data/workspace.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`workspace data HTTP ${response.status}`);
  state.data = await response.json();
  $('projectNotes').value = localStorage.getItem(STORAGE.notes) || '';
  $('runtimeLabel').textContent = navigator.userAgent.includes('Electron') ? 'Windows desktop · localhost' : `${location.hostname || 'local'} preview`;
  bind(); renderSuppliers(); renderEquipment(); renderEconomics(); renderLaunch();
  const last = localStorage.getItem('matcha_workspace_page') || 'dashboard'; setPage(titles[last] ? last : 'dashboard');
}

init().catch((error) => {
  console.error('Workspace init failed', error);
  document.querySelector('.workspace').insertAdjacentHTML('afterbegin', `<div class="fatal-banner">Не удалось загрузить конфигурацию workspace. ${esc(error.message)}</div>`);
});
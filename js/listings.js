import { defaultProjectConfig, isFreshVerifiedListing } from './filters.js?v=info-model-1';
import { calculateBusinessFit } from './business-fit.js?v=business-fit-1';
import { calculateProjectRelevance } from './project-relevance.js?v=relevance-1';
import { getValidExternalUrl } from './source-links.js?v=source-links-1';

const MAX_RELATIVE_FINANCIAL_MONTHS = 24;

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatMoney(value, fallback = 'не опубликовано') {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return formatFinancialCondition(value, fallback);
  return `€${Number(value).toLocaleString('de-DE')}`;
}

function formatArea(value, fallback = 'не опубликована') {
  return value == null ? fallback : `${Number(value).toLocaleString('de-DE')} м²`;
}

function formatFinancialCondition(condition, fallback = 'не опубликовано') {
  if (!condition) return fallback;
  if (typeof condition !== 'object') return String(condition);

  const status = String(condition.status || '').toLowerCase();
  if (status === 'free') return 'provisionsfrei';
  if (status === 'included') return 'включено';
  if (status === 'negotiable') return 'по договорённости';
  if (status === 'mentioned' || status === 'known_mentioned') return 'упомянуто, сумма не указана';
  if (status === 'unknown') return fallback;

  if (condition.amount != null) return formatMoney(condition.amount);
  if (condition.value != null && condition.value !== '') return String(condition.value);
  if (condition.months != null) {
    const months = Number(condition.months);
    if (!Number.isFinite(months) || months <= 0 || months > MAX_RELATIVE_FINANCIAL_MONTHS) return fallback;
    const suffix = Number(condition.months) === 1 ? 'месяц' : 'месяца';
    return `${months.toLocaleString('de-DE')} ${suffix} аренды`;
  }
  if (condition.known === true) return 'указано без суммы';
  return fallback;
}

function getRentLabel(listing) {
  const rentType = String(listing.rentType || listing.rawSourceData?.rentType || '').toLowerCase();
  const priceText = `${listing.rawSourceData?.sourcePriceText || ''} ${listing.rawSourceData?.rentEvidence || ''} ${listing.verifiedSummary || ''}`;
  if (listing.rent != null) return formatMoney(listing.rent);
  if (rentType === 'request'
    || rentType.includes('price_on_request')
    || rentType.includes('on_request')
    || /preis\s+auf\s+anfrage|miete(?:preis)?(?:\s+ab)?\s*[:\s]\s*auf\s+anfrage|mietpreis\s+ab\s+auf\s+anfrage/i.test(priceText)) {
    return 'Preis auf Anfrage';
  }
  return 'Miete nicht angegeben';
}

function getImageUrl(listing) {
  if (listing.image) return listing.image;
  if (Array.isArray(listing.images) && listing.images.length) return listing.images[0];
  return '';
}

function getSourceLabel(listing) {
  const source = `${listing.sourceName || listing.source || ''}`;
  if (/kleinanzeigen/i.test(source)) return 'Kleinanzeigen';
  if (/colliers/i.test(source)) return 'Colliers';
  if (/engel|völkers|voelkers/i.test(source)) return 'Engel & Völkers';
  if (/immobilie1/i.test(source)) return 'immobilie1';
  if (/stadt\s*münchen|stadt\s*muenchen/i.test(source)) return 'Stadt München';
  if (/immoscout/i.test(source)) return 'ImmoScout';
  if (/immowelt/i.test(source)) return 'Immowelt';
  return source || 'Источник';
}

function getTitle(listing) {
  return listing.title || listing.district || listing.address || 'Объект';
}

function getListingTypeLabel(listing) {
  const labels = {
    direct_listing: 'Direct listing',
    project_lead: 'Project lead',
    broker_lead: 'Broker lead',
    municipal_lead: 'Municipal lead',
    manual_lead: 'Manual lead'
  };
  return labels[listing.listingType] || 'Lead';
}

function getGastroLabel(listing) {
  const labels = {
    confirmed: 'Gastro подтверждено',
    possible: 'Gastro возможно',
    unknown: 'Gastro нужно уточнить',
    no: 'Gastro нельзя'
  };
  return labels[listing.gastroSuitability] || labels.unknown;
}

function getGastroClass(listing) {
  if (listing.gastroSuitability === 'confirmed') return 'ok';
  if (listing.gastroSuitability === 'no') return 'no';
  return 'check';
}

function getStatusClass(status = '') {
  const normalized = status.toLowerCase();
  if (normalized.includes('смотреть')) return 'watch';
  if (normalized.includes('уточнить')) return 'check';
  if (normalized.includes('резерв')) return 'reserve';
  if (normalized.includes('пропустить')) return 'skip';
  if (normalized.includes('lead')) return 'lead';
  return 'neutral';
}

function hasKnownCondition(condition, matcher) {
  return Boolean(condition?.known && matcher(String(condition.value || '').toLowerCase()));
}

function isScoreEligible(listing, projectConfig = defaultProjectConfig) {
  const relevance = calculateProjectRelevance(listing, projectConfig);
  const businessFit = calculateBusinessFit(listing);
  return listing.listingType === 'direct_listing'
    && listing.availabilityStatus === 'active'
    && isFreshVerifiedListing(listing, projectConfig.freshnessHours)
    && Boolean(getValidExternalUrl(listing))
    && listing.unitArea != null
    && listing.rent != null
    && listing.gastroSuitability !== 'unknown'
    && Boolean(listing.verifiedSummary || listing.gastroEvidence)
    && (relevance.level === 'strong' || relevance.level === 'acceptable')
    && businessFit.level !== 'exclude';
}

export function calculateMatchaScore(listing, projectConfig = defaultProjectConfig) {
  if (!isScoreEligible(listing, projectConfig) || listing.gastroSuitability === 'no') {
    return { score: null, eligible: false, label: 'Оценка пока невозможна', breakdown: null };
  }

  const breakdown = {
    gastro: 0,
    size: 0,
    rent: 0,
    conditions: 0,
    confidence: 0
  };

  if (listing.gastroSuitability === 'confirmed') breakdown.gastro = 30;
  else if (listing.gastroSuitability === 'possible') breakdown.gastro = 12;

  const area = listing.unitArea;
  if (area != null) {
    if (area >= projectConfig.targetArea.preferredMin && area <= projectConfig.targetArea.preferredMax) breakdown.size = 25;
    else if (area >= projectConfig.targetArea.acceptableMin && area <= projectConfig.targetArea.acceptableMax) breakdown.size = 18;
    else breakdown.size = 6;
  }

  const rent = listing.rent;
  if (rent != null) {
    if (rent <= 2500) breakdown.rent = 25;
    else if (rent <= projectConfig.targetRent.preferredMax) breakdown.rent = 20;
    else if (rent <= 3500) breakdown.rent = 8;
  }

  if (hasKnownCondition(listing.provision, (value) => value.includes('provisionsfrei'))) breakdown.conditions += 4;
  if (hasKnownCondition(listing.abloese, (value) => value.includes('без ablöse') || value.includes('ohne ablöse'))) breakdown.conditions += 3;
  if (hasKnownCondition(listing.kaution, (value) => value.includes('€') || value.includes('monats'))) breakdown.conditions += 2;
  if (listing.nebenkosten?.known) breakdown.conditions += 1;
  breakdown.conditions = Math.min(10, breakdown.conditions);

  breakdown.confidence += 3;
  if (isFreshVerifiedListing(listing, projectConfig.freshnessHours)) breakdown.confidence += 2;
  if (listing.address) breakdown.confidence += 2;
  if (listing.unitArea != null) breakdown.confidence += 1;
  if (listing.rent != null) breakdown.confidence += 1;
  if (listing.gastroEvidence) breakdown.confidence += 1;

  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return { score, eligible: true, label: `Matcha Score ${score}`, breakdown };
}

export function calculateDealScore(listing, projectConfig = defaultProjectConfig) {
  const matchaScore = calculateMatchaScore(listing, projectConfig);
  if (!matchaScore.eligible) return { score: 0, label: 'Недостаточно данных', reasons: [] };

  const reasons = [];
  let score = 0;
  if (listing.rent != null && listing.rent <= projectConfig.targetRent.preferredMax) {
    score += 20;
    reasons.push('В бюджете');
  }
  if (hasKnownCondition(listing.provision, (value) => value.includes('provisionsfrei'))) {
    score += 25;
    reasons.push('Provisionsfrei');
  }
  if (hasKnownCondition(listing.abloese, (value) => value.includes('без ablöse') || value.includes('ohne ablöse'))) {
    score += 25;
    reasons.push('Без Ablöse');
  }
  if (listing.gastroSuitability === 'confirmed') {
    score += 10;
    reasons.push('Готовая гастрономия');
  }
  return { score: Math.min(100, score), label: 'Выгодные условия', reasons };
}

function buildMedia(listing) {
  const imageUrl = getImageUrl(listing);
  if (!imageUrl) return '';

  return `
    <div class="card-media">
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(getTitle(listing))}" loading="lazy">
    </div>
  `;
}

function buildHumanBadges(listing, projectConfig) {
  const badges = [];
  const area = listing.unitArea;
  const rent = listing.rent;

  if (rent != null && rent <= projectConfig.targetRent.preferredMax) badges.push('В бюджете');
  if (rent == null) badges.push('Цена по запросу/не указана');
  if (hasKnownCondition(listing.provision, (value) => value.includes('provisionsfrei'))) badges.push('Provisionsfrei');
  if (hasKnownCondition(listing.abloese, (value) => value.includes('без ablöse') || value.includes('ohne ablöse'))) badges.push('Без Ablöse');
  if (listing.gastroSuitability === 'confirmed') badges.push('Gastro подтверждено');
  if (listing.gastroSuitability === 'possible') badges.push('Café возможно');
  if (listing.gastroSuitability === 'unknown' || area == null || rent == null) badges.push('Нужно уточнить');

  return `
    <div class="conditions badges">
      ${badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join('')}
    </div>
  `;
}

function buildScoreMarkup(scoreResult) {
  if (scoreResult.score == null) {
    return '<div class="score empty" aria-label="Оценка пока невозможна">—</div>';
  }
  return `<div class="score" aria-label="Matcha Score ${scoreResult.score}">${scoreResult.score}</div>`;
}

function buildScoreBreakdown(scoreResult) {
  if (!scoreResult.breakdown) return '<p class="card-note">Оценка пока невозможна: недостаточно подтверждённых данных.</p>';
  const rows = [
    ['Gastro', scoreResult.breakdown.gastro, 30],
    ['Размер', scoreResult.breakdown.size, 25],
    ['Аренда', scoreResult.breakdown.rent, 25],
    ['Входные условия', scoreResult.breakdown.conditions, 10],
    ['Надёжность данных', scoreResult.breakdown.confidence, 10]
  ];

  return `
    <div class="score-breakdown">
      ${rows.map(([label, value, max]) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${value}/${max}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function buildList(title, items) {
  if (!Array.isArray(items) || !items.length) return '';
  return `
    <section class="detail-section">
      <h4>${escapeHtml(title)}</h4>
      <ul>
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </section>
  `;
}

export function buildListingCard(listing, projectConfig = defaultProjectConfig) {
  const scoreResult = calculateMatchaScore(listing, projectConfig);
  const rent = getRentLabel(listing);
  const unitArea = formatArea(listing.unitArea);
  const source = getSourceLabel(listing);
  const url = getValidExternalUrl(listing);
  const projectArea = listing.projectTotalArea == null ? '' : `<span>Проект: ${formatArea(listing.projectTotalArea)}</span>`;
  const sourceAction = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Anzeige öffnen</a>`
    : '<span class="source-unavailable" aria-disabled="true">Источник недоступен</span>';
  const unknowns = Array.isArray(listing.unknowns) ? listing.unknowns.slice(0, 3) : [];
  const reason = listing.verifiedSummary || listing.note || 'Описание из источника пока неполное.';
  const nextAction = listing.nextAction || 'Уточнить условия и пригодность под café перед просмотром.';

  return `
    <article class="card" data-listing-id="${escapeHtml(listing.id)}">
      ${buildMedia(listing)}
      <div class="card-body">
        <div class="card-top">
          <div class="card-heading">
            <span class="source-badge">${escapeHtml(source)}</span>
            <div class="card-title">${escapeHtml(getTitle(listing))}</div>
            <div class="card-meta">${escapeHtml(listing.address || listing.district || 'Адрес не опубликован')}</div>
          </div>
        </div>

        <div class="value-row">
          <div class="price">
            ${rent}
            <small>/ месяц</small>
          </div>
          <div class="area">${unitArea}</div>
        </div>

        ${buildHumanBadges(listing, projectConfig)}

        <div class="conditions">
          <span>Nebenkosten: ${escapeHtml(formatFinancialCondition(listing.nebenkosten))}</span>
          ${projectArea}
        </div>

        <section class="decision-block">
          <strong>Почему интересно</strong>
          <p>${escapeHtml(reason)}</p>
        </section>

        <section class="decision-block">
          <strong>Важно уточнить</strong>
          <p>${escapeHtml(unknowns.length ? unknowns.join('; ') : 'Критичных неизвестных в текущих данных не выделено.')}</p>
        </section>

        <section class="decision-block">
          <strong>Следующий шаг</strong>
          <p>${escapeHtml(nextAction)}</p>
        </section>
      </div>

      <div class="card-actions">
        <button type="button" data-action="details" data-id="${escapeHtml(listing.id)}">Подробнее</button>
        ${sourceAction}
      </div>
    </article>
  `;
}

export function buildLeadCard(listing) {
  const source = getSourceLabel(listing);
  const url = getValidExternalUrl(listing);
  const sourceAction = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Anzeige öffnen</a>`
    : '<span class="source-unavailable" aria-disabled="true">Источник недоступен</span>';
  const location = listing.address || listing.district || 'Локацию уточнить';
  const action = listing.nextAction || 'Запросить конкретный gastro unit 25–80 м².';

  return `
    <article class="lead-card compact-lead" data-listing-id="${escapeHtml(listing.id)}">
      <div class="lead-main">
        <span class="source-badge">${escapeHtml(source)}</span>
        <strong>${escapeHtml(getTitle(listing))}</strong>
        <span>${escapeHtml(location)}</span>
        <small>Lead: конкретное помещение ещё не подтверждено</small>
      </div>
      <p>${escapeHtml(action)}</p>
      <div class="lead-actions">
        <button type="button" data-action="details" data-id="${escapeHtml(listing.id)}">Подробнее</button>
        ${sourceAction}
      </div>
    </article>
  `;
}

export function buildListingDetail(listing, projectConfig = defaultProjectConfig) {
  const scoreResult = calculateMatchaScore(listing, projectConfig);
  const url = getValidExternalUrl(listing);
  const sourceAction = url
    ? `<a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(url)}">Anzeige öffnen</a>`
    : '<span class="primary-link source-unavailable" aria-disabled="true">Ссылка на источник недоступна</span>';

  return `
    <article class="detail-card">
      ${buildMedia(listing)}
      <div class="detail-body">
        <span class="source-badge">${escapeHtml(getSourceLabel(listing))}</span>
        <h3>${escapeHtml(getTitle(listing))}</h3>
        <p class="card-meta">${escapeHtml(listing.address || 'Адрес не опубликован')}</p>

        <div class="detail-grid">
          <div>
            <span>Аренда</span>
            <strong>${escapeHtml(getRentLabel(listing))}</strong>
          </div>
          <div>
            <span>Unit площадь</span>
            <strong>${formatArea(listing.unitArea)}</strong>
          </div>
          <div>
            <span>Nebenkosten</span>
            <strong>${escapeHtml(formatFinancialCondition(listing.nebenkosten))}</strong>
          </div>
        </div>

        ${buildHumanBadges(listing, projectConfig)}

        <section class="detail-section">
          <h4>Почему интересен</h4>
          <p>${escapeHtml(listing.verifiedSummary || 'Подтверждённое описание не указано.')}</p>
        </section>

        ${buildList('Подтверждено', listing.keyFacts)}
        ${buildList('Нужно уточнить', listing.unknowns)}

        <section class="detail-section">
          <h4>Следующее действие</h4>
          <p>${escapeHtml(listing.nextAction || 'Уточнить условия у источника.')}</p>
        </section>

        <div class="detail-grid">
          <div>
            <span>Provision</span>
            <strong>${escapeHtml(formatFinancialCondition(listing.provision))}</strong>
          </div>
          <div>
            <span>Ablöse</span>
            <strong>${escapeHtml(formatFinancialCondition(listing.abloese))}</strong>
          </div>
          <div>
            <span>Kaution</span>
            <strong>${escapeHtml(formatFinancialCondition(listing.kaution))}</strong>
          </div>
        </div>

        ${sourceAction}
      </div>
    </article>
  `;
}

import { defaultProjectConfig, isFreshVerifiedListing } from './filters.js?v=info-model-1';
import { getValidExternalUrl } from './source-links.js?v=source-links-1';

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
  return `€${Number(value).toLocaleString('de-DE')}`;
}

function formatArea(value, fallback = 'не опубликована') {
  return value == null ? fallback : `${Number(value).toLocaleString('de-DE')} м²`;
}

function formatCondition(condition) {
  if (!condition || !condition.known) return 'не опубликовано';
  return condition.value ?? 'не опубликовано';
}

function getImageUrl(listing) {
  if (listing.image) return listing.image;
  if (Array.isArray(listing.images) && listing.images.length) return listing.images[0];
  return '';
}

function getSourceLabel(listing) {
  return listing.sourceName || listing.source || 'Источник';
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
  return listing.listingType === 'direct_listing'
    && listing.availabilityStatus === 'active'
    && isFreshVerifiedListing(listing, projectConfig.freshnessHours)
    && Boolean(getValidExternalUrl(listing))
    && listing.unitArea != null
    && listing.rent != null
    && listing.gastroSuitability !== 'unknown'
    && Boolean(listing.verifiedSummary || listing.gastroEvidence);
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

function buildBadges(listing, projectConfig, scoreResult) {
  const badges = [getListingTypeLabel(listing)];
  const area = listing.unitArea;
  const rent = listing.rent;

  if (scoreResult.score != null && scoreResult.score >= 75) badges.push('Сильный кандидат');
  if (rent != null && rent <= projectConfig.targetRent.preferredMax) badges.push('В бюджете');
  if (rent == null) badges.push('Цена неизвестна');
  if (hasKnownCondition(listing.provision, (value) => value.includes('provisionsfrei'))) badges.push('Provisionsfrei');
  if (hasKnownCondition(listing.abloese, (value) => value.includes('без ablöse') || value.includes('ohne ablöse'))) badges.push('Без Ablöse');
  if (listing.gastroSuitability === 'confirmed') badges.push('Готовая гастрономия');
  if (listing.gastroSuitability === 'unknown' || area == null || rent == null) badges.push('Нужно уточнить');
  if (listing.listingType !== 'direct_listing') badges.push('Проект / Lead');

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
  const rent = formatMoney(listing.rent);
  const unitArea = formatArea(listing.unitArea);
  const source = getSourceLabel(listing);
  const status = listing.status || 'уточнить';
  const statusClass = getStatusClass(status);
  const url = getValidExternalUrl(listing);
  const projectArea = listing.projectTotalArea == null ? '' : `<span>Проект: ${formatArea(listing.projectTotalArea)}</span>`;
  const sourceAction = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Источник ↗</a>`
    : '<span class="source-unavailable" aria-disabled="true">Источник недоступен</span>';

  return `
    <article class="card" data-listing-id="${escapeHtml(listing.id)}">
      ${buildMedia(listing)}
      <div class="card-body">
        <div class="card-top">
          <div class="card-heading">
            <span class="source-badge">${escapeHtml(source)}</span>
            <div class="card-title">${escapeHtml(getTitle(listing))}</div>
            <div class="card-meta">${escapeHtml(listing.address || 'Адрес не опубликован')}</div>
          </div>
          ${buildScoreMarkup(scoreResult)}
        </div>

        <div class="value-row">
          <div class="price">
            ${rent}
            <small>/ месяц</small>
          </div>
          <div class="area">${unitArea}</div>
        </div>

        <div class="status-row">
          <span class="status-pill ${statusClass}">${escapeHtml(status)}</span>
          <span class="gastro ${getGastroClass(listing)}">${escapeHtml(getGastroLabel(listing))}</span>
        </div>

        ${buildBadges(listing, projectConfig, scoreResult)}

        <div class="conditions">
          <span>Nebenkosten: ${escapeHtml(formatCondition(listing.nebenkosten))}</span>
          ${projectArea}
        </div>

        <p class="card-note">${escapeHtml(listing.verifiedSummary || listing.note || 'Подтверждённое описание не указано.')}</p>
      </div>

      <div class="card-actions">
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
    ? `<a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(url)}">Открыть оригинальный источник</a>`
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
            <strong>${formatMoney(listing.rent)}</strong>
          </div>
          <div>
            <span>Unit площадь</span>
            <strong>${formatArea(listing.unitArea)}</strong>
          </div>
          <div>
            <span>Nebenkosten</span>
            <strong>${formatCondition(listing.nebenkosten)}</strong>
          </div>
          <div>
            <span>Matcha Score</span>
            <strong>${scoreResult.score ?? '—'}</strong>
          </div>
        </div>

        <div class="status-row">
          <span class="status-pill ${getStatusClass(listing.status)}">${escapeHtml(listing.status || 'уточнить')}</span>
          <span class="gastro ${getGastroClass(listing)}">${escapeHtml(getGastroLabel(listing))}</span>
        </div>

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

        <section class="detail-section">
          <h4>Matcha Score</h4>
          ${buildScoreBreakdown(scoreResult)}
        </section>

        <div class="detail-grid">
          <div>
            <span>Provision</span>
            <strong>${formatCondition(listing.provision)}</strong>
          </div>
          <div>
            <span>Ablöse</span>
            <strong>${formatCondition(listing.abloese)}</strong>
          </div>
          <div>
            <span>Kaution</span>
            <strong>${formatCondition(listing.kaution)}</strong>
          </div>
          <div>
            <span>Тип</span>
            <strong>${escapeHtml(getListingTypeLabel(listing))}</strong>
          </div>
        </div>

        ${sourceAction}
      </div>
    </article>
  `;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function isScoreEligible(listing) {
  return listing.availabilityStatus === 'active' || listing.availabilityStatus === 'lead';
}

function formatMoney(value, fallback = 'по запросу') {
  if (value == null || value === '') return fallback;
  return `€${Number(value).toLocaleString('de-DE')}`;
}

function formatArea(value) {
  return value == null ? 'не указано' : `${Number(value).toLocaleString('de-DE')} м²`;
}

function formatScore(value) {
  return Number(value || 0).toFixed(1);
}

function getImageUrl(listing) {
  if (listing.image) return listing.image;
  if (Array.isArray(listing.images) && listing.images.length) return listing.images[0];
  return '';
}

function getSourceType(source = '') {
  const normalized = source.toLowerCase();
  if (normalized.includes('kleinanzeigen')) return 'Kleinanzeigen';
  if (normalized.includes('immowelt')) return 'Immowelt';
  if (normalized.includes('immoscout')) return 'ImmoScout24';
  if (normalized.includes('stadt')) return 'Stadt München';
  return source || 'Makler';
}

function getGastroLabel(value) {
  if (value === 'yes') return 'Gastronomie geeignet';
  if (value === 'no') return 'Gastronomie nein';
  return 'Gastronomie уточнить';
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

export function calculateDealScore(listing) {
  if (!isScoreEligible(listing)) {
    return { score: 0, label: 'Нужно проверить', reasons: [] };
  }

  let score = 0;
  const reasons = [];
  const fees = (listing.fees || '').toLowerCase();
  const note = (listing.note || '').toLowerCase();
  const combined = `${fees} ${note}`;

  if (fees.includes('provisionsfrei')) {
    score += 25;
    reasons.push('Provisionsfrei');
  }

  if (fees.includes('ohne ablöse') || fees.includes('без ablöse')) {
    score += 25;
    reasons.push('Без Ablöse');
  }

  if (fees.includes('ablöse') && (fees.includes('по запросу') || fees.includes('vb'))) {
    score += 6;
    reasons.push('Ablöse можно торговать');
  }

  if (combined.includes('оборуд') || combined.includes('vollküche') || combined.includes('teeküche')) {
    score += 8;
    reasons.push('Есть оборудование');
  }

  if (listing.rent != null) {
    if (listing.rent <= 1800) {
      score += 20;
      reasons.push('Очень низкая аренда');
    } else if (listing.rent <= 2300) {
      score += 14;
      reasons.push('Низкая аренда');
    } else if (listing.rent <= 3000) {
      score += 8;
      reasons.push('Аренда в бюджете');
    }
  }

  if (listing.gastro === 'yes') {
    score += 8;
    reasons.push('Готово под гастро');
  }

  const boundedScore = Math.min(100, score);
  let label = 'Обычные условия';

  if (boundedScore >= 55) label = '🔥 Очень выгодно';
  else if (boundedScore >= 35) label = '🟢 Выгодно';
  else if (boundedScore >= 20) label = '🟡 Есть плюс';

  return { score: boundedScore, label, reasons };
}

function buildMedia(listing) {
  const imageUrl = getImageUrl(listing);
  if (!imageUrl) return '';

  return `
    <div class="card-media">
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(listing.district || 'Объект')}" loading="lazy">
    </div>
  `;
}

function buildDealMarkup(deal) {
  if (deal.score < 20) return '';

  return `
    <div class="deal-box" aria-label="Финансовые преимущества">
      <div class="deal-box__top">
        <strong>${escapeHtml(deal.label)}</strong>
        <span class="deal-score">Deal ${deal.score}/100</span>
      </div>
      <div class="deal-reasons">
        ${deal.reasons.map((reason) => `<span class="deal-reason">${escapeHtml(reason)}</span>`).join('')}
      </div>
    </div>
  `;
}

export function buildListingCard(listing) {
  const deal = calculateDealScore(listing);
  const rent = formatMoney(listing.rent);
  const area = formatArea(listing.area);
  const utilities = listing.nk == null ? 'Nebenkosten уточнить' : `${formatMoney(listing.nk)} Nebenkosten`;
  const source = getSourceType(listing.source);
  const status = listing.status || 'уточнить';
  const statusClass = getStatusClass(status);
  const url = listing.url || '#';

  return `
    <article class="card" data-listing-id="${escapeHtml(listing.id)}">
      ${buildMedia(listing)}
      <div class="card-body">
        <div class="card-top">
          <div class="card-heading">
            <span class="source-badge">${escapeHtml(source)}</span>
            <div class="card-title">${escapeHtml(listing.district)}</div>
          </div>
          <div class="score" aria-label="Matcha Score ${formatScore(listing.score)}">${formatScore(listing.score)}</div>
        </div>

        <div class="value-row">
          <div class="price">
            ${rent}
            <small>/ месяц</small>
          </div>
          <div class="area">${area}</div>
        </div>

        <div class="status-row">
          <span class="status-pill ${statusClass}">${escapeHtml(status)}</span>
          <span class="gastro ${listing.gastro === 'yes' ? 'ok' : 'check'}">${escapeHtml(getGastroLabel(listing.gastro))}</span>
        </div>

        <div class="conditions">
          <span>${escapeHtml(utilities)}</span>
          <span>${escapeHtml(listing.fees || 'условия уточнить')}</span>
        </div>

        ${buildDealMarkup(deal)}

        <p class="card-note">${escapeHtml(listing.note || 'Аналитика не указана.')}</p>
      </div>

      <div class="card-actions">
        <button type="button" data-action="details" data-id="${escapeHtml(listing.id)}">Подробнее</button>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Объявление ↗</a>
      </div>
    </article>
  `;
}

export function buildListingDetail(listing) {
  const deal = calculateDealScore(listing);

  return `
    <article class="detail-card">
      ${buildMedia(listing)}
      <div class="detail-body">
        <span class="source-badge">${escapeHtml(getSourceType(listing.source))}</span>
        <h3>${escapeHtml(listing.district || 'Объект')}</h3>
        <p class="card-meta">${escapeHtml(listing.address || 'Адрес не указан')}</p>

        <div class="detail-grid">
          <div>
            <span>Аренда</span>
            <strong>${formatMoney(listing.rent)}</strong>
          </div>
          <div>
            <span>Площадь</span>
            <strong>${formatArea(listing.area)}</strong>
          </div>
          <div>
            <span>Nebenkosten</span>
            <strong>${formatMoney(listing.nk, 'уточнить')}</strong>
          </div>
          <div>
            <span>Matcha Score</span>
            <strong>${formatScore(listing.score)}</strong>
          </div>
        </div>

        <div class="status-row">
          <span class="status-pill ${getStatusClass(listing.status)}">${escapeHtml(listing.status || 'уточнить')}</span>
          <span class="gastro ${listing.gastro === 'yes' ? 'ok' : 'check'}">${escapeHtml(getGastroLabel(listing.gastro))}</span>
        </div>

        <p class="card-note">${escapeHtml(listing.note || 'Аналитика не указана.')}</p>
        <div class="conditions strong">
          <span>Provision / Ablöse / Kaution</span>
          <span>${escapeHtml(listing.fees || 'уточнить')}</span>
        </div>

        ${buildDealMarkup(deal)}

        <a class="primary-link" target="_blank" rel="noopener" href="${escapeHtml(listing.url || '#')}">
          Открыть оригинальное объявление
        </a>
      </div>
    </article>
  `;
}

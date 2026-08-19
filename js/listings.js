export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export function calculateDealScore(listing) {
  let score = 0;
  const reasons = [];
  const fees = (listing.fees || '').toLowerCase();

  if (fees.includes('provisionsfrei')) {
    score += 25;
    reasons.push('+25 без Provision');
  }

  if (fees.includes('ohne ablöse') || fees.includes('без ablöse')) {
    score += 25;
    reasons.push('+25 без Ablöse');
  }

  if (listing.rent != null) {
    if (listing.rent <= 1800) {
      score += 20;
      reasons.push('+20 аренда ≤ €1.8k');
    } else if (listing.rent <= 2300) {
      score += 14;
      reasons.push('+14 аренда ≤ €2.3k');
    } else if (listing.rent <= 3000) {
      score += 8;
      reasons.push('+8 аренда в бюджете');
    }
  }

  if (listing.gastro === 'yes') {
    score += 8;
    reasons.push('+8 Gastro');
  }

  const boundedScore = Math.min(100, score);
  let label = 'Обычные условия';

  if (boundedScore >= 55) label = '🔥 Очень выгодно';
  else if (boundedScore >= 35) label = '🟢 Выгодно';
  else if (boundedScore >= 20) label = '🟡 Есть плюс';

  return { score: boundedScore, label, reasons };
}

export function buildListingCard(listing) {
  const deal = calculateDealScore(listing);
  const price = listing.rent == null
    ? 'Цена по запросу'
    : `€${Number(listing.rent).toLocaleString('de-DE')}`;
  const area = listing.area == null ? 'площадь ?' : `${listing.area} м²`;
  const utilities = listing.nk ? ` + €${listing.nk} NK` : '';
  const gastroLabel = listing.gastro === 'yes' ? 'Gastro ✓' : 'Gastro ?';

  const dealMarkup = deal.score >= 20
    ? `
      <div class="deal-box">
        <div class="deal-box__top">
          <strong>${escapeHtml(deal.label)}</strong>
          <span class="deal-score">${deal.score}/100</span>
        </div>
        <div class="deal-reasons">
          ${deal.reasons.map((reason) => `<span class="deal-reason">${escapeHtml(reason)}</span>`).join('')}
        </div>
      </div>
    `
    : '';

  return `
    <article class="card" data-listing-id="${escapeHtml(listing.id)}">
      <div class="card-body" data-action="details" data-id="${escapeHtml(listing.id)}">
        <div class="card-top">
          <div>
            <div class="card-title">${escapeHtml(listing.district)}</div>
            <div class="card-meta">${escapeHtml(listing.source || '')} · ${area}</div>
          </div>
          <div class="score">${Number(listing.score || 0).toFixed(1)}</div>
        </div>

        <div class="price">
          ${price}
          <small>/ мес.${utilities}</small>
        </div>

        <div class="tags">
          <span class="tag">${area}</span>
          <span class="tag ${listing.gastro === 'yes' ? 'ok' : ''}">${gastroLabel}</span>
          <span class="tag">${escapeHtml(listing.status || '')}</span>
        </div>

        ${dealMarkup}

        <div class="card-note">${escapeHtml(listing.note || '')}</div>
      </div>

      <div class="card-actions">
        <button type="button" data-action="details" data-id="${escapeHtml(listing.id)}">Подробнее</button>
        <a href="${escapeHtml(listing.url || '#')}" target="_blank" rel="noopener">Объявление ↗</a>
      </div>
    </article>
  `;
}

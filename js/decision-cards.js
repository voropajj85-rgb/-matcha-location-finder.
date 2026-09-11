import { escapeHtml as esc } from './listings.js';
import { UNKNOWN_DISTRICT, rentLabel, reasonLabel } from './inventory.js';

const USE = { confirmed: 'Bestätigt', possible: 'Möglich · Genehmigung prüfen', unknown: 'Nicht bestätigt', no: 'Nicht erlaubt' };
const badge = (text, tone = '') => `<span class="decision-badge ${tone}">${esc(text)}</span>`;
const date = (value) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'Nicht bestätigt';

export function buildDecisionCard(row, { details = false } = {}) {
  const l = row.listing;
  const area = l.unitArea ?? l.area;
  const use = l.gastroSuitability || 'unknown';
  const reasons = row.classification.suitableReasons;
  const state = [row.best && 'Best', row.suitable && 'Suitable'].filter(Boolean).join(' · ') || 'Market';
  const why = row.suitable ? (rentLabel(l) === 'Preis auf Anfrage'
    ? 'Zielgröße passt. Miete auf Anfrage – Budget noch offen.'
    : 'Zielgröße und bekannte Monatsmiete passen. Café-Nutzung klären.')
    : `Nicht Suitable: ${reasons.slice(0, 2).map((reason) => reasonLabel(reason, l)).join(' · ') || 'Eignung nicht bestätigt'}.`;
  const next = use === 'no' ? 'Für ein Café ausgeschlossen: Gastronomie ist nicht erlaubt.'
    : row.temporary ? 'Laufzeit, Monatsbudget und erlaubte Nutzung klären.'
    : 'Café-Nutzung, Nebenkosten und Besichtigung klären.';
  const address = l.address || 'Adresse nicht bestätigt';
  return `<article class="decision-card ${row.best ? 'is-best' : ''}" data-listing-id="${esc(l.id || l.externalId)}">
    <div class="decision-card__body">
      <div class="decision-card__status">${badge(state, row.best ? 'best-badge' : '')}${row.temporary ? badge('Temporär · Pop-up', 'temporary-badge') : ''}</div>
      <h3>${esc(l.title || 'Gewerbefläche · Titel nicht bestätigt')}</h3>
      <p class="decision-location">${esc(row.district === UNKNOWN_DISTRICT ? 'München · Stadtteil nicht bestätigt' : row.district)}<span>${esc(address)}</span></p>
      <dl class="decision-facts">
        <div><dt>Fläche</dt><dd>${Number.isFinite(area) ? `${esc(area.toLocaleString('de-DE'))} m²` : 'Nicht bestätigt'}</dd></div>
        <div><dt>Monatsmiete</dt><dd>${esc(rentLabel(l))}</dd></div>
      </dl>
      <div class="decision-use ${use === 'no' ? 'use-prohibited' : ''}"><span>Gastro / Café</span><strong>${esc(USE[use] || USE.unknown)}</strong></div>
      <p class="decision-reason">${row.best ? '<strong>Best-Vorauswahl.</strong> ' : ''}${esc(why)}</p>
      <p class="decision-next"><span>Nächster Schritt</span>${esc(next)}</p>
      <div class="decision-provenance"><span>${esc(l.sourceName || l.source || 'Quelle nicht bestätigt')}</span><span>Verifiziert ${esc(date(l.lastVerifiedAt))}</span></div>
    </div>
    <div class="decision-actions">${row.url ? `<a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">Anzeige öffnen <span aria-hidden="true">↗</span></a>` : '<span>Link nicht bestätigt</span>'}
      ${details ? '' : `<button type="button" data-action="details" data-id="${esc(l.id || l.externalId)}">Details</button>`}</div>
  </article>`;
}

function condition(value) {
  if (value == null || value.status === 'unknown') return 'Nicht bestätigt';
  if (typeof value !== 'object') return String(value);
  if (value.status === 'free') return 'Provisionsfrei';
  if (value.amount != null) return `€${Number(value.amount).toLocaleString('de-DE')}`;
  if (value.months != null) return `${value.months} Monatsmieten`;
  return value.value == null ? 'Nicht bestätigt' : String(value.value);
}

export function buildDecisionDetail(row) {
  const l = row.listing;
  const exclusions = row.classification.suitableReasons.map((reason) => `<li>${esc(reasonLabel(reason, l))}</li>`).join('');
  const bestExclusions = row.classification.bestReasons.map((reason) => `<li>${esc(reasonLabel(reason, l))}</li>`).join('');
  return `${buildDecisionCard(row, { details: true })}
    <section class="detail-section"><h4>Eignung & Unsicherheit</h4>
      ${exclusions ? `<ul>${exclusions}</ul>` : `<p>Zielparameter grundsätzlich erfüllt.${l.rent == null ? ' Mietbudget auf Anfrage noch offen.' : ''} Die konkrete Café-Genehmigung bleibt zu prüfen.</p>`}
      ${row.temporary ? '<p>Temporäre Fläche. Keine bestätigte langfristige Mietoption.</p>' : ''}
      <p>Gastro-Beleg: ${esc(l.gastroEvidence || 'Nicht bestätigt')}</p>
    </section>
    ${!row.best && bestExclusions ? `<section class="detail-section"><h4>Nicht Best</h4><ul>${bestExclusions}</ul></section>` : ''}
    <dl class="detail-grid">${[['Nebenkosten', l.nebenkosten], ['Kaution', l.kaution], ['Provision', l.provision], ['Ablöse', l.abloese]].map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(condition(value))}</dd></div>`).join('')}</dl>
    <details class="detail-section"><summary>Weitere Angaben aus dem Datensatz</summary><p>${esc(l.rawSourceData?.rawDescription || l.verifiedSummary || 'Keine weiteren Angaben veröffentlicht.')}</p></details>`;
}

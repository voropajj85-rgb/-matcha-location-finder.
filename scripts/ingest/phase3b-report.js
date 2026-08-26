#!/usr/bin/env node

// Phase 3B diagnostics postprocessor; final review reruns this after parser hardening.
const fs = require('fs');
const path = require('path');
const { extractListingFacts } = require('./extract-listing-facts');

const reportPath = process.argv[2] || path.join(__dirname, 'reports', 'latest-validation.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

function inc(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

const diagnostics = {
  directListings: 0,
  rentParsed: 0,
  rentPriceOnRequest: 0,
  rentMissing: 0,
  areaParsed: 0,
  areaMissing: 0,
  kautionNumeric: 0,
  kautionRelative: 0,
  kautionMentioned: 0,
  kautionUnknown: 0,
  provisionFree: 0,
  provisionRelative: 0,
  provisionNumeric: 0,
  provisionMentioned: 0,
  provisionUnknown: 0,
  abloeseNumeric: 0,
  abloeseMentioned: 0,
  abloeseNegotiable: 0,
  abloeseUnknown: 0,
  nebenkostenNumeric: 0,
  nebenkostenIncluded: 0,
  nebenkostenMentioned: 0,
  nebenkostenUnknown: 0,
  gastroConfirmed: 0,
  gastroPossible: 0,
  gastroNo: 0,
  gastroUnknown: 0,
  abluftConfirmed: 0,
  abluftNo: 0,
  abluftUnknown: 0,
  terraceConfirmed: 0,
  terraceUnknown: 0,
  existingBusinessConfirmed: 0,
  takeoverRequired: 0,
  descriptionBackedRent: 0,
  descriptionBackedArea: 0
};

for (const listing of report.listings || []) {
  if (listing.listingType !== 'direct_listing') continue;
  diagnostics.directListings += 1;
  const text = `${listing.title || ''} ${listing.rawDescription || ''}`;
  const facts = extractListingFacts(text, { address: listing.location });
  listing.phase3bFacts = facts;
  listing.financialEvidenceStructured = facts.financialEvidence;
  listing.operationalEvidence = facts.operationalEvidence;

  const effectiveMonthlyRent = listing.rent != null && listing.rentType !== 'per_sqm';
  const effectiveRequest = listing.priceStatus === 'request' || facts.rent.status === 'request';
  if (effectiveMonthlyRent || facts.rent.status === 'known') diagnostics.rentParsed += 1;
  else if (effectiveRequest) diagnostics.rentPriceOnRequest += 1;
  else diagnostics.rentMissing += 1;

  if (listing.unitArea != null || facts.area.unitArea != null) diagnostics.areaParsed += 1;
  else diagnostics.areaMissing += 1;

  inc(diagnostics, `kaution${facts.kaution.status === 'known_numeric' ? 'Numeric' : facts.kaution.status === 'known_relative' ? 'Relative' : facts.kaution.status === 'mentioned' ? 'Mentioned' : 'Unknown'}`);
  inc(diagnostics, `provision${facts.provision.status === 'free' ? 'Free' : facts.provision.status === 'known_relative' ? 'Relative' : facts.provision.status === 'known_numeric' ? 'Numeric' : facts.provision.status === 'mentioned' ? 'Mentioned' : 'Unknown'}`);
  inc(diagnostics, `abloese${['known_numeric', 'negotiable_numeric'].includes(facts.abloese.status) ? 'Numeric' : facts.abloese.status === 'mentioned' ? 'Mentioned' : facts.abloese.status === 'negotiable' ? 'Negotiable' : 'Unknown'}`);
  inc(diagnostics, `nebenkosten${facts.nebenkosten.status === 'known' ? 'Numeric' : facts.nebenkosten.status === 'included' ? 'Included' : facts.nebenkosten.status === 'mentioned' ? 'Mentioned' : 'Unknown'}`);

  inc(diagnostics, `gastro${facts.gastro.status[0].toUpperCase()}${facts.gastro.status.slice(1)}`);
  inc(diagnostics, `abluft${facts.operations.abluft.status === 'confirmed' ? 'Confirmed' : facts.operations.abluft.status === 'no' ? 'No' : 'Unknown'}`);
  inc(diagnostics, `terrace${facts.operations.terrace.status === 'confirmed' ? 'Confirmed' : 'Unknown'}`);
  if (facts.existing.existingBusiness === 'confirmed') diagnostics.existingBusinessConfirmed += 1;
  if (facts.existing.takeoverRequired === true) diagnostics.takeoverRequired += 1;
  if (listing.rent == null && listing.priceStatus !== 'request' && facts.rent.status === 'known') diagnostics.descriptionBackedRent += 1;
  if (listing.unitArea == null && facts.area.unitArea != null) diagnostics.descriptionBackedArea += 1;
}

report.phase3b = diagnostics;
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(diagnostics, null, 2));

#!/usr/bin/env node

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

function conditionBucket(prefix, fact) {
  const status = fact?.status || 'unknown';
  if (prefix === 'kaution') {
    if (status === 'known_numeric') inc(diagnostics, 'kautionNumeric');
    else if (status === 'known_relative') inc(diagnostics, 'kautionRelative');
    else if (status === 'mentioned') inc(diagnostics, 'kautionMentioned');
    else inc(diagnostics, 'kautionUnknown');
  } else if (prefix === 'provision') {
    if (status === 'free') inc(diagnostics, 'provisionFree');
    else if (status === 'known_relative') inc(diagnostics, 'provisionRelative');
    else if (status === 'known_numeric') inc(diagnostics, 'provisionNumeric');
    else if (status === 'mentioned') inc(diagnostics, 'provisionMentioned');
    else inc(diagnostics, 'provisionUnknown');
  } else if (prefix === 'abloese') {
    if (status === 'known_numeric' || status === 'negotiable_numeric') inc(diagnostics, 'abloeseNumeric');
    else if (status === 'negotiable') inc(diagnostics, 'abloeseNegotiable');
    else if (status === 'mentioned') inc(diagnostics, 'abloeseMentioned');
    else inc(diagnostics, 'abloeseUnknown');
  } else if (prefix === 'nebenkosten') {
    if (status === 'known') inc(diagnostics, 'nebenkostenNumeric');
    else if (status === 'included') inc(diagnostics, 'nebenkostenIncluded');
    else if (status === 'mentioned') inc(diagnostics, 'nebenkostenMentioned');
    else inc(diagnostics, 'nebenkostenUnknown');
  }
}

const samples = [];
for (const listing of report.listings || []) {
  if (listing.listingType !== 'direct_listing') continue;
  diagnostics.directListings += 1;
  const text = listing.rawDescription || '';
  const facts = extractListingFacts(text, { address: listing.location });

  listing.phase3b = {
    rent: facts.rent,
    nebenkosten: facts.nebenkosten,
    kaution: facts.kaution,
    provision: facts.provision,
    abloese: facts.abloese,
    area: facts.area,
    gastro: facts.gastro,
    operations: facts.operations,
    existing: facts.existing,
    unknowns: facts.unknowns,
    nextAction: facts.nextAction
  };

  if (listing.rent != null || facts.rent.amount != null) diagnostics.rentParsed += 1;
  else if (listing.priceStatus === 'request' || facts.rent.status === 'request') diagnostics.rentPriceOnRequest += 1;
  else diagnostics.rentMissing += 1;
  if (facts.rent.amount != null) diagnostics.descriptionBackedRent += 1;

  if (listing.unitArea != null || facts.area.unitArea != null) diagnostics.areaParsed += 1;
  else diagnostics.areaMissing += 1;
  if (facts.area.unitArea != null) diagnostics.descriptionBackedArea += 1;

  conditionBucket('kaution', facts.kaution);
  conditionBucket('provision', facts.provision);
  conditionBucket('abloese', facts.abloese);
  conditionBucket('nebenkosten', facts.nebenkosten);

  inc(diagnostics, `gastro${facts.gastro.status.charAt(0).toUpperCase()}${facts.gastro.status.slice(1)}`);
  if (facts.operations.abluft.status === 'confirmed') diagnostics.abluftConfirmed += 1;
  else if (facts.operations.abluft.status === 'no') diagnostics.abluftNo += 1;
  else diagnostics.abluftUnknown += 1;
  if (facts.operations.terrace.status === 'confirmed') diagnostics.terraceConfirmed += 1;
  else diagnostics.terraceUnknown += 1;
  if (facts.existing.existingBusiness === 'confirmed') diagnostics.existingBusinessConfirmed += 1;
  if (facts.existing.takeoverRequired === true) diagnostics.takeoverRequired += 1;

  if (samples.length < 20 && (facts.kaution.evidence || facts.provision.evidence || facts.abloese.evidence || facts.nebenkosten.evidence || facts.operations.abluft.evidence || facts.operations.terrace.evidence)) {
    samples.push({
      externalId: listing.externalId,
      source: listing.source,
      url: listing.url,
      kaution: facts.kaution,
      provision: facts.provision,
      abloese: facts.abloese,
      nebenkosten: facts.nebenkosten,
      abluft: facts.operations.abluft,
      terrace: facts.operations.terrace
    });
  }
}

report.phase3bDiagnostics = diagnostics;
report.phase3bEvidenceSamples = samples;
report.phase3bGeneratedAt = new Date().toISOString();
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(diagnostics, null, 2));

const assert = require('assert');
const {
  extractListingFacts,
  extractRent,
  extractNebenkosten,
  extractKaution,
  extractProvision,
  extractAbloese,
  extractArea,
  extractGastro,
  extractOperations,
  extractExistingBusiness
} = require('../extract-listing-facts');

function run() {
  assert.deepStrictEqual(extractKaution('Kaution: 3 Monatsmieten').status, 'known_relative');
  assert.strictEqual(extractKaution('Kaution: 3 Monatsmieten').months, 3);
  assert.strictEqual(extractKaution('Kaution 5.000 €').amount, 5000);

  const provision = extractProvision('Provision: 3,57 MM zzgl. MwSt.');
  assert.strictEqual(provision.status, 'known_relative');
  assert.strictEqual(provision.months, 3.57);
  assert.strictEqual(provision.vat, 'plus_vat');
  assert.strictEqual(extractProvision('provisionsfrei').status, 'free');

  assert.strictEqual(extractAbloese('Ablöse 25.000 €').amount, 25000);
  assert.strictEqual(extractAbloese('Inventar gegen Ablöse').status, 'mentioned');
  assert.strictEqual(extractAbloese('Ablöse VB').status, 'negotiable');

  assert.strictEqual(extractNebenkosten('Nebenkosten 450 €').amount, 450);
  assert.strictEqual(extractNebenkosten('1.600 € zzgl. NK').status, 'mentioned');

  const rent = extractRent('Kaltmiete 1.600 € Nebenkosten 300 € Kaution 5.000 € Ablöse 25.000 €');
  assert.strictEqual(rent.amount, 1600);
  assert.notStrictEqual(rent.amount, 300);
  assert.notStrictEqual(rent.amount, 5000);
  assert.notStrictEqual(rent.amount, 25000);
  assert.strictEqual(extractRent('Ablöse 25.000 € Kaution 5.000 € Provision 3.000 €').amount, null);

  const area = extractArea('Gesamtfläche 800 m², teilbar ab 45 m²');
  assert.strictEqual(area.unitArea, 45);
  assert.strictEqual(area.areaType, 'divisible_minimum');
  assert.strictEqual(area.projectTotalArea, 800);
  assert.strictEqual(extractArea('Verkaufsfläche 57 m²').unitArea, 57);
  assert.strictEqual(extractArea('Ladenfläche ca. 62 m²').unitArea, 62);

  assert.strictEqual(extractGastro('Gastronomie ausgeschlossen').status, 'no');
  assert.strictEqual(extractGastro('geeignet für Café').status, 'confirmed');
  assert.strictEqual(extractGastro('Ladenfläche für Einzelhandel').status, 'possible');

  assert.strictEqual(extractOperations('Küchenabluft vorhanden').abluft.status, 'confirmed');
  assert.strictEqual(extractOperations('keine Abluft').abluft.status, 'no');
  assert.strictEqual(extractOperations('Außengastronomie möglich').terrace.status, 'confirmed');
  assert.strictEqual(extractOperations('nur Tagesgastronomie').openingHours.status, 'restricted');

  const takeover = extractExistingBusiness('Laufender Betrieb, Nachfolger gesucht, Inventarübernahme erforderlich.');
  assert.strictEqual(takeover.existingBusiness, 'confirmed');
  assert.strictEqual(takeover.takeoverRequired, true);

  const facts = extractListingFacts('Ladenfläche 55 m². Kaltmiete 1.850 €. Nebenkosten 300 €. Kaution 3 Monatsmieten. provisionsfrei. geeignet für Café. Küchenabluft vorhanden.', { district: 'Maxvorstadt' });
  assert.strictEqual(facts.rent.amount, 1850);
  assert.strictEqual(facts.nebenkosten.amount, 300);
  assert.strictEqual(facts.kaution.months, 3);
  assert.strictEqual(facts.provision.status, 'free');
  assert.strictEqual(facts.area.unitArea, 55);
  assert.strictEqual(facts.gastro.status, 'confirmed');
  assert.strictEqual(facts.operations.abluft.status, 'confirmed');
  assert.ok(facts.verifiedSummary.includes('55 m²'));
  assert.ok(facts.financialEvidence.kaution.raw.includes('Kaution'));

  console.log('Phase 3B extraction tests passed.');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

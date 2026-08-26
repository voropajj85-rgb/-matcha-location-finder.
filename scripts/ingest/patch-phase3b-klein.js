const fs = require('fs');

function replaceOnce(path, oldText, newText) {
  const current = fs.readFileSync(path, 'utf8');
  if (!current.includes(oldText)) throw new Error(`Target not found in ${path}`);
  fs.writeFileSync(path, current.replace(oldText, newText));
}

replaceOnce(
  'scripts/ingest/extract-listing-facts.js',
  `/(?:kaltmiete|nettokaltmiete|nettomiete|monatsmiete|mietpreis|miete|pacht)\\s*:?[\\s-]*([0-9][0-9.\\s]*(?:,[0-9]{1,2})?)\\s*(?:€|EUR)/ig,`,
  `/(?:kaltmiete|nettokaltmiete|nettomiete|monatsmiete|mietpreis|miete|pacht)\\s*(?:für\\s+(?:die\\s+)?(?:gesamt)?fl[aä]che)?\\s*:?[\\s-]*([0-9][0-9.\\s]*(?:,[0-9]{1,2})?)\\s*(?:€|EUR)/ig,`
);

replaceOnce(
  'scripts/ingest/extract-listing-facts.js',
  `  add(new RegExp(\`${'${MEDIUM}'}\\\\s*:?[\\\\s-]*(?:ca\\\\.?|circa|ungef[aä]hr)?\\\\s*(?<value>[0-9][0-9.,]*)\\\\s*(?:m²|qm|m2)\`, 'ig'), 'usable_area', 80, 'usable-area');`,
  `  add(new RegExp(\`${'${MEDIUM}'}\\\\s*:?[\\\\s-]*(?:ca\\\\.?|circa|ungef[aä]hr)?\\\\s*(?<value>[0-9][0-9.,]*)\\\\s*(?:m²|qm|m2)\`, 'ig'), 'usable_area', 80, 'usable-area');\n  add(/(?:^|\\s)fl[aä]che\\s*:?\\s*(?:ca\\.?|circa|ungef[aä]hr)?\\s*(?<value>[0-9][0-9.,]*)\\s*(?:m²|qm|m2)/ig, 'listed_area', 90, 'listed-area-field');`
);

replaceOnce(
  'scripts/ingest/tests/phase3b-extraction.test.js',
  `  const takeover = extractExistingBusiness('Laufender Betrieb, Nachfolger gesucht, Inventarübernahme erforderlich.');`,
  `  const kleinStructured = extractListingFacts('Art Mieten Fläche 100 m² Objektart Einzelhandel & Kioske Verfügbar ab August 2026 Monatsmiete für Gesamtfläche 2.770 € Kaution 8.310 € Provision Provisionsfrei');\n  assert.strictEqual(kleinStructured.area.unitArea, 100);\n  assert.strictEqual(kleinStructured.rent.amount, 2770);\n  assert.strictEqual(kleinStructured.kaution.amount, 8310);\n  assert.strictEqual(kleinStructured.provision.status, 'free');\n\n  const takeover = extractExistingBusiness('Laufender Betrieb, Nachfolger gesucht, Inventarübernahme erforderlich.');`
);

console.log('Kleinanzeigen Phase 3B patch applied.');

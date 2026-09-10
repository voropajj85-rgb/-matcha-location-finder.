// Reporting groups, not official administrative boundaries. Never infer from a search query.
const DISTRICTS = [
  ['Trudering-Riem', /\btrudering[ -]riem\b/i],
  ['Altstadt-Lehel', /\b(?:altstadt|lehel)\b/i],
  ['Au-Haidhausen', /\b(?:au|haidhausen)\b/i],
  ['Aubing', /\baubing\b/i],
  ['Berg am Laim', /\bberg[ -]am[ -]laim\b/i],
  ['Bogenhausen', /\bbogenhausen\b/i],
  ['Feldmoching-Hasenbergl', /\b(?:feldmoching|hasenbergl)\b/i],
  ['Forstenried', /\bforstenried\b/i],
  ['Giesing', /\b(?:giesing|obergiesing|untergiesing)\b/i],
  ['Hadern', /\b(?:hadern|großhadern)\b/i],
  ['Laim', /\blaim\b/i],
  ['Ludwigsvorstadt-Isarvorstadt', /\b(?:ludwigsvorstadt|isarvorstadt)\b/i],
  ['Maxvorstadt', /\bmaxvorstadt\b/i],
  ['Milbertshofen', /\bmilbertshofen\b/i],
  ['Moosach', /\bmoosach\b/i],
  ['Neuhausen-Nymphenburg', /\b(?:neuhausen|nymphenburg)\b/i],
  ['Pasing', /\bpasing\b/i],
  ['Ramersdorf', /\bramersdorf\b/i],
  ['Riem', /\briem\b/i],
  ['Schwabing', /\bschwabing\b/i],
  ['Sendling-Westpark', /\b(?:sendling[ -]westpark|westpark)\b/i],
  ['Sendling', /\bsendling\b/i],
  ['Solln', /\bsolln\b/i],
  ['Thalkirchen', /\bthalkirchen\b/i],
  ['Trudering', /\btrudering\b/i],
  ['Westend', /\b(?:westend|schwanthalerh[oö]he)\b/i]
];

function districtMatch(value) {
  for (const [district, pattern] of DISTRICTS) {
    const match = String(value || '').match(pattern);
    if (match) return { district, value: match[0] };
  }
  return null;
}

function locationBucket(value) {
  return districtMatch(value)?.district
    || (/m[uü]nchen|muenchen|munich/i.test(String(value || '')) ? 'München unspecified' : 'unknown');
}

function districtBucket(item) {
  // Legacy Kleinanzeigen rows may contain the old query-derived district.
  const safeDistrict = item.rawSourceData?.searchDistrict && !item.rawSourceData?.districtEvidence
    ? null : item.district;
  const values = [item.rawSourceData?.districtEvidence?.value, safeDistrict, item.address, item.location,
    item.rawSourceData?.locationEvidence, item.rawSourceData?.addressEvidence].filter(Boolean);
  for (const value of values) {
    const match = districtMatch(value);
    if (match) return match.district;
  }
  return locationBucket(values.join(' '));
}

module.exports = { districtBucket, districtMatch, locationBucket };

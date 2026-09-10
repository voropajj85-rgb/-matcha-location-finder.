# Munich coverage and product funnel diagnostics

PR #18 fixes district attribution and prepares backend report helpers for Market,
Suitable and Best. It does not change the frontend or the existing Best gates.

## District evidence

Kleinanzeigen search terms are discovery hints. The adapter leaves `district`
empty and keeps the hint exclusively in `rawSourceData.searchDistrict`.
Enrichment reads the listing locality element, JSON-LD address (including postal
code and locality), or the portal's location suffix in the page title. It does
not infer a district from arbitrary description text, related listings or query
terms. Extracted district evidence records the method, source URL and raw text.
Legacy query-derived districts are not restored by the existing-row merge.

`district_coverage.confirmed` contains physical location coverage. `unknown` and
`München unspecified` explicitly represent unconfirmed districts. Discovery
counts are measured before enrichment; verified/visible counts use final rows.
`district_coverage.discovery_search_hints` counts first-discovery hints only.
Because discovery deduplicates URLs, these are not all query appearances.
The query matrix's `districtQueries` records searches attempted, including those
that yielded no new listing. Coverage groups are reporting labels, not official
administrative district boundaries.

## Market funnel

`market_funnel` includes totals, `by_source`, `by_confirmed_district`, and
`by_source_and_confirmed_district`. The district discovery counts in this section
join discovery URLs to final extracted locations where possible.

| Field | Definition |
| --- | --- |
| `discovered` | Raw discovery candidates, including leads and duplicates |
| `verified_direct` | Deduplicated active direct listings with valid direct URLs |
| `with_area` | Verified direct listings with a positive numeric area |
| `area_25_60` | Verified direct listings with area inclusively between 25 and 60 m² |
| `rent_leq_3000_known` | Verified direct listings with positive monthly rent <=€3,000 and no low-confidence flag; per-m² prices excluded |
| `price_on_request` | Verified direct listings with no numeric rent and explicit price-on-request; includes untrusted sources for diagnosis |
| `market` | Verified direct, checked within 48 hours, München location/category evidence, commercial evidence and usable page/title/location data |
| `suitable_parameters` | Market, 25–60 m², confirmed monthly rent <=€3,000 or trusted price-on-request, possible/confirmed gastro use and business fit not excluded |
| `visible_best` | Exactly the existing backend `isVisibleCandidate` result |
| `best_outside_suitable` | Existing Best candidates outside the proposed Suitable policy |

Parameter columns are independent subsets of `verified_direct`, not successive
filters. They must not be subtracted from each other. Suitable is a diagnostic
policy; possible use and conditional business fit still need review. Trusted
price-on-request follows the existing backend source trust helper. This does not
assert a confirmed affordable price.

The existing Best policy has a €3,500 rent ceiling and does not duplicate every
freshness/use check in the proposed Market/Suitable policy. Keep the three flags
independent until a future product decision aligns the gates. No visibility gate
is weakened here. The returned groups contain listing IDs for future consumers;
they do not activate a new frontend presentation.

## Exclusions and row audit

`market_funnel.exclusions` provides `all_direct` and `verified_direct` cohorts,
separate Suitable/Best counts, and source/district breakdowns. `reasons` overlap:
one listing can lack rent and also exceed 60 m². `primary` is exclusive, in
policy-check order, and sums to `excluded` for each stage/cohort.

The `rent >3000` bucket counts over-budget excluded listings. Best retains its
actual €3,500 ceiling, so this signal alone need not exclude a Best listing;
row-level gate details distinguish signals from hard blockers. Suitable uses €3,000. `rent
missing` also includes unusable or unconfirmed rent; trusted explicit requests
are exempt. Missing area is separate from known small/large area. Extra reasons
cover missing Munich/commercial evidence, insufficient usable data and weak
relevance scores so exclusions always reconcile.

Each validation row includes `district`, `confirmedDistrict`, `districtEvidence`,
the search hint under `rawSourceData`, and `marketClassification` with group flags,
stage reasons, review flags and existing Best gate details. These explain an
individual decision without treating every uncertainty as a hard exclusion.

## Validation

```sh
node scripts/ingest/tests/ingestion.test.js
node scripts/ingest/tests/phase3b-extraction.test.js
node scripts/ingest/run-ingestion.js --dry-run --validation-report
node scripts/ingest/tests/validation-report.test.js
```

The regression covers a Pasing discovery whose extracted locality is Laim,
verification, an existing-row merge and both coverage channels. Additional
fixtures cover JSON-LD locality, absent location evidence, overlapping district
names, inactive verification counts, numeric boundaries, per-m² rent, trusted
requests, missing data, stale/invalid URLs and source/reason reconciliation.

The dry-run can read existing Supabase rows for deduplication. It performs no
Supabase writes. Source blocks and errors remain visible in the report; a live
rerun is not assumed to have the same discovered population as an earlier run.

## Explaining the previous 128 → 9 snapshot

The report at PR head `ba0e12b54a727d388ac5bc14a6241082b801620b`, generated
2026-09-10 at 12:47 UTC, contained 128 verified direct listings. Their area
partition was 99 above 60 m², 8 below 25 m², 6 without area, and 15 within
25–60 m². Of those 15, five lacked acceptable rent evidence and one asked
€6,000/month, leaving nine Best candidates. One of the five missing-rent
listings also prohibited gastro use. These counts reconcile the original
question without changing any Best gate.

The corrected locality extraction identifies the previously active listing
`klein-3381804765-277-16369` as `81479 Bayern - Pullach im Isartal` on its page.
It no longer receives a München district from discovery. The existing verifier
returns `insufficient-active-evidence` when it cannot confirm an actual district.
Its area is above 60 m², so this does not affect the nine Best candidates.

## Final dry-run snapshot

Run timestamp: 2026-09-10T13:20:07.575Z. Ingestion/extraction tests, Phase 3B postprocessing and validation-report reconciliation passed. No production writes.

| Metric | Count |
| --- | ---: |
| `discovered` | 156 |
| `verified_direct` | 127 |
| `with_area` | 121 |
| `area_25_60` | 15 |
| `rent_leq_3000_known` | 21 |
| `price_on_request` | 25 |
| `market` | 117 |
| `suitable_parameters` | 6 |
| `visible_best` | 9 |
| `best_outside_suitable` | 3 |

Raw discovery is 156; 145 candidates normalized, and 144 remained after deduplication (129 direct listings and 15 leads). Three existing Best candidates have unknown gastro use and therefore fail the proposed Suitable policy; their current visibility is unchanged.

| Source | Discovered | Verified | With area | 25–60 m² | Known rent <=3000 | Request | Market | Suitable | Best |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Kleinanzeigen | 44 | 42 | 36 | 12 | 13 | 0 | 42 | 4 | 7 |
| Immowelt | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ImmoScout24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Stadt München | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Colliers | 41 | 38 | 38 | 1 | 0 | 18 | 28 | 1 | 1 |
| Engel & Völkers | 43 | 43 | 43 | 2 | 6 | 7 | 43 | 1 | 1 |
| immobilie1 | 10 | 4 | 4 | 0 | 2 | 0 | 4 | 0 | 0 |
| Aigner Immobilien | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

JLL returned HTTP 403; ImmoScout24 returned 401; Immowelt returned 410. Other partial-source failures are recorded in the JSON report.

| Confirmed district group | Verified direct |
| --- | ---: |
| unknown | 9 |
| Westend | 1 |
| Maxvorstadt | 5 |
| München unspecified | 65 |
| Schwabing | 10 |
| Bogenhausen | 6 |
| Au-Haidhausen | 4 |
| Ludwigsvorstadt-Isarvorstadt | 2 |
| Altstadt-Lehel | 3 |
| Moosach | 2 |
| Pasing | 3 |
| Laim | 3 |
| Sendling | 2 |
| Neuhausen-Nymphenburg | 2 |
| Giesing | 2 |
| Trudering-Riem | 1 |
| Ramersdorf | 1 |
| Sendling-Westpark | 3 |
| Milbertshofen | 3 |

There are 53 listings in named district groups, 65 with München only and 9 without a confirmed Munich district. The first-discovery hints identify 42 listings from citywide searches and 2 from Laim searches; these are separate from physical coverage.

| Overlapping signal among excluded verified listings | Suitable | Best |
| --- | ---: | ---: |
| > 60 m² | 98 | 98 |
| <25 m² | 8 | 8 |
| rent >3000 | 13 | 13 |
| rent missing | 68 | 68 |
| gastro/use uncertainty | 20 | 1 |
| missing area | 6 | 6 |
| weak business fit | 2 | 2 |
| stale / invalid URL | 0 | 0 |
| outside / unconfirmed München | 10 | 10 |

Suitable excludes 121 verified rows and Best excludes 118; overlapping signals do not sum to these totals. Two additional direct rows fail verification before the verified cohort. The JSON also contains exclusive primary reasons and row-level evidence.

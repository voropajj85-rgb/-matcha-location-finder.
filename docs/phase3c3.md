# Phase 3C.3 — Small Unit Source Expansion

Dry-run generated: 2026-09-10T15:44:12.933Z. Baseline: 2026-09-10T13:20:07.575Z, merged main eaece43f3c349f8f817dc2bdb86a840063808f4b.

Verified 25–60 m² listings: **15 → 20**. 15 retained, 5 newly in the target cohort, 0 no longer in the cohort.

The current target cohort contains **16 standard or unspecified-tenancy listings and 4 temporary pop-up listings**. Temporary inventory is not evidence of growth in ordinary long-term leases. Best: 9 → 9.

Of the 5 new target-range listings, 4 are temporary and 1 standard/unspecified listings explicitly prohibit gastronomy. 0 new target-range listings pass the unchanged Best gates.

## Scope and safeguards

- Expanded Kleinanzeigen small-shop, 20/30/40/50/60 qm, kiosk, takeover, successor-tenant, ground-floor, café, tea and bistro searches, plus all existing district combinations. District terms remain discovery hints only.
- Corrected Kleinanzeigen keyword pagination to the public /seite:2/term/k... route. Duplicate page-one results no longer suppress later small-unit pages. Explicit Nachmieter-gesucht offers are discoverable without admitting shop-wanted ads.
- Added Emslander and RaumForm33 public catalog adapters with exact host/path and same-object redirect checks. Only 20–60 m² units are emitted; an explicit total above 60 m² is excluded even when a smaller room is mentioned.
- Listing title/location/area must be present on the actual object page. Related offers and generic FAQs are excluded from extraction. Conflicting pop-up object IDs are quarantined.
- Daily, weekly and package prices are not converted to monthly rent. Emslander’s explicit Miete/Monat label uses the existing rent parser. Explicit gastro prohibitions remain prohibitions.
- Existing Best, business-fit, freshness, Munich, lifecycle and Supabase write gates were retained. Market diagnostics recognize retail/pop-up-store wording. No frontend changes, production writes or merge.

## Small-unit funnel by source

All figures count deduplicated direct listing URLs/IDs, not proven distinct physical premises across sources. Verified requires active verification within 48 hours. Area columns additionally require confirmed Munich commercial Market evidence. “Known/request rent” and “usable use” are independent subsets of 25–60 m², not successive gates. Known/request does not assert rent ≤€3,000, trusted request pricing, or Suitable/Best status. Usable use means extracted commercial/gastro evidence and no explicit gastro prohibition.

| Source | Verified | ≤60 m² | 25–60 m² | 25–60 + known/request | 25–60 + usable use | Best |
| --- | --- | --- | --- | --- | --- | --- |
| Kleinanzeigen | 45 | 17 | 12 | 8 | 9 | 7 |
| Colliers | 38 | 1 | 1 | 1 | 1 | 1 |
| Engel & Völkers | 43 | 4 | 2 | 1 | 1 | 1 |
| immobilie1 | 4 | 1 | 0 | 0 | 0 | 0 |
| Emslander | 1 | 1 | 1 | 1 | 0 | 0 |
| RaumForm33 | 4 | 4 | 4 | 1 | 4 | 0 |
| Total | 135 | 28 | 20 | 12 | 15 | 9 |

## New sources and routes tested

Ordinary public GETs and public search discovery. No login, CAPTCHA solving, anti-bot bypass or private endpoints. Research page counts are scoped probes, not exhaustive inventories. Rejected/deferred sources contribute zero pipeline-verified listings; this is not a claim that their inventories are empty.

For kept sources, page counts come from the full live catalog scan. Rejected/deferred page counts are the bounded research probe. Rent ≤€3,000 and request-price columns cover pipeline-verified listings of any area. Zero verified means not admitted and verified by this pipeline; it does not claim the source has no inventory.

| Source | Decision | Pages discovered | Verified | 25–60 | ≤€3,000 known | Request | Best |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [Emslander](https://www.emslander-co.de/immobilien?filter=gewerbe) | kept | 54 | 1 | 1 | 1 | 0 | 0 |
| [RaumForm33](https://raumform33.de/pop-up-store/pop-up-mieten-muenchen/) | kept_temporary_only | 70 | 4 | 4 | 0 | 1 | 0 |
| [Nußbaumer](https://nussbaumer-gmbh.de/objekte) | rejected_this_phase | 10 | 0 | 0 | 0 | 0 | 0 |
| [Immowelt](https://www.immowelt.de/suche/mieten/ladenflaechen/bayern/munchen-80331/ad08de6345) | rejected_new_route | 13 | 0 | 0 | 0 | 0 | 0 |
| [ohne-makler](https://www.ohne-makler.net/immobilien/) | deferred | 0 | 0 | 0 | 0 | 0 | 0 |
| [SWM](https://www.swm.de/unternehmen/immobilien) | deferred_pdf_verification | 4 | 0 | 0 | 0 | 0 | 0 |
| [Röthig](https://www.roethig-immobilien.de/objekte/mitten-in-schwabing-kleine-ladenflaeche-direkt-an-der-muenchner-freiheit-zu-vermieten_12457.php) | rejected_this_phase | 1 | 0 | 0 | 0 | 0 | 0 |
| [SONTONA](https://partner.sontona.de/immobilien/sofort-nutzbar-klein/) | rejected_this_phase | 1 | 0 | 0 | 0 | 0 | 0 |
| [Münchner Wohnen](https://www.muenchner-wohnen.de/wohnen-mieten/gewerbeflaechen/aktuelle-angebote) | deferred_external_portal | 1 | 0 | 0 | 0 | 0 | 0 |
| [heimmobilien](https://www.heimmobilien.de/wohnung-mieten-angebote) | rejected_this_phase | 0 | 0 | 0 | 0 | 0 | 0 |
| [Kreativ München](https://kreativ-muenchen.de/h/raum/ausschreibung-laden-13-und-16.html) | deferred_project_lead | 1 | 0 | 0 | 0 | 0 | 0 |

- **Emslander:** Public catalog and individual HTML objects. Only concrete 20–60 m² commercial units with no explicit total above 60 m² are emitted. Access: No access problem observed in the scoped probe.
- **RaumForm33:** Public individual pop-up objects. Temporary tenancy is explicit and separately counted; daily/weekly/package prices are not monthly rents. Conflicting object IDs and large totals are rejected. Access: No access problem observed in the scoped probe.
- **Nußbaumer:** Public takeover catalog, but current Munich units inspected are above 60 m². Small Olching, Emmering and Gauting offers are outside Munich; no large inventory imported. Access: No access problem observed in the scoped probe.
- **Immowelt:** New public search route exposes individual UUID URLs, but ordinary direct-page verification was blocked. Existing adapter is unchanged. Access: Direct object GET returned HTTP 403 / JavaScript challenge; no bypass attempted.
- **ohne-makler:** No usable Munich small-unit direct URL discovery established. Search result OM-485952 is in Markt Indersdorf, outside Munich. Access: Candidate Munich catalog route returned 404; public replacement is an interactive search shell.
- **SWM:** Four concrete public PDF offers found. No PDF identity, deadline and rent verifier implemented. Theresienstraße's 27.82 m² includes 17.51 m² external storage; sales area is only 10.31 m². Do not count snippets or bid rents as verified monthly-rent offers. Access: PDF-only object details require a dedicated verification adapter; normal public access itself works.
- **Röthig:** The small-shop search hit is explicitly rented and 138 m² overall, with 69 m² ground floor. Its smaller basement is not a separate target unit. Access: No access problem observed in the scoped probe.
- **SONTONA:** Public small-unit page has 34 m² total but only 15 m² sales area and prohibits gastronomy. No target-range sales unit established. Access: No access problem observed in the scoped probe.
- **Münchner Wohnen:** Own site delegates objects to Scout/Immowelt. A 47.03 m² Ackermannbogen search hit is a lead, not pipeline verified; no independent native direct-object feed found. Access: Delegated portals are not normally verifiable by current adapters; search snippets are not confirmation.
- **heimmobilien:** The apparent 40 m² shop is actually in Dachau. Nearby Pasing text belongs to another, rented residential card. No Munich small-unit direct page established. Access: No access problem observed in the scoped probe.
- **Kreativ München:** Temporary creative-project tender for Rathaus shops. Individual-unit area, current deadline and permitted commercial use were not fully verified; no adapter added. Access: No access problem observed in the scoped probe.

## Newly found target-range examples

These are verified target-area listings, not a claim that all are viable Matcha Bar candidates. Temporary status, unknown rent and use restrictions are shown explicitly.

| Listing | Source | m² | Monthly rent | Tenancy | Use evidence | Best |
| --- | --- | --- | --- | --- | --- | --- |
| [Charmanter Laden in Denkmalhaus](https://www.emslander-co.de/objekte/charmanter-laden-in-denkmalhaus/) | Emslander | 50 | €1680/month | Standard/unspecified | no | No |
| [Pop Up Store Fläche](https://raumform33.de/pop-up-store/pop-up-mieten-muenchen/pop-up-store-munchen-innenstadt-55-qm-id-176/) | RaumForm33 | 25 | Unknown | Temporary pop-up | unknown | No |
| [Pop-Up Store Gärtnerplatzviertel München](https://raumform33.de/pop-up-store/pop-up-mieten-muenchen/pop-up-store-glockenbach-munchen-id-145/) | RaumForm33 | 60 | Unknown | Temporary pop-up | unknown | No |
| [Pop-Up Store Glockenbach](https://raumform33.de/pop-up-store/pop-up-mieten-muenchen/pop-up-store-glockenbach-20-qm-id-108/) | RaumForm33 | 42 | Unknown | Temporary pop-up | possible | No |
| [Laden mit Kochwerkstatt](https://raumform33.de/pop-up-store/pop-up-mieten-muenchen/pop-upstore-munchen-haidhausen-id-119/) | RaumForm33 | 50 | On request | Temporary pop-up | possible | No |

## Baseline overlap and losses

Retained IDs: klein-3476142261-277-6416, klein-3470636624-277-16373, klein-3230995176-277-6441, klein-3481274063-277-6429, klein-3506924765-277-16355, klein-3476141984-277-6416, klein-3437932531-277-6447, klein-3487446534-277-6451, klein-3477375265-277-16373, klein-3484857394-277-6451, klein-3471053348-277-16388, klein-3484241799-277-6451, colliers-laden-muenchen-m-p4523-g1-e5, engel-91317ab1-f52b-5154-b229-73e198eb4db5, engel-05cf4d8c-5deb-576c-a8a3-fb67e2b04b4c.

No baseline target listing lost.

## Validation

Run from the repository root:

```sh
node scripts/ingest/tests/ingestion.test.js
node scripts/ingest/tests/phase3b-extraction.test.js
node scripts/ingest/run-ingestion.js --dry-run --validation-report
node scripts/ingest/phase3b-report.js
node scripts/ingest/tests/validation-report.test.js
node scripts/ingest/small-unit-report.js
```

The checked-in JSON contains per-listing extraction evidence, district confirmation, URL verification, all source errors, small-unit metrics and source investigation decisions. Live results can change with availability or access conditions.

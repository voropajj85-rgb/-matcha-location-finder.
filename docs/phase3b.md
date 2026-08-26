# Phase 3B — Extraction & Intelligence

This branch adds evidence-backed extraction for German commercial listings without changing the production frontend or writing to Supabase.

Validation is performed by `.github/workflows/phase3b-validation.yml` and includes the existing ingestion tests, dedicated Phase 3B extraction tests, and a full dry-run validation report.

Final review reruns the full validation after the rent, area, financial-evidence, structured JSONB persistence, €/m² separation, and Kleinanzeigen structured-field fixes.

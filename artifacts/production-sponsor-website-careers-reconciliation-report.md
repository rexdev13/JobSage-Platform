# Production sponsor website and careers reconciliation (read-only dry run)

**Status: no production import or write was run.** This is a row-level reconciliation package for review only. It maps development candidate rows to production by normalized organisation name, then checks town/city, county, region, industry, route, and sub-route wherever values are available. Development `sponsor_licence_id` values were used only to join local source files and development import reports; they were removed before production lookup and are not present as production match keys in the output.

## Scope and production identity results

- Candidate field rows considered: **6,007** (website: **5,645**; careers: **362**). The website count includes low-confidence evidence leads; those rows are rejected from import.
- Confidence after folding in the 40-row live-verification pilot: high **3,353**, medium **1,492**, low **1,162**. The 40 pilot upgrades are counted once and explicitly flagged as not imported into development.
- Unique normalized organization names queried in production: **5,110**.
- Production sponsor records returned for those names: **5,806**.
- Exact unique production identity matches: **4,426 complete**, **2 partial**.
- Ambiguous matches: **1,125**.
- Production sponsors missing by normalized name: **0**.
- Single-name matches with conflicting identity fields: **454**.

A unique production sponsor ID is populated only when the identity match is unique. Ambiguous or conflicting candidates appear in the candidate-ID and candidate-detail columns instead of being presented as a match.

## Production field checks and recommended disposition

- Website candidates were compared with `sponsor_licences.website`.
- Careers candidates were compared with `sponsor_licence_company_site_checks.careers_url`. That table has no location or route fields, so the sponsor identity was first resolved against `sponsor_licences`; careers rows were then linked by normalized organization name. The production site-check row ID is included only for a unique row.
- Recommended safe-to-import rows: **2,175** (**1,939 website**, **236 careers**). A safe row must be high-confidence, have a unique complete production identity, already match the candidate in development, target a blank production field, and have no same-target URL collision.
- Already matching production value (no-op): **344** (**333 website**, **11 careers**).
- Manual-review rows: **2,117**.
- Rejected low-confidence rows: **1,162**.
- Duplicate same-target rows that need no second write: **13**.
- Rows flagged because a production target value differs: **333** (non-exclusive; some also have identity ambiguity).
- Rows flagged because the development target value differs: **225** (non-exclusive).
- High/medium rows with at least one conflict flag: **1,541**. Distinct production targets with competing candidate URLs: **0**.

## Disposition counts

- `already_matches_production_noop`: **344**
- `conflict_existing_production_value`: **196**
- `duplicate_candidate_same_target_noop`: **13**
- `manual_review_ambiguous_production_match`: **912**
- `manual_review_development_value_conflict`: **20**
- `manual_review_identity_conflict`: **352**
- `manual_review_incomplete_production_identity`: **2**
- `manual_review_medium_confidence`: **827**
- `manual_review_pilot_upgrade_not_imported_to_development`: **4**
- `rejected_low_confidence`: **1,162**
- `safe_to_import`: **2,175**

## Files and limits

- Row-level package: `artifacts/production-sponsor-website-careers-reconciliation-dry-run.csv` (6,007 rows; 4,272,464 bytes).
- The CSV includes candidate source file/row references, source identity and evidence, current development value, production match status, production IDs only where uniquely matched, and candidate ID/value lists for ambiguous or conflicting rows.
- The 40-row live-verification upgrade is supplemental evidence only. It was not applied to the development audit, so it is not recommended as a production write.
- SELECT-only production reads were used. No production table was changed and no development/production import was run for this reconciliation.

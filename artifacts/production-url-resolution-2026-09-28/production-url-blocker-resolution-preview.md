# Production URL blocker resolution preview

## Safety status

- Dry run only. This review did not change production sponsor website/careers rows, create staging rows, or invoke a vacancy job. Existing production schedules continue independently and may write vacancy rows.
- Apply candidates are isolated in `reviewed-source-import-candidates.csv`; review the live production import preview and plan hash before any apply.
- Source staging remains separate from discovery. Careers-only rows without a production sponsor website do not make an employer scheduler-ready.
- No existing URL was classified for replacement: no liveness/redirect verification was performed, and a `bad` probe status alone is not proof that a URL is dead.

## Blocker totals

- Identity-review rows examined: 596.
- Identity rows mapped to one production sponsor or a clearly grouped same-employer set: 583; source rows with a proposed direct source or normalized no-op: 360; manual identity rows: 13.
- URL-conflict rows examined: 312.
- URL conflicts converted to a production careers source or normalized no-op: 63 (63 no-op, 0 careers-source writes); secondary sources held in staging: 161; manual URL reviews: 88; dead/bad replacements: 0.
- No URL conflict qualified for a direct careers-source write: candidate homepages are not careers destinations, and other close cases did not match the reviewed development URL or already had a different production careers URL. Keep these staged/manual; do not loosen the evidence rules.
- Missing-data rows examined: 126.
- Missing rows recovered to a direct import or normalized no-op: 66; additional rows retained as staging candidates: 52; manual missing-data rows: 8.
- Rows in the staging review CSV: 384.
- Target URL collisions withheld from apply: 0 rows across 0 target fields.

## Proposed apply counts

- Source-import CSV rows: 443 (includes 224 previously auto-resolved candidates, deduplicated with this review).
- Candidate rows by field: website 362, careers 81.
- Website target rows proposed: 362; careers target rows proposed: 81.
- Existing sponsor rows with websites: 9,791 (production snapshot).
- Existing careers-site rows: 8,810; rows with careers URLs: 3,096; verified ATS mappings: 29 (production snapshot).
- Proposed source coverage, row-based upper bound before live-plan no-op checks: up to 10153 sponsor website rows and 3177 careers URLs. The live import preview may reduce these counts where current production already matches.
- Newly website-bearing distinct employer names visible in the exported target set: 337. These are only a subset of the global scheduler pool and are not a live scheduler count.
- Verified newly resolved employers eligible for a bounded allowlisted pilot: 139; the first ten are in `vacancy-pilot-allowlist.csv`, and the deterministic first candidate is in `vacancy-pilot-first-source.csv`. Careers-only rows without a production website are excluded.

## Production vacancy baseline

- Read-only snapshot captured 2026-09-28: company_site 2478 rows across 513 employers; job_board 1710 rows across 580 employers; total 4188 rows.
- This is the production vacancy-stats liveness/evidence count with the manager-role approval gate. It is not an exact count for every candidate feed: category, industry, contact, apply-link, and candidate-specific matching filters further narrow the feed.
- Sponsor URL/careers metadata imports do not create vacancy rows. Existing production schedules can change the baseline independently, so capture a fresh count before any future pilot.
- No post-pilot count exists because this review did not invoke the pilot worker. The allowlisted pilot still needs the same candidate-specific before/after review after separate authorization; do not infer candidate-visible roles from raw discovery totals.

## Identity method and guardrails

- Auto-mapping requires exact normalized legal-name agreement plus matching supplied location fields, or a unique exact-name production row whose existing official website already matches the candidate domain without contradicting supplied location.
- Same-employer fan-out is limited to exact same-name/location groups with a single non-conflicting website value and independent audit or distinctive-brand evidence.
- Domain similarity alone never promotes a source. Automatic promotion additionally requires high confidence in both source and development review, an importable review action, a matching reviewed development value, and independent same-site or strong page/location evidence.
- URL comparison ignores HTTP/HTTPS, `www`, trailing slash, and fragment differences; it preserves path and query. Existing URLs are not overwritten.
- Careers pages are accepted only when the path identifies a current jobs/careers destination or a verified ATS mapping does. Policy, training, editorial, and search-result pages remain out of automatic promotion.

## Counts by reason

| Reason code | Rows |
| --- | ---: |
| identity_mapping:auto_unique_location | 455 |
| identity_mapping:auto_unique_location_and_official_domain | 1 |
| identity_mapping:manual_ambiguous_same_name_location | 12 |
| identity_mapping:manual_location_conflict_or_insufficient | 1 |
| identity_mapping:multi_row_same_employer | 127 |
| development_url_recovered_pending_verification | 199 |
| manual_ambiguous_same_name_location | 17 |
| manual_careers_target_ambiguous | 2 |
| manual_location_conflict_or_insufficient | 1 |
| manual_source_evidence_insufficient | 98 |
| manual_url_review | 67 |
| normalized_careers_url_already_present | 1 |
| normalized_url_already_present | 268 |
| preserve_both_official_url_candidates | 161 |
| verified_blank_website_from_blocker_review | 154 |
| verified_careers_site_insert | 66 |

## Pilot readiness

- Do not start the pilot until the reviewed apply is run and verified.
- Use only names from `vacancy-pilot-allowlist.csv` after the reviewed import is applied. The internal company-site job now accepts `organisationNames` and applies the normalized exact-name filter before priority selection, limit, and discovery.
- Begin with one newly resolved employer, then stop and inspect. For one employer, any error is a 100% error rate and stops the pilot. Do not widen the cohort until inserted, updated, rejected, and error counts plus candidate-visible counts are reviewed.
- Production staging table is currently absent; the local staging CSV is not a production queue.

## Sample manual rows

- Identity: ABS QE Assurance Services (UK) Ltd — manual_ambiguous_same_name_location: More than one production sponsor row matches the supplied name and location; independent evidence does not safely select or group them. URL retained in review only.
- Identity: ABS QE Assurance Services (UK) Ltd — manual_ambiguous_same_name_location: More than one production sponsor row matches the supplied name and location; independent evidence does not safely select or group them. URL retained in review only.
- Identity: Ada Digital Health Ltd — manual_ambiguous_same_name_location: More than one production sponsor row matches the supplied name and location; independent evidence does not safely select or group them. URL retained in review only.
- Identity: Ada Digital Health Ltd — manual_ambiguous_same_name_location: More than one production sponsor row matches the supplied name and location; independent evidence does not safely select or group them. URL retained in review only.
- Identity: ADM Promotions UK Limited — manual_ambiguous_same_name_location: More than one production sponsor row matches the supplied name and location; independent evidence does not safely select or group them. URL retained in review only.
- URL conflict: A Kola Construction Ltd — manual_url_review: Candidate ownership or relevance is not independently established; no production URL is changed.
- URL conflict: ABT CONSTRUCTION SERVICES LTD — manual_url_review: Candidate ownership or relevance is not independently established; no production URL is changed.
- URL conflict: AMAAN CONSTRUCTION LTD — manual_url_review: Candidate ownership or relevance is not independently established; no production URL is changed.
- URL conflict: Al Habib Islamic Educational and Cultural Centre — manual_url_review: Candidate ownership or relevance is not independently established; no production URL is changed.
- URL conflict: Al Habib Islamic Educational and Cultural Centre — manual_url_review: Candidate ownership or relevance is not independently established; no production URL is changed.
- Missing data: BMC Software Ltd — manual_ambiguous_same_name_location: More than one production sponsor row matches the supplied name and location; independent evidence does not safely select or group them. URL retained in review only.
- Missing data: Center Healthcare Limited — manual_source_evidence_insufficient: Production identity is resolved, but the URL does not yet satisfy the first-party promotion checks.
- Missing data: Clarendon Lodge Medical Practice — manual_source_evidence_insufficient: Production identity is resolved, but the URL does not yet satisfy the first-party promotion checks.
- Missing data: FEN HOUSE DENTAL PRACTICE — manual_careers_target_ambiguous: Multiple production careers-site rows match this employer; none was selected.
- Missing data: Fen House Dental Practice — manual_careers_target_ambiguous: Multiple production careers-site rows match this employer; none was selected.

# Consolidated production URL import — read-only preflight

Production snapshot date: 2026-09-28.

## Source reconciliation

- Earlier safe candidate file: 224 rows.
- Latest blocker-review candidate file: 443 rows.
- Earlier safe rows already represented in the latest file: 224.
- Earlier safe rows added separately because they were absent from the latest file: 0.
- Combined distinct input rows sent through the import planner: 443.
- Distinct normalized employer names in the candidates: 412.
- Current production sponsor targets loaded for those names: 681.
- Current company-site/careers targets loaded for those names: 26.
- Production identity-crosswalk mappings loaded: 4086.
- Separate previous production apply audit: 2026-09-27T18:52:04.939521+00:00; 6007 input rows, 1954 website updates and 3 careers/source updates (1957 approved rows); 4086 identity mappings stored.

## Read-only importer-plan validation

This uses the protected admin importer's shared planning function against a fresh read-only production snapshot. It does not call the apply, stage, or production preview endpoints. No authenticated production super-admin session was available for a live endpoint preview; no credentials were requested or used.
- Already-present candidate URLs in the current production snapshot: 0.
- Candidates held because of an existing production URL value: 0.

| Input disposition | Rows |
| --- | ---: |
| duplicate_candidate_same_target_noop | 8 |
| manual_review_development_action | 3 |
| manual_review_invalid_url_or_evidence | 1 |
| safe_to_import | 431 |

Excluded candidates:

| source_ref | URL type | disposition | reason |
| --- | --- | --- | --- |
| non-healthcare-company-websites-all-sectors.csv:3008:website:production-target-13452:website | website | manual_review_development_action | The development review action does not authorize automatic promotion. |
| non-healthcare-company-websites-all-sectors.csv:9128:website:production-target-146603:website | website | manual_review_development_action | The development review action does not authorize automatic promotion. |
| non-healthcare-company-websites-all-sectors.csv:10094:website:production-target-14896:website | website | duplicate_candidate_same_target_noop | Identical verified URL updates for every blank target are already queued. |
| non-healthcare-company-websites-all-sectors.csv:10103:website:production-target-15089:website | website | duplicate_candidate_same_target_noop | Identical verified URL updates for every blank target are already queued. |
| non-healthcare-company-websites-all-sectors.csv:10103:website:production-target-15090:website | website | duplicate_candidate_same_target_noop | Identical verified URL updates for every blank target are already queued. |
| non-healthcare-company-websites-all-sectors.csv:10466:website:production-target-19181:website | website | duplicate_candidate_same_target_noop | Identical verified URL updates for every blank target are already queued. |
| non-healthcare-company-websites-all-sectors.csv:10701:website:production-target-22547:website | website | duplicate_candidate_same_target_noop | Identical verified URL updates for every blank target are already queued. |
| non-healthcare-company-websites-all-sectors.csv:10705:website:production-target-22600:website | website | duplicate_candidate_same_target_noop | Identical verified URL updates for every blank target are already queued. |
| non-healthcare-company-websites-all-sectors.csv:10759:website:production-target-23526:website | website | duplicate_candidate_same_target_noop | Identical verified URL updates for every blank target are already queued. |
| batch1.csv:432:website_url:production-target-15210:website | website | duplicate_candidate_same_target_noop | Identical verified URL updates for every blank target are already queued. |
| non-healthcare-company-websites-all-sectors.csv:38:website:production-target-18137:website | website | manual_review_development_action | The development review action does not authorize automatic promotion. |
| batch5.csv:403:careers_url:production-target-71446:careers | careers | manual_review_invalid_url_or_evidence | A careers URL needs a careers-path signal or explicit verification of an external ATS destination. |

## Final CSV

- File: `final-approved-production-url-import.csv`.
- Candidate rows: 431.
- Website rows: 351.
- Careers/source rows: 80.
- Planned production writes after duplicate-group fan-out: 674.
- Website target writes: 594.
- Careers/source target writes: 80.
- Duplicate target/type/normalized-URL write keys: 0.
- Targets with competing URLs: 0.
- Nonblank production values that would be overwritten: 0.
- CSV SHA-256: `1524257221140ccda92c7a933f8d847b368665336d0295a70f1e40995d93cc8b`.
- Input plan hash: `8f38af80f4ca52257da7179f85ca162cbcfeab7317820126f6f32549dac015bc`.

## Manual production import steps

1. Open the published JOBSAGE production app and sign in as a super-admin.
2. Open **Admin → Sponsor website and careers import** and upload this CSV.
3. Run **Preview**. Confirm the environment is `production`; every row is `safe_to_import`; the row count, write count, website/careers write counts, and no-op/manual/collision counts match this report.
4. If any value differs, or production changed since this snapshot, do not apply. Refresh the production snapshot and regenerate the package.
5. Apply only after reviewing the live preview and its plan hash. The endpoint locks and rechecks targets, fills blank fields only, and records an audit event.

This package is ready to upload for a fresh live preview. It is not authorization to bypass that preview or to apply if the live plan differs.

## Bounded vacancy pilot

- The original candidate pool had 139 employers. The final pool has 136 employers after matching each URL to a planned final-import website write; 3 candidates had no matching final write. Current production probe rows matched: 0; known-bad candidates: 0.
- The prepared `vacancy-pilot-allowlist.csv` contains ten distinct exact employer names. `vacancy-pilot-first-source.csv` is the first listed employer for a separate one-employer smoke test if requested.

Do not run ingestion now. After a successful manual URL import, a separately approved production publish containing the allowlist filter, and separate pilot authorization, send one request to the production service's `/internal/vacancy-jobs` route:

```json
{
  "kind": "company_site",
  "limit": 10,
  "organisationNames": [
    "A1 CLUTCHES CANNOCK (UK) LIMITED",
    "Abaseen Superstore (UK) LTD",
    "Ability Post Production Academy Limited",
    "Abingdon and Witney College",
    "Abingdon School",
    "ABSCapCo Limited",
    "ABV HAIR & BEAUTY LTD",
    "Academia Park Ltd",
    "Academy of Medical Royal Colleges",
    "Ace Childrens Occupational Therapy Limited"
  ]
}
```

The company-site selector chooses distinct employer names before applying the batch limit, so this payload is bounded to at most ten employers and ten selected rows. Before any future call, confirm the effective `COMPANY_SITE_BATCH_SIZE` is ten, the AI web-search cap is zero, the production deployment includes the `organisationNames` filter, and no other batch is running. Do not retry automatically on a conflict or timeout; inspect the result first. The configured job secret must remain in the existing secret flow and must not be placed in this plan.

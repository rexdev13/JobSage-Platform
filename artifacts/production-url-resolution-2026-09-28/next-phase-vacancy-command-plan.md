# Vacancy pilot preparation — not authorized or executed

## Safety status

This review did not change production sponsor website/careers rows, create staging rows, or invoke the production vacancy worker. Existing production schedules continued independently; deployment logs during this review show company-site batches, including one batch with `selected=10`, `upserted=1`, `inserted=1`, and `errors=8`. I did not start or stop that scheduler. Do not call the production vacancy worker or apply the URL-import file as part of this review. The new allowlist code and this plan are workspace changes only; the production deployment has not been updated.

The protected URL importer still requires a fresh production preview and a reviewed plan hash. This file is not approval to apply it. Production staging is absent, and the local staging CSV is not a production queue.

## Read-only production baseline

Captured 2026-09-28 using the vacancy-stats live/evidence gates, including the manager-role approval gate and a 48-hour verification window:

| Source | Eligible rows | Employers |
| --- | ---: | ---: |
| company_site | 2,478 | 513 |
| job_board | 1,710 | 580 |
| Total rows | 4,188 | — |

This is a liveness/evidence baseline, not an exact count for every candidate feed. Candidate-specific category, industry, contact, apply-link, and matching gates can reduce the feed. An import that changes only sponsor URL/careers metadata does not itself create vacancy rows, but existing production schedules can change these counts independently. Recheck this snapshot before any future pilot. No post-pilot count exists because this review did not invoke the pilot worker.

## Prepared allowlist

- `vacancy-pilot-candidate-pool.csv` is the earlier 139-employer proposal. `vacancy-pilot-final-candidate-pool.csv` is the final-import-filtered 136-employer pool; three proposals had no matching approved website write. No current production company-site probe rows matched these employers.
- `vacancy-pilot-allowlist.csv` contains ten distinct names selected from that filtered pool in normalized-name order. The last name is **Ace Childrens Occupational Therapy Limited**; **ACE CARS & MINIBUSES LTD** was not retained because its URL is not in the final approved import. `vacancy-pilot-first-source.csv` contains **A1 CLUTCHES CANNOCK (UK) LIMITED**.
- These files are dry-run proposals only. They do not prove that the URL import has been applied or that an employer is currently due for a crawl. Existing scheduler freshness, retry, probe, and source-safety checks remain in force.
- The workspace route accepts `organisationNames` for `company_site` jobs and filters by case-insensitive, trimmed exact employer name before priority selection and the batch limit. The production deployment does not have this change until a separately approved publish.

## Requirements before any future run

This review grants no permission to start ingestion. A future, separately authorized pilot would require all of the following first:

1. Upload `final-approved-production-url-import.csv` in the published production admin importer. Require the live preview to match 431 safe rows and 674 writes (594 website, 80 careers/source); do not apply if anything differs. The offline plan hash is in `final-production-url-import-validation.md`.
2. Apply the URL file only after a separate approval and the matching protected production preview. This review did not have a production super-admin session, so it did not call the protected preview or apply endpoint.
3. Confirm the production deployment contains the exact-name `organisationNames` filter and that the effective company-site batch size is 10. Confirm the AI web-search cap is zero. If any precondition is unmet, do not run.
4. The prepared request is one `POST /internal/vacancy-jobs` with `kind: "company_site"`, `limit: 10`, and the ten exact employer names in `vacancy-pilot-allowlist.csv`. The full body is also recorded in `final-production-url-import-validation.md`. Do not substitute a generic unfiltered `limit: 10` request.
5. Send at most one request. The selector chooses distinct employer names before the limit, so it can process no more than ten pilot employers/rows. If another batch is running, or the request times out, inspect state and logs before any further action; do not retry automatically.
6. After a separately authorized run, verify every selected name belongs to the allowlist and review selected, inserted, updated, rejected, and error metrics. Stop after this one batch; do not schedule retries or drain the general queue.
7. Recheck the same candidate-specific view before and after ingestion. The 4,188-row liveness/evidence baseline above is a reference, not a substitute for the candidate feed’s additional gates.

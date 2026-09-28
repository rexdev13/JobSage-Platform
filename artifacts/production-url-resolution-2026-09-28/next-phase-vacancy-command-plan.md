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

- `vacancy-pilot-candidate-pool.csv` contains 139 distinct employers from newly resolved, approved source candidates with a nonblank website after the proposed import; candidates with a known bad company-site probe are excluded.
- `vacancy-pilot-allowlist.csv` contains the first ten names, sorted by normalized employer name. `vacancy-pilot-first-source.csv` contains the deterministic initial candidate: **A1 CLUTCHES CANNOCK (UK) LIMITED**.
- These files are dry-run proposals only. They do not prove that the URL import has been applied or that an employer is currently due for a crawl. Existing scheduler freshness, retry, probe, and source-safety checks remain in force.
- The development route now accepts `organisationNames` for `company_site` jobs and filters by normalized exact employer name before priority selection and the batch limit. The production route does not have this change until a separately approved publish.

## Requirements before any future run

This review grants no permission to start ingestion. A future, separately authorized pilot would require all of the following first:

1. Review the production URL-import preview and plan hash; do not apply any URL changes without separate approval.
2. Confirm that the production deployment includes the allowlist filter and that the configured AI web-search cap satisfies the worker’s production guard.
3. Use one exact employer name from `vacancy-pilot-first-source.csv`, with a company-site batch limit of one. Do not use an unfiltered `limit: 1` request; that would select the next employer from the general queue.
4. After a separately authorized run, verify the selected employer is the requested name and review inserted, updated, rejected, and error metrics. Stop after the first employer; no automatic retry or queue drain.
5. Recheck the same candidate-specific view before and after ingestion. The 4,188-row liveness/evidence baseline above is a reference, not a substitute for the candidate feed’s additional gates.

# Company-site direct-feed rollout plan

## Current status

- The strict `company_site_direct_feed` job is implemented but is not scheduled
  in production.
- No production environment variable, mapping, vacancy row, or cron entry was
  changed as part of this work.
- The generic company-site discovery schedule remains unchanged. The current
  canonical schedules are in `vacancy-jobs-http-cron.md`; the older
  `vacancy-pipeline-cron-job-org.md` now uses the same board and probe values.
- Do not deploy or add a production cron until the discovery report, mapping
  diff, and development repeat-import result have been reviewed and separately
  approved.

## Safety controls

The direct-feed job requires a stored mapping with `verified` status, provider,
board ID, and careers URL. The approved careers URL must parse back to the same
stored board ID. The job accepts only `known_ats_posting` evidence and uses the
existing writer lock, employer lease, deduplication, upsert, liveness, and
retry logic. It does not parse generic HTML, JSON-LD, or microdata.

The generic import kill switch is `COMPANY_SITE_GENERIC_IMPORT_ENABLED=false`.
When set, generic company-site adverts are not persisted, while verified direct
ATS/feed imports remain available. The variable defaults to `true` when unset.
Setting or changing it in production is a separate operator action and has not
been done here.

Read-only discovery is bounded to saved employer root, same-site careers, and
same-site mapping-evidence URLs; at most three pages are fetched per employer.
It uses the shared HTTPS, DNS pinning, SSRF, redirect, robots, pacing, retry,
deadline, and response-size controls. Read-only host pacing and robots results
are kept in process memory; the tool does not write host-state, mapping, vacancy,
or liveness rows.

The mapping importer defaults to dry-run. It writes only the five mapping
columns on an existing company-site check row. It matches by normalized
organisation name plus exact employer website host, preserves verified mappings
unless replacement is explicitly approved, and emits before/after and rollback
values. Production apply requires production runtime, `--apply=true`, and the
explicit `--confirm-production-mapping-only=true` gate; do not use that gate
without a separate production approval.

## Provider policy

| Provider/source | Policy |
| --- | --- |
| Ashby, Greenhouse, Lever, SmartRecruiters | Direct feed imports remain eligible for authoritative snapshots only when the existing adapter proves a complete inventory. |
| Recruitee, Personio | Direct feed imports are allowed, but missing records are not retired because the feed does not prove a complete inventory. |
| Pinpoint | Public `postings.json` feed is allowed as observed-only; it is not authoritative for retirement because the adapter does not prove completeness. |
| Circle Health Group Workday | Keep the exact employer/board connector and identity checks; do not generalize this exception to other Workday boards. |
| Teamtailor | Recognized only. Its XML feed is partner-specific; do not infer a feed URL from an employer name or public careers page. |
| iCIMS | Recognized only. Its Job Portal API requires credentials; do not import it without an approved credentialed design. |
| Other ATS hosts | Recognized for discovery/reporting only until a public, safe, provider-specific feed contract is verified. |

Only a first-party employer page that links to the exact supported ATS board
produces a high-confidence mapping candidate. The discovery report includes
rejections, feed completion, accepted/rejected posting counts, and whether the
feed is authoritative for retiring missing postings.

## Development validation

Before any development database query or write, obtain the fingerprint from the
development database pane and pass it to the tool. This prevents a development
label or `NODE_ENV` value from being treated as proof of the connected database:

```sql
SELECT md5(
  current_database() || ':' ||
  coalesce(inet_server_addr()::text, '') || ':' ||
  pg_postmaster_start_time()::text
) AS fingerprint;
```

Run the read-only discovery against one to three named development employers:

```sh
pnpm --filter @workspace/api-server exec tsx src/tools/companySiteAtsDiscovery.ts \
  --environment=development \
  --expected-db-fingerprint=<confirmed-development-fingerprint> \
  --organisations="59 Studio,Vertical Aerospace" \
  --limit=2 \
  --format=json > discovery.json
```

Review the evidence and feed status before producing a dry-run mapping diff:

```sh
pnpm --filter @workspace/api-server exec tsx src/tools/importCompanySiteAtsMappings.ts \
  --environment=development \
  --input=discovery.json
```

Only after verifying the dry-run output, development mappings may be updated
with `--apply=true`, `--confirm-dev-mapping-only=true`, and the same
`--expected-db-fingerprint`:

```sh
pnpm --filter @workspace/api-server exec tsx src/tools/importCompanySiteAtsMappings.ts \
  --environment=development \
  --input=discovery.json \
  --apply=true \
  --confirm-dev-mapping-only=true \
  --expected-db-fingerprint=<confirmed-development-fingerprint>
```

The repeat-import check is limited to one
explicitly named development employer and two direct-feed passes:

```sh
NODE_ENV=development SPONSOR_WEBSITE_VACANCY_PIPELINE_DEV_DB=confirmed \
  pnpm --filter @workspace/api-server exec tsx \
  src/tools/companySiteRepeatImportTest.ts \
  --environment=development \
  --expected-db-fingerprint=<confirmed-development-fingerprint> \
  --organisation="59 Studio" \
  --confirm-dev-writes=true
```

The check requires a complete feed with at least one accepted posting on the
first pass, then asserts that the second pass and its repeated persistence
attempt insert no new records. It does not run generic crawling. Do not run it
against production.

## Production canary sequence (not authorized by this change)

1. Publish the reviewed code through the normal release process.
2. Run read-only discovery against a small, explicitly selected production
   cohort. Export JSON/CSV and review exact same-site evidence, rejected
   candidates, feed completeness, and authoritative-snapshot status.
3. Run the mapping importer in production dry-run mode. Review each before/after
   value and keep the rollback export. Do not apply mappings without a separate
   approval.
4. If approved, apply only approved mappings through the guarded importer.
5. Add one external cron entry for
   `POST /api/internal/vacancy-jobs` with
   `{"kind":"company_site_direct_feed","limit":5}`. Proposed initial cadence:
   `0 5 * * *` Europe/London. This is a proposal only; no cron entry has been
   created. Keep the existing shared-writer non-overlap rules and honor `409`
   and `504` retry headers.
6. Observe a five-employer canary before raising the cap to ten. Review
   per-employer provider/mapping ID, inserted/updated/revived/retired counts,
   completion, elapsed time, error category, HTTP status, and retry time.
   Logs exclude full error messages and query strings.
7. Keep Pinpoint observed-only and do not allow it to retire older postings.
   Keep schema.org/microdata and generic company-site results outside this job.

## Rollback

- Remove or disable the direct-feed external cron first; do not retry in a tight
  loop after `409` or `504`.
- Restore mappings from the importer's rollback output if any approved mapping
  is found to be incorrect.
- If the generic-import kill switch was changed, restore its previous value.
- Existing vacancy rows are not bulk-deleted by rollback. Missing-posting
  retirement remains scoped to complete authoritative feed snapshots only.
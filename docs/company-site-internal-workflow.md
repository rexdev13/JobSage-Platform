# Internal company-site workflow

These endpoints are internal and fail closed unless `VACANCY_JOB_SECRET` is
configured and the request supplies the exact `x-jobsage-job-secret` value.
Reports are stored in Replit private Object Storage in Production and in
`.cache/company-site-workflow/` in Development/test. Report retrieval uses the
same secret.

## Production payloads

Read-only discovery (maximum five exact employers; no persistence):

```bash
curl -X POST "$APP_URL/api/internal/company-site-discovery/read-only" \
  -H "content-type: application/json" -H "x-jobsage-job-secret: $VACANCY_JOB_SECRET" \
  -d '{"limit":5,"organisationNames":["Example Employer"],"providers":["Greenhouse","Workday"]}'
```

Mapping dry-run:

```bash
curl -X POST "$APP_URL/api/internal/company-site-mappings/dry-run" \
  -H "content-type: application/json" -H "x-jobsage-job-secret: $VACANCY_JOB_SECRET" \
  -d '{"discoveryReportId":"<discovery-report-id>","reviewed":true}'
```

The response contains a one-time `approvalToken` UUID. For a reviewed mapping
file instead of a discovery report, place the reviewed JSON file's records in
`reviewedMappingFile.records`:

```bash
curl -X POST "$APP_URL/api/internal/company-site-mappings/dry-run" \
  -H "x-jobsage-job-secret: $VACANCY_JOB_SECRET" \
  -F 'reviewed=true' -F 'file=@reviewed-mappings.json;type=application/json'
```

The uploaded file must be JSON containing a top-level `records` array and is
limited to 1 MB. The same content can also be sent inline as the
`reviewedMappingFile` JSON field.

Apply is deliberately separate and requires a reviewed dry-run plus the exact
UUID returned by that dry-run:

```bash
curl -X POST "$APP_URL/api/internal/company-site-mappings/apply" \
  -H "content-type: application/json" -H "x-jobsage-job-secret: $VACANCY_JOB_SECRET" \
  -d '{"dryRunReportId":"<reviewed-dry-run-id>","approvalToken":"<dry-run-approvalToken-uuid>"}'
```

Retrieve any report:

```bash
curl "$APP_URL/api/internal/company-site-workflow/reports/<report-id>" \
  -H "x-jobsage-job-secret: $VACANCY_JOB_SECRET"
```

The apply response is the committed result and includes `intentReportId`.
Retrieve both the committed apply report and its pre-write intent/rollback
report using the retrieval endpoint.

Verified mapping overwrites are refused by default. Only include
`"allowVerifiedOverwrite":true` alongside `"reviewed":true` in the dry-run
request when an existing verified mapping has been explicitly reviewed for
replacement; the apply step still requires the exact returned approval token.

Discovery uses a repeatable-read, transaction-read-only snapshot, checks saved
employer/careers/evidence URLs and first-party supported ATS links only, and
forces a rollback before comparing fresh counts. It passes
`readOnly`, `noHostState`, and `noProcessCache`; it never calls vacancy
persistence. Mapping apply locks and rechecks the dry-run before-state and
updates only the five mapping columns. The rollback export and per-row audit
report are saved before the transaction commit.

## Rollout

1. Run discovery for at most five explicitly selected employers.
2. Review verified candidates and rejected/uncertain records.
3. Run the dry-run and review every before/after field diff.
4. Re-run dry-run with `reviewed:true` only after operator review; retain the
   returned UUID approval token.
5. Apply only with that exact approval token.
6. Retrieve and retain both the committed apply report and `intentReportId`
   rollback report.
7. Only after review, add one direct-feed canary:
   `{"kind":"company_site_direct_feed","limit":5}`.

No cron entries were edited. Existing job-board, Reed, additional-board,
liveness, and probe jobs remain unchanged. Before enabling a direct-feed
canary, pause the old generic `JOBSAGE company-site A`, `B`, `C`, and `D`
jobs after verifying the current scheduler export; keep the company-site probe
enabled. Direct-feed verification in Development must be mock-only because the
existing runner persists vacancies.
# Vacancy pipeline cron-job.org payloads

These requests are bounded, idempotent, and safe for an Autoscale API server. They
must target the deployed API origin and include the configured
`VACANCY_JOB_SECRET` in the `x-jobsage-job-secret` header. Do not put the secret
in a URL, JSON body, or repository file.

## Common request

```text
POST https://<production-api-origin>/api/internal/vacancy-jobs
Content-Type: application/json
x-jobsage-job-secret: <VACANCY_JOB_SECRET>
```

The production origin should be the current published JOBSAGE URL. The API
rejects requests without the secret and caps every limit server-side.

## Recommended schedules and exact bodies

### NHS / core board refresh

```text
Schedule: 0 2,8,14,20 * * *
Body: {"kind":"job_board","limit":50}
```

### Reed profession backfill

The backfill cursor advances through every configured profession target. Start
at cursor `0`, then schedule the next request with the returned `nextCursor`.
When `done` is `true`, restart at cursor `0`.

```text
Schedule: */10 * * * *
Body: {"kind":"reed_professions","limit":3,"cursor":0}
```

Replace `0` with the previous response's `nextCursor`. The server processes up to three
profession categories and 40 results per category per request, and records attempted queries, discovered
rows, classified rows, upserts, candidate-visible rows, and
`emptySuccess` flags per profession.

### Additional boards: jobs.ac.uk and Teaching Vacancies

Use the same cursor protocol. The plan includes every configured non-NHS
profession for jobs.ac.uk and the education profession for Teaching Vacancies.

```text
Schedule: 10 * * * *
Body: {"kind":"additional_boards","limit":3,"cursor":0}
```

Replace `0` with the returned `nextCursor`; restart at `0` after `done: true`.

### Free public UK board feeds

This job resumes the stored cursor for NHS Jobs, Teaching Vacancies, NHS
Scotland, jobs.ac.uk, CharityJob and the other configured free feeds. It keeps
source observations, sponsor matching, deduplication and missing-listing
reconciliation inside the protected writer lock.

```text
Schedule: 5,25,45 * * * *
Body: {"kind":"free_board_sources","limit":5}
```

### Reviewed free ATS directory

Only reviewed provider/board mappings are eligible; the reference allowlist is
not employer-identity proof by itself.

```text
Schedule: 15 * * * *
Body: {"kind":"free_source_ats","limit":10,"cursor":0}
```

Advance `cursor` from the prior response and restart at zero when `done` is
true. Keep these minutes clear of other vacancy-writer calls.

### Company-site probe

```text
Schedule: 30 3,5,9,11,15,17,21,23 * * *
Body: {"kind":"company_site_probe","limit":30}
```

The probe keeps the existing robots, SSRF, pacing, response-size, and retry
controls. It prioritizes retryable false-bad/unknown states and unprobed
employers without admitting unverified vacancies to the candidate feed.

### Company-site discovery

```text
Schedule: 17 * * * *
Body: {"kind":"company_site","limit":10}
```

This retains the hybrid `ok_for_crawl` plus unprobed selection policy. Do not
increase the limit above the server cap without a separate capacity review.

### Liveness verification

```text
Schedule: 30 1,7,13,19 * * *
Body: {"kind":"liveness","limit":40}
```

## Operator rules

- Treat HTTP 409 as a normal overlap response and retry after 30 seconds.
- Treat HTTP 504 as an in-progress batch that is finalizing safely; retry after
  30 seconds rather than starting a manual duplicate.
- Keep the cron-job.org request timeout above 30 seconds.
- Keep cron-job.org response logging limited to status, duration, and redacted
  summary fields. Never log the secret or full provider responses.
- The profession backfill endpoints are deliberately capped at three categories
  per request and use a 45-second internal budget. Do not raise either bound
  without measuring provider latency and the hosting request timeout.

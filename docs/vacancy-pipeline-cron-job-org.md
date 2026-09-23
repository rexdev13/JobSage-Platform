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
Schedule: 0 */6 * * *
Body: {"kind":"job_board","limit":50}
```

### Reed profession backfill

The backfill cursor advances through every configured profession target. Start
at cursor `0`, then schedule the next request with the returned `nextCursor`.
When `done` is `true`, restart at cursor `0`.

```text
Schedule: */20 * * * *
Body: {"kind":"reed_professions","limit":2,"cursor":0}
```

Replace `0` with the previous response's `nextCursor`. The server processes two
profession categories per request and records attempted queries, discovered
rows, classified rows, upserts, candidate-visible rows, and
`emptySuccess` flags per profession.

### Additional boards: jobs.ac.uk and Teaching Vacancies

Use the same cursor protocol. The plan includes every configured non-NHS
profession for jobs.ac.uk and the education profession for Teaching Vacancies.

```text
Schedule: 10 * * * *
Body: {"kind":"additional_boards","limit":2,"cursor":0}
```

Replace `0` with the returned `nextCursor`; restart at `0` after `done: true`.

### Company-site probe

```text
Schedule: */15 * * * *
Body: {"kind":"company_site_probe","limit":60}
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
- The backfill endpoints are deliberately capped at two profession categories
  per request to keep each request inside the 22-second HTTP budget.
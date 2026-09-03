# Vacancy jobs Scheduled deployments

The public `jobsage.co.uk` deployment remains **Autoscale**. Production vacancy
discovery and liveness are owned by separate Replit **Scheduled** deployments,
not by the website process and not by HTTP requests to the website.

Create three Scheduled deployments in the same Replit project. Each deployment
must use the **Production** environment so `DATABASE_URL` is the published
application database.

## Shared build command

```sh
pnpm --filter @workspace/api-server run build
```

## 1. JOBSAGE vacancy board discovery

- Type: **Scheduled**
- Time zone: **Europe/London**
- Cron: `0 2,8,14,20 * * *`
- Run command:

```sh
VACANCY_JOB_ENV=production VACANCY_JOB_KIND=job_board VACANCY_AI_WEB_SEARCH_DAILY_CAP=0 pnpm --filter @workspace/api-server run vacancy:jobs
```

This executes one capped batch of at most 250 employers with concurrency 15.

## 2. JOBSAGE company-site discovery

- Type: **Scheduled**
- Time zone: **Europe/London**
- Cron: `17 * * * *`
- Run command:

```sh
VACANCY_JOB_ENV=production VACANCY_JOB_KIND=company_site VACANCY_AI_WEB_SEARCH_DAILY_CAP=0 pnpm --filter @workspace/api-server run vacancy:jobs
```

This executes one capped batch of 75–100 employers with concurrency 8. It
retains the crawler's robots checks, pacing, retry times, and host backoff.

## 3. JOBSAGE vacancy-link liveness

- Type: **Scheduled**
- Time zone: **Europe/London**
- Cron: `30 1,7,13,19 * * *`
- Run command:

```sh
VACANCY_JOB_ENV=production VACANCY_JOB_KIND=liveness VACANCY_AI_WEB_SEARCH_DAILY_CAP=0 pnpm --filter @workspace/api-server run vacancy:jobs
```

This executes one capped sweep of at most 600 stored links with domain
concurrency 24 and per-domain pacing.

## Safety and verification

- Never replace these commands with `curl jobsage.co.uk`: that wakes an
  Autoscale web instance and makes scraping dependent on an HTTP request.
- The worker acquires a PostgreSQL advisory writer lock. An overlapping run
  logs `skipped=writer-lock-held` and exits without clearing probe leases,
  retry timestamps, or backoff.
- The published website does not register the three in-process vacancy crons
  and does not run a vacancy catch-up on boot.
- Candidate `GET /roles` only reads persisted data; it does not invoke this
  worker.
- Every run emits a `[vacancy-job]` line containing the job name and
  `upserted`, `live`, `dead`, and `inconclusive` counts.

After publishing the code and creating the Scheduled deployments, leave the
Autoscale web deployment idle and run **JOBSAGE vacancy board discovery** once
from the Scheduled deployment's Run control. Confirm:

1. The Scheduled deployment log ends with `job=job_board`.
2. `errors=0`.
3. `upserted` is present in the summary.
4. A read-only production query shows a newly written or revived
   `source_type = 'job_board'` row with `liveness = 'live'` after the normal
   liveness job verifies it.

Do not run the full liveness scan. Do not enable the region, industry, contact,
or all-sponsor startup backfills.
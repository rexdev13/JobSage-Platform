# Vacancy jobs over short awaited HTTP batches

The public JOBSAGE deployment remains **Autoscale**. External cron callers wake
that deployment with short, authenticated requests. Each request awaits one
capped batch and returns its final counters; it never returns `202` and never
detaches work into the background.

## Production secret

In **Publishing → production secrets**, add:

```text
VACANCY_JOB_SECRET
```

Use a long random value. Store the same value in the external scheduler's secret
store. Never put it directly in a repository, workflow file, URL, or log.

The endpoint returns `503` when the production secret is absent and `401` when
the request header does not match.

## Endpoint

```text
POST https://jobsage.co.uk/api/internal/vacancy-jobs
Header: x-jobsage-job-secret: <secret>
Content-Type: application/json
```

Kinds and safe HTTP defaults:

| Kind | Default | Maximum |
| --- | ---: | ---: |
| `job_board` | 50 employers | 50 |
| `company_site` | 30 employers | 40 |
| `liveness` | 100 URLs | 120 |

The response is returned only after that batch finishes:

```json
{
  "selected": 50,
  "upserted": 4,
  "live": 0,
  "dead": 0,
  "inconclusive": 0,
  "errors": 0,
  "done": false
}
```

`done` is true when the worker selected fewer rows than the requested batch
limit. One curl is deliberately **not** a full 250-employer board run. Repeat
short calls until `done` is true (or `selected` is zero).

## curl

Set the secret in your shell without placing it in shell history:

```sh
read -s VACANCY_JOB_SECRET
export VACANCY_JOB_SECRET
```

Run one short board batch:

```sh
curl --fail-with-body \
  -X POST https://jobsage.co.uk/api/internal/vacancy-jobs \
  -H "Content-Type: application/json" \
  -H "x-jobsage-job-secret: ${VACANCY_JOB_SECRET}" \
  --data '{"kind":"job_board","limit":50}'
```

Company-site and liveness:

```sh
curl --fail-with-body -X POST https://jobsage.co.uk/api/internal/vacancy-jobs \
  -H "Content-Type: application/json" \
  -H "x-jobsage-job-secret: ${VACANCY_JOB_SECRET}" \
  --data '{"kind":"company_site","limit":30}'

curl --fail-with-body -X POST https://jobsage.co.uk/api/internal/vacancy-jobs \
  -H "Content-Type: application/json" \
  -H "x-jobsage-job-secret: ${VACANCY_JOB_SECRET}" \
  --data '{"kind":"liveness","limit":100}'
```

Wait for each response before sending the next request. A `409` means another
batch owns the shared PostgreSQL writer lock; wait and retry rather than running
requests concurrently.

## cron-job.org

Create POST jobs using the endpoint, JSON body, and
`x-jobsage-job-secret` header. Configure the schedules in Europe/London:

- Board: `0 2,8,14,20 * * *`
- Company site: `17 * * * *`
- Liveness: `30 1,7,13,19 * * *`

cron-job.org sends one request per trigger. To drain more than one short batch,
use multiple sequential jobs with enough spacing for the previous request to
finish, or use a looping runner such as GitHub Actions. Never overlap kinds; they
share one writer lock.

## GitHub Actions loop

Store the value as the repository secret `VACANCY_JOB_SECRET`. Schedule times in
GitHub Actions cron are UTC, not Europe/London, so UTC expressions must be
adjusted when the UK enters or leaves daylight-saving time.

The loop must await every curl and stop when the JSON response reports
`done=true` or `selected=0`:

```sh
for kind in job_board company_site liveness; do
  while true; do
    response="$(curl --fail-with-body \
      -X POST https://jobsage.co.uk/api/internal/vacancy-jobs \
      -H "Content-Type: application/json" \
      -H "x-jobsage-job-secret: ${VACANCY_JOB_SECRET}" \
      --data "{\"kind\":\"${kind}\"}")"
    echo "${response}"
    node -e '
      const value = JSON.parse(process.argv[1]);
      process.exit(value.done === true || value.selected === 0 ? 0 : 1);
    ' "${response}" && break
    sleep 10
  done
done
```

Keep `VACANCY_AI_WEB_SEARCH_DAILY_CAP=0`. The HTTP route uses the existing
NHS/Reed, company-site, and liveness workers with their leases, robots rules,
backoff, pacing, and shared advisory lock. It does not run a boot catch-up or
full-database scan.
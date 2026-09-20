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
| `company_site` | 10 employers | 10 |
| `liveness` | 40 URLs | 50 |
| `contact` | 5 employers | 5 |
| `reed_professions` | 1 profession category | 2 categories |
| `additional_boards` | 1 board/profession page | 2 board/profession pages |

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

Profession backfills are cursor-paged because a single Reed or official-board
search can require several polite page requests. Their `limit` is the number of
profession pages in this request, not the number of vacancies. `cursor` is
zero-based:

- `reed_professions` pages the nine Reed targets in the order declared by the
  backfill module.
- `additional_boards` pages the jobs.ac.uk targets first, followed by the
  Teaching Vacancies education target.

The response includes `cursor`, `nextCursor`, `remaining`, and `done`, plus the
source/category metrics written to `vacancy_sync_log`. On a failed or cooldown
category, `nextCursor` stays at that category so the caller can retry it.

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

Company-site, liveness, and resumable official-contact enrichment:

```sh
curl --fail-with-body -X POST https://jobsage.co.uk/api/internal/vacancy-jobs \
  -H "Content-Type: application/json" \
  -H "x-jobsage-job-secret: ${VACANCY_JOB_SECRET}" \
  --data '{"kind":"company_site","limit":10}'

curl --fail-with-body -X POST https://jobsage.co.uk/api/internal/vacancy-jobs \
  -H "Content-Type: application/json" \
  -H "x-jobsage-job-secret: ${VACANCY_JOB_SECRET}" \
  --data '{"kind":"liveness","limit":40}'

curl --fail-with-body -X POST https://jobsage.co.uk/api/internal/vacancy-jobs \
  -H "Content-Type: application/json" \
  -H "x-jobsage-job-secret: ${VACANCY_JOB_SECRET}" \
  --data '{"kind":"contact","limit":5}'

curl --fail-with-body -X POST https://jobsage.co.uk/api/internal/vacancy-jobs \
  -H "Content-Type: application/json" \
  -H "x-jobsage-job-secret: ${VACANCY_JOB_SECRET}" \
  --data '{"kind":"reed_professions","cursor":0,"limit":1}'

curl --fail-with-body -X POST https://jobsage.co.uk/api/internal/vacancy-jobs \
  -H "Content-Type: application/json" \
  -H "x-jobsage-job-secret: ${VACANCY_JOB_SECRET}" \
  --data '{"kind":"additional_boards","cursor":0,"limit":1}'
```

For a later profession page, replace `cursor` with the previous response's
`nextCursor`. Do not increase the profession `limit` above `2`; the HTTP
worker has a 22-second absolute budget and keeps the existing request
timeouts, pacing, sponsor matching, direct-URL checks, and verified-live
semantics.

Wait for each response before sending the next request. A `409` means another
batch owns the shared PostgreSQL writer lock; honor `Retry-After` and retry
later rather than running requests concurrently. Company-site must have one
active caller at a time: do not attach multiple cron jobs to the same minute
or run a tight retry loop after a `409`.

## cron-job.org

Create POST jobs using the endpoint, JSON body, and
`x-jobsage-job-secret` header. Configure the schedules in Europe/London:

- Board: `0 2,8,14,20 * * *`
- Company site: `17 * * * *`
- Liveness: `30 1,7,13,19 * * *`
- Contact: `47 3 * * *` (one authenticated, non-overlapping daily batch)

For a complete daily profession sweep, create these additional POST jobs. Each
job uses the same URL, `Content-Type` header, and secret header shown above.
Keep the JSON body fixed; cron-job.org does not update a later job's body from a
previous response:

| Schedule (Europe/London) | Kind | JSON body |
| --- | --- | --- |
| `1 3 * * *` through `25 3 * * *`, every 3 minutes | `reed_professions` | `{"kind":"reed_professions","cursor":0..8,"limit":1}` — create one job per cursor |
| `1 4 * * *` through `28 4 * * *`, every 3 minutes | `additional_boards` | `{"kind":"additional_boards","cursor":0..9,"limit":1}` — create one job per cursor |

The compact form above means nine Reed jobs with cursors `0` through `8` at
03:01, 03:04, ..., 03:25, and ten additional-board jobs with cursors `0`
through `9` at 04:01, 04:04, ..., 04:28. The three-minute spacing is
intentional: it leaves room for the 22-second server budget, response delivery,
and a `Retry-After: 30` retry without overlapping the next fixed page. If a
page returns `done=false` with a different `nextCursor`, use that cursor for a
manual catch-up request rather than changing the daily jobs mid-run.

In each cron-job.org job:

1. Select **POST** and the exact endpoint above.
2. Add `Content-Type: application/json`.
3. Add `x-jobsage-job-secret` as a secret/header value; never put the secret in
   the URL or request body.
4. Paste the fixed JSON body for that cursor.
5. Set the timezone to **Europe/London** and use the schedule table above.
6. Do not run overlapping retries. A `409` is expected backpressure; retry only
   after the response's `Retry-After` value, and keep the same cursor.

These schedules are deployment instructions, not an instruction to publish or
to run against production from this development workspace. Enable them only
after the route is published and the production secret has been configured.

cron-job.org sends one request per trigger. The recommended baseline is one
company-site request hourly, one board request every six hours, four liveness
requests daily, and one contact request daily. Never overlap kinds; they share
one writer lock and overlapping requests receive `409`.

If company-site throughput later needs to approach 142 completed employers/hour,
do not raise the batch size or add overlapping cron jobs. First remove wasted
slots through quarantine/backoff and fix failed/partial outcomes. Then use one
serialized runner that sends another batch only after the previous response
completes; at ten employers per batch, roughly fifteen fully successful batches
per hour would be needed. Staggered cron callers are safe only if they are
strictly serialized and honor `Retry-After`.

The contact worker has its own persisted UTC daily web-search allowance
(`CONTACT_WEB_SEARCH_DAILY_CAP`, default 50, maximum 100). A zero-selected
contact response may still report backlog because rows are awaiting their retry
time or tomorrow's allowance; stop that loop rather than hammering the endpoint,
and let the daily contact schedule run again.

Before any paid lookup, the contact worker drains a database-only harvest in
batches of up to 250 employers with a 20-second time budget. It checks current,
non-dead stored vacancies and matching employer-profile contacts, never fetches
a page, and never overwrites an existing sponsor contact. Responses expose
`harvested`, `skippedExisting`, `noEmailInStore`, and `harvestRemaining`.
Paid website discovery remains disabled until `harvestRemaining` reaches zero.

## GitHub Actions loop

Store the value as the repository secret `VACANCY_JOB_SECRET`. Schedule times in
GitHub Actions cron are UTC, not Europe/London, so UTC expressions must be
adjusted when the UK enters or leaves daylight-saving time.

The loop must await every curl and stop when the JSON response reports
`done=true` or `selected=0`:

```sh
for kind in job_board company_site liveness contact; do
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

Keep `VACANCY_AI_WEB_SEARCH_DAILY_CAP=0`. The contact worker is separate and
resumable per organisation: it only uses corroborated official employer pages,
honours company-site robots/SSRF/pacing protections, never guesses an address,
and never overwrites register contact data. The HTTP route uses the existing
NHS/Reed, company-site, and liveness workers with their leases, robots rules,
backoff, pacing, and shared advisory lock. It does not run a boot catch-up or
full-database scan.

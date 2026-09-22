# Vacancy jobs over short awaited HTTP batches

The public JOBSAGE deployment remains **Autoscale**. External cron callers wake
that deployment with short, authenticated requests. Each request awaits one
capped batch and normally returns its final counters; it never returns `202`.
If a company-site probe reaches its absolute HTTP deadline, the endpoint returns
`504` with `Retry-After: 30` while retaining the shared writer lock until any
in-flight persistence and sync logging settle safely.

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
| `company_site_probe` | 30 employers | 30 |
| `liveness` | 40 URLs | 50 |
| `contact` | 5 employers | 5 |
| `reed_professions` | 1 profession category | 2 categories |
| `additional_boards` | 1 board/profession page | 2 board/profession pages |

The normal response is returned after that batch finishes:

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
source/category metrics written to `vacancy_sync_log`. Each category reports
`discovered`, `sponsorMatched`, `classified`, `candidateVisible`, and its
inserted/updated/revived counters. The HTTP runner requests up to 20 results
per category within the 22-second profession-backfill budget. On a failed or
cooldown category, `nextCursor` stays at that category so the caller can retry
it.

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
  --data '{"kind":"company_site_probe","limit":30}'

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
or run a tight retry loop after a `409`. A probe `504` means its HTTP budget was
reached while final writes were still settling under the same lock; honor
`Retry-After` exactly as for a `409`.

## cron-job.org

Create POST jobs using the endpoint, JSON body, and
`x-jobsage-job-secret` header. Configure the schedules in Europe/London:

- Board: `0 2,8,14,20 * * *`
- Company site: `17 * * * *`
- Company-site probe: `30 3,5,9,11,15,17,21,23 * * *`
- Liveness: `30 1,7,13,19 * * *`
- Contact: `47 3 * * *` (one authenticated, non-overlapping daily batch)

Keep the existing board, company-site, liveness, and contact jobs. For
continuous profession coverage, create the following 19 additional POST jobs.
Each job uses the same URL, `Content-Type` header, and secret header shown
above. Keep the JSON body fixed; cron-job.org does not update a later job's body
from a previous response:

Create one additional all-day probe job:

| Schedule (Europe/London) | Job title | Kind | JSON body |
| --- | --- | --- | --- |
| `30 3,5,9,11,15,17,21,23 * * *` | Company site health probe | `company_site_probe` | `{"kind":"company_site_probe","limit":30}` |

The probe uses only the requested free-minute set: minute `:30` is unused by
the odd-hour additional-board cursor pass. The selected hours avoid liveness
at `01:30`, `07:30`, `13:30`, and `19:30`; they also avoid board (`:00`),
company-site (`:17`), contact (`:47`), and every even/odd-hour profession
cursor job (`:06`, `:10`, `:18`, `:22`, `:30`, `:34`, `:42`, `:46`, `:54`,
`:58`).
The probe performs only one robots-aware root fetch per selected employer and
does not crawl vacancy links. Wait for its response before any other pipeline
request and honor `Retry-After: 30` on a `409` or `504`.

| Schedule (Europe/London) | Job title | Kind | JSON body |
| --- | --- | --- | --- |
| `6 0-22/2 * * *` | Reed profession cursor 0 | `reed_professions` | `{"kind":"reed_professions","cursor":0,"limit":1}` |
| `10 0-22/2 * * *` | Reed profession cursor 1 | `reed_professions` | `{"kind":"reed_professions","cursor":1,"limit":1}` |
| `18 0-22/2 * * *` | Reed profession cursor 2 | `reed_professions` | `{"kind":"reed_professions","cursor":2,"limit":1}` |
| `22 0-22/2 * * *` | Reed profession cursor 3 | `reed_professions` | `{"kind":"reed_professions","cursor":3,"limit":1}` |
| `30 0-22/2 * * *` | Reed profession cursor 4 | `reed_professions` | `{"kind":"reed_professions","cursor":4,"limit":1}` |
| `34 0-22/2 * * *` | Reed profession cursor 5 | `reed_professions` | `{"kind":"reed_professions","cursor":5,"limit":1}` |
| `42 0-22/2 * * *` | Reed profession cursor 6 | `reed_professions` | `{"kind":"reed_professions","cursor":6,"limit":1}` |
| `46 0-22/2 * * *` | Reed profession cursor 7 | `reed_professions` | `{"kind":"reed_professions","cursor":7,"limit":1}` |
| `54 0-22/2 * * *` | Reed profession cursor 8 | `reed_professions` | `{"kind":"reed_professions","cursor":8,"limit":1}` |
| `58 0-22/2 * * *` | Additional boards cursor 0 | `additional_boards` | `{"kind":"additional_boards","cursor":0,"limit":1}` |
| `6 1-23/2 * * *` | Additional boards cursor 1 | `additional_boards` | `{"kind":"additional_boards","cursor":1,"limit":1}` |
| `10 1-23/2 * * *` | Additional boards cursor 2 | `additional_boards` | `{"kind":"additional_boards","cursor":2,"limit":1}` |
| `18 1-23/2 * * *` | Additional boards cursor 3 | `additional_boards` | `{"kind":"additional_boards","cursor":3,"limit":1}` |
| `22 1-23/2 * * *` | Additional boards cursor 4 | `additional_boards` | `{"kind":"additional_boards","cursor":4,"limit":1}` |
| `34 1-23/2 * * *` | Additional boards cursor 5 | `additional_boards` | `{"kind":"additional_boards","cursor":5,"limit":1}` |
| `42 1-23/2 * * *` | Additional boards cursor 6 | `additional_boards` | `{"kind":"additional_boards","cursor":6,"limit":1}` |
| `46 1-23/2 * * *` | Additional boards cursor 7 | `additional_boards` | `{"kind":"additional_boards","cursor":7,"limit":1}` |
| `54 1-23/2 * * *` | Additional boards cursor 8 | `additional_boards` | `{"kind":"additional_boards","cursor":8,"limit":1}` |
| `58 1-23/2 * * *` | Additional boards cursor 9 | `additional_boards` | `{"kind":"additional_boards","cursor":9,"limit":1}` |

The even-hour Reed pass and the odd-hour additional-board pass each complete
every two hours. Additional-board cursor 0 uses `:58` in even hours so the
remaining odd-hour jobs avoid the existing liveness `:30` slots. The
three-minute-or-more spacing leaves room for the 22-second server budget,
response delivery, and a `Retry-After: 30` retry without overlapping the next
fixed page. If a page returns `done=false` with a different `nextCursor`, use
that cursor for a manual catch-up request rather than changing the daily jobs.

In each cron-job.org job:

1. Select **POST** and the exact endpoint above.
2. Add `Content-Type: application/json`.
3. Add `x-jobsage-job-secret` as a secret/header value; never put the secret in
   the URL or request body.
4. Paste the fixed JSON body for that cursor.
5. Set the timezone to **Europe/London** and use the schedule table above.
6. Do not run overlapping retries. A `409` is expected backpressure and a probe
   `504` means safe finalization is still in progress; retry only after the
   response's `Retry-After` value, and keep the same cursor.

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

# JOBSAGE k6 load testing

This harness is for local or explicitly provisioned non-production staging only.
It must not target `https://jobsage.co.uk`, any Replit preview domain, or a
customer account.

## What is covered

The script in `scripts/k6/jobsage-smoke.js` exercises:

- `GET /api/healthz`;
- `GET /api/auth/user`;
- login/session bootstrap when `K6_TEST_EMAIL` and `K6_TEST_PASSWORD` are set;
- authenticated Job Board Opportunities;
- authenticated company-site Opportunities;
- authenticated eligibility-history browsing; and
- the rules-based eligibility evaluation only when
  `K6_RUN_ELIGIBILITY=true`.

The test user must be a synthetic, verified, consented staging account with a
staging-only profile. Do not use a real customer's credentials. Eligibility
evaluation writes a decision record, so it is opt-in rather than part of the
default smoke journey.

## Local run

The API workflow listens on port 8080. With that workflow running:

```sh
bash scripts/k6/run-local.sh
```

The default is one VU for 30 seconds. Results are written to
`artifacts/k6/smoke-summary.json`.

Authenticated smoke:

```sh
K6_TEST_EMAIL='synthetic@example.test' \
K6_TEST_PASSWORD='staging-only-password' \
bash -c 'pnpm --filter @workspace/api-server run seed:k6-fixture && bash scripts/k6/run-local.sh'
```

The fixture command is development-only and accepts only the reserved
`@example.test` or `@jobsage.test` domains. It upserts a verified synthetic
candidate with consent and a profile; it does not send email:

```sh
export K6_TEST_EMAIL='synthetic@example.test'
export K6_TEST_PASSWORD="$(openssl rand -base64 24)"
pnpm --filter @workspace/api-server run seed:k6-fixture
bash scripts/k6/run-local.sh
```

Opt in to the write-light eligibility call only with a synthetic profile:

```sh
K6_TEST_EMAIL='synthetic@example.test' \
K6_TEST_PASSWORD='staging-only-password' \
K6_RUN_ELIGIBILITY=true \
bash scripts/k6/run-local.sh
```

The runner refuses production and hosted preview domains. For a separately
provisioned staging service, use a non-production `STAGING_BASE_URL`; still
review the target manually before running:

```sh
STAGING_BASE_URL='http://staging.internal.example/api' \
K6_PROFILE=100 \
bash scripts/k6/run-local.sh
```

No production custom domain is accepted by the runner.

When the normal development API workflow is running its in-process vacancy
schedulers, use an isolated local API process for capacity tests so ingestion
does not compete with the user journey:

```sh
cd artifacts/api-server
NODE_ENV=production PORT=8082 pnpm exec tsx ./src/index.ts
```

This is still a local process using the development database. In this mode the
API expects external cron ownership and does not start the short vacancy
batches. Point `K6_BASE_URL` at `http://127.0.0.1:8082/api`.

## Profiles

`K6_PROFILE` supports:

| Profile | Shape | Intended use |
| --- | --- | --- |
| `smoke` | 1 VU for 30 seconds | Syntax and local health verification |
| `100` | Ramp to 100 VUs, hold, ramp down | Small staged test |
| `1000` | Ramp to 1,000 VUs, hold, ramp down | Capacity experiment after smoke |
| `10000` | Ramp to 10,000 VUs, hold, ramp down | Dedicated staging only |
| `100k` | 10-minute ramp to 100,000 VUs | Plan only; requires external load generators |
| `1m` | 60-minute ramp to 1,000,000 VUs | Plan only; cannot be certified by Replit preview tooling |

The VU count is concurrent virtual users, not registered users. One VU loops
through the journey and sleeps for one second, so convert any result to a
request-rate model before comparing it with real traffic.

## Thresholds

The default thresholds are:

- failed HTTP request rate below 1%;
- p95 latency below 1 second;
- p99 latency below 2.5 seconds; and
- check pass rate above 99%.

These are starting gates, not a product SLA. For 10,000 VUs and above, set
thresholds only after the target staging database and worker topology are
declared.

## Results from this workspace

On 23 September 2026, k6 was installed in the workspace and the script passed
static parsing and k6 inspection. The guarded local smoke ran against
`http://127.0.0.1:8080/api` with one VU for 30 seconds:

| Result | Value |
| --- | ---: |
| Completed iterations | 30 |
| HTTP requests | 60 |
| HTTP request failures | 0% |
| Checks | 60/60 passed |
| HTTP p95 | 3.87 ms |
| HTTP p99 threshold | Passed; maximum observed was 12.14 ms |

Raw output is saved at
`artifacts/k6/smoke-summary.json`. This was a local health/auth-bootstrap
smoke, not a production test. That initial run skipped authenticated
Opportunities and eligibility because no synthetic credentials were available;
unauthenticated `/auth/user` was still checked. The authenticated results from
the subsequent synthetic-fixture runs are recorded below.

### Authenticated local results

On 23 September 2026, a development-only synthetic candidate fixture was
created using the reserved `@example.test` domain. It was marked verified,
given a consent record and a non-customer profile, and never sent email.

The authenticated smoke against the isolated local API passed:

| Result | Value |
| --- | ---: |
| Completed iterations | 14 |
| HTTP requests | 71 |
| HTTP request failures | 0% |
| Checks | 71/71 passed |
| HTTP p95 | 346.47 ms |

The opt-in smoke with eligibility evaluation also passed:

| Result | Value |
| --- | ---: |
| Completed iterations | 18 |
| HTTP requests | 109 |
| HTTP request failures | 0% |
| Checks | 109/109 passed |
| HTTP p95 | 344.85 ms |

The 100-VU profile reached 100 VUs but did not meet the starting thresholds
on this single local API process:

| Result | Value |
| --- | ---: |
| Completed iterations | 35 |
| HTTP requests | 447 |
| HTTP request failures | 4.02% |
| Checks | 429/447 (95.97%) |
| HTTP p95 | 54.49 seconds |
| Maximum observed request time | 60.00 seconds |

The failure was primarily health-request timeouts and long request queues as
concurrency increased. This is a local capacity signal, not a production
capacity claim. It confirms that the next meaningful test requires a declared
staging topology with separate API capacity, database sizing, connection-pool
limits, and observability.

## What Replit can and cannot simulate

| Tier | Replit workspace can do | It cannot prove |
| --- | --- | --- |
| 100 | Run a local smoke and a small staged ramp | Production autoscale behavior or provider billing |
| 1,000 | Run a controlled staging ramp if the database is isolated | Long-term autoscale saturation or email/AI vendor quotas |
| 10,000 | Author and stage the profile; run only with dedicated capacity and approval | That the development database, preview proxy, or one API process can sustain it |
| 100,000 | Produce the ramp plan and identify infrastructure requirements | A credible full run from one Replit workspace |
| 1,000,000 | Produce an external-generator plan and capacity checklist | Full-scale execution, production safety, or a single-instance claim |

For 100,000 and 1,000,000 users, use distributed load generators outside the
application runtime, isolate the database, pre-seed synthetic accounts, cap
email delivery, mock or sandbox AI calls, and use a staging vacancy dataset.
Do not generate real vacancy ingestion traffic during an end-user load test.

## Cost/performance interpretation

- User-facing Opportunities requests should use cached or coalesced vacancy
  data; they must not increase vacancy crawler batch sizes.
- Eligibility evaluation is a rules/database path in the current API. AI
  features elsewhere are the main per-request cost risk and should be measured
  separately with synthetic prompts or a fixed mock.
- Vacancy ingestion has its own cadence and shared writer coordination. Track
  409 responses and lock wait time separately from user API latency.
- Replit Autoscale is a reasonable early-tier assumption in the pricing model,
  but it is not evidence for 100k or 1M concurrent virtual users.
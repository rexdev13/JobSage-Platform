# JOBSAGE Vacancy Collector: Rebuild Guide (for the Replit Agent)

This guide explains exactly how the free vacancy collector was built and measured, so it can be rebuilt (or ported) inside JOBSAGE.

**Fastest path:** the attached `jobsage-vacancy-collector.tar.gz` holds the complete working source. Uploading it to Replit and running `pnpm install && pnpm collect` reproduces the results. This guide explains *why* each part exists, so the agent can port it into `artifacts/api-server` without breaking the accuracy safeguards.

Measured result of one full run (2026-10-06): **32,981 live, deduplicated vacancies (20,067 UK) from 54 free, keyless sources** in about 13 minutes, using 1,728 HTTP requests. A random sample of 277 listings that could be checked against the live listing or the employer's ATS were all live with matching titles.

---

## 0. Stack

- Node.js 20+, TypeScript (ESM, `"type": "module"`), run with `tsx`.
- `better-sqlite3@^11.10.0` for storage. Version 13 segfaulted on Node 20. **In JOBSAGE, use the existing PostgreSQL**; the schema below ports directly.
- `fast-xml-parser` (NHS XML).
- Node's built-in `fetch`. No scraping libraries and no headless browsers.
- `vitest` for tests.

```
src/
  types.ts          adapter contract + types
  http.ts           polite HTTP client (robots, pacing, retries, caps)
  normalize.ts      validation, canonical URL, sector/country/sponsorship, fingerprint
  db.ts             schema, shared upsert/dedupe, liveness, circuit breaker
  pipeline.ts       runs sources, checkpoints, outcome classification
  sources.ts        source registry + per-host pacing
  adapters/nhsJobs.ts, teachingVacancies.ts, ats.ts, boards.ts
  verify.ts         precision sampling
  report.ts, query.ts, server.ts, cli.ts
config/ats-employers.json
public/index.html   dashboard
```

---

## 1. The adapter contract (the core idea)

An adapter only *fetches and maps*. It never writes to the DB and never decides visibility. Each adapter is an async generator that yields pages:

```ts
interface RawVacancy {
  externalId: string; title: string; employer: string; url: string; applyUrl?: string;
  locations: string[]; country?: string; remote?: boolean; salary?: string; employmentType?: string;
  sectorHint?: string; category?: string; postedAt?: string; closesAt?: string; description?: string;
}
interface Reject { reason: string; externalId?: string; title?: string }
interface AdapterPage {
  rows: RawVacancy[];
  rejects: Reject[];
  nextCursor: string | null;   // null === source fully exhausted
  reportedTotal?: number;      // what the source says it has (for coverage %)
}
interface SourceDef {
  id: string;                  // e.g. "nhs-jobs", "greenhouse:monzo"
  provider: string;            // e.g. "nhs_jobs", "greenhouse"
  sourceType: "job_board" | "company_site";
  boardName: string;
  employer?: string;           // fixed employer for ATS sources
  sectorHint?: string;         // e.g. "healthcare" for NHS
  parserVersion: string;
  allowedUrlHosts: string[];   // listing URLs must be on these hosts (suffix match)
  maxPagesPerRun: number;      // page cap so one source can't starve others
  maxAgeDaysWithoutClose?: number; // stale rule; default 90, ATS 365
  pages(ctx: { http: HttpClient; cursor: string | null }): AsyncGenerator<AdapterPage>;
}
```

Run outcomes. Every source run gets exactly one:
`success_with_listings | success_zero | partial | retryable_failure | permanent_block | needs_review | skipped_backoff`.

**Rule: a timeout, 403, robots block or exception must never be recorded as `success_zero`.** Only a fully exhausted, error-free sweep can say "zero vacancies".

---

## 2. Sources: exact endpoints and the quirks that matter

All are free, keyless and public. Each source's robots.txt was checked first.

### 2.1 NHS Jobs (about 12.1k, England and Wales)
- `GET https://www.jobs.nhs.uk/api/v1/search_xml?page={n}&limit=100&sort=publicationDateAsc`
- XML root `<nhsJobs>` with `<totalPages>`, `<totalResults>`, and repeated `<vacancyDetails>`. Each one has `id`, `reference`, `title`, `description`, `employer`, `type`, `salary`, `closeDate` (YYYY-MM-DD), `postDate`, `url`, and `<locations><location>…</location></locations>`.
- Parse with `fast-xml-parser` using `{ ignoreAttributes: true, parseTagValue: false, isArray: n => n === "vacancyDetails" || n === "location" }`.
- `externalId = reference || id`. `closesAt = closeDate + "T23:59:59Z"` (open until the end of the day). `postedAt = postDate.slice(0,23) + "Z"`. `country = "GB"`. `sectorHint = "healthcare"`.
- URLs come back as `beta.jobs.nhs.uk`. Canonicalize them to `www.jobs.nhs.uk`.
- **GOTCHA:** without `sort=`, the default ordering repeats rows across pages. In testing, 5 pages gave 500 rows but only 443 unique, and about 2,000 jobs were missed per full run. `sort=publicationDateAsc` is stable, and new adverts get appended at the end during a sweep. Coverage went from 82.9% to **99.8%**.
- Pacing: 400 ms per request. About 122 pages take about 90 s.

### 2.2 GOV.UK Teaching Vacancies (about 6.9k, England, Open Government Licence)
- List: `GET https://teaching-vacancies.service.gov.uk/api/v1/jobs.json?page={n}`. 100 per page. `meta.count` gives the total, and `links.next` gives the next page.
- Items are schema.org `JobPosting`: `title`, `url`, `datePosted`, `validThrough`, `description` (HTML), `employmentType`, `jobLocation[].address{addressLocality,addressRegion,postalCode}`, `hiringOrganization.name`, `baseSalary.value.value`.
- `externalId` = the URL path after `/jobs/` (the slug). There is no `identifier` field.
- **GOTCHA:** the list API's pagination is unordered. 7 pages gave 700 rows but only 497 unique, so about 1,280 jobs never appear in it. No sort or page-size parameter works. **Fix: reconcile against the sitemap.**
  1. Page through the list API and keep a `seen` set of slugs.
  2. `GET https://teaching-vacancies.service.gov.uk/sitemap.xml` (about 1.7 MB). Extract every `<loc>https://teaching-vacancies.service.gov.uk/jobs/{slug}</loc>`.
  3. For each slug not in `seen`, `GET https://teaching-vacancies.service.gov.uk/api/v1/jobs/{slug}.json`. It returns the same JobPosting shape, so the same mapper works. A 404/410 means the job was removed in between: record a `gone_before_fetch` reject. Any other error is thrown so the run shows as partial.
  4. Yield these in batches of 50, with the cursor set to `"fill"`. Cap at 3,000 per run.
- Coverage went from 81.4% to **99.9%**. Pacing is 250 ms. This source is the slowest part of a run, about 10 minutes, because of the roughly 1,280 detail fetches.

### 2.3 Employer ATS boards (company_site, first-party, about 9k from 49 employers)
All are public JSON endpoints with one request per employer:
- **Greenhouse:** `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`, returning `jobs[]` with `id`, `title`, `absolute_url`, `location.name`, `first_published`, `updated_at`, `content` (double-HTML-encoded), and `departments`.
  - **GOTCHA:** many employers' `absolute_url` is their own careers page with `?gh_jid={id}` (e.g. `https://stripe.com/jobs/search?gh_jid=123`). **Do not strip `gh_jid` during URL canonicalization.** Stripping it collapsed all of Stripe, Databricks, MongoDB, Elastic, Pinterest and others into a single vacancy each. Strip `gh_src`, `utm_*`, `ref`, `source`, `src`, `lever-source` and `lever-origin` only.
- **Lever:** `GET https://api.lever.co/v0/postings/{slug}?mode=json`, returning an array with `id`, `text` (title), `hostedUrl`, `applyUrl`, `createdAt` (ms), `country`, `workplaceType`, `categories{location, allLocations, commitment, team, department}`, `descriptionPlain`, `additionalPlain` and `salaryRange`. robots.txt sets Crawl-delay 1, so pace at 1000 ms.
- **Ashby:** `GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`, returning `jobs[]` with `id`, `title`, `jobUrl`, `applyUrl`, `location`, `secondaryLocations[]`, `isRemote`, `isListed`, `publishedAt`, `employmentType`, `department`, `team`, `descriptionPlain` and `compensation`. Reject `isListed === false` as `unlisted_posting`.
- Each employer is its own source (`greenhouse:monzo`), with `sourceType = "company_site"` and `employer` taken from config, never from the feed. `allowedUrlHosts = [ATS host, ...config domains]`.
- `maxAgeDaysWithoutClose = 365` for ATS. Being present in the employer's own live feed is liveness evidence, and evergreen roles stay open for a long time.
- Config file `config/ats-employers.json`. **Only add a slug after confirming the board belongs to that employer.** Current list:
  - greenhouse: monzo, deliveroo, wise, gocardless, cloudflare, stripe [stripe.com], gitlab, elastic [jobs.elastic.co], datadog [careers.datadoghq.com], mongodb [mongodb.com], airbnb [careers.airbnb.com], dropbox [jobs.dropbox.com], figma, twilio, okta [okta.com], thoughtworks [thoughtworks.com], duolingo [careers.duolingo.com], reddit, pinterest [pinterestcareers.com], robinhood, coinbase [coinbase.com], affirm, brex [brex.com], gusto, databricks [databricks.com], samsara [samsara.com], anthropic, discord, asana [asana.com], squarespace [squarespace.com], klaviyo [klaviyo.com], instacart [instacart.careers]
  - lever: palantir, spotify, zopa, matchgroup
  - ashby: ramp, notion, openai, linear, multiverse, synthesia, elevenlabs, cursor, perplexity, replit, supabase, benchling, wayve
  - Format: `{ "greenhouse": [{ "slug": "stripe", "employer": "Stripe", "domains": ["stripe.com"] }], "lever": [...], "ashby": [...] }`
  - To find a slug, open the employer's careers page, look for `boards.greenhouse.io/{slug}`, `jobs.lever.co/{slug}` or `jobs.ashbyhq.com/{slug}`, then confirm the API returns that company's jobs.

### 2.4 Remote and EU boards (page-capped samples)
- **Arbeitnow:** `GET https://www.arbeitnow.com/api/job-board-api?page={n}` returns `data[]` with `slug`, `company_name`, `title`, `description`, `remote`, `url`, `tags`, `job_types`, `location` and `created_at` (unix seconds), plus `links.next`. Allowed hosts: `arbeitnow.com/.co.uk/.de/.fr/.ch/.at/.nl/.es/.it`, because listings link to country domains. Cap at 20 pages and pace at **1500 ms**, since it returned HTTP 429 at about 1 request/second.
- **Jobicy:** `GET https://jobicy.com/api/v2/remote-jobs?count=100[&cursor=…]` returns `jobs[]` with `id`, `url`, `jobTitle`, `companyName`, `jobIndustry`, `jobType`, `jobGeo`, `pubDate` and salary fields. Cap at 10 pages.
- **Himalayas:** `GET https://himalayas.app/jobs/api?limit=20[&cursor=…]` returns `jobs[]` with `guid` (the listing URL), `title`, `companyName`, `applicationLink`, `locationRestrictions`, `pubDate` (s), `expiryDate` (s) and `description`, plus `nextCursor` and `totalCount` (about 119k). Cap at 100 pages and pace at 600 ms. **Its listing pages sit behind a Cloudflare challenge, so their accuracy can't be verified.** Report them as "unverifiable".

### 2.5 Deliberately NOT used
- **Remotive:** robots.txt `Disallow: /api/*`.
- **SmartRecruiters:** `api.smartrecruiters.com` robots disallows generic agents.
- **DWP Find a Job:** blocks automated access.
- Reed and Adzuna are free but need API keys. They can be added later if keys are acceptable.

---

## 3. Polite HTTP client (`http.ts`)

Every request goes through one `HttpClient`:
1. **HTTPS only.** Refuse anything else.
2. **robots.txt.** Fetch and cache once per host and parse only the `User-agent: *` group. Apply Disallow/Allow with `*` and `$` wildcards. The longest matching rule wins, and Allow wins ties. Honour `Crawl-delay`, capped at 10 s. A blocked URL throws `RobotsBlockedError`, which the pipeline maps to `permanent_block`.
3. **Per-host pacing.** Use a promise queue per host with a minimum interval: default 300 ms, overrides `api.lever.co`=1000, `www.jobs.nhs.uk`=400, `teaching-vacancies.service.gov.uk`=250, `www.arbeitnow.com`=1500, `himalayas.app`=600.
4. **Timeouts.** Use an AbortController, 30 s by default (NHS 45 s).
5. **Response cap.** Stream the body and abort past `maxBytes` (40 MB default, 512 KB for robots).
6. **Retries** for 429, 5xx, network errors and timeouts only. Use exponential backoff `min(30s, 500ms·2^attempt) × jitter(0.5–1.5)` and honour `Retry-After`. Default 3 retries.
7. **Identifying User-Agent,** e.g. `JobsageVacancyCollector/0.1 (+contact URL; respects robots.txt)`.

---

## 4. Normalization (`normalize.ts`): every row is accepted or rejected with a reason

Rules, in order:
1. `title`, `employer`: decode HTML entities and collapse whitespace. `employer` falls back to `source.employer`.
2. Reject with a reason: `missing_external_id`, `missing_title` (fewer than 3 characters), `missing_employer`, `non_role_title`, `invalid_url`, `url_host_not_allowed`, `closed_past_deadline`, `posted_in_future` (more than 2 days ahead), `stale_no_closing_date` (no close date and posted more than `maxAgeDaysWithoutClose` days ago).
   - `non_role_title` regex: `general application|speculative application|talent (pool|community|network)|expression of interest|register your interest|future opportunities|open application|join our talent|don't see (a|the) (role|job)`.
3. **Canonical URL:** force https, lowercase the host, map `beta.jobs.nhs.uk` to `www.jobs.nhs.uk`, drop the hash, remove tracking params (`utm_*`, `gh_src`, `ref`, `source`, `src`, `lever-source`, `lever-origin`), sort the remaining params, and strip the trailing slash. **Keep `gh_jid`.**
4. `applyUrl` is kept only if it is on an allowed host.
5. Dates are converted to ISO. Numbers of 10–13 digits are treated as unix s/ms.
6. **Country:** an explicit field wins. Otherwise UK patterns are checked: country names, the 21 largest UK cities, or a UK postcode regex `[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}`. Then a small country/city name map is used. Otherwise null.
7. **Sector:** deterministic, versioned rules (`sector-rules-v1`). A provider hint wins (NHS gives healthcare, Teaching Vacancies gives education). Then title regexes are tried in order: healthcare, education, technology, finance, sales_marketing, engineering, social_care, hospitality_retail, logistics, legal, admin_hr. Then the same rules are tried against the feed's category or department. Otherwise `unclassified`. The evidence is stored, e.g. `title:nurse`.
8. **Sponsorship** comes from **this vacancy's text only**. Negative phrases are checked first ("unable to offer sponsorship", "no visa sponsorship", "must have the right to work", …), then positive ones ("visa sponsorship available", "certificate of sponsorship", "skilled worker visa", …). The result is `offered`, `not_offered` or `unknown`, with an evidence snippet of about 200 characters. **Never infer sponsorship from the employer being on the sponsor register.**
9. `fingerprint = sha1(normKey(employer) | normKey(title) | normKey(first part of location))`. `normKey` lowercases, strips accents, removes ltd/limited/plc/inc/gmbh/the/nhs trust/foundation trust, and collapses non-alphanumeric characters.
10. `rawHash = sha1([title, employer, canonicalUrl, locations, salary, closesAt, description.length])` is used for change detection.

---

## 5. Storage and dedupe (`db.ts`)

Four tables. The column names below port directly to Postgres:

```sql
CREATE TABLE sources (id TEXT PRIMARY KEY, provider TEXT, source_type TEXT, board_name TEXT, employer TEXT,
  sector_hint TEXT, parser_version TEXT, cursor TEXT, sweep_started_at TEXT, last_run_at TEXT,
  last_success_at TEXT, last_exhausted_at TEXT, last_outcome TEXT, last_error TEXT, reported_total INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT);

CREATE TABLE source_runs (id SERIAL PK, source_id TEXT REFERENCES sources, started_at, finished_at, outcome,
  exhausted BOOL, pages, requests, raw_count, accepted, rejected, new_vacancies, updated,
  merged_cross_source, marked_missing, reported_total, reject_reasons JSON, error TEXT);

CREATE TABLE vacancies (id SERIAL PK, fingerprint TEXT NOT NULL /* NOT unique */, title, employer, location,
  locations JSON, country, remote BOOL, salary, employment_type, sector, sector_evidence, classifier_version,
  sponsorship DEFAULT 'unknown', sponsorship_evidence, posted_at, closes_at, best_url, apply_url,
  best_source_type, best_provider, first_seen_at, last_seen_at, liveness DEFAULT 'live',
  link_status, link_checked_at);
CREATE INDEX ON vacancies(fingerprint); CREATE INDEX ON vacancies(liveness, last_seen_at);

CREATE TABLE observations (id SERIAL PK, vacancy_id REFERENCES vacancies, source_id REFERENCES sources,
  provider, source_type, board_name, external_id, url, canonical_url, apply_url, raw_hash, parser_version,
  first_seen_at, last_seen_at, missing_since, UNIQUE(source_id, external_id));
CREATE INDEX ON observations(canonical_url); CREATE INDEX ON observations(vacancy_id);
```

`vacancies` holds one canonical row per real job. `observations` holds one row per sighting on each source, which preserves provenance.

**Shared upsert.** It runs in one transaction per page. For each normalized row:
1. Look for an observation with the same `(source_id, external_id)`. If found, it's the same vacancy: update it.
2. Otherwise, look for an observation with the same `canonical_url` **whose vacancy has no observation from this same source**.
3. Otherwise, look for a vacancy with the same `fingerprint` **that has no observation from this same source**.
4. If 2 or 3 matched, it's a cross-source merge: update that vacancy. Otherwise insert a new vacancy.
5. Insert or update the observation, set `last_seen_at = now`, and set `missing_since = NULL`.

**Why the "not from the same source" guard:** two different listings from the same source with the same employer, title and town (e.g. two "Teaching Assistant" posts at one school) are different jobs. Without the guard, about 1,100 Teaching Vacancies jobs were wrongly merged. The fingerprint column must therefore **not** be UNIQUE.

Update rules when merging:
- Prefer the **company_site** URL and provider as `best_url` over job boards.
- Keep the existing sector unless it was unclassified or the new evidence is a provider hint.
- Only overwrite sponsorship when the new value isn't `unknown`.
- Use `posted_at = COALESCE(old, new)` and `closes_at = COALESCE(new, old)`.

**Timestamps** must be strictly increasing with millisecond precision. Second-level timestamps broke "missing" detection, because old and new sightings shared the same second.

**Missing detection:** only after a **fully exhausted** sweep, set `missing_since = now` on observations of that source with `last_seen_at < sweep_started_at`. Vacancies with no remaining non-missing observation get `liveness = 'missing'`. Partial or failed runs never mark anything missing.

**Closing:** after each run, `liveness = 'closed'` where `closes_at <= now`.

**Circuit breaker:** after a failed outcome, `consecutive_failures++` and `next_retry_at = now + min(24h, 15min × 2^(failures-1))`. A `permanent_block` waits 24 h. Success resets the counter. A run starting before `next_retry_at` returns `skipped_backoff` (unless forced).

**Candidate-visible rule.** This is the only definition of "show to candidates":
```sql
v.liveness = 'live'
AND v.last_seen_at >= now() - interval '48 hours'
AND (v.closes_at IS NULL OR v.closes_at > now())
AND v.best_url IS NOT NULL
AND COALESCE(v.link_status,'') <> 'dead'
```

---

## 6. Pipeline (`pipeline.ts`)

For each source, with bounded concurrency (8 workers; per-host pacing still applies):
1. Register or update the source row and load `cursor`, `sweep_started_at` and `next_retry_at`.
2. Skip with `skipped_backoff` if the circuit is open.
3. `sweepStartedAt` = the saved value if resuming from a cursor, otherwise now.
4. Iterate `adapter.pages({ http, cursor })`. For each page: normalize, count reject reasons, run the shared upsert, then **save the cursor after every page** so an interrupted run resumes.
5. Stop at `nextCursor === null` (exhausted) or at `maxPagesPerRun`. Hitting the cap gives `partial`, and the next run resumes from the cursor.
6. Outcome:
   - Exhausted with listings: `success_with_listings`.
   - Exhausted with nothing: `success_zero`.
   - Page cap reached: `partial`.
   - Exception after at least one page: `partial`.
   - Exception before any page: classify the error.
     - Robots block, 401, 403 or 451: `permanent_block`.
     - 404 or 410 (e.g. a dead ATS slug): `needs_review`.
     - 429, 5xx or timeout: `retryable_failure`.
7. Record the `source_runs` row with all counters, plus `reported_total` for coverage %.

---

## 7. Measuring accuracy (`verify.ts`): don't trust the counts, sample them

`pnpm verify --per-provider 40` picks random candidate-visible vacancies for each provider and checks each one:
- **ATS-sourced vacancies:** re-check against the employer's live ATS record, because their careers pages render the title with JavaScript, so it isn't in the HTML.
  - Greenhouse: `GET boards-api.greenhouse.io/v1/boards/{slug}/jobs/{id}`.
  - Lever: `GET api.lever.co/v0/postings/{slug}/{id}?mode=json`.
  - Ashby: fetch the board once per run and look up the id.
  - 404 or absent means `dead`. Present with at least 60% of the stored title's words means `verified`, otherwise `title_mismatch`.
- **Other sources:** fetch the listing page.
  - 404/410 means `dead`.
  - 401/403 or a robots block means `blocked` (unverifiable, e.g. Cloudflare). This is excluded from precision, not counted as wrong.
  - Closure text ("no longer accepting applications", "vacancy has closed", "job has expired", …) means `closed`.
  - Otherwise compare title words against the page text (entity-decoded, punctuation-insensitive).
- Store `link_status` and `link_checked_at`. Vacancies found `closed` or `dead` are hidden immediately.
- Precision = verified ÷ (checked − blocked − error).

Last run: Ashby 40/40, Greenhouse 40/40, Lever 40/40, NHS 40/40, Teaching Vacancies 40/40, Jobicy 40/40, Arbeitnow 37/37 (3 blocked), Himalayas 0 checkable (Cloudflare).

---

## 8. Reporting, API and dashboard

- `pnpm report` shows the totals:
  - visible, UK, observations, multi-source merges, missing, closed, dead, and sponsorship offered.
  - Outcome counts, and visible counts and precision by provider.
  - Counts by sector and by country.
  - A per-source line: visible vs `reported_total` (coverage %), reject reasons, and last error.
- `pnpm export --country GB` writes a CSV of candidate-visible vacancies.
- `pnpm serve` (port 3000) serves:
  - `GET /api/vacancies?q=&country=&sector=&provider=&sourceType=&sponsorship=&remote=1&limit=&offset=`
  - `GET /api/vacancies.csv?...`
  - `GET /api/report`
  - a static dashboard at `/`.
- All reads come from the DB. **Never crawl during a candidate request.**

---

## 9. Scheduling (free)

Run `collect` every 3–6 hours using a Replit Scheduled Deployment, GitHub Actions cron or any cron. Each run refreshes `last_seen_at`. Jobs not seen for 48 h, or missing from a completed sweep, disappear from candidate views automatically.

---

## 10. Porting into JOBSAGE (do this, not a parallel system)

1. **Read the real code first:** `artifacts/api-server/src/lib/boardVacancyPipeline.ts`, the existing NHS/Reed board adapters, the company-site connectors (Ashby, Greenhouse, Lever, SmartRecruiters, Recruitee, Personio, Pinpoint, Workday), the liveness fields and the candidate-visibility SQL. Reuse them. Don't create new tables if equivalents exist.
2. Wrap each adapter here as a JOBSAGE `BoardAdapter`, or as a company-site connector, that feeds the **existing shared upsert** in `boardVacancyPipeline.ts`. Don't write one-off SQL.
3. Field mapping:
   - `provider` → `board_name`
   - `sourceType` → `source_type`
   - `externalId` → the board's external ID column
   - `canonicalUrl` → `source_url`
   - `closesAt`, `postedAt` and liveness → the existing liveness/verification columns
   - `sponsorship` and its evidence → vacancy-level sponsorship fields only
4. Port the four fixes that actually mattered, even if JOBSAGE already has the adapter:
   1. NHS `sort=publicationDateAsc`
   2. Teaching Vacancies sitemap reconciliation
   3. keep `gh_jid` in Greenhouse URLs
   4. URL/fingerprint merges are cross-source only
5. Keep the outcome classification (timeout ≠ zero), cursor checkpoints, page caps, robots/pacing/retry, and the circuit breaker. Don't weaken existing SSRF, DNS, redirect or size protections.
6. Run collection only from the protected internal cron endpoint (e.g. `/api/internal/vacancy-jobs`) as bounded job kinds.
7. Keep candidate visibility stricter than discovery. Apply, Smart Apply and Send CV must use only verified URLs and recipients. **Never guess employer emails, and never auto-submit forms.**

---

## 11. Acceptance tests to write (all 29 exist in the tarball under `test/`)

- Each adapter's mapper produces the expected `RawVacancy` from a sample payload. Empty NHS XML returns 0 rows.
- Normalization: closed, stale, non-role, bad host, bad URL and missing employer rows are rejected with the right reason. Apply URLs on other hosts are dropped. The fingerprint is stable across sources. Canonicalization keeps `gh_jid` and strips `gh_src`/`utm_*`. Country, sector and sponsorship detection work. Double-encoded HTML is stripped.
- Pipeline:
  - The same job on two sources gives 1 vacancy with 2 observations, and the company_site URL is preferred.
  - Two same-titled jobs from one source give 2 vacancies.
  - A thrown error is never recorded as `success_zero`.
  - A cursor is saved and the next run resumes from it.
  - Repeated failures open the circuit (`skipped_backoff`).
  - Rows are marked missing only after an exhausted sweep.
  - Reject reasons are persisted.
- Robots: longest match wins, and Allow wins ties.
- Verify: title matching ignores punctuation and entities.

---

## 12. Prompt you can paste to the Replit Agent

> Read `JOBSAGE-vacancy-collector-rebuild-guide.md` and the attached `jobsage-vacancy-collector.tar.gz`. Port the free vacancy sources (NHS Jobs, Teaching Vacancies with sitemap reconciliation, Greenhouse/Lever/Ashby employer boards from `config/ats-employers.json`, Arbeitnow, Jobicy, Himalayas) into JOBSAGE's existing `boardVacancyPipeline.ts` and company-site connectors. Reuse the existing shared upsert, liveness and candidate-visibility rules rather than creating a parallel store. Preserve:
> - the run-outcome classification (a timeout is never "zero vacancies")
> - per-page cursor checkpoints
> - page caps, robots.txt, per-host pacing, retries and the circuit breaker
> - cross-source-only dedupe
> - keeping `gh_jid` in Greenhouse URLs
> - NHS `sort=publicationDateAsc`
>
> Run collection only from the protected internal cron endpoint. Add the tests in section 11. Then run a full collection and the precision sample, and report visible counts per source vs reported totals, plus sampled precision per provider.

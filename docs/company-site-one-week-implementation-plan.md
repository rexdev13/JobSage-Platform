# JOBSAGE Company-Site Vacancy Coverage

## One-Week Code-Level Implementation Plan

Prepared from the production investigation and current repository trace.

No implementation, migration, dependency, workflow, or infrastructure changes were made while preparing this plan.

## Executive decision

Do not increase the company-site HTTP batch above 10 yet.

The safest launch path is:

1. Instrument completed versus partial company crawls.
2. Improve vacancy-evidence validation and remove false positives.
3. Add source-aware freshness and consistent candidate visibility.
4. Add targeted BambooHR support.
5. Increase external invocation frequency while keeping batches at 10.
6. Drain the backlog and measure whether larger batches are necessary.

This preserves the existing HTTP crawler, robots policy, SSRF controls, host pacing, URL validation, and verification pipeline.

---

# Part 1 — Exact code trace

## 1. `companySiteDiscovery.ts`

### Current behavior

Main functions:

- `discoverCompanySiteVacancies()`
- `extractJsonLdAdverts()`
- `advertsFromLinks()`
- `selectNavigationLinks()`
- `extractSitemapLinks()`
- `persistCompanySiteVacancies()`

The discovery order is:

1. Normalize the sponsor website.
2. Establish a deadline: the earlier of the caller deadline or 25 seconds.
3. Queue the homepage.
4. If the stored careers URL is already a recognised ATS URL, queue it after the homepage.
5. Fetch each queued URL sequentially, with at most six visited pages.
6. For HTML:
   - Extract allowed anchors.
   - Extract JSON-LD `JobPosting` records.
   - Convert qualifying anchors into adverts.
   - Select careers, ATS, or pagination links for further navigation.
7. If ordinary navigation finishes with no adverts, queue `/sitemap.xml`.
8. Normalize and deduplicate adverts.
9. Return at most 12 adverts.

Ordinary anchor adverts currently require:

- A valid deep URL.
- A vacancy signal such as `job`, `vacancy`, `position`, `role`, `opportunity`, `opening`, or `apply` in the link text or URL path.

### Contribution to the launch problem

- Provider recognition is host-suffix detection, not a true ATS adapter system.
- A six-page exit does not explicitly mark the observation as partial.
- Direct links without vacancy signals can be rejected even when they appear in a genuine vacancy list.
- Weak signals such as “role” or “apply” can allow news and generic application pages to become adverts.
- The result does not contain rejected-advert counts or reason buckets.
- The result cannot distinguish:
  - Complete empty source.
  - Partial source.
  - Page limit reached.
  - Deadline reached.
  - Provider detected but listing not parsed.

### Required modification

Modify `discoverCompanySiteVacancies()` and its result type to return:

```ts
type CompanySiteDiscoveryCompletion =
  | "complete"
  | "partial_page_limit"
  | "partial_deadline"
  | "failed";

type CompanySiteDiscoveryResult = {
  // existing fields
  completion: CompanySiteDiscoveryCompletion;
  pagesAttempted: number;
  pagesFetched: number;
  advertsExtracted: number;
  advertsRejected: number;
  rejectionReasons: Record<string, number>;
  discoveredUrls: string[];
};
```

Pass page context into anchor extraction:

```ts
advertsFromLinks(
  links,
  organisationName,
  listingPageProvider,
  listingPageUrl,
  {
    isConfirmedCareersPage,
    pageHasJobPostingData,
    pageHasVacancyListEvidence,
  },
);
```

**Status: Required.**

## 2. `companySiteHttp.ts`

### Current behavior

Main functions:

- `knownAtsProvider()`
- `isAllowedCompanyDestination()`
- `fetchCompanySitePage()`
- `robotsPolicy()`
- `fetchWithoutRobots()`
- `reserveHost()`
- `completeHost()`
- `failHost()`

Protections include:

- Public-DNS validation and pinned DNS resolution.
- Private-IP rejection.
- Robots checks and caching.
- Three redirects maximum.
- Redirect destination validation.
- Nine-second page timeout.
- 25-second employer budget supplied by discovery.
- One-megabyte page limit.
- Database-backed host leases and backoff.
- 1.75-second same-host pacing.

Recognised ATS hosts:

1. Greenhouse
2. Lever
3. Workday
4. SmartRecruiters
5. Oracle Recruiting
6. Taleo
7. Pinpoint
8. SAP SuccessFactors
9. Ashby

### Contribution to the launch problem

`isAllowedCompanyDestination()` permits the employer domain, its parent/subdomains, and recognised ATS domains.

Because BambooHR is not recognised, the following Hopscotch link is discarded before navigation:

```text
https://hopscotch.bamboohr.com/careers
```

The DNS error path also groups several DNS and network outcomes under “non-public hostname,” making failure analysis less precise.

### Required modification

Replace the private ATS array with a central typed registry:

```ts
type AtsProviderDefinition = {
  name: string;
  hostSuffixes: string[];
  postingUrl: (url: URL) => boolean;
};

const ATS_PROVIDERS: AtsProviderDefinition[] = [
  // existing providers
  {
    name: "BambooHR",
    hostSuffixes: ["bamboohr.com"],
    postingUrl: isBambooHrPostingUrl,
  },
];
```

`knownAtsProvider()` and `isAllowedCompanyDestination()` should consume this registry. Do not add a broad arbitrary external-domain exception.

Improve DNS failures so they distinguish:

- DNS not found.
- DNS timeout.
- Private/non-public result.
- Network request failure.

**Status:**

- BambooHR registry entry: Required.
- Error taxonomy: Required for instrumentation.
- Broad unknown-ATS allowlist: Optional and not recommended before launch.

## 3. `companySiteVerification.ts`

### Current behavior

`verifyCompanySiteStoredLink()`:

- Rejects invalid or blocked URLs.
- Marks unsafe, 404, and 410 responses dead.
- Detects soft-not-found pages.
- Detects known expiration phrases.
- Rejects login redirects.
- Marks other successful pages live.
- Treats robots, rate limits, timeouts, and network failures as inconclusive.

### Contribution to the launch problem

An HTTP 200 page is marked live unless a negative check fires. This permits:

- An old archived listing whose URL still returns 200.
- A corporate news article.
- A generic application form.
- A listing missing from the employer’s current vacancy index.

The verifier proves URL accessibility, not current source membership.

### Required modification

Keep URL verification, but stop treating it as the only candidate-visibility proof.

```ts
type CompanySiteVerificationResult = {
  outcome: "live" | "dead" | "inconclusive";
  httpAccessible: boolean;
  specificVacancyEvidence: boolean;
  reason: string | null;
};
```

A company vacancy becomes candidate-visible only when:

1. It has specific vacancy evidence.
2. It was observed in a completed source crawl.
3. Its URL verification is recent and live.
4. It is not marked missing from the source.

**Status: Required.**

## 4. `companySiteScheduler.ts`

### Current behavior

Main functions:

- `selectCompanySiteBatch()`
- `runCompanySiteCheck()`
- `runCompanySiteDiscoveryBatch()`
- `startCompanySiteDiscoveryScheduler()`

Constants:

```ts
COMPANY_SITE_DISCOVERY_BATCH_SIZE = 100
COMPANY_SITE_DISCOVERY_CONCURRENCY = 8
COMPANY_SITE_GENERIC_TTL_MS = 48 hours
COMPANY_SITE_ATS_TTL_MS = 24 hours
COMPANY_SITE_BATCH_WRITE_RESERVE_MS = 3 seconds
```

Production does not use the internal hourly scheduler. Production invokes this path through the HTTP job endpoint.

Selection:

- Requires a non-empty website.
- Excludes rows whose `retry_after` remains in the future.
- Selects never-checked or expired generic checks.
- Selects due ATS checks for recognised ATS records.
- Reserves 25% of capacity for bookmarked companies.
- Rotates unbookmarked companies across eight sectors.
- Orders never-checked companies ahead of previously checked companies.
- Fills unused priority capacity with oldest eligible rows.

The selection query does not claim rows with `FOR UPDATE` or a row lease. Global serialization is supplied by `vacancyJobRunner.ts`.

Batch execution:

- Requests `batchSize + 1` candidates.
- Processes only `batchSize`.
- Uses eight workers.
- Stops assigning work when the shared deadline is reached.
- Calculates:

```ts
remaining =
  errors +
  deferred +
  (hasMore ? 1 : 0);

done = remaining === 0;
```

`remaining` is a lower bound when the extra candidate proves more work exists.

### Contribution to the launch problem

- The production HTTP route limits each invocation to 10.
- Partial discovery can advance some check timestamps.
- A thrown exception is counted but does not persist employer retry state.
- Logs do not distinguish completed, partial, empty, and failed companies.
- Completed crawls do not reconcile previously stored vacancies that disappear.

### Required modification

Update `runCompanySiteCheck()` to:

1. Return complete, partial, or failed state.
2. Persist `lastAttemptedAt` for every attempt.
3. Advance the completed timestamp only for a genuinely complete observation.
4. Store retry metadata for thrown exceptions.
5. Reconcile missing vacancies only after a completed, non-transient observation.
6. Return rejected, inserted, updated, revived, and source-empty counts.

Update `runCompanySiteDiscoveryBatch()` to aggregate:

```ts
{
  selected,
  attempted,
  completed,
  partial,
  failed,
  empty,
  careersFound,
  atsFound,
  pagesFetched,
  advertsExtracted,
  advertsRejected,
  inserted,
  updated,
  revived,
  done,
  remaining
}
```

**Status: Required.**

## 5. `vacancyJobRunner.ts`

### Current behavior

Main functions:

- `withPipelineWriter()`
- `runVacancyJob()`

It uses a PostgreSQL session advisory lock:

```ts
PIPELINE_WRITER_LOCK =
  "jobsage:external-vacancy-pipeline-writer";
```

The lock serializes job-board, company-site, liveness, and contact-enrichment batches.

Company-site calls receive a 20-second HTTP budget. `companySiteScheduler.ts` subtracts three seconds for final writes, leaving approximately 17 seconds for assigning crawl work.

### Contribution to the launch problem

- Only one vacancy writer job can run at a time.
- Frequent company calls can collide with job-board or liveness work.
- The lock is safe, but the caller must retry HTTP 409 responses.
- The summary lacks completed, partial, and empty counters.

### Required modification

Keep the writer lock.

Extend `VacancyJobSummary`:

```ts
type VacancyJobSummary = {
  // existing fields
  metrics?: VacancyJobMetrics;
};
```

Do not extend the 20-second HTTP budget until production measurements demonstrate that it is inadequate.

**Status:**

- Summary metrics: Required.
- Writer-lock redesign: Not required.
- Longer HTTP budget: Optional and not justified yet.

## 6. `internalVacancyJobs.ts`

### Current behavior

The endpoint is:

```text
POST /internal/vacancy-jobs
```

It:

- Requires `VACANCY_JOB_SECRET`.
- Requires the AI web-search cap to remain disabled.
- Validates job kind and requested limit.
- Caps company-site requests at 10.
- Returns HTTP 409 when the global writer lock is held.
- Returns HTTP 500 with `done: false` on an unhandled error.

Exact cap:

```ts
DEFAULT_COMPANY_SITE_HTTP_BATCH_SIZE = 10;
```

`getCompanySiteHttpBatchSize()` only accepts configured values from 1 to 10.

### Required modification

For the first launch iteration:

- Keep the cap at 10.
- Return retry guidance with HTTP 409:

```http
Retry-After: 30
```

- Include the richer job summary.
- Ensure the external scheduler treats 409 as retryable.

After instrumentation, a later change may allow a configured maximum above 10.

**Status:**

- Retryable 409 contract: Required.
- Immediate batch-size increase: Not required.

## 7. `boardVacancyPipeline.ts`

### Current behavior

Main functions:

- `normaliseAndDedupeBoardAdverts()`
- `upsertSharedBoardVacancies()`
- `persistScrapedAdvertContacts()`
- `discoverEmployerBoardVacancies()`

The normalizer silently rejects adverts for reasons including:

- Manual-labour title.
- Invalid canonical URL.
- Missing source classification.
- Invalid source-specific deep link.
- Duplicate URL.
- Duplicate employer/title/location fingerprint.

The upsert:

- Takes transaction-scoped advisory locks for URL, fingerprint, and external listing ID.
- Matches existing rows by URL, source/fingerprint, or external ID.
- Inserts new rows as unverified.
- Updates `lastDiscoveredAt` on rediscovery.
- Queues link verification only after commit.

### Contribution to the launch problem

- Rejection reasons are invisible.
- Updated existing rows are not counted separately.
- Company-site rows have no “missing from latest completed source observation” field.
- The generic pipeline accepts company adverts without a strong company-vacancy evidence type.

### Required modification

Change normalization to return stats:

```ts
type NormalisationResult = {
  adverts: BoardAdvert[];
  rejected: number;
  rejectedByReason: Record<string, number>;
  deduplicated: number;
};
```

Add explicit evidence to company adverts:

```ts
type CompanyVacancyEvidence =
  | { kind: "json_ld_job_posting" }
  | { kind: "known_ats_posting"; provider: string }
  | { kind: "careers_listing_link"; listingUrl: string }
  | { kind: "structured_job_card"; listingUrl: string };

interface BoardAdvert {
  // existing fields
  companyVacancyEvidence?: CompanyVacancyEvidence;
}
```

Require this evidence when `sourceType === "company_site"`.

Return:

```ts
{
  inserted,
  updated,
  revived,
  rejected
}
```

**Status: Required.**

## 8. Sponsor and vacancy schema

Relevant schema:

- `sponsorLicenceCompanySiteChecksTable`
- `sponsorLicenceVacanciesTable`
- `vacancySyncLogTable`
- `companySiteHostStatesTable`

Existing vacancy state:

- `sourceType`
- `lastDiscoveredAt`
- `liveness`
- `lastVerifiedAt`
- `livenessReason`

Existing liveness values:

- `unverified`
- `live`
- `dead`

### Contribution to the launch problem

The schema cannot explicitly represent:

- Latest attempt.
- Latest completed source observation.
- Partial observation.
- Vacancy missing from source.
- Repeated source absence.
- Batch-level source metrics.

### Planned schema modification

When implementation begins, use one small additive schema release containing:

For company checks:

```ts
lastAttemptedAt
lastCompletedAt
lastPartialAt
lastOutcome
lastPagesFetched
lastAdvertsFound
lastRejectedCount
```

For company vacancies:

```ts
sourceMissingSince
sourceMissingObservations
```

For `vacancy_sync_log`:

```ts
jobKind
metrics // JSONB
```

Do not add `stale` to the persisted liveness enum. Treat stale as a derived candidate-visibility state.

**Status: Required for durable freshness and daily metrics.**

No migration was created during this planning stage.

## 9. Source classification

Relevant function:

- `classifyVacancySource()` in `vacancySource.ts`

### Current behavior

- Recognised job-board deep links become `job_board`.
- Valid non-board deep links become `company_site`.
- Invalid or generic URLs are unclassified.

Company discovery also explicitly assigns `sourceType: "company_site"`.

### Required modification

No broad classification change is needed.

BambooHR remains a company-site source. Its provider identity should live in company-vacancy evidence rather than changing its source to `job_board`.

**Status: No required change, apart from tests.**

## 10. Candidate-facing filtering

Relevant code:

- `vacancyLiveness.ts`
- `sponsorVacancyRoles.ts`
- `routes/sponsorLicences.ts`
- Other consumers of `getVacancyLinkStatus()` and `fetchSponsorVacanciesAsRoles()`

### Current behavior

- Company-site rows must be `live` before role aggregation exposes them.
- Some paths require a recently verified, specific link.
- Other aggregation paths exclude only `dead`, permitting stale live rows.
- `lastDiscoveredAt` does not affect visibility.
- Company vacancies missing from a later source crawl remain live until URL verification positively kills them.

### Required modification

Create one central candidate predicate in `vacancyLiveness.ts`:

```ts
getCandidateVacancyStatus({
  sourceType,
  liveness,
  lastVerifiedAt,
  lastDiscoveredAt,
  sourceMissingSince,
  sourceMissingObservations,
}): "visible" | "stale" | "missing" | "dead" | "unverified";
```

Use it consistently in:

- Sponsor-company vacancy details.
- Sponsor vacancy role aggregation.
- Opportunity counts.
- Matches.
- Alerts.
- Application-opening checks.

**Status: Required.**

---

# Part 2 — Company-site throughput

## Current measured throughput

Observed production window:

- First company batch: 06:17 UTC.
- Last observed start: 09:36 UTC.
- 52 starts.
- 50 completed responses available in the log window.
- 500 companies selected.
- 500 checked.
- Zero batch-level errors.
- Every completed batch returned `done=false`.
- Average completed batch duration: approximately 7.6 seconds.
- Maximum observed duration: approximately 16.1 seconds.
- Median interval between starts: approximately four minutes.
- Mean interval: approximately 3.9 minutes.

Observed sustained capacity:

```text
~10 companies every 3.9 minutes
≈ 151 companies/hour
≈ 3,600 companies/day
```

At this cadence, the 3,762 currently unchecked organisations could receive a first check in roughly 25 hours.

Every website also becomes due again after 48 hours:

```text
6,844 / 48 hours ≈ 143 recurring checks/hour
```

The observed capacity is only slightly above this steady-state requirement. This explains why the queue continuously reports `done=false` and has little catch-up headroom.

## Actual throughput bottleneck

The strongest measured limit is:

> External invocation frequency multiplied by the route’s fixed maximum of 10.

Database writes are not the demonstrated bottleneck:

- Batch-level errors were zero.
- Adverts are usually zero.
- Writes are small and transactionally bounded.

The 20-second boundary is not currently the ordinary batch bottleneck:

- Average batch duration was 7.6 seconds.
- Maximum observed duration was 16.1 seconds.

Larger batches are not automatically safe:

- Only eight employers run concurrently.
- The work-assignment deadline is approximately 17 seconds.
- A single employer can consume up to nine seconds per page.
- A slow first wave can prevent later rows from starting.
- Unstarted rows become deferred rather than lost.

## Can 25, 50, or 100 be accepted safely?

Internally, `runCompanySiteDiscoveryBatch()` accepts up to 100. The production route caps the effective limit at 10.

If that cap were raised:

- 25 requires up to four worker waves.
- 50 requires up to seven worker waves.
- 100 requires up to thirteen worker waves.

Those waves cannot reliably complete inside 17 seconds when pages are slow. Large selections would often increase `deferred`, not completed throughput.

## Smallest safe throughput change

Keep `limit=10`, and change external scheduling to:

1. Invoke company-site work every two minutes while `done=false`.
2. Retry HTTP 409 after 20–40 seconds with jitter.
3. Do not run overlapping manual company batches.
4. Slow to maintenance cadence when `done=true`.
5. Continue interleaving liveness and job-board work.

At one successful call every two minutes:

```text
10 × 30 calls/hour = 300 companies/hour
```

One 6,844-site cycle would take approximately 23 hours, leaving room for retries and fresh 48-hour checks.

Only consider increasing the batch to 16 after instrumentation proves:

- At least 95% of 10-company batches finish below 10 seconds.
- Deferred companies remain near zero.
- 409 rates remain acceptable.
- Database and host-lease contention remain low.

---

# Part 3 — External scheduler

## Exact request path

```text
External scheduler
    ↓
POST /internal/vacancy-jobs
    ↓
authentication and kind/limit validation
    ↓
runVacancyJob()
    ↓
pg_try_advisory_lock(global vacancy writer)
    ↓
runCompanySiteDiscoveryBatch()
    ↓
select batchSize + 1
    ↓
process up to batchSize with 8 workers
    ↓
return summary
    ↓
release advisory lock
```

## Expected and actual frequency

Production frequency is not encoded in this repository. Production intentionally disables in-process vacancy schedulers and delegates scheduling to an external HTTP system.

The non-production company scheduler is hourly at minute 17, but this is not the production schedule.

The observed production company-site median interval was approximately four minutes, with intervals ranging from roughly two to nine minutes.

## Request timeouts

- Company job budget in `vacancyJobRunner.ts`: 20 seconds.
- Scheduler write reserve: 3 seconds.
- Effective worker-assignment window: approximately 17 seconds.
- Employer budget: the earlier of 25 seconds or the shared batch deadline.
- Page timeout: up to nine seconds.

## Lock and HTTP 409 behavior

The global PostgreSQL advisory lock serializes every vacancy writer job.

If another job owns the lock, the endpoint returns HTTP 409.

HTTP 409 is retryable. It means another batch owns the shared writer lock; it is not an employer failure and must not consume an employer retry attempt.

## Interruption and lost-work behavior

A request can be interrupted by a client timeout, deployment interruption, or process termination.

Normal client disconnection does not automatically cancel the promise. Work can continue while the process remains alive.

If the process terminates:

- Committed vacancy transactions remain committed.
- Completed company-check writes remain committed.
- Selected but unstarted employers remain eligible.
- There is no row claim to strand.
- Transactions interrupted before commit roll back.
- A vacancy could commit before its check metadata if termination occurs between those writes, but the next run rediscoveries and deduplicates it.

Work is retryable and generally not lost, although vacancy persistence and check-state persistence should eventually be made per-employer atomic.

## Minimum launch-safe scheduler change

1. Keep batch size 10.
2. Invoke company-site work every two minutes while the backlog remains.
3. Treat 409 as retryable.
4. Add retry jitter.
5. Alert on:
   - Five consecutive 409 responses.
   - No successful company batch for 15 minutes.
   - Batch p95 above 17 seconds.
   - Partial or deferred rate above 5%.
6. Reassess batch size after one day of metrics.

A separate worker is not required for the immediate launch target.

---

# Part 4 — Named discovery cases

## 411 Communications

Stored state:

- Careers URL recorded.
- Last generic check: 10 September 2026.
- No error.
- Zero company-site rows.
- Current source inspected on 18 September 2026.

Current vacancy:

```text
https://www.fouroneone.co.uk/jobs/freelance-content-creator
```

The URL contains `/jobs/`, so today’s `advertsFromLinks()` logic would accept it if the careers page were fetched.

The evidence does not prove a current parser failure.

The more likely measured cause is:

- The last completed source check was eight days earlier.
- The source has not been revisited despite the 48-hour TTL.
- The company remains behind a continuously non-empty queue.
- The vacancy may have appeared after the last check.

Implementation response:

- Add a 411 regression fixture proving the current parser accepts it.
- Improve revisit throughput.
- Record source snapshots so future analysis can distinguish “new since previous crawl” from “parser missed.”

## Hopscotch

Stored state:

- Careers URL is the employer’s `/work-with-us` page.
- No ATS provider recorded.
- Zero company-site rows.

Current page links to:

```text
https://hopscotch.bamboohr.com/careers
```

Failure path:

1. Employer page is fetched.
2. Anchor extraction resolves the BambooHR URL.
3. `isAllowedCompanyDestination()` checks the host.
4. BambooHR is not recognised.
5. The link is discarded before navigation.
6. No ATS provider or vacancy is persisted.

Required fix:

- Add BambooHR to the typed ATS registry.
- Permit only BambooHR hosts through the recognised-provider path.
- Add BambooHR-specific posting URL recognition.
- Do not permit arbitrary external careers hosts.

## Assured Guaranty / Greenhouse

Stored state:

- Generic and ATS timestamps recorded.
- No ATS provider stored.
- Error: `employer request budget exhausted`.
- Zero company-site rows.

Current source exposes a Greenhouse job link.

Greenhouse detection supports `*.greenhouse.io`, but there is no API adapter. The crawler still depends on reaching and parsing the Greenhouse HTML.

Likely failure path:

1. Employer page and careers navigation consumed part of the budget.
2. Greenhouse or intermediate pages remained queued.
3. The deadline expired while the queue was non-empty.
4. Discovery returned a transient budget failure.
5. No provider or advert was stored.

Required response:

- Add a Greenhouse regression fixture.
- Record whether the Greenhouse URL was:
  - Detected.
  - Queued.
  - Fetched.
  - Parsed.
  - Rejected.
- Do not add another Greenhouse implementation until this trace identifies the missing stage.

## Ashcroft, Aspatria, and Assured Guaranty budget failures

The 25-second budget includes:

- Robots fetch/check.
- DNS resolution.
- Host lease acquisition.
- 1.75-second pacing.
- Redirects.
- Up to nine seconds per page.
- Employer and external ATS pages.

The error is emitted only when time expires while work remains queued.

Hitting six pages alone does not emit the budget error; it currently creates a silent partial result.

Instrument the limiting stage before altering either limit.

---

# Part 5 — ATS strategy

## Current support

Nine provider host families are recognised, but there are no true company-site provider API adapters.

Current ATS support consists of:

- Host detection.
- Destination permission.
- Navigation priority.
- Generic HTML anchor extraction.
- Generic JSON-LD extraction.
- Limited opaque posting-path recognition.

Greenhouse, Lever, and Ashby have some posting-path handling but not independent API clients.

## Detected but not necessarily extracted

A recognised provider can be detected without producing an advert when:

- Listing HTML is client-rendered.
- Posting links do not match expected patterns.
- The listing page is not reached.
- The request times out.
- The source observation is partial.
- Titles or URLs fail generic evidence rules.

## Extracted but not persisted

This cannot currently be measured because normalization and upsert rejection counts are not returned.

## BambooHR implementation

1. Add the BambooHR provider definition.
2. Add host and destination tests.
3. Add a Hopscotch traversal fixture.
4. Inspect the real BambooHR listing response.
5. If static anchors are present, add precise posting-path recognition.
6. If listings come from a bounded JSON endpoint, add a read-only BambooHR fetcher.
7. Apply existing robots, DNS, timeout, byte-limit, destination, and deep-link controls.
8. Persist BambooHR jobs as `sourceType: "company_site"` with provider evidence.

## Generic external-ATS fallback

Not required for initial launch.

If added later, only follow an external host when:

- The anchor is on a confirmed employer careers page.
- Anchor text strongly identifies a careers or vacancies destination.
- The destination is HTTPS.
- DNS is public.
- Robots permit access.
- The target page produces structured or listing-level vacancy evidence.

Do not treat every link on an unknown external host as a vacancy.

## Other ATS providers

Provider frequency cannot currently be measured reliably because only 28 providers are recorded and unsupported providers are discarded before classification.

Do not commit another new provider before source metrics identify it.

---

# Part 6 — False-positive protection

## Why the known false positives pass

### 2H Offshore

The stored URL is under `/about/news/` and includes “role” in its title or path.

Current logic accepts `role` as a vacancy signal. The URL is a long, non-generic deep link, so it passes deep-link validation.

### Astorg

The corporate news URL is also a long employer-domain deep link. It is not blocked by generic-path rules, and news paths are not inherently rejected.

### A1 Transport

The “Apply Online” anchor matches the `apply` vacancy signal. Its nested `/careers/apply-online` path is not the exact generic `/apply` path rejected by the deep-link validator.

## Smallest safe validation improvement

Do not simply blacklist `/news/`, `/blog/`, or `/about/`.

Require at least one positive vacancy evidence type:

1. JSON-LD `JobPosting`.
2. Known ATS posting URL.
3. Link from a confirmed vacancy-listing page with:
   - Specific non-generic title.
   - Specific detail URL.
   - Repeated sibling job-card structure or equivalent list evidence.
4. Structured job card with title plus location, department, closing date, or apply action.

Negative context should reduce confidence:

- News or article schema.
- Published-date/byline/article metadata.
- Corporate announcement terms.
- Generic “Apply Online.”
- Generic careers landing page.
- News/blog/press/about path without stronger positive evidence.

Required function changes:

- `advertsFromLinks()`
- `extractJsonLdAdverts()`
- `normaliseAndDedupeBoardAdverts()`
- `verifyCompanySiteStoredLink()`

Required regression tests:

- 2H news rejected.
- Astorg news rejected.
- A1 generic application rejected.
- 411 specific vacancy accepted.
- Kooner and Aaseya real listings accepted.
- Greenhouse and BambooHR posting links accepted.

---

# Part 7 — Minimum launch-safe freshness model

## Discovered

A specific vacancy passed ingestion evidence and was upserted.

```text
last_discovered_at = current completed source observation
source_missing_since = null
source_missing_observations = 0
```

Discovery alone does not make it visible.

## Verified live

The specific URL passed controlled verification recently.

```text
liveness = live
last_verified_at within visibility window
```

Verification alone does not prove source membership.

## Source-observed

The vacancy appeared in the latest completed, non-transient source observation for its employer.

This refreshes `last_discovered_at` and clears missing state.

## Missing from source

A completed source observation did not contain a previously stored vacancy.

```text
source_missing_since = now
source_missing_observations += 1
```

The vacancy becomes candidate-hidden immediately but is not marked dead.

Partial, failed, robots-blocked, or timed-out crawls must never set this state.

## Stale

Stale is a derived state, not a persisted liveness value.

A vacancy is stale when:

- Its verification is older than 48 hours.
- It is missing from the latest completed source observation.
- Its source has not completed within the freshness window.
- Repeated verification remains inconclusive beyond the visibility window.

Stale vacancies are candidate-hidden.

## Closed

Use `liveness = dead` only when:

- Hard URL evidence indicates closure: 404, 410, soft-not-found, expiry text, blocked redirect, or invalid URL.
- Or the vacancy has been absent from two completed source observations separated by at least 24 hours.

One failed crawl never closes a vacancy.

## Candidate visibility rule

A company-site vacancy is visible only when:

```text
specific vacancy evidence
AND source observed in latest completed crawl
AND liveness = live
AND last_verified_at is recent
AND source_missing_since IS NULL
```

---

# Part 8 — Instrumentation

## Storage

Use two existing storage locations.

### Per-company current state

Extend `sponsor_licence_company_site_checks` with:

- Last attempted.
- Last completed.
- Last partial.
- Last outcome.
- Latest page count.
- Latest advert count.
- Latest rejected count.
- Existing careers URL and ATS provider.
- Existing retry state and error.

### Historical batch metrics

Extend `vacancy_sync_log` with:

- `job_kind`
- `metrics JSONB`

Use one row per job invocation. Do not create a new event table.

## Required metrics

```ts
{
  attempted: number;
  completed: number;
  failed: number;
  partial: number;
  empty: number;

  careersPagesFound: number;
  atsProvidersFound: Record<string, number>;

  advertsFound: number;
  advertsRejected: number;
  rejectedByReason: Record<string, number>;

  inserted: number;
  updated: number;
  revived: number;

  verifiedLive: number;
  verifiedDead: number;
  verificationInconclusive: number;

  oldestUncheckedWebsiteAt: string | null;

  durationMs: number;
  deferred: number;
  done: boolean;
  remaining: number;
  remainingIsLowerBound: boolean;
}
```

“Verified live” should come from the liveness job’s metrics, not be reported as zero by company ingestion.

The oldest unchecked website can be calculated from existing check timestamps.

---

# Part 9 — Seven-day implementation sequence

## Day 1 — Outcome contracts and regression fixtures

### Files

- `companySiteDiscovery.ts`
- `companySiteScheduler.ts`
- `boardVacancyPipeline.ts`
- Existing tests for these modules

### Behavior

- Add complete, partial, and failed result semantics.
- Add rejection reason counts.
- Add fixtures for:
  - 411 Communications.
  - Hopscotch.
  - Assured/Greenhouse.
  - 2H.
  - Astorg.
  - A1 Transport.

### Risk

Low. Mostly additive contracts and tests.

### Estimated effort

0.75–1 day.

### Expected coverage effect

No immediate row increase, but establishes whether each known failure is traversal, extraction, budget, queue, or validation-related.

## Day 2 — Evidence-based false-positive protection

### Files and functions

- `companySiteDiscovery.ts`
  - `advertsFromLinks()`
  - `extractJsonLdAdverts()`
- `boardVacancyPipeline.ts`
  - `normaliseAndDedupeBoardAdverts()`
- `vacancyUrlPolicy.ts`
  - Shared evidence helpers only if required

### Behavior

- Require explicit company-vacancy evidence.
- Reject news and generic application pages unless stronger evidence exists.
- Return rejection reason buckets.
- Keep URL, robots, and SSRF controls unchanged.

### Risk

Medium. Overly strict evidence rules could reduce recall.

### Estimated effort

0.75–1 day.

### Expected coverage effect

Removes confirmed false active rows and prevents similar news/application pages from entering the feed.

## Days 2–3 — Freshness and source reconciliation

### Files and functions

- `sponsorLicences.ts` schema definitions
- Future additive migration
- `boardVacancyPipeline.ts`
  - `upsertSharedBoardVacancies()`
- `companySiteScheduler.ts`
  - `runCompanySiteCheck()`
- `companySiteVerification.ts`
  - `verifyCompanySiteStoredLink()`
- `vacancyLiveness.ts`
- `sponsorVacancyRoles.ts`
- `routes/sponsorLicences.ts`

### Behavior

- Record source-missing state.
- Clear missing state on rediscovery.
- Reconcile only after completed source observations.
- Hide missing and stale rows.
- Close only on hard evidence or repeated completed absence.
- Centralize candidate visibility.

### Risk

Medium to high. Candidate counts may fall when old URL-live rows are correctly hidden.

### Estimated effort

1.25–1.75 days.

### Expected coverage effect

Candidate-visible company jobs become materially more current and trustworthy.

## Day 4 — BambooHR support

### Files and functions

- `companySiteHttp.ts`
  - ATS registry
  - `knownAtsProvider()`
  - `isAllowedCompanyDestination()`
- `companySiteDiscovery.ts`
  - BambooHR posting recognition or bounded response adapter
- Existing HTTP and discovery tests

### Behavior

- Follow recognised BambooHR careers links safely.
- Extract only provider-specific postings.
- Persist as company-site vacancies with BambooHR evidence.

### Risk

Medium. BambooHR tenants may expose different listing templates.

### Estimated effort

0.75–1.25 days.

### Expected coverage effect

Recovers the confirmed Hopscotch source and similar BambooHR tenants encountered during backlog processing.

## Day 5 — Durable instrumentation

### Files and functions

- `sponsorLicences.ts`
- Future additive migration
- `companySiteScheduler.ts`
- `boardVacancyPipeline.ts`
- `vacancyCheckScheduler.ts`
- `vacancyLivenessSweep.ts`
- `vacancyJobRunner.ts`
- `internalVacancyJobs.ts`

### Behavior

- Persist batch metrics to `vacancy_sync_log`.
- Persist the latest employer outcome to company checks.
- Emit the same metrics in structured logs.
- Add updated and rejection counters.

### Risk

Low to medium. Metrics writes must not make crawl batches fail.

### Estimated effort

0.75–1 day.

### Expected coverage effect

Makes every required funnel stage measurable and enables safe throughput tuning.

## Day 6 — Scheduler acceleration and controlled catch-up

### External scheduler and endpoint

- Keep `limit=10`.
- Invoke every two minutes while `done=false`.
- Retry HTTP 409 with jitter.
- Retain the 20-second endpoint budget.
- Do not change crawler page or employer limits.

### Endpoint file

- `internalVacancyJobs.ts`
  - Add retry guidance.
  - Return richer summaries.

### Risk

Medium. More frequent company calls can delay board or liveness calls unless scheduling remains interleaved.

### Estimated effort

0.25–0.5 day plus monitoring.

### Expected coverage effect

Approximately doubles measured company processing from about 150 per hour to about 300 per hour, assuming similar duration and writer-lock availability.

## Day 7 — Validation and launch audit

### Actions

- Drain the oldest unchecked cohort.
- Run company-site and liveness validation.
- Recheck the 40-company audit sample.
- Compare:
  - Real source jobs.
  - Extracted jobs.
  - Rejections.
  - Persisted jobs.
  - Candidate-visible jobs.
- Review:
  - Partial rate.
  - Error rate.
  - HTTP 409 rate.
  - p95 duration.
  - False-positive sample.
  - Missing-source transitions.
- Decide whether raising the batch above 10 is justified.

### Risk

Low.

### Estimated effort

0.75–1 day.

### Expected coverage effect

Produces a launch decision based on measured coverage and freshness rather than raw row volume.

---

# Part 10 — Exact implementation order

1. Add complete/partial/failed crawl outcomes, rejection reasons, and named regression fixtures.
2. Require explicit vacancy evidence and reject news/generic-application false positives.
3. Add source-missing freshness semantics and enforce one strict candidate visibility rule.
4. Add targeted BambooHR support and validate Greenhouse traversal with instrumentation.
5. Increase external company-site invocation frequency while retaining batch size 10 and retrying HTTP 409.
6. Drain and measure the backlog.
7. Only then decide whether the batch cap should move from 10 to 16.
8. Do not increase six pages, 25 seconds, or nine seconds without page-level measurements.

## If only three things can be implemented before launch

### 1. Vacancy evidence and false-positive protection

Without this, increasing throughput will populate more news articles, generic application pages, and old content.

### 2. Source-aware freshness and strict candidate filtering

A URL returning HTTP 200 is not sufficient evidence of a current vacancy. Missing and stale source rows must be hidden without being closed after one failed crawl.

### 3. Faster scheduling with the existing safe batch of 10

Invoke company-site work every two minutes while `done=false`, retry HTTP 409 with jitter, and retain the current HTTP, crawler, robots, SSRF, and host-pacing protections.

BambooHR is the next change after those three. It fixes a confirmed missed provider, but current evidence supports one measured BambooHR case, while the first three changes affect the integrity and throughput of the entire company-site pipeline.
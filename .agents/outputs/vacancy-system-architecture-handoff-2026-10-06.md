# JOBSAGE vacancy collection, matching, and CV delivery
## Architecture handoff for the next building agent

**Workspace snapshot:** 6 October 2026  
**Purpose:** Explain the relevant existing system, its real coverage limits, and a safe target architecture for collecting useful vacancies automatically across sectors and source types, then connecting those vacancies to Apply and Send CV.

This note separates **what is in the current code** from **what is proposed**. Re-check the named files before changing them; this is a handoff, not a substitute for reading the implementation and tests. Do not promise that any crawler can find every vacancy on the web. The goal is high, measurable coverage with reliable freshness, correct employer identity, trustworthy application routes, and visible failure states.

## 1. Current system at a glance

JOBSAGE is a pnpm monorepo:

- `artifacts/jobsage-web`: React/Vite candidate, employer, and admin web app.
- `artifacts/jobsage-mobile`: Expo mobile client.
- `artifacts/api-server`: Express 5 API and development-mode schedulers.
- `artifacts/chrome-extension`: Smart Apply browser extension source/build.
- `lib/db`: PostgreSQL schema and Drizzle client.
- `lib/api-spec`, `lib/api-zod`, and `lib/api-client-react`: OpenAPI contract, generated validators/types, and generated React Query client.
- `lib/auth-web`: shared web authentication.

The web and mobile clients use the same API and database-backed product. The API uses custom email/password authentication with database-backed sessions, Replit Object Storage for private and public files, Resend for transactional email, and a Replit AI integration where product features call AI. Production PostgreSQL is external to Replit's managed database pane; use the project's guarded database and production-worker workflows rather than assuming Replit's managed production SQL is the live JOBSAGE database.

At the product level, the relevant flow is:

```text
employer/source directories
        ↓
source discovery and identity verification
        ↓
job-board / employer-site / employer-posted vacancy ingestion
        ↓
shared normalization, deduplication, evidence, and freshness checks
        ↓
candidate opportunity API → web/mobile feed
        ↓
verified Apply route, Smart Apply assistance, or tracked Send CV
        ↓
application tracker and delivery status
```

These stages are not interchangeable. Adding an employer website to the employer record does **not** itself import that employer's vacancies. Finding a listing does **not** by itself establish that it is open, relevant, sponsored, or safe to expose as an Apply/Send CV action.

## 2. Existing vacancy data and discovery

### Three role stores feed different parts of Opportunities

The current product has overlapping role sources rather than one universal job table:

1. **`sponsor_licence_vacancies`** — discovered vacancies associated with an employer in JOBSAGE's sponsor register. Records include employer name, title, location, salary, posting/closing information, URL, `source_type`, `board_name`, external listing ID, company-site evidence, liveness and verification timestamps, and source-missing state.
2. **`roles`** — curated/admin-managed roles, with regulator/category and application/contact fields.
3. **Employer `job_listings`** — roles published through the JOBSAGE employer portal.

`/api/roles` combines relevant records for an authenticated candidate. It applies profession/category and region logic, hides ambiguous classifications from candidate results, and can filter by `source=job_board` or `source=company_site`. Candidate alerts and other Opportunities sections should remain aligned with the same visibility and ranking rules.

The sponsor register is an important current employer universe, but it is **not** a complete registry of every UK employer. It must not become the permanent boundary for a cross-sector discovery system.

### Job-board discovery

There are two related but distinct board paths:

- Employer-scoped sponsor vacancy checks use the `BoardAdapter` pipeline. The adapters currently shown in `boardVacancyPipeline.ts` query NHS Jobs and Reed, with outage/backoff handling. NHS listing URLs can identify NHS Jobs, Trac, or HealthJobsUK as the board name.
- Candidate-triggered live search in `candidateBoardDiscovery.ts` chooses the NHS Jobs family for regulated professions and Reed for other mapped professions. It builds profession/specialty terms, applies region handling, matches returned employer names against existing sponsor employers, and saves accepted adverts via the shared upsert path. It uses a short refresh cache and a longer snapshot freshness threshold; a cold refresh is non-blocking for the candidate request.
- Additional profession backfills include NHS Jobs, jobs.ac.uk, Teaching Vacancies, and Reed targets, but they are bounded, source-specific backfills—not continuous comprehensive coverage of every profession or every sector.

This is useful existing infrastructure, but it is not yet a universal source strategy. The main candidate live-search path is only NHS Jobs-family and Reed, with sponsor-name matching. Broader sources currently exist as targeted backfills.

### Employer websites and ATS feeds

Company-site discovery is a separate employer-centred pipeline. It uses sponsor/employer records and saved website/careers/source evidence to probe or crawl a confirmed first-party site. `companySiteDiscovery.ts`, `companySiteScheduler.ts`, `companySiteProbe.ts`, and `companySiteHttp.ts` implement discovery, selection, probing, parsing, and bounded web access.

The direct employer-board connector has provider-specific parsing for supported ATS platforms, including Ashby, Greenhouse, Lever, SmartRecruiters, Recruitee, Personio, Pinpoint, and Workday. A parser existing in code does **not** mean every employer mapping to that platform is verified. A saved careers URL or a search-result lead is not enough to prove employer identity or a valid feed.

Company-site access is intentionally constrained: HTTPS/public-DNS protections, redirect checks, robots policy, host pacing/leases, deadlines, response-size bounds, transient retries, and employer/request budgets. Generic discovery is bounded (including a page cap); it is not a full browser capable of understanding every JavaScript-only site. Never weaken these controls to inflate a raw listing count.

### Normalization, persistence, and deduplication

`boardVacancyPipeline.ts` is the shared normalization/persistence boundary for board and company-site discoveries. It canonicalizes URLs, validates source-specific URL shapes, drops known non-role/editorial results where required, preserves source attribution, and deduplicates using canonical URL, source/external listing identity, and a normalized employer/title/location fingerprint. PostgreSQL advisory locks serialize overlapping writers. Refreshes update or revive matched records instead of blindly inserting a second row.

New source adapters should reuse this shared path (or a deliberately designed successor), not write vacancy rows through one-off SQL or bypass deduplication. Preserve the distinction between `source_type` (`job_board` / `company_site`) and the specific provider/board name.

### Scheduling and job execution

Development starts in-process vacancy/company-site/liveness schedulers and a stale-pipeline catch-up. Production startup explicitly logs that an **external HTTP cron** owns the short `job_board`, `company_site`, and `liveness` batches. The protected internal endpoint is `/api/internal/vacancy-jobs`; it accepts bounded job kinds and caps, and the API refuses these jobs if the configured AI web-search daily cap is not zero. `vacancy_sync_log` records batch outcomes and metrics.

The code has bounded batch execution, cross-process locks, per-source outage backoff, company-site host coordination, and freshness catch-up. Do not assume this is a general durable queue with a separate persisted job/cursor row for every source/employer task. Before adding more volume, establish exactly which production scheduler calls each job kind, how it resumes after a process interruption, and whether a zero-result run can be distinguished from a failed/incomplete run.

### Candidate visibility is stricter than discovery

The candidate-visible sponsor vacancy query and `getCandidateVacancyStatus` impose freshness and evidence gates. In particular, a candidate-visible listing generally needs:

- `liveness = live` and verification in the last 48 hours;
- a source type and URL;
- no passed close/expiry date or explicit closed/filled signal;
- no active source-missing indication;
- acceptable source evidence for company-site records.

Company-site rows need corroboration such as a verified direct ATS posting, an enabled and valid structured-job signal, strict role-page evidence, or a time-bounded trusted legacy review. Standalone manager roles require an approved role-eligibility review. The exact SQL is in `routes/sponsorLicences.ts`; shared per-record status rules are in `artifacts/api-server/src/lib/vacancyLiveness.ts`. Vacancy action links have further verification checks. Keep these rules consistent across SQL aggregates, candidate lists, link checks, alerts, and application creation.

Employer sponsor-register membership is **not** evidence that a particular vacancy offers sponsorship. Sponsorship must be backed by vacancy-specific evidence.

## 3. Send CV and application tracking

Send CV is a tracked outreach path, not a substitute for the employer's Apply form:

1. The candidate chooses a company and optionally a specific vacancy, a candidate-owned PDF CV, and an optional cover letter.
2. The API validates the authenticated candidate, requested employer/vacancy identity, source and URL, and the stored vacancy's current state. A vacancy-specific request cannot swap in a different URL or rely on a dead/stale vacancy.
3. The API resolves a recipient from persisted employer/sponsor contact evidence or an eligible JOBSAGE employer account. It must not guess an email address from a name or domain.
4. A durable `speculative_applications` record and `speculative_application_delivery_attempts` record are created before delivery. Per-user/day limits and an advisory lock protect against duplicate clicks and concurrent retries.
5. The user's CV is fetched from private object storage. Email uses the platform's approved sender; the candidate's JOBSAGE alias is the reply address, keeping their personal login email out of employer-facing delivery.
6. Delivery state is reported as delivered, pending, or failed and shown in the application tracker. If no direct stored contact is available, the record remains pending for follow-up; it is not silently described as sent and must not be routed to an operations inbox as if it had reached the employer.

Employer-level speculative outreach and vacancy-specific Send CV have different evidentiary requirements. A vacancy-specific action needs a current vacancy identity and usable route/contact evidence; employer-level outreach can exist independently of a particular live vacancy. Keep the candidate in control of document choice and final send. Smart Apply/extension assistance is also separate from automatic submission: do not turn data collection into an unapproved form submission.

## 4. What the latest NHS Trust check actually tells us

On 6 October 2026, 55 sponsor rows across **54 distinct NHS Trust employers** had their website/ODS metadata updated. That import did not add vacancy records. A read-only production check scoped to those 54 employers found:

- **245** records passing the current candidate-visible/recent verification rules;
- **44 of 54** trusts with at least one qualifying record;
- all **245** records had `source_type = job_board`;
- **0** qualifying records had `source_type = company_site`.

This is a dated snapshot, not a claim that those trusts have no jobs on their own sites. It shows the distinction between employer website enrichment and actual company-site vacancy ingestion, and it is a useful baseline for the requested work.

## 5. Proposed target architecture for broader automatic coverage

Build incrementally around explicit provenance and measurable coverage. Do not start with a broad schema migration or a single “scrape the whole web” worker.

### A. Separate employer identity from source discovery

Create or evolve a canonical employer identity layer that can represent all employers—not just visa sponsors. Give each employer a stable JOBSAGE identity and retain source-specific aliases, legal/brand names, domains, locations, and evidence. Resolve matches using more than name alone; use authoritative identifiers and independent location/domain evidence where available. Keep sponsor-register membership as one attribute, not the primary key or coverage boundary.

Represent sources independently from employers: an employer can have several boards, multiple ATS feeds, a careers page, and more than one legal/brand identity. A source mapping should record provider/type, source URL or feed key, employer identity evidence, sector coverage, discovery route, robots/terms policy, cadence, parser version, last success/failure, next retry, and review status.

### B. Use a durable, observable ingestion pipeline

Target flow:

```text
source lead
  → employer/source identity verification
  → persisted source mapping
  → scheduled, bounded fetch job with cursor/checkpoint
  → source-specific adapter
  → raw observation + parsing/identity evidence
  → normalization and cross-source deduplication
  → vacancy status/classification
  → candidate-visible projection
  → Apply / Smart Apply / Send CV
```

Prefer documented/public APIs, provider feeds, RSS/JSON/structured data, and verified ATS connectors. Use HTML crawling as a bounded fallback where permitted. Define a testable adapter contract that reports request success, pagination/cursor state, parsed rows, rejects with reasons, and whether the source was fully exhausted. Distinguish at least: successful-with-listings, successful-zero-listings, partial, retryable failure, permanent/robots block, and needs review. A timeout must never look like “no vacancies.”

Persist jobs/checkpoints and source health so work is resumable after process restart. Use bounded workers, per-host and per-provider concurrency/rate limits, exponential backoff with jitter, circuit breakers, and fair scheduling so a large source backlog cannot starve small or slow sources. Keep logs for every batch and source result. Long-running crawls stay out of candidate HTTP requests; candidate reads remain DB-first and fast.

### C. Keep observations separate from the canonical job

For an MVP, extend the existing shared upsert carefully rather than replacing the vacancy model at once. The intended conceptual model is:

- **Canonical vacancy:** stable role identity, employer, title, structured location/remote status, salary, sector/occupation, posted/closing dates, application route, lifecycle state.
- **Source observation:** provider/source mapping, original URL and external ID, first/last seen, fetch timestamps, raw evidence reference/hash, parser version, and source-specific status.
- **Application route/contact evidence:** route type, URL/email, who published it, when verified, safety/identity basis, and supported action (`Apply`, `Send CV`, or display-only).

One vacancy may be observed on several boards and a company site. Preserve each sighting and its evidence while deduplicating to one candidate-facing role. Do not erase provenance when selecting the best display URL. A changed title, employer alias, or URL needs a controlled matching policy; URL-only dedupe and employer/title fuzzy matches can each create false merges if used without source context.

### D. Make cross-sector classification explicit and reviewable

Use a versioned taxonomy with separate dimensions for sector, occupation/profession, seniority, location/remote status, registration requirement, sponsorship evidence, and application route. Start with deterministic provider fields and tested rules; use a classifier only as an assist where evidence is incomplete. Store its version, evidence, confidence, and unresolved reason. Do not infer sponsorship from the employer's licence, invent application details, or silently discard an ambiguous vacancy.

Build reviewed positive and negative examples across multiple sectors and provider types. Track precision and recall independently: a cleaner feed that misses most roles is not adequate, and a high raw count full of irrelevant/stale listings is not adequate.

### E. Treat visibility and actions as a single contract

Have one shared vacancy state/evidence policy used by candidate lists, counts, alerts, Apply checks, and Send CV eligibility. Candidate visibility should include live/fresh state, expiry/closure, source completeness, identity confidence, relevance threshold, and a valid destination. Return rejection/withheld reasons for internal monitoring instead of silently dropping every rejected row.

Keep “discovered,” “verified open,” “candidate-visible,” and “actionable” separate. A careers homepage is a route lead, not a vacancy. A generic application form is not a sample job. A listing can be displayable but not support vacancy-specific Send CV. The candidate may still visit the employer's verified careers route where no direct application URL exists, but should not see a broken or misleading action.

### F. Improve Send CV through verified contacts, not guessed addresses

Expand contact coverage using source-published employer/job advert contacts and verified employer accounts. Store the contact's evidence URL, source, scope, verification time, and state. Exhaust existing stored evidence before optional external enrichment. Accept only published, suitable employer contacts; do not synthesize addresses. Keep Send CV's current candidate alias, private PDF, durable attempt, idempotency, delivery truth, and retry protections.

Measure the funnel separately: vacancies with a valid Apply route, employer-level contact coverage, vacancy-specific contact coverage, delivered/rejected/deferred CV attempts, and reply outcomes. A vacancy with no safe contact should remain useful for browsing/Apply and should not be falsely counted as a successful Send CV opportunity.

### G. Measure coverage, not just row counts

Build a source/sector coverage report with denominators. At minimum track:

- known employers, verified sources, active source mappings, and source types per sector;
- sources due, attempted, successful, zero-result, partial, blocked, retrying, and stale;
- raw results, rejected results by reason, identity matches, canonical vacancies, duplicates, and changes;
- open/live/visible/actionable counts and age of last successful verification;
- valid Apply route rate and verified contact rate;
- sampled precision (is the job real, current, and correctly attributed?) and recall (does a sampled official source contain jobs we missed?).

Use independently assembled samples from official career pages and known boards, with manual adjudication, to estimate recall. Keep parsers covered by fixtures and replay tests, including empty feeds, pagination, employer identity conflicts, title/location changes, closure dates, malformed HTML, encoding/compression, and transient failures.

## 6. Recommended implementation sequence

1. **Baseline and instrument:** freeze a read-only denominator of employers/sources by sector; expose per-source outcomes and the distinction between zero results and incomplete/error. Re-run the 54-trust source check as one baseline, not as the full product cohort.
2. **Unify source inventory:** define employer/source IDs and audited mappings without changing candidate output. Add the missing non-sponsor employers by sector from authoritative registries or reviewed company sources.
3. **Pilot board adapters:** choose a small, representative set of sectors and public/documented boards; use common adapter contract, pagination, parsing fixtures, source-specific backoff, and shared persistence. Compare against audited source pages.
4. **Pilot company-site coverage:** use verified domains/careers routes and provider-specific ATS connectors first; then bounded safe HTML/structured extraction. Report JS-only, robots-blocked, unknown-provider, and empty outcomes distinctly.
5. **Roll out progressively:** canary per sector/source; compare new versus current candidate-visible results; monitor false positives, duplicates, staleness, load, and source fairness before widening.
6. **Connect actions:** enable Apply and Send CV only when their own route/contact evidence passes the shared policy. Test candidate consent, exact vacancy identity, delivery state, retry/idempotency, and tracker wording.

## 7. Instructions and guardrails for the next agent

- Read the relevant code, current tests, and project memory before changing the pipeline. The paths below are landmarks; code is the authority.
- Do not equate “company website imported,” “employer is a sponsor,” or “source request succeeded” with “we have a current vacancy.”
- Reuse the shared vacancy normalization/upsert, source classification, liveness, region/category rules, and Send CV recipient/delivery protections. Avoid a parallel writer that creates divergent status and dedupe rules.
- Do not turn candidate request handlers into crawlers. Production batch jobs are externally scheduled and bounded; preserve that separation.
- Preserve company-site SSRF, DNS, HTTPS, redirect, robots, size, timeout, pacing, retry, and host-coordination protections.
- Keep production writes behind the existing guarded/reviewed operational path. Production is external PostgreSQL; do not treat a Replit-managed production SQL connection as authoritative for live JOBSAGE data.
- Treat source content as untrusted. Never trust arbitrary embedded application/contact URLs without validation and employer/source evidence.
- Do not state “all vacancies” or “guaranteed coverage.” Report coverage, freshness, and quality by sector/provider, including unknown and failed sources.

## 8. Useful code and operational landmarks

**API and contracts**
- `artifacts/api-server/src/routes/roles.ts` — candidate role aggregation and source filtering.
- `artifacts/api-server/src/routes/sponsorLicences.ts` — sponsor vacancy list, status, and candidate-visible SQL.
- `lib/db/src/schema/sponsorLicences.ts`, `roles.ts`, `applications.ts`, `speculativeApplications.ts` — current persistence models.
- `lib/api-spec/openapi.yaml`, `lib/api-zod`, `lib/api-client-react` — API contract and generated clients.

**Discovery and quality**
- `artifacts/api-server/src/lib/boardVacancyPipeline.ts` — board/company-site normalization, deduplication, and persistence.
- `candidateBoardDiscovery.ts`, `nhsJobsClient.ts`, `reedJobsClient.ts` — candidate-triggered board refresh.
- `additionalBoardProfessionBackfill.ts`, `jobsAcUkClient.ts`, `teachingVacanciesClient.ts`, `reedProfessionBackfill.ts` — targeted profession backfills.
- `companySiteDiscovery.ts`, `companySiteScheduler.ts`, `companySiteProbe.ts`, `companySiteHttp.ts`, `directEmployerBoardConnectors.ts` — employer-site discovery, safe fetching, provider feeds, and scheduling.
- `artifacts/api-server/src/lib/vacancyLiveness.ts`, `artifacts/api-server/src/lib/vacancyLivenessSweep.ts`, `artifacts/api-server/src/lib/vacancyPipelineCatchup.ts`, `artifacts/api-server/src/lib/vacancyJobRunner.ts`, `artifacts/api-server/src/routes/internalVacancyJobs.ts` — status, freshness, batch execution, and production job endpoint.
- `healthcareRoleEvidence.ts`, `companySiteRoleSectors.ts`, `vacancyTitlePolicy.ts`, `vacancyUrlPolicy.ts`, `professionCategory.ts`, `regionMatching.ts` — evidence, classification, URL, and match policy.
- `scripts/README-vacancy-source-routing.md`, `scripts/README-sponsor-contact-discovery.md` — review-first source/contact discovery workflows.

**Candidate actions**
- `artifacts/api-server/src/routes/speculativeApplications.ts` — tracked Send CV creation and delivery state.
- `artifacts/api-server/src/lib/employerRecipient.ts`, `email.ts`, `objectStorage.ts` — recipient selection, platform email, and document storage.
- `artifacts/jobsage-web/src/pages/OpportunitiesPage.tsx`, `SponsorLicencesPage.tsx`, `ApplicationsPage.tsx`, `components/SmartApplyModal.tsx`, `components/SponsorVacancyApplyModal.tsx` — candidate opportunity and outreach UI.
- `artifacts/chrome-extension/` — Smart Apply browser assistance.


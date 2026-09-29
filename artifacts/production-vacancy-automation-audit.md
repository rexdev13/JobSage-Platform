# Production Vacancy Automation Audit

**Audit date:** 27 September 2026  
**Scope:** Static review of repository code, tests, documentation, and the currently configured Replit development workflows. No production request, database query, import, enrichment, deployment, or vacancy crawl was run for this audit.

## Executive summary

JOBSAGE has substantial vacancy automation implemented: bounded employer-site crawling, a set of direct ATS connectors, NHS Jobs and Reed employer-board adapters, separate profession/additional-board backfills, duplicate controls, source and vacancy liveness checks, candidate eligibility gates, and a candidate-facing Send CV flow.

That does **not** establish that production is currently running those jobs. Production startup deliberately does not register the in-process board, company-site, and liveness schedulers and does not run vacancy catch-up. The current documented design expects an external scheduler to call the authenticated, bounded `POST /api/internal/vacancy-jobs` endpoint. The repository contains scheduling instructions, but no evidence in this audit that the external schedules are actually configured and succeeding. The configured Replit workflows shown for this project are development processes for the API, web app, mobile app, and component preview; they are not production cron jobs.

The strongest production-readiness concerns are:

1. **Production schedule status is unverified.** If the external HTTP cron jobs are absent or misconfigured, the automatic vacancy pulls and liveness checks do not run in production.
2. **There is no universal, reversible source-import workflow.** The source-routing runner is review-only CSV output. The guarded sponsor website importer is development-only and Healthcare-specific. A legacy sponsor-contact importer has a weaker production-target guard.
3. **Monitoring is mostly logs and recent-run views.** No threshold-based external alerting or durable general retry/dead-letter queue was found.
4. **Source disappearance is not fully retired.** A company-site advert can become candidate-hidden as `missing` but remain stored indefinitely; cleanup deletes sponsor vacancies only after they are positively marked `dead`.
5. **The sector-coverage check is manual and can drift from runtime visibility.** Its latest documented result is dated 23 September 2026 and “GREEN” means at least one row per shared category, not complete profession-level coverage.

**Bottom line:** The repository contains components from which a bounded production system can be operated, but the audit cannot certify that production is autonomously running today. Verify the external scheduler, production secret/schema, and end-to-end candidate-visible results before describing the system as continuously automated.

## Scope and evidence limits

- This is a code-and-documentation audit. Production scheduler settings, production secrets, live database rows, and runtime logs were not inspected.
- No crawler, enrichment runner, importer, production endpoint, or production database query was run.
- The Replit documentation describes Scheduled Deployments as cron-triggered commands configured in deployment settings and stopped after completion; this is separate from a development workflow. See [Deployment types](https://docs.replit.com/features/publishing/deployment-types).
- An already-running local sponsor-website discovery process was stopped to honor the attached “Do not crawl websites” instruction. Its last persisted progress snapshot was **14,311 of 14,530** selected rows, incomplete. Its existing progress/journal files support resume; it was not restarted for this audit.

## Architecture at a glance

```text
GOV.UK sponsor register
  └─ sponsorLicenceSync
       └─ sponsor_licences + sponsor sync logs

Offline / review workflows
  ├─ sponsorEnrichmentExport (development-only, read-only snapshot)
  ├─ sponsor website/contact discovery (CSV artifacts)
  ├─ vacancySourceRoutingBatch (CSV recommendations; no database import)
  └─ healthcareSponsorWebsiteImport (explicit development-only apply path)

Production vacancy ingestion, when externally triggered
  └─ External cron (configuration not verified in this audit)
       └─ POST /api/internal/vacancy-jobs
            └─ secret check, server caps, shared writer lock
                 ├─ job_board: NHS Jobs + Reed employer adapters
                 ├─ company_site / company_site_probe:
                 │    employer-site crawl + supported direct ATS/feed connectors
                 ├─ reed_professions / additional_boards: cursor-paged backfills
                 ├─ contact: bounded contact follow-up
                 └─ liveness: stored-link sweep
                      └─ sponsor_vacancies / roles / job_listings
                           + vacancy_sync_log and company-site check state

Candidate delivery
  ├─ /roles, /roles/my-matches, /opportunities/recommended
  ├─ shared visibility, source-evidence, profession and ranking rules
  ├─ Opportunities UI + scheduled candidate alerts
  └─ vacancy-specific Send CV
       └─ speculative application + delivery-attempt record + email
```

## Pipeline assessment

### Source discovery, validation, and imports

**Offline discovery and review**

- `scripts/src/sponsorEnrichmentExport.ts` has a guarded export path. `assertDevelopmentTarget` requires development mode, an explicit development confirmation, and rejects deployment/prod-looking database targets. `loadSnapshot` uses a read-only transaction. It aggregates existing source evidence but does not itself crawl or import.
- `scripts/src/vacancySourceRoutingBatch.ts` selects sponsors, gathers local/source/search leads, validates employer identity and vacancy-detail evidence, and writes resumable CSV/report/progress artifacts. `scripts/README-vacancy-source-routing.md` explicitly says the runner does not connect to a database or import.
- `scripts/src/healthcareSponsorWebsiteImport.ts` has a dry-run plan and an explicit `--apply-dev` path guarded by an expected plan hash and development-target checks. It is Healthcare-specific, validates sponsor identity, and preserves already-populated fields.
- The older `scripts/src/sponsor-contact-discovery/importer.ts` is dry-run unless `apply` is requested, but the reviewed importer did not have the same explicit development/prod target guard as the newer Healthcare website importer. Do not treat it as a production-safe vacancy-source importer.

**Production discovery and validation**

- `artifacts/api-server/src/lib/companySiteProbe.ts` performs a bounded root-site probe and persists retry/probe state. Full company-site crawling is probe-gated in the documented HTTP-cron design.
- `artifacts/api-server/src/lib/companySiteDiscovery.ts` finds employer vacancy pages from bounded HTML, sitemap, structured-data, careers-path, and supported direct-feed evidence. It rejects generic careers/navigation/editorial links without sufficient role-detail evidence. Crawling is bounded by a page cap and employer budget.
- `artifacts/api-server/src/lib/directEmployerBoardConnectors.ts` validates and parses public Ashby, Greenhouse, Lever, SmartRecruiters, Recruitee, Personio, Pinpoint, and a configured Circle Workday board. It checks provider/board identity, URL safety, snapshots, pagination, and provider-specific consistency.
- `artifacts/api-server/src/lib/boardVacancyPipeline.ts` provides employer-board discovery and persistence. Its normal employer adapter registry contains NHS Jobs and Reed; additional sources have separate backfill paths rather than being automatically covered by a general board adapter.
- `artifacts/api-server/src/lib/vacancySource.ts` classifies recognized board URLs versus company-site links and canonicalizes URLs.

**Coverage and limitations**

- `companySiteHttp.ts` recognizes additional ATS products, including Oracle Recruiting, Taleo, SAP SuccessFactors, and BambooHR, but recognition is not the same as a working direct-feed connector.
- Recruitee snapshots are marked incomplete, preventing the authoritative missing-posting pass. Pinpoint and Workday have parsing support but do not have complete matching source-retirement branches in the company-site scheduler.
- Sites that require JavaScript rendering or lack supported structured evidence are diagnosed but are not rendered by a browser crawler.
- Production ingestion from known sources is code-backed; importing arbitrary reviewed CSV source recommendations into production is not a general, reversible workflow.

### Source routing, persistence, duplicate prevention, and removal

- `artifacts/api-server/src/lib/vacancyJobRunner.ts` dispatches bounded job kinds. `artifacts/api-server/src/routes/internalVacancyJobs.ts` requires `VACANCY_JOB_SECRET`, validates kind/limit, enforces the AI web-search cap, and returns backpressure/deadline responses rather than accepting an unbounded job.
- `artifacts/api-server/src/lib/boardVacancyPipeline.ts` normalizes candidate records, rejects weak/editorial matches, and deduplicates using canonical URLs, role fingerprints, board identifiers, and ATS identity. Persistence uses transactions and advisory locks; approved role review is preserved only when the full role identity remains unchanged.
- `vacancy_sync_log` stores batch-level status and metrics. Pipeline records include a job kind such as `job_board`, `company_site`, `liveness`, or `contact`. This is useful operational provenance, but it is not an immutable per-source/per-advert history with a complete input snapshot and rollback plan.
- Sponsor vacancy rows retain source, external identifiers, URL, evidence, liveness, closure/expiry, and source-missing state in `lib/db/src/schema/sponsorLicences.ts`. `roles` and employer `job_listings` do not have identical lifecycle fields or identity constraints.
- Liveness marks URLs dead, stale, inconclusive, missing, or live. `sponsorVacancyCleanup.ts` deletes rows only after positive `dead` status and its retention period. The company-site authoritative snapshot logic records source disappearance as `source_missing_since` / observations; the reviewed path does not subsequently retire those rows after a configured missing threshold. They can remain stored but candidate-hidden.
- Candidate deduplication has another layer: sponsor candidates can be collapsed by employer/title. This can merge distinct same-title roles; it should not be mistaken for source-level identity deduplication.

### Liveness and safe fetching

- `artifacts/api-server/src/lib/vacancyLiveness.ts` centralizes candidate status. It rejects closed, expired, source-missing, unapproved manager-review, non-live, and stale vacancies. Candidate visibility uses a 48-hour verification window; action/link freshness uses a shorter 6-hour check.
- `artifacts/api-server/src/lib/vacancyLivenessSweep.ts` sweeps sponsor vacancies, active roles, and published job listings, logs checked/live/dead/inconclusive counters, and has a full-scan status path.
- Company-site fetches use HTTPS, public DNS/SSRF checks, robots rules, bounded responses, redirect validation, timeouts, host pacing, and retry/backoff rules. Documented public ATS JSON APIs have a narrow robots exception for supported exact API destinations; network/SSRF/pacing controls remain required.
- The HTTP worker serializes writers with a PostgreSQL advisory lock. A `409` means backpressure; do not launch a concurrent retry. A `504` may mean the response deadline elapsed while safe final writes are still settling under the lock; honor `Retry-After`.
- Retry handling is not uniform exponential backoff. Several probe and crawl retry windows are fixed; liveness inconclusive results are represented primarily by timestamps and can wait for the common stale threshold. Some transient database writes have bounded retry, but there is no general durable dead-letter/retry queue for every failed discovery stage.

### Candidate visibility, ranking, and alerts

- Candidate routes in `artifacts/api-server/src/routes/roles.ts` include `/roles`, `/roles/my-matches`, and `/opportunities/recommended`. Sponsor records are shaped by `artifacts/api-server/src/lib/sponsorVacancyRoles.ts`.
- Candidate feeds use the shared vacancy status and source evidence rules, then category/profession eligibility and ranking. Apply/contact route requirements, URL safety, region, sponsorship evidence, and role review can affect display/actionability.
- `artifacts/api-server/src/lib/alertScheduler.ts` uses the candidate vacancy composition and ranking logic for alerts, then applies cadence/checkpoint/dedup behavior. `artifacts/jobsage-web/src/pages/OpportunitiesPage.tsx` and shared client filters present the feed.
- `artifacts/api-server/src/routes/speculativeApplications.ts` revalidates the stored vacancy identity and liveness for vacancy-specific Send CV submissions. It persists an attempt before delivery and uses stored employer/sponsor or employer-account contact resolution; it does not run AI contact enrichment in the send path.
- Send CV is separate from a formal application. Pending, failed, and delivered states exist, but there is no general background worker/admin queue to resolve and retry pending no-recipient applications. Email delivery followed by later database/notification failure can leave partial state; no transactional outbox was found.
- `requireDirectContact` is represented in the request contract but is not enforced in the reviewed route. Candidate UI/server contract drift should be resolved before relying on it as a safety boundary.
- Sponsor vacancies have richer close/expiry semantics than curated `roles` (`lib/db/src/schema/roles.ts`), which rely mainly on `active`. Employer job listings have published/closed status. This schema mismatch makes close/expiry behavior less uniform across sources.

## Scheduler and production status

### What the code does

- `artifacts/api-server/src/index.ts` starts some in-process schedulers (including sponsor-register sync, alert delivery, cleanup, and other maintenance work).
- In production it deliberately does **not** start the in-process job-board, company-site, or liveness schedulers and does not run vacancy catch-up at boot. Those are expected to be called by the external HTTP scheduler.
- Non-production starts the in-process vacancy schedules and catch-up logic. This is not evidence that production is scheduled.
- The production worker endpoint is `POST /api/internal/vacancy-jobs`. The current `docs/vacancy-jobs-http-cron.md` describes short awaited batches, shared lock behavior, caps, cursors, retry-after handling, and external cron-job.org schedules. It explicitly says those are deployment instructions, not a command to run from the development workspace.

### What is configured or verified

- The configured Replit workflows in the workspace are development commands for the API server, web app, mobile app, and component preview server. No scheduled deployment appears in that workflow list.
- No production Replit Scheduled Deployment or external cron-job.org/GitHub Actions job was inspected or verified. The audit therefore cannot say that production schedules are currently active.
- `docs/vacancy-jobs-scheduled-deployment.md` is explicitly marked **legacy/superseded** and says not to create those separate Scheduled Deployments. Do not follow its old setup over the newer HTTP-cron design.
- `docs/vacancy-pipeline-cron-job-org.md` and `docs/vacancy-jobs-http-cron.md` do not describe identical schedules/limits. Keep one clearly authoritative schedule and verify it against the current server caps before enabling jobs.
- Replit Scheduled Deployments, if chosen for another task, are configured in deployment settings and are distinct from development workflows. The current repository docs instead recommend external HTTP cron for vacancy work.

**Production scheduler conclusion:** Production automation is **implemented but runtime configuration is unverified**. Because production disables the local vacancy crons, a correctly configured external caller is required for continuous board/site pulls and liveness. An exposed endpoint or a schedule documented in a Markdown file is not evidence that the external schedule exists or is healthy.

## Monitoring and recovery

**Present**

- `vacancy_sync_log` stores run kind, status, counts, errors, and metrics. Company-site check records retain probe/crawl state, retry information, and errors.
- Super-admin routes expose recent register and vacancy sync logs and manual triggers (`artifacts/api-server/src/routes/superAdmin.ts`). Role/admin routes expose full liveness scan status and manual scan/import/backfill operations.
- The internal vacancy job route protects batch execution with a secret, server caps, an advisory lock, bounded deadlines, and explicit `409`/`504` behavior.
- The public health endpoint is process-level only; it does not prove database health, scheduler activity, source freshness, or candidate coverage.

**Missing or weak**

- No external alert integration or thresholds were found for missed cron runs, repeated sync failures, falling live coverage, stale sources, crawler errors, or Send CV delivery failure.
- Some manual/background admin jobs only log exceptions to the console. Recent sync-log views help inspect runs but are not an alerting or durable retry system.
- There is no universal source quarantine/disable and rollback facility for an incorrectly imported source batch. Retry state and candidate visibility gates are useful containment, but do not replace rollback.
- No automated “one live visible vacancy for every target profession/sector” monitor was found.

## Sector coverage verification

`docs/vacancy-coverage-verification.md` contains an inline, read-only SQL report and a snapshot dated **23 September 2026**. It reports GREEN for 21 onboarding professions, but several professions share a category, so a category count is repeated; it does not prove each profession has a matching role.

Important differences from runtime behavior:

- The SQL has a separate regex category classifier rather than calling the runtime `classifyVacancyCategory`.
- It checks the stored `url`, while candidate code may choose `applicationUrl ?? url`, then apply source-specific URL and contact-route checks.
- It does not fully match the runtime company-site evidence and manager-title review rules.
- It counts snapshot rows, not necessarily distinct roles after candidate deduplication.
- GREEN means at least one visible row in a category; it does not assert a minimum volume, source balance, employer diversity, or geography.
- Candidate-visible status uses 48-hour vacancy visibility; actionability can use a 6-hour link freshness condition.

The query is useful as an operator snapshot, not as an automated readiness gate. There is no committed generator, timestamped raw output, scheduled coverage report, durable GREEN/RED state, or alert when a category falls to zero. Replace the SQL classifier and predicates with the shared runtime rules and add an automated candidate-route parity check before using GREEN as a production SLA.

## Answers to the requested audit questions

1. **What production vacancy automation exists?** The API contains bounded production-capable board/site/contact/backfill/liveness jobs and protected internal job routes. Runtime schedule configuration was not verified.
2. **Which parts are automated?** Register sync, bounded ingestion workers, source probes, liveness logic, cleanup, ranking, and alerts have scheduler/worker code. Board/site/liveness automation in production depends on external cron.
3. **What remains manual/offline?** Sponsor enrichment and source routing produce CSV artifacts. The routing runner is review-only; the development-only website import is not a general production source importer. Coverage verification is a manual SQL snapshot.
4. **Is there a production-safe import pipeline for discovered sources?** Not a general CSV-to-production source import with a universal identity gate, audit batch, rollback, and quarantine. The production job workers upsert discovered vacancies from configured sources; that is not a general reviewed-source importer.
5. **Is there dry-run before import?** Yes for reviewed sponsor website import and the documented legacy contact importer. The newer Healthcare website importer has stronger dev-only and plan-hash guards.
6. **Is batch ID/source provenance supported?** Batch sync logs and per-vacancy source/evidence fields exist. Immutable source snapshots and complete per-advert provenance history are incomplete.
7. **Can bad imports be rolled back or sources disabled?** No universal rollback/disable tool was found. Existing liveness, retry, and visibility states can contain some issues; they do not restore the prior batch state.
8. **Is source liveness checked?** Yes. Company sites have a root probe with persisted state/retry metadata.
9. **Is vacancy liveness checked?** Yes. A sweep checks sponsor vacancies, roles, and published job listings and records outcomes.
10. **Is vacancy pulling continuously scheduled?** The code and external-cron instructions support recurring pulls. The actual production schedule is unverified.
11. **Is the scheduler configured for production or only documented?** Production in-process vacancy crons are disabled. External schedules are documented, but not verified as configured.
12. **Are company site, board/ATS, and Send CV separate?** Yes. Company-site crawl/direct-feed work, board adapters/backfills, and candidate Send CV delivery are separate paths, though they converge on candidate vacancy data.
13. **How are duplicates prevented?** Canonical URLs, fingerprints, external IDs, employer/source identity, transaction/advisory locks, and candidate-level employer/title dedupe are used. Employer/title dedupe can merge distinct roles.
14. **How are dead vacancies removed from candidate view?** Shared visibility rules hide dead, expired, missing, stale, unverified, and pending-review vacancies; positive dead sponsor rows are later cleaned up. Source-missing rows may remain hidden but stored indefinitely.
15. **How are source failures retried?** Durable retry/probe state and fixed cooldowns exist for some paths; transient persistence errors have bounded retries. Backoff is inconsistent, and there is no universal dead-letter queue.
16. **How are robots/policy blocks handled?** Company-site crawling applies robots, HTTPS, DNS/SSRF, redirect, pacing, body-size, and timeout controls. Supported public ATS JSON APIs have a narrow documented robots exception while retaining network safety controls.
17. **How are candidate-visible vacancies filtered/ranked?** Shared status, source evidence, category/profession eligibility, source/contact/apply rules, user preferences and signals feed ranking; the alert path reuses candidate composition/ranking.
18. **How is each sector verified?** A manual SQL query in `docs/vacancy-coverage-verification.md` checks category counts. It is not an automated, exact candidate-route parity test and does not prove every profession has a distinct live vacancy.
19. **What monitoring/logging exists?** Batch metrics, source check state, recent admin sync logs, full-scan status, and console/API error logs exist. `/healthz` is process-only.
20. **What alerts exist for sync failure?** No threshold-based external alerting was found. Some failures are visible in logs/admin views; some background errors are console-only.
21. **What is the safest path to autonomy?** Verify one external production scheduler and its secret/schema first; stage source imports with dry-run, provenance, disable/rollback; serialize recurring pulls; align source-missing retirement and candidate coverage checks; then add durable alerts/retry.

## Risk list, highest first

| Severity | Risk | Why it matters |
| --- | --- | --- |
| **Critical** | External production schedule is unverified while production in-process vacancy schedules are disabled. | Vacancy freshness can silently stop even though the code and docs look complete. |
| **High** | No universal reversible production source-import/quarantine process. | A bad source batch can contaminate or misroute vacancies without a reliable rollback. |
| **High** | No alerting for missed jobs, falling visible coverage, or repeated sync failures. | Operators may not know automation has stalled. |
| **High** | Source-missing rows are hidden but not guaranteed to age into dead/removed rows. | Stale data can accumulate and complicate audits, dedupe, and candidate counts. |
| **High** | Manual coverage SQL can diverge from runtime filters and reports category rather than profession guarantees. | GREEN can overstate what candidates can actually see and act on. |
| **Medium** | Normal employer-board adapters cover NHS Jobs and Reed; other boards rely on separate backfills. | “All job boards” is not an accurate description of the normal continuous adapter path. |
| **Medium** | Direct-feed support and authoritative removal support do not fully align across providers. | Some feeds cannot safely retire missing postings after a complete snapshot. |
| **Medium** | Retry/backoff is fixed or timestamp-based in several paths. | Repeated transient failures can delay recovery or hide the reason for delay. |
| **Medium** | Lifecycle fields differ across sponsor vacancies, curated roles, and employer job listings. | Expiry/closure/removal parity is harder to maintain across all candidate paths. |
| **Medium** | Send CV lacks a durable retry worker/outbox; request contract and recipient behavior are not fully aligned. | Provider success followed by persistence/notification failure can produce partial delivery state. |
| **Medium** | Employer/title candidate dedup can collapse distinct same-title vacancies. | Candidates may lose valid opportunities or see ambiguous role identity. |

## What can safely go live now

- Candidate-facing reads of already-persisted vacancies can use the existing server-side visibility and action gates, subject to production schema/migration verification.
- Read-only admin sync-log and coverage inspection can be used as diagnostics; they are not substitutes for alerts.
- The bounded, secret-protected worker endpoint is a reasonable production execution mechanism **only after** confirming the production secret, schema, caps, single scheduler owner, and external schedule. A documented endpoint is not a reason to call it during this audit.
- Keep AI vacancy web search disabled at the production cap of zero unless that policy is explicitly changed.

Do **not** claim autonomous production discovery is live until the external schedule and successful run history are verified. Do not enable the superseded Scheduled Deployment instructions or re-enable production in-process vacancy cron/catch-up without a deliberate architecture change.

## Recommended implementation plan

### Phase 1 — Safe production readiness

1. Verify in the actual production scheduler whether the current HTTP cron jobs exist, their timezone/cadence, request timeout, and whether retries are sequential.
2. Verify the production `VACANCY_JOB_SECRET` is configured without displaying it; verify the route rejects missing/invalid authentication and has the expected production schema.
3. Reconcile the conflicting scheduler documents into one source of truth. Confirm production remains single-writer and that no legacy scheduled deployment or node-cron job duplicates it.
4. Run the local typecheck and relevant mocked/unit suites below. In a controlled staging environment, exercise one bounded worker batch, lock conflict, timeout finalization, and candidate visibility; do not use the production endpoint as a test.
5. Make current sync state, missed-run detection, and candidate-visible freshness measurable before scaling up.

### Phase 2 — Automated source import

1. Add a production source-import plan that uses exact employer/source identity, a stable batch ID, and per-row provenance.
2. Require dry-run output and explicit approval before apply; preserve existing values unless a separately reviewed update policy permits replacement.
3. Add a first-class source disable/quarantine and batch rollback/reversal path with an audit record.
4. Harden or retire the legacy sponsor-contact importer so it cannot target production accidentally.
5. Test duplicate inputs, identity ambiguity, partial apply, rollback, and repeated idempotent import.

### Phase 3 — Continuous vacancy sync

1. Keep one sequential external caller per shared writer lock and honor `409` / `504` `Retry-After` responses.
2. Align recognized ATS providers, actual connector support, complete-snapshot authority, and missing-posting retirement rules.
3. Define when authoritative source absence moves from `missing` to `dead`/closed and when cleanup may remove the row; never infer closure from partial or non-authoritative snapshots.
4. Use consistent bounded retry/backoff with persisted reason and attempt count for source, vacancy, and persistence failures.
5. Keep board, company-site, contact, and liveness metrics explicitly typed and comparable across runs.

### Phase 4 — Monitoring and alerts

1. Alert on missed expected runs, repeated errors, high `409`/`504` rates, probe/crawl backlog, stale visible-vacancy counts, and category/profession coverage drops.
2. Persist failure and retry state for manual background jobs and Send CV delivery; add an operator retry/resolve view for pending work.
3. Replace the coverage SQL's independent classifier with an automated parity check over the shared runtime visibility rules and all target professions.
4. Add end-to-end staging tests for source → stored vacancy → liveness → candidate API → Send CV, including failure and recovery paths.

## Exact readiness commands and checks

These commands were **not run**; they are recommended verification commands. They run local tests/build checks rather than importing or crawling:

```sh
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server run build

pnpm --filter @workspace/scripts typecheck
pnpm --filter @workspace/scripts vacancy-source-routing:test
pnpm --filter @workspace/scripts sponsor-enrichment-export:test
pnpm --filter @workspace/scripts healthcare-sponsor-import:test
```

The API test suite includes relevant coverage for `companySiteDiscovery`, `directEmployerBoardConnectors`, `boardVacancyPipeline`, `vacancyLiveness`, `vacancyLivenessSweep`, role routes/ranking, alerts, and `speculativeApplications`. The corresponding tests should be kept in the readiness gate when those paths change.

Operational verification, **only after explicit go-live approval and in a controlled environment**:

1. Check the external scheduler settings and run history; do not infer production scheduling from development workflows or repository cron documentation.
2. Use the documented `POST /api/internal/vacancy-jobs` examples in `docs/vacancy-jobs-http-cron.md` with a capped request, and wait for each response before the next request. Never put the secret in a URL/body/log.
3. Inspect the resulting `vacancy_sync_log` row and source/company-site retry state; verify `kind`, counters, `errors`, lock behavior, and that a 504/409 retry is not concurrent.
4. Reconcile and run the inline query in `docs/vacancy-coverage-verification.md` against an approved read replica only after aligning its classifier and visibility predicate with runtime code. The current query must not be treated as definitive candidate-visible coverage.
5. Verify representative candidate API results and action endpoints after liveness; a live count alone does not prove the vacancy is visible, correctly ranked, or actionable.

## Audit completion statement

This report was created from repository code, tests, and documentation. No production database data was changed, no production endpoint was called, and nothing was deployed. No crawl, enrichment, or import was run for this audit; the pre-existing local website-discovery process was stopped as noted above.
# JOBSAGE vacancy coverage — development architecture and baseline audit

**Snapshot:** 2026-10-11, development environment  
**Purpose:** Establish the real candidate-visibility baseline before coverage changes. The attached coverage specification remains the acceptance contract.

## Scope and safety

- Git was recorded before edits: branch `master`, five commits ahead of `origin/master`, commit `9af7cea4d557d7a8c98979830fc6f2cb09d49dd1`; the attached specification was the only untracked workspace file.
- The development app's read-only SQL connection and the Replit development SQL environment both identify database `heliumdb`. The measured development snapshot contained 14,016 sponsor-vacancy rows.
- The baseline and source audit are read-only. The running development API has its pre-existing bounded schedulers enabled; their development logs recorded one company-site batch and one liveness sweep during this audit. No production database writes, deployment, or production-scheduler changes were initiated.
- No CV was sent as part of this work. No test email was sent to an employer.
- The bounded source probes used injected in-memory persistence and an unreachable dummy database URL. The first run missed three free-feed IDs due to `--name=value` parsing; that parser was fixed and those feeds were probed separately. Neither run wrote to a database.

## Architecture map

1. **Discovery**
   - Employer-scoped job-board checks use the shared board pipeline and currently include NHS Jobs and Reed.
   - Candidate-triggered board refresh selects the NHS Jobs family for regulated professions and Reed for other mapped professions.
   - Bounded profession backfills exist for Reed, NHS Jobs, jobs.ac.uk, Teaching Vacancies, and configured public feeds. They are not a continuously complete cross-sector catalogue.
   - Company-site discovery runs separately against saved employer/careers evidence and supported ATS providers: Ashby, Greenhouse, Lever, SmartRecruiters, Recruitee, Personio, Pinpoint, and Workday. A parser or directory hit alone is not proof of employer ownership or a valid board.
   - Adzuna credentials and CV-Library partner authorization are unavailable in development. AI contact lookup remains disabled; it is not used to fill this gap.

2. **Employer identity and sponsor matching**
   - Public-feed discovery is restricted by sponsor/employer identity resolution. Exact and unique normalized-name matches can be accepted; ambiguous and unmatched results must not be promoted.
   - The sponsor register is an employer universe, not proof that an individual vacancy offers sponsorship and not a complete universe of UK employers.
   - Sponsor-register contact addresses are distinct from vacancy-level recruitment contacts.

3. **Classification**
   - Candidate matching currently uses a 37-category profession/opportunity taxonomy. It is separate from sponsor-register industry and marketing-lead industry.
   - Company-site role discovery and candidate profiles now use the same canonical eight-sector list.
   - Some current category relationships are intentionally cross-matched (notably IT/Engineering); summing category results is not a unique-vacancy total.

4. **Persistence, deduplication, and liveness**
   - Board and company-site adverts pass through a shared validation/upsert path. It preserves source identity and uses URL/external-ID and normalized vacancy fingerprints with PostgreSQL advisory locking.
   - Candidate visibility is stricter than discovery: live state, recent verification (normally within 48 hours), UK location, a specific valid link, unexpired/open state, and acceptable company-site evidence are required.
   - Incomplete source snapshots must not retire previously observed vacancies.

5. **Candidate API and UI**
   - `/api/roles` combines sponsor vacancies, curated roles, and employer job listings. Source-specific candidate modes are filtered through the shared role/visibility rules; category/profile and region preferences further narrow results.
   - `fetchSponsorVacanciesAsRoles` is the helper used for the source-separated baseline below. It enforces current visibility, UK location, profession relevance, and, for this measurement, a specific live URL.
   - The current candidate UI and alert paths consume the API's role/category results; they are not equivalent to discovery totals.

6. **Contact enrichment, Send CV, and tracker**
   - Contact enrichment is persisted per employer with source, evidence URL, and extraction time. Development contained 1,048 complete syntactically usable records with all three fields present.
   - There is no persisted email-validation result or confidence field, so those records cannot currently be counted as validated destinations under the specification.
   - The candidate-facing direct-contact helper accepts syntactically usable sponsor, employer-profile, or employer-account addresses. Employer-account verification is not part of that eligibility query. This makes the current API boolean an unverified signal, not a compliant Send CV count.
   - Send CV creates durable application and delivery-attempt records. Development has 14 attempts recorded as `delivered` and 4 as `pending`; the attempt schema does not record a controlled sandbox recipient or sandbox marker. Those 14 therefore cannot be attested as safe sandbox deliveries.
   - The legacy recipient resolver has an operations-inbox fallback. It must never be counted as direct eligibility or described as employer delivery.

7. **Scheduling and retries**
   - Development runs bounded in-process job-board, company-site, and liveness schedulers, plus stale-pipeline catch-up. The development API logs show company-site/liveness batches writing only to the development database.
   - Production short jobs are designed for an authenticated external HTTP scheduler. This audit does not verify or alter that scheduler.
   - Batch outcomes are recorded in `vacancy_sync_log`; the system has bounded batches, leases/locks, source backoff, and liveness checks, but not a durable per-employer cursor for every source task.

## Candidate-visible baseline by sector and mode

Counts below are source-separated current candidate-helper results, not raw discoveries. A row is counted only when the helper's live/freshness, UK, category, contact-route, and specific-link checks pass. `API Send CV flag` is the current boolean and is explicitly **not** a validated direct-eligibility count.

| Canonical sector | Job Board visible | Company Website visible | Current API Send CV flag | Verified direct Send CV eligible | Verified sandbox delivered |
|---|---:|---:|---:|---:|---:|
| Healthcare | 3,315 | 37 | 587 | 0 evidenced | 0 evidenced |
| Education | 919 | 0 | 5 | 0 evidenced | 0 evidenced |
| Engineering | 121 | 18 | 7 | 0 evidenced | 0 evidenced |
| IT | 108 | 17 | 6 | 0 evidenced | 0 evidenced |
| Legal | 4 | 0 | 0 | 0 evidenced | 0 evidenced |
| Accounting | 58 | 2 | 2 | 0 evidenced | 0 evidenced |
| Architecture | 11 | 1 | 0 | 0 evidenced | 0 evidenced |
| Business Development | 1,454 | 11 | 133 | 0 evidenced | 0 evidenced |

The current API flags total 740 across sector-helper calls; the source-separated candidate counts sum to 5,990 Job Board and 86 Company Website results. These sums are not asserted to be globally unique because category overlap can repeat a vacancy. No cross-source global unique count is asserted.

The strict verified-direct count is zero **as an evidenced count**, not proof that no usable email exists: the database lacks stored validation results and the current eligibility flag does not enforce the complete specification. Existing `delivered` attempts are not counted as sandbox deliveries without sandbox-recipient evidence.

### Gate status at baseline

- **Job Boards (200 per sector):** Healthcare, Education, and Business Development meet the numeric floor; Engineering, IT, Legal, Accounting, and Architecture do not.
- **Company Websites (100 per sector):** No sector meets the numeric floor.
- **Verified direct Send CV (100 per sector):** No sector has countable persisted validation evidence.
- **Global minimums:** A global unique-vacancy total is not established from category-helper sums. Direct-send and sandbox gates are not met.
- Source-family diversity, employer concentration, per-stage discovery funnel, and 50-per-mode precision are not established by the existing metrics. They must not be inferred from the visible counts.

## Bounded no-write public-source audit

The audit exercised Reed, the additional-board backfill, and all eight configured free-feed adapters. Its output is discovery evidence only: matched rows were not imported, validated as live, or exposed to candidates. The CSV marks each row `candidate_visibility_status=not_imported`; that is an unmeasured state, not a claim that the source has zero eligible jobs.

- The initial run produced 2,055 distinct apply URLs. The corrected run for the three omitted feeds produced 145 more; URL-set overlap was zero, for 2,200 distinct URLs across the two exports.
- The public-feed calls fetched 8,256 records in total. Across the eight feeds there were 1,676 sponsor-name matches and zero ambiguous name matches. These are per-feed matches, not 1,676 unique eligible vacancies.
- Six feeds reached their 20-page run limit. Only jobs.ac.uk and Jobicy completed their available pagination in these bounded runs. Arbeitnow and Himalayas both stopped at the page limit.
- The external sponsor-name file contained 127,367 names. The development sponsor register had 142,999 rows and 127,397 distinct names; exact set overlap was not calculated.

| Source | Records fetched | Sponsor-name matches | Ambiguous | Pagination result | Distinct output URLs |
|---|---:|---:|---:|---|---:|
| NHS Jobs | 2,000 | 959 | 0 | 20-page cap | 1,149 |
| Teaching Vacancies | 2,000 | 131 | 0 | 20-page cap | 131 |
| NHS Scotland | 240 | 235 | 0 | 20-page cap | 235 |
| jobs.ac.uk | 250 | 169 | 0 | complete | 215 |
| CharityJob | 300 | 37 | 0 | 20-page cap | 37 |
| Arbeitnow | 2,450 | 87 | 0 | 20-page cap | 87 |
| Jobicy | 773 | 38 | 0 | complete | 38 |
| Himalayas | 243 | 20 | 0 | 20-page cap | 20 |
| Reed | 2,240 | 307 | not measured | profession-targeted probe | 288 |
| Additional board adapters | 1,981 | 607 | not measured | bounded backfill | 236 |

The per-source match counts can include the same employer across feeds and must not be added to estimate candidate-visible vacancies. Distinct output URL counts reflect all collectors assigned to each source, so they do not necessarily equal that feed's standalone sponsor-name match count. URLs are deduplicated within and across the two exports, but are still not liveness, sponsorship, direct-contact, or candidate-visibility proof. Detailed bounded results are in `vacancy-coverage-source-audit-2026-10-11.json`.

## Sector catalog and development profile migration

One canonical eight-sector catalog now feeds company-site sector checks and candidate profile selection. Onboarding and profile editing send the selected sector; the API validates it against the profession, derives it for older clients that omit it, and returns a display label. Non-healthcare profiles now submit `not_applicable` for clinical registration and a null home-country licence value; regulated healthcare professions can retain an explicit `unknown` status rather than being defaulted to “not registered.”

The development `profiles.sector` column is nullable text. An additive migration and backfill ran only against the explicit development database:

| Existing profession value | Canonical sector | Rows |
|---|---|---:|
| doctor / Doctor | healthcare | 11 |
| nurse / Nurse | healthcare | 6 |
| allied_health_professional | healthcare | 1 |
| IT Professional | it | 1 |
| student | null — quarantined as unsupported | 1 |

All 20 profile rows remain present; the raw `profession` values were preserved. The 19 recognized rows were mapped, and the single `student` row remains outside sector-specific counts. The migration report is `profile-sector-migration-2026-10-11.json`. No production schema or data was changed.

## Development worker evidence during the audit

- One bounded company-site batch selected and checked 10 employers, upserted 6 vacancies, retired 2, and recorded 3 transient errors. It reported at least 4 remaining employers. This is a write-run by the already-configured development worker, not a production run.
- One liveness sweep checked 600 rows: 430 live, 56 dead, 114 inconclusive, with 2,485 remaining. The backlog is not yet fresh/completed.
- No public-source audit rows were imported, so these probes did not change candidate-visible counts. The displayed candidate baseline predates this audit's worker writes; a new exact-helper matrix is still needed after the development worker backlog settles.

## Taxonomy and migration findings

The taxonomy remains deliberately separated by domain:

- Candidate profile profession remains a persisted label from the shared 37-category profession catalogue and aliases; profile sector is a nullable canonical classification.
- Sponsor vacancy classification still uses profession/opportunity categories. They were not blanket-converted to sector strings.
- Company-site checks and candidate profiles now use the same eight canonical sector IDs.
- Sponsor-register `industry`, employer-account `industry`, and marketing `industrySector` are separate domain fields. Their labels are not safe to blanket-convert into vacancy sectors.

The migration is intentionally nullable and preserves raw profession text. Unrecognized or ambiguous future values must remain null and be reported rather than guessed; sponsor, employer-account, and marketing industry labels remain outside this conversion.

## Known blockers and next measurements

1. Remeasure the candidate matrix after current development worker writes settle, using the exact role helper and candidate visibility predicates.
2. Direct Send CV remains 0 evidenced: contact records have no persisted validation result/confidence, existing delivered attempts have no sandbox-recipient marker, and no real CVs or employer test emails were sent.
3. Company-site coverage remains below 100 in every sector. Public-source audit rows are not a safe substitute for employer ownership, current liveness, sponsorship, or specific-vacancy evidence.
4. Adzuna credentials and CV-Library partner authorization remain unavailable in development. Do not bypass source access, identity, URL, freshness, or sponsorship-evidence rules to close the numeric gaps.
5. A repeatable, production-refusing development proof command and post-worker candidate matrix are still needed for future coverage runs.

# JobSage sponsor vacancy pipeline — local live validation, 8 October 2026

## Provenance and safety boundary

- Fresh clone: `JobSage-Platform-fresh-20261008`
- GitHub default branch: `master`
- Commit: `2781843d646ad97472cfb72d212b6a83e9f04a32`
- Git LFS smudge was disabled during clone.
- The proposed patch passed `git apply --check` and applied cleanly because the clone commit matched its base. Further fixes were made after live testing.
- No JobSage database was connected to or modified. No CV was sent, no application was submitted, and nothing was pushed or deployed.

## Official register

The live GOV.UK asset contained 143,186 rows. The exact default route filter selected 122,386 unique Skilled Worker sponsor name-and-town identities. Exact name-and-town repository evidence supplied an industry for 7,462 identities.

## Live vacancy result

The isolated export contains 237 distinct current UK role links and zero duplicate apply URLs:

| Sponsor | Mode | UK vacancies | Deep links checked live | Sponsor match | Guarded import |
| --- | --- | ---: | ---: | --- | --- |
| Monzo Bank Ltd | job_board | 54 | 10 | exact-register-name | eligible |
| 9fin Limited | job_board | 21 | 10 | brand-to-legal-name-review | blocked |
| Vertical Aerospace Group Ltd | job_board | 6 | 6 | group-entity-review | blocked |
| Nuffield Health - Hospitals Division | company_website | 156 | 10 | division-scope-review | blocked |

The Nuffield public Algolia source returned 446 records; the UK-location filter retained 156 and rejected 290 non-UK/unsuitable-location records. All 237 rows retain `sponsorship_status=unknown`. A Skilled Worker licence is not evidence that an individual vacancy offers sponsorship.

Application-mode totals are 81 `job_board` and 156 `company_website`. The measured four-sponsor runtime was 37.1 seconds for the three job-board sources and 21.5 seconds for the company-website source. These are local sequential per-sponsor timings, not cron throughput guarantees.

No suitable public recruitment mailbox was verified. Zero rows are exposed as `send_cv`. Generic addresses remain excluded; role-labelled addresses require employer-scope review before they could become a Send CV route.

## Sector probes

Twenty-six actual sponsors were scanned. Exact industry-evidence probes included:

| Industry | Sponsor | Runtime | Vacancies |
| --- | --- | ---: | ---: |
| Social Care | CREATIVE CARE HOME LIMITED | 5.9s | 0 |
| Education | Little Garden Gate Nursery Ltd | 2.3s | 0 |
| Engineering | 2 EXCEL ENGINEERING LIMITED | 53.5s | 0 |
| Finance | 1 Answer Insurance Services LTD. | 24.6s | 0 |
| Technology | 1 And 5 Tech Ltd | 26.9s | 0 |
| Hospitality | 12.18 Roxburghe Hotel Golf & Spa Ltd | 35.1s | 0 |
| Construction | 1066 PLUMBING AND HEATING LTD | 5.3s | 0 |
| Manufacturing | 1 Stop Print Ltd | 12.6s | 0 |
| Retail | 4FEET RETAIL LTD | 16.2s | 0 |

Healthcare was represented by Brooke Healthcare Ltd, (IECC Care) Independent Excel Care Consortium Limited, and the Nuffield division. Other broad-sector samples were SEAHAM HIGH SCHOOL; "K" Line Energy Shipping (UK) Limited; CONSTRUCTION POINT LIMITED; 01 Accounting Services Ltd; BRITANNIA BUSINESS CONSULTING LIMITED; MULTIPLIER TECHNOLOGIES UK LTD; Rotamat Limited trading as Huber Technology; 1 Green Foods Ltd; Asian African Foods Ltd; 108 RETAIL LIMITED T/A SPAR; and Bossmans Retail Abergavenny Ltd. The four vacancy-bearing sponsors in the table above complete the 26-company set.

The exact industry sample is deliberately small and returned no roles. It establishes failure/runtime behaviour, not sector-wide vacancy volume. Random small-employer scans are low yield; reaching thousands requires more reviewed first-party website/ATS mappings and broader bounded runs, not extrapolation from this sample.

## Website and careers evidence

Among 26 companies, 12 responding/resolved website candidates were recorded: four matched saved name-and-town website evidence, one came from review-flagged reference evidence, and seven were runtime guesses. Six careers-page candidates were recorded. Only the four targeted public vacancy sources produced live UK roles. Guessed websites and review-flagged entity mappings must not be promoted automatically.

## Reliability changes validated

- Skilled Worker is the default exact sponsor route; same-name sponsors in different towns remain separate.
- Isolated `--results-file` and `--out-dir` prevent committed historical results contaminating a live run.
- Cron uses a filesystem lock, least-recently-checked selection, bounded limits and concurrency, resumable append-only state, retries, and a recent-complete export window.
- URLs are HTTPS-only, normalized and globally deduplicated. Tracking parameters do not create duplicates.
- Live reference hints are refetched and retain their sponsor review status.
- JSON-LD expiry and Nuffield's public Algolia configuration are handled; role URLs can be deep-checked in bounded batches.
- Generic contacts never become verified Send CV routes.

## Verification

- Standalone focused tests: 8/8 passed.
- JobSage database-free vacancy/application compatibility suites: 35/35 passed across five files.
- Three more app suites could not load because the repository requires `DATABASE_URL`; no database was provisioned by design.
- API typecheck did not pass: workspace declaration outputs were not built, producing `TS6305` errors and cascading baseline errors. This is not presented as a clean monorepo typecheck.
- Network doctor reached GOV.UK, Greenhouse, Ashby, SmartRecruiters, Lever, BambooHR, Workday and a UK company site; provider-specific 404/406 responses still demonstrated host reachability.

## Remaining work

The result is repeatable and materially live, but it is not yet a thousands-of-vacancies result and it does not prove sector-wide coverage. Before any guarded database import, resolve the 9fin legal-name, Vertical group-entity, and Nuffield division scope; add verified first-party mappings for high-volume sponsors in every requested sector; and run a larger scheduled cohort while measuring source success, expiry, retry rates and provider throttling.

## Scale phase completed later on 8 October 2026

The API-side no-write audit was expanded to NHS Jobs, NHS Scotland, jobs.ac.uk,
Teaching Vacancies, CharityJob, Reed and the previously verified first-party ATS
sources. It read 122,136 unique sponsor names from the local official-register
snapshot and fetched live public vacancy pages without connecting to JobSage's
database.

After canonical URL deduplication, the combined local dataset contains 7,555
current source-observed vacancy links and zero duplicate URLs. Of those, 5,967
have an exact official-register employer name. A further role-classification gate
leaves 3,218 strict guarded-import candidates. The remaining 2,749 exact-name
records are blocked because their roles are not yet classified, and 1,588 are
blocked for employer-identity review. These counts are evidence from the local
audit export, not claims that the records have been imported or shown to users.

| Application mode | Collected links |
| --- | ---: |
| Job board | 7,399 |
| Company website / first-party ATS | 156 |
| Verified Send CV | 0 |

The 3,218 guarded candidates by category are: Accounting 27, Architecture 1,
Business Development 1, Construction 10, Dental 58, Education 253,
Engineering 41, Finance 7, GMC 909, HCPC 587, Hospitality 47, IT 44, Legal 6,
Manufacturing 0, NMC 981, Pharmacy 203, Retail 2 and Social Work 41. This proves
broad cross-sector representation, but the strict set still has no manufacturing
vacancy and is not thousands in every sector; healthcare and education dominate.

The source totals are NHS Jobs 5,334, NHS Scotland 859, jobs.ac.uk 751,
CharityJob 207, the verified Algolia company source 156, Teaching Vacancies 105,
Reed 62, Greenhouse 54 and Ashby 27. All 7,555 records retain
`sponsorship_status=unknown`: sponsor licensing remains separate from
vacancy-level sponsorship evidence.

A second priority company-site run was stopped after roughly 17 minutes because
it was not scaling: 24 organisations produced 12 websites (10 confirmed from
saved evidence), 5 careers-page candidates, no verified recruitment email and
no vacancy. This negative result is retained rather than extrapolated.

The application layer no longer marks every sponsor role as Send CV eligible.
Public generic mailboxes such as `info@` are excluded; only an explicit employer
route or a recruitment-labelled mailbox with evidence can enable that route.

The scheduler now uses larger but bounded per-run limits, rotating cursors,
deadlines, retries and separate external-cron jobs for the public feeds. The
coverage audit and merger are repeatable package scripts and generate both CSV
and machine-readable metrics. The merger also writes a separate guarded-only CSV
so review-blocked rows are not mixed into a future import. The API build passed, 150 focused source/matching/
application tests passed, 32 scheduler/internal-endpoint tests passed, and the 8
standalone pipeline tests passed.

Candidate-visible vacancies remain zero because the user prohibited development
and production database writes for this work. The generated CSV is a guarded
review/import artifact; making records visible requires explicit permission for
a controlled database import and post-import liveness check.

## Continued scale validation on 9 October 2026

The official/public feeds were run to their complete observed depth where the
source exposed an end: NHS Jobs 12,552 records over 126 pages, Teaching
Vacancies 7,289 records over 73 pages, and jobs.ac.uk 2,091 records over 84
pages. NHS Jobs produced 6,766 sponsor-name matches, Teaching Vacancies 468,
and jobs.ac.uk 1,482. Additional bounded Arbeitnow, Jobicy and Himalayas reads
produced 176 sponsor-name matches, while the expanded Reed matrix produced 179
classified sponsor matches.

The combined canonical dataset now contains 10,645 unique current-source links,
with 80 duplicate URLs removed. Exact guarded identity plus profession checks
leave 4,513 guarded vacancies; 3,610 exact-identity records remain blocked as
unclassified and 2,522 remain blocked for sponsor/employer identity review.

Application modes are now mapped by destination rather than provider branding:
employer-specific Greenhouse, Ashby, Workday, Workable and similar tenants are
`company_website`, while multi-employer sources remain `job_board`. The local
result contains 10,137 job-board links and 508 first-party company/ATS links.
Only 26 company/ATS links currently pass strict identity and role gates; the
largest newly discovered boards remain blocked where the official site names a
different legal entity or the evidence confidence is insufficient.

Guarded profession totals are: GMC 1,146; NMC 1,230; HCPC 817; Education 630;
Pharmacy 254; IT 80; Engineering 72; Dental 60; Hospitality 58; Social Work 45;
Accounting 43; Finance 23; Construction 20; Legal 14; Business Development 9;
Architecture 5; Retail 5; and Manufacturing 2. This is thousands overall and
over one thousand for GMC and NMC, but it is still not thousands for every
profession.

The cross-sector website evidence file is now part of scheduled discovery. Two
hundred evidence-backed careers sites in education, healthcare, public/charity
and other sectors and more than one hundred in the initially thin sectors were
checked in bounded batches. A stale keep-alive issue that left a completed CLI
process running was fixed by explicitly ending the one-shot process after its
files and lock are closed.

Send CV now has a separate proof path. Sixty-seven saved recruitment-email
candidates were live checked; only four routes passed both exact sponsor/site
identity and an explicit current-page instruction to email or submit a CV.
Generic contact addresses and recruitment-labelled mailboxes without that
instruction remain blocked. The verified routes are exported separately from
vacancies.

Current validation is 12/12 standalone pipeline tests, 190/190 focused API
source/matching/application/scheduler tests, and a successful API build. No
database was connected or modified, no CV or application was sent, and nothing
was pushed or deployed.

## Shared taxonomy and guarded recovery on 9 October 2026

A single shared catalogue now supplies the API, onboarding dropdown and profile
dropdown. It contains 38 candidate professions across 10 sectors and keeps the
statutory GMC/NMC/HCPC regulator dimension separate from opportunity families.
Profile writes canonicalise recognised legacy aliases and reject new arbitrary
profession strings. Vacancy exports now include classification confidence and
reason fields.

The expanded deterministic title classifier added healthcare support, research
and academia, administration, project/programme management, operations, HR,
marketing, sales/account management, procurement/supply chain, fundraising,
public policy, facilities, customer service, transport/logistics, science/lab,
media/creative, care support and broader clinical healthcare families. Broad
new families require title evidence rather than incidental words in a
description.

Unique normalised employer names are accepted only where the live source
resolver found exactly one sponsor-register organisation after harmless legal
name normalisation. This recovered the 1,942 uniquely resolved records while
leaving 580 division, group, brand, website-confidence and non-unique cases in
identity review.

The regenerated no-write audit contains 10,645 unique links. It has 10,065
identity-eligible rows and 7,700 rows passing identity, classification and title
policy gates. The remaining blocks are 1,976 unclassified, 580 identity review
and 389 title-policy exclusions. New guarded families include Administration
361, Healthcare Support 430, Clinical Healthcare 281, Care Support 287,
Research/Academia 321, Project/Programme 101, Operations 125, HR/Recruitment 46,
Fundraising/Charity 27, Hospitality 40 and Construction 26. Existing guarded
totals include NMC 1,500, GMC 1,376, HCPC 1,057, Education 736, Pharmacy 294,
IT 143 and Engineering 120.

The title policy now distinguishes elementary work from skilled occupations
such as chefs, hospitality managers and named construction trades. Vacancy-level
sponsorship remains unknown unless the advert explicitly confirms it; occupation
classification and sponsor-register membership do not create that claim.

Focused taxonomy/classification/profile/title-policy validation passed 201/201.
Shared-library, API and web typechecks passed. API and Windows web production
builds passed after restoring the Windows Lightning CSS and Tailwind native
packages that the workspace overrides had excluded. No database was connected
or modified and nothing was deployed or pushed.

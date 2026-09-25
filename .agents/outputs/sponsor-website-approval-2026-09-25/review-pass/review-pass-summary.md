# Sponsor website approval review pass — 2026-09-25

## Scope and safeguards

- Reviewed all 971 development-only review-required employers using saved sponsor websites, stored career links, current live+verified company-site vacancy rows, same/related-host linkage, ATS evidence, prior fetched page titles/excerpts, known aggregator/blocked-host checks, and recorded geography results.
- This review’s database queries and manual rollout were development-only; no production database write or deployment was initiated. Rejected rows were not reconsidered; the separate rejected list remains unchanged at 33.
- This review approves employer sources, not individual vacancies. The rollout pipeline will recrawl approved sites and reapply its role, geography, liveness, application-link, and candidate-visibility checks.
- Auto-approval threshold reached: 109 distinct employers total (29 retained + 80 from this review).

## Decision rule

New same-host approvals require all of: a valid HTTPS saved employer website; an employment-oriented careers/jobs URL on the same registered domain; a current live+verified company-site role row linked to that domain; a meaningful employer/trading-brand or clearly related-host match; and no known aggregator/blocked host, conflicting saved website, or recorded geography mismatch. Current role evidence includes structured evidence or an active bounded migration-grace row; the per-employer CSV states which. The 14 prior-page approvals require fetched page identity evidence plus an official/related employer site and no recorded geography mismatch.

The following remained review-required despite other positive signals: 2H Offshore (stored page is news, not a role source); Bletchley PJ Pizza/Papa Stadium (franchise-to-brand employer attribution unresolved); 80,000 Hours (career guide, not an employer careers source); Enterprise Singapore and ADNOC (stored evidence is foreign-facing); 2CRSi (sampled roles are in France); 1st Focus Homecare (stored sample is informational/guide content); 3Search and AA Euro Recruitment (job-search pages may represent client vacancies); Blacklane Havn (driver application is not established as employee hiring); and ACCA (saved website URL is HTTP, so the development runner will not accept it).

## Totals

- Auto-approved employers: **109** (80 newly approved: 66 same-host careers + current role evidence, and 14 fetched-page identity reviews; 29 existing approvals retained).
- Review-required employers after this pass: **891**
- Rejected rows unchanged and separate: **33**
- Careers URLs in approved pool: **79**
- Employers with an ATS provider or board ID: **4**; verified mappings: **3**
- Approved employers by sector: Construction 5; Engineering 7; Finance 4; Healthcare / social care 14; Hospitality 4; Manufacturing 1; Other 56; Technology 5; Unclassified 7; Education 2; Retail 2; Transport 1; Legal & professional 1
- Remaining review-required by reason category: prior_audit_review_required 27; multiple_licence_ids 82; no_current_identity_audit 779; ats_evidence_not_first_party 1; name_or_licence_duplicates_need_resolution 1; multiple_website_hosts 1

## Rollout input

A deterministic 100-employer cohort is prepared: 100 rows, 100 unique names and IDs, HTTPS websites only, and no rejected rows. It contains 29 retained approvals, all 14 prior-page identity approvals, and 57 of the strongest same-site candidates, prioritized by the requested sectors, single-licence identity where possible, structured/current evidence, and role-specific samples.

Preflight dry run: selected 100 unique employers; 92 matched an exact single sponsor row, while 8 stopped before discovery because multiple same-name licence rows made the sponsor identity ambiguous (Vertical Aerospace Group Ltd; aventis pharma Ltd  t/a Sanofi; Animal Friends Insurance; BlackRock Investment Management (UK) Limited; BMC Software Ltd; Azeus UK Ltd; 4170 UK LLP; ABF Ingredients Limited). These are counted as rollout failures unless the source database supports a safe exact identity.

Baseline under the sponsor-licence route’s shared company-site vacancy gates: 232 visible company-site rows across 34 cohort employers; 43 visible rows had application URLs; 36 visible rows rely on bounded legacy evidence; 2 duplicate URL groups already existed. Each visible row is live, verified within 48 hours, has a URL, is not expired/closed/source-missing, and has structured company evidence or unexpired legacy grace. This is the backend visibility gate before candidate-specific region and matching filters.

## First development rollout — completed

- Same deterministic cohort: 100 selected; 92 eligible for site discovery and 8 stopped before discovery by same-name/multiple-licence identity conflicts. No ambiguous sponsor row was guessed.
- Row outcomes: 50 complete; 32 partial_page_limit; 1 partial_deadline; 9 crawl failures; 8 sponsor_identity_conflict.
- Pipeline counts: 37 inserted; 128 updated; 0 revived; 32 no_jobs; 12 employer websites filled; 165 adverts found and 959 rejected; 13 locations known and 152 unknown.
- Candidate visibility for the 100-employer cohort after pass one: 328 rows across 43 employers, 43 with application URLs, 296 structured-evidence rows, 32 bounded-legacy rows, and 1 duplicate URL group. Baseline was 232 rows across 34 employers, 43 application URLs, 36 legacy rows, and 2 duplicate groups (net: +96 visible rows, +9 employers, unchanged application-URL count, -4 legacy rows, -1 duplicate group).
- Current visibility across all 109 approved employers after pass one: 333 rows across 47 employers, 43 with application URLs, 296 structured-evidence rows, 37 legacy rows, and 1 duplicate URL group. This all-109 figure is a post-pass snapshot; the baseline above is for the 100-employer cohort.

## Repeat rollout — stopped by the repeat guard

- The unchanged cohort (SHA-256: 9e85a8f0ef31d7e08a938bd60924978c3ab88fdb8a5e0570ecdeedd98f98e3b5) and development database fingerprint were rechecked before the repeat.
- The repeat selected the same 100 employers but stopped after 44 rows when the expect-repeat guard detected a new insertion. Exit code 1; employers 45–100 were not processed. The guard was not bypassed.
- Partial-repeat outcomes: 39 complete; 1 partial_deadline; 3 identity conflicts; 1 crawl failure; 1 inserted; 63 updated; 0 revived; 35 no_jobs; 64 adverts found and 108 rejected; 12 UK locations known and 52 unknown.
- The sole repeat insertion was ID 39706, Kingsley Healthcare Limited: title “Skip to main content”, URL https://kingsleyhealthcare.co.uk/careers/benefits, no location or application URL, and structured_job_card evidence. It is live and passes the shared candidate-visibility gate. The exact URL appears once, so it did not increase duplicate URL groups (still 1).

## Vacancy-discovery false positives found

- The first-pass insertion audit found 7 ABPI career-guidance/resource pages inserted as live company-site vacancies (for example, “Why work in the industry” and “undergraduates”). The repeat then inserted the Kingsley benefits page above. All 8 have structured evidence and pass the current shared visibility gate, despite not being current job postings. No application URLs were stored for these rows.
- Two inserted 247 Commerce developer listings report “Cluj, Romania / Bangalore, India”; these are explicit non-UK locations, not evidence of UK eligibility.
- After the partial repeat, cohort visibility was 360 rows across 48 employers, 43 with application URLs, 298 structured-evidence rows, 62 legacy-evidence rows, and 1 duplicate URL group. The corresponding all-109 snapshot was 364 rows across 52 employers, 43 application URLs, 299 structured-evidence rows, 65 legacy rows, and 1 duplicate group. These are partial-repeat snapshots, not final metrics for all 100 employers.
- Because a repeat produced a live, candidate-visible non-vacancy page, no further apply was started. The development rows were left unchanged pending a decision to repair the classifier and resume.

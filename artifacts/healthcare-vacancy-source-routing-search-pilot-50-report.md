# Healthcare vacancy source routing — unresolved 50-row pilot

Generated: 2026-09-27

**Review only.** No source was imported; no database or production data was written.

## Source and cohort

- Source CSV: `/home/runner/workspace/.local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv`
- Read-only unresolved/baseline CSV: `/home/runner/workspace/artifacts/healthcare-vacancy-source-routing-batch2-200.csv`
- Input rows: **25,349**
- Exact `Healthcare` rows: **4,808**
- Unique exact-sector rows after ID/fallback-key deduplication: **4,808**
- Duplicate sponsor IDs skipped: **0**
- Duplicate blank-ID normalized-name/town keys skipped: **0**
- Previously routed IDs excluded: **100**
- Rows excluded outside the unresolved cohort: **4550**
- Selected rows with at least one missing source signal: **50**
- Selected rows with a previous company-site error: **0**
- Selection: priority by missing source fields, previous site error, unverified mapping status, then stable source order; offset 0; requested size 50
- `sponsor_licence_id` is retained exactly from the input. It is the JOBSAGE sponsor-row key, not an official licence number.

## Search and verification

- Search access: **SponsorList available; web search disabled or not configured**
- Bing key configured: **no**
- Optional web search enabled for this run: **no**
- Per-sponsor search cap: **2**; total search cap: **100**
- Search and URL cache enabled: **yes**
- Bing search requests issued (cache misses): **0**
- Reused cache results: **67 total** (36 persisted lookup/search cache hits; 31 page-fetch cache hits)
- Public HTTP attempts for selected sponsors: **190**; elapsed runtime: **119.3 seconds**
- Robots/policy-blocked checks: **15**; employer-identity checks rejected: **35**
- CQC local records loaded: **96,394** (/home/runner/workspace/scripts/data/cache/cqc-directory-2026-09-14.csv)
- SponsorList availability: **available**. It is a website lead only; matching requires exact normalized employer name and location overlap.
- Local support inputs: company-site cache **/home/runner/workspace/.local/reports/sponsor-enrichment/jobsage-company-site-existing.csv** (1,554 rows); prior vacancy-source cache **/home/runner/workspace/.local/reports/sponsor-enrichment/jobsage-existing-vacancy-sources.csv** (1,683 rows).
- Contact-email domains and known company/site source URLs are leads only. They are checked against employer identity before any route can be accepted.
- First-party pages are fetched with the existing public-site safety client: HTTPS, public-DNS checks, same-site redirect limits, robots.txt, request pacing, response-size limits, timeouts, and transient retries.
- Search results/directories are leads only. A route is accepted only after employer identity and hiring-path evidence are checked. Unsupported or ambiguous sources remain `unverified`.
- No agent-per-row manual search was used.

## Routing results

| Pipeline | Sponsor rows |
|---|---:|
| company_website | 0 |
| job_board | 0 |
| send_cv | 1 |
| unverified | 49 |
| **Total processed** | **50** |

### Confidence and import recommendation

| Confidence | Rows |
|---|---:|
| high | 0 |
| medium | 1 |
| low | 0 |
| unverified | 49 |

| Recommendation | Rows |
|---|---:|
| no_unverified | 49 |
| review_medium_confidence | 1 |

- Useful verified routes: **1/50 (2.0%)**
- High-confidence rows: **0**
- Medium-confidence rows requiring review: **1**
- Low-confidence or unverified findings are not importable.
- Secondary verified routes are retained in `notes`; one CSV row is emitted per selected sponsor record.

### Job-board and ATS providers

| Provider | Rows |
|---|---:|
| (none verified) | 0 |

## Common failure reasons

- `identity_not_confirmed`: 25
- `robots_or_policy_block`: 15
- `search_source_unavailable_or_no_match`: 9

## Examples of newly recovered matches

All 50 selected sponsors were unverified in batch 2 before this pilot.

### Company website

- No verified examples.

### Job board / ATS

- No verified examples.

### Send CV / recruitment contact

- [AmBience Healthcare Ltd](https://ambiencehealthcare.co.uk/job-application-form/) — medium confidence; explicit first-party CV/application form; send_cv_contact_form.

### Unverified examples

- **Alchemy Dental Practice** — CQC exact/strict match lead: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://www.alchemydental.co.uk/).
- **Aldeburgh Dental Practice** — employer identity was not corroborated on the page; SponsorList exact-name/location lead: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://www.aldeburghdentist.co.uk/).
- **Aldergate Medical Practice** — candidate employer page could not be safely checked: robots.txt disallows this page; employer identity was not corroborated on the page; SponsorList exact-name/location lead: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://aldergatemedicalpractice.co.uk/).
- **Aldgate House Dental Care** — CQC exact/strict match lead: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://www.aldgatedentalcare.co.uk/).
- **Alif Moosajee Ltd Trading as Oakdale Dental** — employer identity was not corroborated on the page; SponsorList exact-name/location lead: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://www.oakdaledental.co.uk/).

## Baseline comparison

- Batch 2 baseline: **200** rows; useful routes: **42/200 (21.0%)**; high confidence: **15**; unverified: **158**; attempts: **641**; retries: **0**; route totals: `unverified` 158, `company_website` 42.
- Selected pilot cohort: **50** baseline rows; **50** were unverified before this pilot.
- Newly verified in the pilot: **1/50**; pilot current coverage: **1/50 (2.0%)**.
- Batch 2 was used only as a read-only cohort/baseline; its CSV, report, and progress checkpoint were not rewritten.

- Batch 1 non-overlap reference: **100** rows; useful routes **19/100**; high confidence **18**; pilot overlap with batch 1 **0**; combined unique rows **150**.

## Recommendation

**No larger search-enabled batch is justified by this run: optional web search was not configured or was disabled. Keep the pilot capped, and do not expand beyond Healthcare until a configured search run has been measured.**

The recommendation uses this sample's verified-route yield (1/50), high-confidence share among verified routes (0.0%), search availability, cache use, and blocked-result count. It does not authorize automatic import or imply that unverified rows have no vacancies.

## File handling and safety

- CSV: `/home/runner/workspace/artifacts/healthcare-vacancy-source-routing-search-pilot-50.csv`
- Report: `/home/runner/workspace/artifacts/healthcare-vacancy-source-routing-search-pilot-50-report.md`
- Resumable progress: `/home/runner/workspace/artifacts/healthcare-vacancy-source-routing-search-pilot-progress-strict.json`
- Reusable lookup cache: `/home/runner/workspace/.local/reports/sponsor-enrichment/vacancy-source-routing-search-cache.json` (written only when caching is enabled)
- Progress is checkpointed after every sponsor. Existing output CSV/report files are never overwritten.
- This run performs public HTTP GET/search requests only. It does not write to a database, import findings, modify production data, or deploy.

# Healthcare vacancy source routing — batch 2 (200 sponsor rows)

Generated: 2026-09-26

**Review only.** No source was imported; no database or production data was written.

## Source and cohort

- Source CSV: `/home/runner/workspace/.local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv`
- Input rows: **25,349**
- Exact `Healthcare` rows: **4,808**
- Unique exact-sector rows after ID/fallback-key deduplication: **4,808**
- Duplicate sponsor IDs skipped: **0**
- Duplicate blank-ID normalized-name/town keys skipped: **0**
- Previously routed IDs excluded: **100**
- Selected rows with at least one missing source signal: **200**
- Selected rows with a previous company-site error: **0**
- Selection: priority by missing source fields, previous site error, unverified mapping status, then stable source order; offset 0; requested size 200
- `sponsor_licence_id` is retained exactly from the input. It is the JOBSAGE sponsor-row key, not an official licence number.

## Search and verification

- Search access: **SponsorList available; Bing not configured**
- Bing key configured: **no**
- CQC local records loaded: **96,394** (/home/runner/workspace/scripts/data/cache/cqc-directory-2026-09-14.csv)
- SponsorList is queried one employer at a time. It is a website lead only; matching requires exact normalized employer name and location overlap.
- First-party pages are fetched with the existing public-site safety client: HTTPS, public-DNS checks, same-site redirect limits, robots.txt, request pacing, response-size limits, timeouts, and transient retries.
- Search results/directories are leads only. A route is accepted only after employer identity and hiring-path evidence are checked. Unsupported or ambiguous sources remain `unverified`.
- No agent-per-row manual search was used.

## Routing results

| Pipeline | Sponsor rows |
|---|---:|
| unverified | 158 |
| company_website | 42 |
| **Total processed** | **200** |

### Confidence and import recommendation

| Confidence | Rows |
|---|---:|
| unverified | 158 |
| medium | 27 |
| high | 15 |

| Recommendation | Rows |
|---|---:|
| no_unverified | 158 |
| review_medium_confidence | 27 |
| yes_high_confidence | 15 |

- Useful verified routes: **42/200 (21.0%)**
- High-confidence rows: **15**
- Medium-confidence rows requiring review: **27**
- Low-confidence or unverified findings are not importable.
- Secondary verified routes are retained in `notes`; one CSV row is emitted per selected sponsor record.

### Job-board and ATS providers

| Provider | Rows |
|---|---:|
| (none verified) | 0 |

## Common failure reasons

- `search_source_unavailable_or_no_match`: 74
- `identity_not_confirmed`: 44
- `robots_or_policy_block`: 40

## Example verified sources

### Company website

- [Abbey Dale Medical Centre](https://www.abbey-dale.co.uk/jobs/) — high confidence; company_recruitment_page.
- [Abbey Equine Clinic LTD](https://www.abbeyequine.co.uk/careers) — medium confidence; company_recruitment_page.
- [Abbey Healthcare (Aaron Court) Limited](https://www.abbeyhealthcare.org.uk/careers/) — medium confidence; company_recruitment_page.
- [Abbey Healthcare (Cromwell) Ltd](https://www.abbeyhealthcare.org.uk/careers/) — medium confidence; company_recruitment_page.
- [Abbey Healthcare (Hamilton) Ltd](https://www.abbeyhealthcare.org.uk/careers/) — medium confidence; company_recruitment_page.

### Job board / ATS

- No verified examples.

### Send CV / recruitment contact

- No verified examples.

### Unverified examples

- **Alchemy Dental Practice** — CQC exact/strict match lead: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://www.alchemydental.co.uk/).
- **Aldeburgh Dental Practice** — SponsorList exact-name/location lead: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://www.aldeburghdentist.co.uk/).
- **Aldergate Medical Practice** — candidate employer page could not be safely checked: robots.txt disallows this page; SponsorList exact-name/location lead: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://aldergatemedicalpractice.co.uk/).
- **Aldgate House Dental Care** — CQC exact/strict match lead: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://www.aldgatedentalcare.co.uk/).
- **Alif Moosajee Ltd Trading as Oakdale Dental** — SponsorList exact-name/location lead: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://www.oakdaledental.co.uk/).

## Batch 1 comparison

- Batch 1 rows: **100**; useful routes: **19/100 (19.0%)**; high confidence: **18**.
- Batch 1 route totals: `unverified` 81, `company_website` 9, `job_board` 6, `send_cv` 4.
- Batch 2 useful-route yield: **21.0%**; batch 1 yield: **19.0%**.
- Batch 2 sponsor IDs already in the prior file: **0**.
- Combined unique rows across the two batches: **300**.

## Recommendation

**Not yet. Improve source coverage or identity verification and review this batch before expanding beyond another small pilot. Keep all rows review-only until evidence precision is confirmed.**

The recommendation is based on this sample's verified-route yield (42/200) and high-confidence share among verified routes (35.7%). It does not authorize automatic import or imply that unverified rows have no vacancies.

## File handling and safety

- CSV: `/home/runner/workspace/artifacts/healthcare-vacancy-source-routing-batch2-200.csv`
- Report: `/home/runner/workspace/artifacts/healthcare-vacancy-source-routing-batch2-200-report.md`
- Resumable progress: `/home/runner/workspace/artifacts/healthcare-vacancy-source-routing-progress.json`
- Progress is checkpointed after every sponsor. Existing output CSV/report files are never overwritten.
- This run performs public HTTP GET/search requests only. It does not write to a database, import findings, modify production data, or deploy.

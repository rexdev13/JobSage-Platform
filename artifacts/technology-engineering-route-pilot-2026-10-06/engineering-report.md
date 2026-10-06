# Engineering vacancy source routing — batch 1 (9 sponsor rows)

Generated: 2026-10-06

**Review only.** No source was imported; no database or production data was written.

## Source and cohort

- Source CSV: `/tmp/jobsage-tech-eng-route-pilot-2026-10-06/engineering.csv`
- Read-only unresolved/baseline CSV: `(not supplied)`
- Input rows: **9**
- Exact `Engineering` rows: **9**
- Unique exact-sector rows after ID/fallback-key deduplication: **9**
- Duplicate sponsor IDs skipped: **0**
- Duplicate blank-ID normalized-name/town keys skipped: **0**
- Previously routed IDs excluded: **0**

- Selected rows with at least one missing source signal: **9**
- Selected rows with a previous company-site error: **0**
- Selection: priority by missing source fields, previous site error, unverified mapping status, then stable source order; offset 0; requested size 9
- `sponsor_licence_id` is retained exactly from the input. It is the JOBSAGE sponsor-row key, not an official licence number.

## Search and verification

- Search access: **SponsorList available; web search disabled or not configured**
- Bing key configured: **no**
- Optional web search enabled for this run: **no**
- Per-sponsor search cap: **2**; total search cap: **100**
- Search and URL cache enabled: **no**
- Bing search requests issued (cache misses): **0**
- Reused cache results: **0 total** (0 persisted lookup/search cache hits; 0 page-fetch cache hits)
- Public HTTP attempts for selected sponsors: **64**; elapsed runtime: **168.4 seconds**
- Robots/policy-blocked checks: **0**; employer-identity checks rejected: **0**
- CQC local records loaded: **0** (/home/runner/workspace/scripts/data/cache/cqc-directory-2026-09-14.csv)
- SponsorList availability: **available**. It is a website lead only; matching requires exact normalized employer name and location overlap.
- Local support inputs: company-site cache **/home/runner/workspace/.local/reports/sponsor-enrichment/jobsage-company-site-existing.csv** (1,554 rows); prior vacancy-source cache **/home/runner/workspace/.local/reports/sponsor-enrichment/jobsage-existing-vacancy-sources.csv** (1,683 rows).
- Contact-email domains and known company/site source URLs are leads only. They are checked against employer identity before any route can be accepted.
- First-party pages are fetched with the existing public-site safety client: HTTPS, public-DNS checks, same-site redirect limits, robots.txt, request pacing, response-size limits, timeouts, and transient retries.
- Search results/directories are leads only. A route is accepted only after employer identity and hiring-path evidence are checked. Unsupported or ambiguous sources remain `unverified`.
- No agent-per-row manual search was used.

## Routing results

| Pipeline | Sponsor rows |
|---|---:|
| company_website | 1 |
| job_board | 0 |
| send_cv | 1 |
| unverified | 7 |
| **Total processed** | **9** |

### Confidence and import recommendation

| Confidence | Rows |
|---|---:|
| high | 1 |
| medium | 1 |
| low | 0 |
| unverified | 7 |

| Recommendation | Rows |
|---|---:|
| no_unverified | 7 |
| review_medium_confidence | 1 |
| yes_high_confidence | 1 |

- Useful verified routes: **2/9 (22.2%)**
- High-confidence rows: **1**
- Medium-confidence rows requiring review: **1**
- Low-confidence or unverified findings are not importable.
- Secondary verified routes are retained in `notes`; one CSV row is emitted per selected sponsor record.

### Job-board and ATS providers

| Provider | Rows |
|---|---:|
| (none verified) | 0 |

## Common failure reasons

- `identity_not_confirmed`: 7

## Verified routes and unverified leads

No baseline file was supplied. These are findings from this pilot only, not claims of recovery against a prior routing batch.

### Company website

- [EGIS UK - CONSULTING AND ENGINEERING LIMITED](https://jobs.egis-group.com/) — high confidence; company_recruitment_page; [sample vacancy](https://jobs.egis-group.com/job/technical-supervisor-in-dartford-jid-9382).

### Job board / ATS

- No verified examples.

### Send CV / recruitment contact

- [MOELLER & POELLER ENGINEERING LTD](https://www.moellerpoeller.co.uk/careers) — medium confidence; send_cv_email.

### Unverified examples

- **Advanced Compressor Engineering Services Limited** — Existing sponsor website field: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://www.acescomp.co.uk/).
- **Donland Engineering Ltd** — Existing sponsor website field: distinctive employer identity corroborated; location not present on the page; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://www.donland.co.uk/).
- **Krause Automation Ltd.** — Existing sponsor website field: distinctive employer identity corroborated; location not present on the page; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://krause-automation.com/en/career/open-positions/).
- **MEC Industrial Engineering LTD** — Existing sponsor website field: distinctive employer identity and stored location corroborated; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://www.mec-engineering.co.uk/).
- **Power Control and Automation Solutions Limited** — Existing sponsor website field: distinctive employer identity corroborated; location not present on the page; first-party website identity was verified, but no employer-specific hiring route was found [evidence](https://pcasltd.com/).

## Baseline comparison

- No separate baseline routing CSV was supplied; cohort-level comparison was unavailable.


## Recommendation

**Keep this review capped.** This no-search Engineering sample found one high-confidence employer-hosted vacancy route and one medium-confidence Send CV route. Review both before any import; the seven unverified rows and small sponsor cohort do not establish sector-wide coverage.

The recommendation uses this sample's verified-route yield (2/9), high-confidence share among verified routes (50.0%), search availability, cache use, and blocked-result count. It does not authorize automatic import or imply that unverified rows have no vacancies.

## File handling and safety

- CSV: `/home/runner/workspace/artifacts/technology-engineering-route-pilot-2026-10-06/engineering.csv`
- Report: `/home/runner/workspace/artifacts/technology-engineering-route-pilot-2026-10-06/engineering-report.md`
- Resumable progress: `/home/runner/workspace/artifacts/technology-engineering-route-pilot-2026-10-06/engineering-progress.json`
- Reusable lookup cache: `/home/runner/workspace/.local/reports/sponsor-enrichment/vacancy-source-routing-search-cache.json` (written only when caching is enabled)
- Progress is checkpointed after every sponsor. Existing output CSV/report files are never overwritten.
- This run performs public HTTP GET/search requests only. It does not write to a database, import findings, modify production data, or deploy.

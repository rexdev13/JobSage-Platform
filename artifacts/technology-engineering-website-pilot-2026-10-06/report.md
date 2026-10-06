# Non-Healthcare company website discovery — all sectors

**Status:** Complete  
**Updated:** 2026-10-06T19:07:14.977Z

## Scope and inputs

- Source CSV: `/tmp/jobsage-tech-eng-website-pilot-2026-10-06.csv`
- Rows in source CSV: **100**
- Exact `Healthcare` rows excluded: **0**
- Non-Healthcare sponsor rows considered, including blank `industry`: **100**
- Unique non-Healthcare rows after stable sponsor-ID deduplication: **100**
- Selected under the per-sector cap: **100**
- Processed so far: **100**; verified website found (high + medium): **24**
- Rows skipped by the 3,000-per-sector cap: **0**
- Duplicate source rows skipped: **0**
- The blank industry value is kept as its own `(blank industry)` group; only the exact value `Healthcare` is excluded.
- Sector selection follows the stable order of the supplied export; within each exact industry, the first 3,000 unique sponsor rows are selected.
- Search configured: **no**; Bing queries used: **0**. SponsorList queries: **100**. PublicSiteFetcher calls (site and SponsorList): **164**, including retries. Company homepage checks: **64**.

## Existing signal inventory

These counts cover only existing website, careers URL, public contact email, and company-site evidence fields. Prior source evidence means an exact normalized-name match in the supplied company-site file or a live `company_site` source row.

| Exact industry label | Source sponsors | Existing website | Existing careers URL | Valid contact email | Prior source evidence |
|---|---:|---:|---:|---:|---:|
| Engineering | 50 | 0 | 0 | 0 | 0 |
| Technology | 50 | 0 | 0 | 0 | 0 |

## Results by sector

“Websites found” counts only first-party identity-verified high/medium results. Low-confidence candidates remain review-only and have no accepted `official_website_url`.

| Exact industry label | Available | Selected | Cap applied | Processed | Websites found (coverage) | High | Medium | Low | Unverified |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Engineering | 50 | 50 | No | 50 | 9 (18.0%) | 5 | 4 | 6 | 35 |
| Technology | 50 | 50 | No | 50 | 15 (30.0%) | 5 | 10 | 4 | 31 |

## Sources used

The run tried existing website first, then a usable existing contact-email domain, an employer-domain existing careers URL, exact-name company-site support, a live company-site host clue from the vacancy-source support file, SponsorList, and finally optional configured Bing search. Cached vacancy-detail/application URLs were never followed or accepted as websites.

| Lead source used for rows | Rows |
|---|---:|
| SponsorList | 34 |

## Common failure reasons

Failure counts may exceed processed rows because one sponsor can have multiple failed candidate leads before another lead verifies.

| Reason code | Occurrences |
|---|---:|
| no_exact_name_location_lead | 37 |
| identity_not_confirmed | 28 |
| robots_or_policy_block | 4 |
| unsafe_or_external_redirect | 3 |
| page_over_size_limit | 3 |
| website_server_error | 1 |

## Website coverage priorities

Best verified website coverage among sectors with at least 50 processed:

- **Technology** — 15/50 verified websites (30.0%).
- **Engineering** — 9/50 verified websites (18.0%).

Lowest coverage among sectors with at least 50 processed:

- **Engineering** — lowest measured website coverage among sectors with at least 50 processed (9/50, 18.0%); review the failure mix before prioritizing.
- **Technology** — lowest measured website coverage among sectors with at least 50 processed (15/50, 30.0%); review the failure mix before prioritizing.

Use these sectors as the strongest website-identity starting points:

- **Technology** — 15/50 verified websites (30.0%).
- **Engineering** — 9/50 verified websites (18.0%).

No ATS/job-board discovery, vacancy discovery or routing, import, database write, production change, or deployment was performed.

## Files and resume

- Combined CSV: `artifacts/technology-engineering-website-pilot-2026-10-06/combined.csv` (100 processed rows currently written)
- Per-sector CSVs: `artifacts/technology-engineering-website-pilot-2026-10-06/by-sector/<sector-slug>-company-websites.csv`
- Progress JSON: `artifacts/technology-engineering-website-pilot-2026-10-06/progress.json`
- Append-only resume journal: `artifacts/technology-engineering-website-pilot-2026-10-06/progress.jsonl`
- This report: `artifacts/technology-engineering-website-pilot-2026-10-06/report.md`
- Run signature: `d2b0e88d77f220d073265c88e9d5c8a5cfe04bde33571a45bc9f229f28bd40e5`

This run is complete.

No database was queried or changed. The supplied export and support CSVs were read as local files only.

## Interpretation and coverage boundary

- The sponsor export used for this sample was last modified **26 September 2026**. The sample is 50 Technology and 50 Engineering employers from that sponsor-only snapshot, selected because no website or careers URL was recorded.
- The 24 high/medium findings verify employer website identity only. They do not establish a careers feed, current vacancy, or Apply/Send CV eligibility. Coverage percentages describe these 100 sampled sponsors, not either whole sector.
- Bing search was not configured, so this run used existing local clues and SponsorList. The result is limited to those sources; it is not a full web search.
- To extend the employer universe beyond licensed sponsors, [Companies House data products](https://www.gov.uk/guidance/companies-house-data-products) can seed legal-company names, status, addresses, and SIC codes. That data does not provide employer websites or vacancies, and an SIC match is not proof that a company is an active employer in the target sector. Treat it as a candidate seed, then verify employer identity and hiring sources separately.

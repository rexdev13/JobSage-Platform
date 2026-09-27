# Non-Healthcare company website discovery — all sectors

**Status:** Incomplete / resumable  
**Updated:** 2026-09-27T07:04:00.892Z

## Scope and inputs

- Source CSV: `.local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv`
- Rows in source CSV: **25,349**
- Exact `Healthcare` rows excluded: **4,808**
- Non-Healthcare sponsor rows considered, including blank `industry`: **20,541**
- Unique non-Healthcare rows after stable sponsor-ID deduplication: **20,541**
- Selected under the per-sector cap: **14,530**
- Processed so far: **12,802**; verified website found (high + medium): **3,329**
- Rows skipped by the 3,000-per-sector cap: **6,011**
- Duplicate source rows skipped: **0**
- The blank industry value is kept as its own `(blank industry)` group; only the exact value `Healthcare` is excluded.
- Sector selection follows the stable order of the supplied export; within each exact industry, the first 3,000 unique sponsor rows are selected.
- Search configured: **no**; Bing queries used: **0**. SponsorList queries: **10824**. PublicSiteFetcher calls (site and SponsorList): **19610**, including retries. Company homepage checks: **8786**.

## Existing signal inventory

These counts cover only existing website, careers URL, public contact email, and company-site evidence fields. Prior source evidence means an exact normalized-name match in the supplied company-site file or a live `company_site` source row.

| Exact industry label | Source sponsors | Existing website | Existing careers URL | Valid contact email | Prior source evidence |
|---|---:|---:|---:|---:|---:|
| (blank industry) | 5524 | 57 | 16 | 75 | 84 |
| Construction | 1016 | 29 | 9 | 15 | 30 |
| Education | 1522 | 9 | 4 | 23 | 38 |
| Engineering | 678 | 20 | 9 | 10 | 31 |
| Finance | 1185 | 20 | 5 | 18 | 33 |
| Hospitality | 114 | 28 | 7 | 15 | 28 |
| Legal & Professional | 182 | 23 | 9 | 16 | 25 |
| Manufacturing | 221 | 10 | 2 | 8 | 11 |
| Other | 6487 | 1362 | 396 | 887 | 1427 |
| Public Services | 222 | 0 | 0 | 185 | 5 |
| Retail | 68 | 14 | 3 | 11 | 14 |
| Social Care | 1594 | 22 | 10 | 165 | 43 |
| Technology | 1681 | 32 | 13 | 19 | 47 |
| Transport | 47 | 19 | 4 | 16 | 19 |

## Results by sector

“Websites found” counts only first-party identity-verified high/medium results. Low-confidence candidates remain review-only and have no accepted `official_website_url`.

| Exact industry label | Available | Selected | Cap applied | Processed | Websites found (coverage) | High | Medium | Low | Unverified |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| (blank industry) | 5524 | 3000 | Yes | 3000 | 707 (23.6%) | 490 | 217 | 182 | 2111 |
| Construction | 1016 | 1016 | No | 1016 | 96 (9.4%) | 59 | 37 | 134 | 786 |
| Education | 1522 | 1522 | No | 1522 | 558 (36.7%) | 479 | 79 | 34 | 930 |
| Engineering | 678 | 678 | No | 678 | 174 (25.7%) | 112 | 62 | 78 | 426 |
| Finance | 1185 | 1185 | No | 1185 | 278 (23.5%) | 184 | 94 | 38 | 869 |
| Hospitality | 114 | 114 | No | 114 | 36 (31.6%) | 26 | 10 | 5 | 73 |
| Legal & Professional | 182 | 182 | No | 182 | 53 (29.1%) | 36 | 17 | 12 | 117 |
| Manufacturing | 221 | 221 | No | 221 | 37 (16.7%) | 28 | 9 | 24 | 160 |
| Other | 6487 | 3000 | Yes | 3000 | 1081 (36.0%) | 661 | 420 | 369 | 1550 |
| Public Services | 222 | 222 | No | 222 | 83 (37.4%) | 82 | 1 | 2 | 137 |
| Retail | 68 | 68 | No | 68 | 11 (16.2%) | 1 | 10 | 5 | 52 |
| Social Care | 1594 | 1594 | No | 1594 | 215 (13.5%) | 139 | 76 | 74 | 1305 |
| Technology | 1681 | 1681 | No | 0 | 0 (0.0%) | 0 | 0 | 0 | 0 |
| Transport | 47 | 47 | No | 0 | 0 (0.0%) | 0 | 0 | 0 | 0 |

## Sources used

The run tried existing website first, then a usable existing contact-email domain, an employer-domain existing careers URL, exact-name company-site support, a live company-site host clue from the vacancy-source support file, SponsorList, and finally optional configured Bing search. Cached vacancy-detail/application URLs were never followed or accepted as websites.

| Lead source used for rows | Rows |
|---|---:|
| SponsorList | 3177 |
| existing_website | 965 |
| existing_careers_url_domain | 352 |
| company_site_existing_file | 350 |
| contact_email_domain | 329 |
| verified_company_site_source_host | 112 |

## Common failure reasons

Failure counts may exceed processed rows because one sponsor can have multiple failed candidate leads before another lead verifies.

| Reason code | Occurrences |
|---|---:|
| no_exact_name_location_lead | 4832 |
| identity_not_confirmed | 3769 |
| robots_or_policy_block | 1262 |
| website_fetch_failed | 237 |
| page_over_size_limit | 211 |
| website_access_denied | 121 |
| unsafe_or_external_redirect | 77 |
| website_not_found | 22 |
| website_server_error | 11 |
| website_timeout | 3 |
| unsafe_or_unresolved_host | 2 |
| website_rate_limited | 1 |

## Website coverage priorities

Best verified website coverage among sectors with at least 50 processed:

- **Public Services** — 83/222 verified websites (37.4%).
- **Education** — 558/1522 verified websites (36.7%).
- **Other** — 1081/3000 verified websites (36.0%).

Lowest coverage among sectors with at least 50 processed:

- **Construction** — lowest measured website coverage among sectors with at least 50 processed (96/1016, 9.4%); review the failure mix before prioritizing.
- **Social Care** — lowest measured website coverage among sectors with at least 50 processed (215/1594, 13.5%); review the failure mix before prioritizing.
- **Retail** — lowest measured website coverage among sectors with at least 50 processed (11/68, 16.2%); review the failure mix before prioritizing.

Use these sectors as the strongest website-identity starting points:

- **Public Services** — 83/222 verified websites (37.4%).
- **Education** — 558/1522 verified websites (36.7%).
- **Other** — 1081/3000 verified websites (36.0%).

No ATS/job-board discovery, vacancy discovery or routing, import, database write, production change, or deployment was performed.

## Files and resume

- Combined CSV: `artifacts/non-healthcare-company-websites-all-sectors.csv` (12802 processed rows currently written)
- Per-sector CSVs: `artifacts/company-websites-by-sector/<sector-slug>-company-websites.csv`
- Progress JSON: `artifacts/non-healthcare-company-websites-all-sectors-progress.json`
- Append-only resume journal: `artifacts/non-healthcare-company-websites-all-sectors-progress.jsonl`
- This report: `artifacts/non-healthcare-company-websites-all-sectors-report.md`
- Run signature: `ae47bc4f3fc8d4e62607ca39f4fdc36507785394ee299a7fd624b9220e04e0a5`

This run is resumable. Continue with `pnpm --filter @workspace/scripts non-healthcare-company-websites -- --resume`; the runner validates the input/support hashes and resumes from the journal. Stop reason: not yet completed.

No database was queried or changed. The supplied export and support CSVs were read as local files only.

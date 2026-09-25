# JOBSAGE sponsor-employer direct ATS coverage audit

**Run date:** 2026-09-25T07:32:07.376Z
**Data source:** development database plus read-only public ATS GETs

## Plain answer

Direct ATS lookup is worth keeping as a low-cost first pass for known board IDs and exact brand slugs. It is not enough to start the broad vacancy pipeline by itself. The sample produced **92 raw postings**: **33 verified**, **43 probable**, and **16 uncertain**. Count only the verified 33 as production-safe without further employer-site confirmation; verifying the two probable boards could raise the observed sample yield to 76. The uncertain 16 Greenhouse postings should not be counted until ownership is confirmed.

The 139-employer sample found active feeds for 4 employers (1 verified, 2 probable, 1 uncertain). It also found 1 empty feed. 135 sampled employers had no supported direct feed returning jobs. These are feasibility results, not a reliable total-register forecast.

**Recommendation:** fix and verify the website/careers inventory before broad Phase 1 crawling. Proceed narrowly with the verified direct-feed path, verify the two probable employer boards, and resolve the 59 Studio/Greenhouse ownership ambiguity. The largest unsupported saved-mapping family is Workday (5 records), so it is the next adapter candidate after API feasibility and mapping checks.

## Population and coverage

- Sponsor register rows: **142921**
- Distinct normalized organisation names: **127293**
- Stored website: **1515 (1.19%)**
- Stored careers URL: **417 (0.33%)**; all 417 also have a stored website
- Existing ATS provider/board mapping: **19 (0.01%)**, with **1** stored as verified
- No stored careers URL: **126876**; of these, **125778** have neither website nor careers URL and no ATS mapping
- Region populated: **34589**; missing: **92704**

This is the main bottleneck: direct feeds can be cheap once the board is known, but very few sponsor records currently provide a careers URL to find or verify it.

### Raw industry breakdown

| Industry | Employers | Share of distinct names |
|---|---:|---:|
| (missing) | 55602 | 43.68% |
| Other | 53907 | 42.35% |
| Healthcare | 4644 | 3.65% |
| Hospitality | 2144 | 1.68% |
| Legal & Professional | 1726 | 1.36% |
| Social Care | 1568 | 1.23% |
| Technology | 1499 | 1.18% |
| Education | 1269 | 1.00% |
| Retail | 1208 | 0.95% |
| Construction | 997 | 0.78% |
| Finance | 863 | 0.68% |
| Transport | 672 | 0.53% |
| Engineering | 587 | 0.46% |
| Public Services | 401 | 0.32% |
| Manufacturing | 206 | 0.16% |

### Region breakdown

| Region | Employers | Share of distinct names |
|---|---:|---:|
| (missing) | 92704 | 72.83% |
| South East | 8954 | 7.03% |
| East of England | 5153 | 4.05% |
| West Midlands | 3491 | 2.74% |
| North West | 3365 | 2.64% |
| South West | 2691 | 2.11% |
| London | 2650 | 2.08% |
| Yorkshire and the Humber | 2261 | 1.78% |
| East Midlands | 2229 | 1.75% |
| Scotland | 1387 | 1.09% |
| Northern Ireland | 884 | 0.69% |
| Wales | 848 | 0.67% |
| North East | 676 | 0.53% |

## Sector coverage results

Sample design: up to five employers per sector with a stored website/careers URL and no ATS mapping, plus up to five with neither URL, and all 19 existing ATS mappings as a certainty sample.

| Sector | Population | Sample | Sample website | Sample careers URL | Existing mapped | Any direct hit | Verified employers | Probable employers | Uncertain employers | Verified roles | Probable roles | Uncertain roles | Empty-feed employers | No supported ATS with jobs |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Construction | 997 | 10 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Education | 1269 | 10 | 5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Engineering | 587 | 10 | 5 | 2 | 0 | 1 | 0 | 1 | 0 | 0 | 7 | 0 | 0 | 9 |
| Finance / Professional Services | 2589 | 12 | 7 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 12 |
| Healthcare / Social Care | 6212 | 10 | 5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Hospitality | 2144 | 10 | 5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Manufacturing | 206 | 10 | 5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Other | 54308 | 25 | 20 | 17 | 15 | 2 | 1 | 0 | 1 | 33 | 0 | 16 | 1 | 23 |
| Retail | 1208 | 10 | 5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Technology / IT | 1499 | 11 | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 11 |
| Transport / Logistics | 672 | 10 | 5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Unclassified | 55602 | 11 | 6 | 3 | 1 | 1 | 0 | 1 | 0 | 0 | 36 | 0 | 0 | 10 |

“Any direct hit” includes uncertain ownership; the verified and probable columns are separate. “No supported ATS with jobs” means no tested Ashby/Greenhouse/Lever feed returned at least one parseable posting.

### Follow-up needs in the sample

| Sector | Need website discovery | Need unsupported ATS adapter | Need generic crawl/ownership check |
|---|---:|---:|---:|
| Construction | 5 | 0 | 5 |
| Education | 5 | 0 | 5 |
| Engineering | 5 | 0 | 5 |
| Finance / Professional Services | 5 | 2 | 5 |
| Healthcare / Social Care | 5 | 0 | 5 |
| Hospitality | 5 | 0 | 5 |
| Manufacturing | 5 | 0 | 5 |
| Other | 5 | 12 | 7 |
| Retail | 5 | 0 | 5 |
| Technology / IT | 5 | 1 | 5 |
| Transport / Logistics | 5 | 0 | 5 |
| Unclassified | 5 | 1 | 5 |

## ATS/platform results

| Platform | GET attempts | HTTP 200 | HTTP 404 | Other status | Valid JSON boards | Boards with jobs | Raw postings | Verified | Probable | Uncertain | Avg. postings / employer with jobs | Response bytes | Timeouts | Oversize | Redirects seen (none followed) |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Ashby | 264 | 3 | 261 | — | 3 | 3 | 76 | 33 | 43 | 0 | 25.33 | 1174700 | 0 | 0 | 0 |
| Greenhouse | 265 | 2 | 262 | — | 2 | 1 | 16 | 0 | 0 | 16 | 16.00 | 246293 | 1 | 0 | 0 |
| Lever | 264 | 0 | 263 | 502: 1 | 0 | 0 | 0 | 0 | 0 | 0 | — | 10905 | 0 | 0 | 0 |

The “average” is raw postings divided by sampled employers with a non-empty feed; Greenhouse’s 16 are ownership-uncertain. Lever returned no valid feed in this sample. Across all platforms there were 793 GET attempts, 5 valid JSON board feeds (4 with jobs and 1 empty), 1 timeout, 0 oversized response, and 0 redirects seen. Redirect following was disabled. The one non-404 HTTP error was a Lever 502.

## Matches and interpretation

| Employer | Sector | Platform / board | Result | Vacancies |
|---|---|---|---|---:|
| 9fin Limited | Other | Ashby / 9fin | Verified saved mapping | 33 |
| Vertical Aerospace Group Ltd | Engineering | Ashby / vertical-aerospace | Probable exact-name slug | 7 |
| Pliant Payments Limited | Unclassified | Ashby / pliant | Probable brand slug | 36 |
| 59 Studio Ltd | Other | Greenhouse / journey | Uncertain saved mapping ownership | 16 |
| 59 Studio Ltd | Other | Greenhouse / 59studio | Valid empty feed | 0 |

**Fastest observed sectors:** Unclassified (36 probable postings), Other (33 verified plus 16 uncertain), and Engineering (7 probable). **Hard in this sample:** Construction, Education, Finance / Professional Services, Healthcare / Social Care, Hospitality, Manufacturing, Retail, Technology / IT, Transport / Logistics. A no-hit sample is not proof those sectors lack ATS vacancies; it means these safe name-pattern lookups did not find a verified/probable active board.

## Cost/efficiency and next step

- Cheap direct-feed collection demonstrated: **33 verified postings now**, with **43 more probable postings** pending official-site verification; **16 uncertain** postings excluded from the safe count. Raw feeds returned 92 postings total.
- No stable all-register vacancy estimate is reported. There were only five non-mapped employers per sector/URL stratum; one high-volume employer can dominate a naive expansion. Increase sample size before using extrapolated counts for capacity or product planning.
- Keep exact direct ATS lookup as a low-cost first stage, but prioritize employer URL discovery because only 0.33% have a stored careers URL and 98.8% have neither website nor careers URL.
- Workday is the next adapter candidate based on five stored mappings; Oracle Recruiting (four) and BambooHR (three) follow. These counts do not establish API feasibility.
- Do not treat probable boards as production-safe until the official employer site/careers page confirms ownership.

## Safety and limits

Development database SELECTs only. Public ATS HTTPS GETs were limited to fixed provider API hosts, public DNS was resolved and pinned per request, requests were spaced by 1.75 seconds per host, each request had a 9-second timeout and 2 MB response cap, and redirects were never followed. Generic employer websites/careers pages were not fetched; those URLs remain crawl/verification candidates rather than being marked live or broken. No vacancies were imported, no vacancy liveness or employer records were changed, no employer emails or applications were sent, no paid API or LLM was used, and nothing was deployed. The raw postings are not filtered for UK location, sponsorship eligibility, or sponsor-register validity.

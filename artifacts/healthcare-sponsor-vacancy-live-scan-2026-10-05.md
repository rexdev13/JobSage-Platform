# Healthcare sponsor live vacancy discovery scan

**Status:** COMPLETE  
**Started:** 2026-10-05T15:58:18.109Z  
**Report updated:** 2026-10-05T18:55:50.312Z  
**Targets:** 270 exact employer/careers-URL groups from the audit and development data.

## Results

| Measure | Count |
|---|---:|
| Targets finalized | 270 / 270 |
| Exact stored careers URLs fetched successfully (HTTP 2xx) | 260 |
| Employer/approved-ATS sites reached successfully | 261 |
| Targets with a confirmed exact or employer-linked careers page | 260 |
| Distinct current individual listings verified | 201 |
| Of those, not already represented by a development vacancy row | 194 |
| Verified current listings with a reachable, job-specific application URL | 8 |
| Duplicate candidate sightings collapsed by canonical listing URL | 148 |
| Distinct candidate listing URLs explicitly excluded by detail or URL-safety checks | 2 |
| Distinct candidate listing URLs still inconclusive (blocked, timed out, or not confirmed) | 4 |
| Crawler-rejected link/ad signals (includes navigation and non-vacancy links) | 4261 |
| Candidate pages explicitly excluded as expired/closed/archived | 0 |

## Scope exception

The AD Implant target had no independent employer source; its supplied audit URL pointed only to DuckDuckGo. Before this was caught, the crawler made 7 read-only GET requests there (the hiring page, homepage, sitemap, and four PDFs). The target remains UNCHECKED, and those requests and link rejections are excluded from all coverage and vacancy totals. No vacancy candidate from that target is retained.

### Existing development vacancy records (separate from this live scan)

There were **55** existing vacancy rows on the exact target employer names before the scan: **42 live**, **13 dead**, **14 company-site**, and **41 job-board** rows, across 20 employer targets. These are existing database records, not newly discovered results. The scan uses read-only database access and does not insert, update, or delete vacancy rows.

### Page fetch outcomes

| Phase | Attempts | Successful | Robots blocked | HTTP 403 | Rate-limited (429/backoff) | Timed out | Other inconclusive |
|---|---:|---:|---:|---:|---:|---:|---:|
| Employer/careers discovery | 1781 | 1457 | 13 | 1 | 37 | 26 | 247 |
| Individual listing pages | 528 | 526 | 0 | 0 | 0 | 0 | 2 |
| Application pages (GET only; no forms submitted) | 8 | 8 | 0 | 0 | 0 | 0 | 0 |

### Target statuses

- CHECKED_EXACT_CAREERS_URL: 260
- UNCHECKED: 9
- INCONCLUSIVE: 1

### Listing exclusion reasons

- listing_detail_does_not_confirm_candidate_title: 4
- listing_fetch_http_http_404: 2

### Crawler link rejections

- invalid_deep_link: 1065
- generic_careers_content: 845
- negative_editorial_context: 1008
- missing_listing_context_or_vacancy_signal: 348
- navigation_link_not_vacancy: 862
- editorial_or_non_vacancy_title: 16
- normalization_or_duplicate: 68
- missing_posting_specific_evidence: 49

## Method and limits

- The target list uses the exact stored careers URL only when it matches the audit URL; the employer homepage comes from development sponsor data, or from the audit's exact first-party evidence URL when no homepage is stored. No URL was guessed. A search/aggregator host is not treated as an employer site.
- Discovery uses the existing company-site crawler with readOnly=true. It reads stored robots/cooldown state but holds request state in memory; this one-off scanner ran serially, but readOnly mode does not persist a cross-process request lease. Its separate vacancy-persistence function is not called. Robots policy, public-DNS pinning/SSRF checks, redirects, response limits, deadlines, and host pacing are retained.
- Candidate URLs are followed individually through the same safe page fetcher. A listing is counted only when its detail page returns successfully, the visible page headline confirms the advertised role (including a matching role-title prefix when a source card appends location or an apply button), and no explicit closed/archived state or past closing date is detected. Headline-matched candidates from the first pass were re-fetched so the closure and closing-date checks still run. Application links are tested with a read-only GET only; no forms are submitted. A link counts as reachable/job-specific only when its URL shares role-identifying path/query evidence with the listing and the page returns successfully.
- Duplicate listings are grouped by canonical listing URL while keeping all target names, sponsor IDs, careers URLs, and listing-source pages in the CSV. Rejected or inconclusive candidates are retained as excluded rows with their reason; blank target rows remain present for every employer.
- “Current” means current evidence was visible at scan time; it does not guarantee a later application submission will succeed. The scan cannot prove that a site has no jobs beyond the pages exposed by its public HTML/approved ATS feed or the crawler's per-target page/deadline limits. Any target not fully checked is called out in the CSV with a reason.

**Target status totals:** {"CHECKED_EXACT_CAREERS_URL":260,"UNCHECKED":9,"INCONCLUSIVE":1}  
**No vacancies claim:** 

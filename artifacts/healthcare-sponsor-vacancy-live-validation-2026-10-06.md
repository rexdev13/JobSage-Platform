# Healthcare sponsor vacancy live validation — 2026-10-06

- **Source:** `artifacts/healthcare-sponsor-vacancy-live-scan-2026-10-05.csv` (201 unique vacancy URLs; 270 target rows; 267 distinct target names).
- **Completed:** 2026-10-05T23:31:43.277Z (UTC).
- **Development database snapshot:** 2026-10-05 23:19:57.792336+00 (read-only transaction); 61 rows matched the exact target-employer-name cohort. The prior CSV recorded 55 rows for that cohort; the current snapshot is 61. This difference is not attributed without row history.
- **Network scope:** serial GET requests through the existing safe company-site fetcher with read-only mode. No forms were submitted, no authentication was used, and no applications were made.

## Recalculated totals

| Metric | Count | Definition |
|---|---:|---|
| Candidate listings | 201 | Unique listing URLs in the source CSV. |
| Live checks attempted | 201 | One detail-page GET attempt for each candidate. |
| Checked / resolved | 201 | Page result definitively classifiable as current or not current. |
| Current | 192 | Employer and role title confirmed on the live page, with no explicit closure or passed labelled closing date. |
| Not current / wrong page | 9 | Closed, expired, HTTP 404/410, title mismatch, or generic/wrong page. |
| Inconclusive / blocked | 0 | Blocked, timed out, network/server error, or employer/title evidence insufficient. Not counted as passed. |
| Current duplicates | 7 | Current candidates matching an existing development DB record under project duplicate rules. |
| Current new listings | 185 | Current candidates with no matching development DB record. |
| READY | 178 | Current, no DB duplicate, and no failed/uncertain explicit application link check. |
| HOLD | 23 | All other candidates, with reason on each CSV row. |
| Job-specific application pages reachable by GET | 185 | Current-page apply link resolves to a role-specific page returning HTTP 2xx. |
| Explicit apply URLs found | 192 | Links discovered from current live detail pages; historical CSV application URLs were not reused. |
| Reachable but generic apply pages | 7 | HTTP 200 responses did not identify the specific role. |

**Count check:** current (192) + not current (9) + inconclusive (0) = 201. Current duplicates (7) + current new (185) = 192.

## Listing status breakdown

| Status | Count |
|---|---:|
| CURRENT | 192 |
| NOT_CURRENT_CLOSING_DATE_PASSED | 7 |
| NOT_CURRENT_TITLE_MISMATCH | 2 |

## HOLD reason breakdown

| Reason | Count |
|---|---:|
| Current listing already matches a development database record | 7 |
| Labelled closing date passed | 7 |
| Apply link reached a generic careers page, not a role-specific page | 7 |
| Live page title did not match the candidate title | 2 |

## Method and duplicate rules

- Candidate employer, title, and location came from the source CSV; the live page was independently fetched and its visible title/employer evidence was recorded in the CSV. A labelled closing date is interpreted using the existing UK closing-date parser. Unknown closing dates alone do not imply closure.
- “Current” requires a successful page response, a matching role title, employer evidence from page text or JobPosting structured data, and no explicit closed phrase or passed labelled closing date. A blocked, timed-out, ambiguous, or insufficiently rendered page is never treated as a pass.
- Duplicate matching follows the existing pipeline: same-source canonical URL or normalized employer/title/location fingerprint; cross-source URL base (query/fragment ignored) or exact case-insensitive employer/title/location identity. Employer aliases come from the CSV target/sponsor names. A matching DB row is shown with its ID, source, liveness, and match rule.
- READY means the listing passed the current/title/employer screen and is not already represented in the development database. If a current page's explicit apply link reaches only a generic careers page, the result is HOLD even when that page returns HTTP 200. An absent job-specific URL alone is not evidence that a vacancy is stale.
- The detailed CSV contains one row per candidate, final evidence URLs, sanitized page excerpts, application GET result, duplicate match details, and a reasoned READY/HOLD decision.

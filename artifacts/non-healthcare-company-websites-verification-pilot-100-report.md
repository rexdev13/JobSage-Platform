# Website verification pilot selection — local only

**Status:** Selection complete; no websites fetched  
**Generated:** 2026-09-27T08:28:25.884Z

## Selection summary

- Input rows: **14530**
- Medium-confidence rows in input: **1233**
- Low-confidence rows in input: **1162**
- Strong medium candidates: **159** across **137** unique domains
- Pilot target: **100**
- Selected: **100** (100 strong medium, 0 other medium, 0 low)
- Selected unique domains: **100**
- Maximum selected rows per domain: **1**
- HTTP/AI/search requests: **0**
- Database reads/writes: **0**

Included **0 low-confidence candidates** because 159 strong medium candidates were available.

## Strong medium definition

A strong medium must satisfy all of the following:

1. Current confidence is medium.
2. Candidate website domain exactly matches the existing contact-email domain (ignoring leading `www`).
3. The discovery provenance identifies `existing_website` or `existing_careers_url_domain`, and that source URL's domain matches the candidate.
4. At least one of town/city, county, or region is present.
5. The discovery journal exists for the sponsor and contains no prior robots, blocking, timeout, access-denied, or rate-limited failure code.

## Deterministic ranking and domain diversity

- Strong medium candidates are selected before any other candidates.
- Within the priority order, more populated location fields rank first.
- The selection takes one candidate per normalized domain before taking a second from any domain; ties use domain and sponsor ID for stable ordering.
- If fewer than the target number of strong mediums exist, other medium candidates fill remaining places before low-confidence candidates. Low-confidence rows are only eligible when the strong-medium pool is below the target, and are reported separately.

## Selected rows by industry

| Industry | Medium | Low | Strong medium | Fallback |
|---|---:|---:|---:|---:|
| (blank industry) | 1 | 0 | 1 | 0 |
| Education | 1 | 0 | 1 | 0 |
| Hospitality | 1 | 0 | 1 | 0 |
| Legal & Professional | 1 | 0 | 1 | 0 |
| Other | 88 | 0 | 88 | 0 |
| Social Care | 2 | 0 | 2 | 0 |
| Technology | 4 | 0 | 4 | 0 |
| Transport | 2 | 0 | 2 | 0 |

## Location completeness in selected pilot

| Populated location fields | Candidates |
|---:|---:|
| 3 | 27 |
| 2 | 11 |
| 1 | 62 |

## Inputs and output

- Discovery CSV: `artifacts/non-healthcare-company-websites-all-sectors.csv`
- Discovery journal: `artifacts/non-healthcare-company-websites-all-sectors-progress.jsonl`
- Pilot CSV: `artifacts/non-healthcare-company-websites-verification-pilot-100.csv`

This is a selection list only. `selected_for_pilot_not_yet_rechecked` does not mean a candidate has been verified again or promoted.

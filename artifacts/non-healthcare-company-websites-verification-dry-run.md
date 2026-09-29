# Non-Healthcare website verification — dry run

**Status:** Queue prepared; no websites fetched  
**Generated:** 2026-09-27T08:09:14.664Z

## Scope

- Input: `artifacts/non-healthcare-company-websites-all-sectors.csv`
- Input rows: **14530**
- Medium rows selected: **1233**
- Low rows selected: **1162**
- Queue rows written: **2395**
- Limit applied: **none**
- HTTP requests: **0**
- Database reads or writes: **0**
- Existing results were not changed or promoted.

## Queue status

| Status | Rows |
|---|---:|
| ready_for_independent_check | 2395 |

## Queue by industry

| Industry | Medium | Low | Ready for independent check | Manual review required |
|---|---:|---:|---:|---:|
| (blank industry) | 217 | 182 | 399 | 0 |
| Construction | 37 | 134 | 171 | 0 |
| Education | 79 | 34 | 113 | 0 |
| Engineering | 62 | 78 | 140 | 0 |
| Finance | 94 | 38 | 132 | 0 |
| Hospitality | 10 | 5 | 15 | 0 |
| Legal & Professional | 17 | 12 | 29 | 0 |
| Manufacturing | 9 | 24 | 33 | 0 |
| Other | 420 | 369 | 789 | 0 |
| Public Services | 1 | 2 | 3 | 0 |
| Retail | 10 | 5 | 15 | 0 |
| Social Care | 76 | 74 | 150 | 0 |
| Technology | 197 | 197 | 394 | 0 |
| Transport | 4 | 8 | 12 | 0 |

## Verification policy for a later approved live pass

- Reuse only the evidence URL already present in the discovery CSV; low-confidence rows use that evidence host as a candidate, not as an accepted official website.
- Check the homepage and only same-origin About, Contact, or Careers pages discoverable from it. Do not follow cross-host redirects or crawl unrelated paths.
- Require independent identity corroboration: distinctive legal/trading name plus matching geography or a reliable official-register/cross-link signal. A repeated generic token alone cannot promote a result.
- Keep uncertain, blocked, or conflicting cases at their current confidence for review.
- Use the controlled public-site fetcher and its robots, DNS/SSRF, redirect, host-pacing, retry, and size limits if a live pass is approved.

Queue CSV: `artifacts/non-healthcare-company-websites-verification-dry-run.csv`

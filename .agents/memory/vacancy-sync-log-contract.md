---
name: Vacancy sync-log contract
description: Operational contract for classifying and observing vacancy pipeline batches
---

Every vacancy pipeline batch must persist its explicit kind (`job_board`, `company_site`, `liveness`, or `contact`). Liveness rows must include checked, live, dead, and inconclusive counters. External callers must serialize requests and treat HTTP 409 as backpressure, not as permission to retry concurrently.

**Why:** Unlabelled sync rows made production board, company-site, and liveness activity indistinguishable, while overlapping short HTTP callers created retry storms and hid the effective completion rate.

**How to apply:** Keep batch size limits and quarantine/backoff unchanged. Add observability at every batch writer, preserve the shared PostgreSQL writer lock, and recommend one sequential caller before adding staggered capacity.
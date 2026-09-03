---
name: Production vacancy schedulers
description: Durable production requirements for vacancy discovery and liveness scheduling
---

Production vacancy discovery and liveness use capped stale catch-ups protected by PostgreSQL advisory locks, followed by their normal cron schedules. Keep candidate-facing source priority explicit: job-board unverified links before company-site links, then legacy rows.

**Why:** Autoscale can scale to zero and miss in-process cron windows. A registered cron is not proof the pipeline runs. Production also exposed PostgreSQL inferring a fractional queue-share parameter as integer inside a CASE expression.

**How to apply:** Keep the published API on Reserved VM/Always Running when relying on node-cron. Run catch-up only after listen, never a full-register startup crawl. Cast fractional SQL parameters to numeric, preserve database-backed host leases/backoff, and keep AI vacancy web search capped at zero unless explicitly changed.
---
name: Production vacancy schedulers
description: Durable production requirements for vacancy discovery and liveness scheduling
---

Production vacancy discovery and liveness run in external Replit Scheduled deployments while the public website remains Autoscale. The production web process must not register those in-process crons or run a vacancy catch-up on boot. Scheduled workers call the capped batch functions directly against the Production environment's `DATABASE_URL`, use a shared PostgreSQL writer lock, and preserve per-employer probe leases and backoff. Keep candidate-facing source priority explicit: job-board unverified links before company-site links, then legacy rows.

**Why:** The owner explicitly requires the public site to remain Autoscale. Autoscale can scale to zero and miss in-process cron windows, while waking the web dyno through HTTP would couple scraping to request handling. Production also exposed PostgreSQL inferring a fractional queue-share parameter as integer inside a CASE expression.

**How to apply:** Configure separate Scheduled deployments for board discovery, company-site discovery, and liveness. Never curl the Autoscale site to scrape, never run discovery from candidate GET routes, never restore the full-register boot scan, cast fractional SQL parameters to numeric, preserve database-backed leases/backoff, and keep AI vacancy web search capped at zero unless explicitly changed.
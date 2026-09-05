---
name: Production vacancy schedulers
description: Durable production requirements for vacancy discovery and liveness scheduling
---

Production vacancy discovery and liveness use authenticated external HTTP cron requests while the public website remains Autoscale. Each request awaits a short capped batch below the proxy timeout and uses the same shared PostgreSQL writer lock and workers as the CLI. Production must not register the vacancy crons or run vacancy catch-up on boot. Keep candidate-facing source priority explicit: job-board unverified links before company-site links, then legacy rows.

**Why:** The owner explicitly requires one Autoscale app, while a full 250-employer batch exceeds the HTTP proxy timeout. Short awaited requests wake it safely without detached work or a full boot scan. Production also exposed PostgreSQL inferring a fractional queue-share parameter as integer inside a CASE expression.

**How to apply:** External callers must use the secret-protected vacancy endpoint sequentially and loop until done. Keep production node-cron and boot catch-up disabled, never start a full board batch from candidate GET routes, preserve leases/backoff, and keep AI vacancy web search capped at zero unless explicitly changed.
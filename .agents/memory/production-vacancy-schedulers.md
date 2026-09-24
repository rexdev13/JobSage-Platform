---
name: Production vacancy schedulers
description: Durable production requirements for vacancy discovery and liveness scheduling
---

Production vacancy discovery and liveness use authenticated external HTTP cron requests while the public website remains Autoscale. Successful requests await short capped batches using a shared PostgreSQL writer lock. Production must not register the vacancy crons or run vacancy catch-up on boot. Keep candidate-facing source priority explicit: job-board unverified links before company-site links, then legacy rows.

**Why:** The owner explicitly requires one Autoscale app, while a full 250-employer batch exceeds the HTTP proxy timeout. The external scheduler is configured outside the repository: observed production batch frequency may differ materially from checked-in scheduling instructions. A deadline response is not proof that underlying work was cancelled.

**How to apply:** External callers must use the secret-protected vacancy endpoint sequentially and loop until done. Check production batch history and external scheduler settings before making capacity claims. Treat a successful response as a completed batch, but a deadline response as uncertain until in-flight work settles; retry with backoff. Keep production node-cron and boot catch-up disabled, preserve leases/backoff, and keep AI vacancy web search capped at zero unless explicitly changed.
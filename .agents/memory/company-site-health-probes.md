---
name: Company-site health probes
description: Durable safety and scheduling rules for separating cheap host checks from full vacancy crawling.
---

Company-site health probes are a lightweight stage inside the existing vacancy pipeline, not a second vacancy system. They classify one robots-aware root fetch as workable, temporary failure, or permanent failure using the existing employer check/backoff state and shared HTTP safety layer. Full crawling remains capped separately.

**Why:** Full multi-page crawling wastes scarce short-request capacity on dead, unsafe, or repeatedly failing sponsor websites. A cheap preflight improves completion rates without weakening vacancy evidence, liveness, relevance, or sponsor matching. If an HTTP deadline is reached, releasing the shared writer lock before outstanding probe writes settle would create overlapping writers.

**How to apply:** Reuse DNS pinning, SSRF, redirects, TLS, robots, pacing, bounded decoding, and quarantine logic. Never parse vacancy links in the probe. Prefer workable and previously successful hosts in full-crawl selection while preserving healthcare-evidence and bookmark reserves. Keep the response deadline bounded, but retain the advisory lock until any finalizing worker and database writes have actually settled.
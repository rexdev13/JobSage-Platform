---
name: Company-site health probes
description: Durable safety and scheduling rules for separating cheap host checks from full vacancy crawling.
---

Company-site health probes are a lightweight stage inside the existing vacancy pipeline, not a second vacancy system. They perform one robots-aware root fetch, inspect only that bounded response for a careers/jobs signal or approved ATS link, and persist a separate `ok_for_crawl`/`bad`/`unknown` mark with a timestamp and short reason. Full crawling remains capped separately and must not overwrite the probe mark.

**Why:** Full multi-page crawling wastes scarce short-request capacity on dead, unsafe, or repeatedly failing sponsor websites. A cheap preflight improves completion rates without weakening vacancy evidence, liveness, relevance, or sponsor matching. If an HTTP deadline is reached, releasing the shared writer lock before outstanding probe writes settle would create overlapping writers.

**How to apply:** Reuse DNS pinning, SSRF, redirects, TLS, robots, pacing, bounded decoding, and quarantine logic. Do not follow vacancy links in the probe. Full-crawl selection requires a recent `ok_for_crawl` mark; unknown and recently bad employers are skipped, while healthcare-evidence and bookmark reserves apply within the approved queue. Keep the response deadline bounded, but retain the advisory lock until any finalizing worker and database writes have actually settled.
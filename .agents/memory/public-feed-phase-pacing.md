---
name: Public-feed phase pacing
description: Keep multi-phase public-feed scans from violating the shared host pacing controls.
---

When a paginated public feed transitions to another phase on the same hostname, do not fetch the next phase immediately inside the same bounded run. Persist the phase cursor and yield; resume in a separate request after the ordinary pacing interval. Never bypass or weaken the shared safe-fetch pacing and backoff.

**Why:** A development Teaching Vacancies sweep completed its list phase, then immediately requested the same-host sitemap. The safe fetch layer refused it as paced and put the source into retry backoff even though the list coverage was valid.

**How to apply:** Use a phase-boundary yield for same-host transitions such as list-to-sitemap or index-to-detail. Keep cursor progress durable, preserve existing retry state, and test that the collector does not fetch the next phase during the same invocation.

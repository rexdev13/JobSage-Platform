---
name: Public-feed phase pacing
description: Keep multi-phase public-feed scans from violating the shared host pacing controls.
---

When a paginated public feed transitions to another phase on the same hostname, do not fetch the next phase immediately inside the same bounded run. Persist the phase cursor and yield; resume in a separate request after the ordinary pacing interval. Never bypass or weaken the shared safe-fetch pacing and backoff.

The source-level `nextRetryAt` expiring does not prove that shared host pacing or backoff has cleared. If the safe-fetch layer still returns `hostname is paced or in backoff` after one cooldown, retain the cursor and stop retrying; do not bypass the shared control.

**Why:** A Teaching Vacancies sweep completed its list phase, then repeatedly encountered shared-host pacing at the sitemap phase, including after source-level cooldown expiry. The host-level safety control remained authoritative.

**How to apply:** Use a phase-boundary yield for same-host transitions such as list-to-sitemap or index-to-detail. Keep cursor progress durable. When pacing still blocks a resumed request, inspect or wait for host-level state rather than repeatedly submitting source batches.

Persist the index's remaining detail identifiers before yielding, rather than relying on a process-local index cache. Checkpoint individual detail fetches so a later pacing failure cannot discard earlier successful requests.

**Why:** An autoscale request can resume in a cold process. Re-fetching an index before every detail batch can exhaust the same bounded deadline repeatedly, even when callers wait between requests.

**How to apply:** Carry a bounded, validated index snapshot in durable sweep state. Preserve the shared fetch layer's retry time and never retry sooner than either the source or host backoff permits.

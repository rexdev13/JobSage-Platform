---
name: Sponsor vacancy identity join
description: Keep candidate vacancy-to-sponsor contact enrichment joins index-supported without adding unused indexes.
---

Candidate vacancy enrichment matches vacancies to sponsor-register rows using `lower(btrim(organisation_name))`. Keep the sponsor-register functional index identical to that expression, and preserve the `(source_type, liveness)` index for selective source feeds. Avoid adding a vacancy-side normalization index unless a measured plan uses it.

**Why:** An unindexed normalized join forced an expensive sort and temporary-disk spill over the sponsor-register side. A matching expression index changed it to indexed lookups; the source/liveness index is useful for the smaller company-site feed, while a full scan remains preferable for broad job-board batches.

**How to apply:** When changing identity normalization or feed filters, update the matching index expression and validate both feed types with development-only `EXPLAIN (ANALYZE, BUFFERS)`. Keep projections narrow and do not use this as evidence of production latency.

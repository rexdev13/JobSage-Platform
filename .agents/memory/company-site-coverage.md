---
name: Company-site coverage
description: How to increase employer-site vacancy coverage without weakening source safety or relevance filters.
---

Company-site discovery is constrained by a short external HTTP response window and per-host politeness, so coverage improves through bounded parallel employer slots and better low-cost URL discovery rather than relaxed vacancy classification.

**Why:** Employer sites are structurally slower and less linkable than job boards; increasing relevance permissiveness would reintroduce careers articles and other false positives.

**How to apply:** Preserve robots, SSRF, host pacing, liveness, and classifier filters. Prefer balanced queue quotas, sitemap/pagination discovery, and bounded batch-size changes. Production visibility still requires publishing the API and enabling the external worker.
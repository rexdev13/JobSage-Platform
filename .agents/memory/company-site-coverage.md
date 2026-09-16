---
name: Company-site coverage
description: How to increase employer-site vacancy coverage without weakening source safety or relevance filters.
---

Company-site discovery is constrained by a short external HTTP response window and per-host politeness, so coverage improves through bounded parallel employer slots and better low-cost URL discovery rather than relaxed vacancy classification. Rotate unbookmarked employers across explicit sector buckets using oldest-due ordering within each bucket; rotate the starting bucket and backfill missing sectors.

**Why:** Employer sites are structurally slower and less linkable than job boards; increasing relevance permissiveness would reintroduce careers articles and other false positives.

**How to apply:** Preserve robots, SSRF, host pacing, liveness, and classifier filters. Reserve part of the external HTTP budget for final database writes; defer unstarted employers with resumable counts instead of overrunning the caller. Production visibility still requires publishing the API and enabling the external worker.
---
name: Company-site coverage
description: How to increase employer-site vacancy coverage without weakening source safety or relevance filters.
---

Company-site discovery is constrained by a short external HTTP response window and per-host politeness, so coverage improves through bounded parallel employer slots and better low-cost URL discovery rather than relaxed vacancy classification. Rotate unbookmarked employers across explicit sector buckets using oldest-due ordering within each bucket; rotate the starting bucket and backfill missing sectors.

News, blog, and press destinations can have anchor text that looks like a job title because it includes the employer name. Treat a negative editorial path as stronger evidence than title-shaped link text.

**Why:** Employer sites are structurally slower and less linkable than job boards, and employer names in editorial link text can fool job-title heuristics. Broadening relevance to compensate would reintroduce false positives.

**How to apply:** Preserve robots, SSRF, host pacing, liveness, and classifier filters. Reject editorial paths before title heuristics and record the rejection reason. Reject article/education cards whose extracted title contains appended explanatory prose at extraction, normalization, and candidate-feed visibility stages; this also hides existing polluted rows without deleting audit data. Reserve part of the external HTTP budget for final database writes; defer unstarted employers with resumable counts instead of overrunning the caller. Give failed employers a durable retry delay and deduplicate sponsor rows by normalized employer identity, or dead domains and duplicate licences repeatedly consume the bounded batch. Production visibility still requires publishing the API and enabling the external worker.
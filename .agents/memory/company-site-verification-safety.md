---
name: Company-site verification safety
description: Safety boundary for ingestion-time liveness checks of employer and ATS vacancy links.
---

Company-site vacancy discovery and its post-commit liveness verification must use the same robots policy, persisted hostname lease/pacing, Retry-After/backoff, redirect allowlist, and SSRF checks. Every redirect destination needs its own robots decision before it is fetched.

**Why:** Treating initial verification as an ordinary link check creates a second crawler path that can bypass the protections used during discovery, including on redirects to an ATS or forbidden board.

**How to apply:** Any new company-site ingestion or verification entry point must route network access through the controlled company-site fetch layer. Keep uncertain robots/rate/network outcomes hidden and inconclusive rather than marking them live.
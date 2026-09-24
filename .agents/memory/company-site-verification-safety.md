---
name: Company-site verification safety
description: Safety boundary for ingestion-time liveness checks of employer and ATS vacancy links.
---

Company-site vacancy discovery and its post-commit liveness verification must use the same robots policy, persisted hostname lease/pacing, Retry-After/backoff, redirect allowlist, and SSRF checks. Every redirect destination needs its own robots decision before it is fetched.

Only verify an ATS mapping when an employer-controlled hiring page links to that board; provider hostnames, URL shapes, and stored URLs alone do not prove ownership. Career-section navigation and page-level vacancy prose are crawl signals, not job listings. Require link-level posting evidence before extracting a vacancy, while still allowing category pages to be crawled for actual postings.

**Why:** A separate verification fetch can bypass crawler protections, while shared ATS domains, stale URLs, and generic career pages can misattribute employers or create false vacancies.

**How to apply:** Route all company-site network access through the controlled fetch layer. Keep first-party evidence URLs with verified mappings, reject navigation-only links as vacancy evidence, and leave uncertain robots/rate/network outcomes inconclusive rather than marking them live.
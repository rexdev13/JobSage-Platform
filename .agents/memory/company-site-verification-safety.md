---
name: Company-site verification safety
description: Safety boundary for ingestion-time liveness checks of employer and ATS vacancy links.
---

Company-site vacancy discovery and its post-commit liveness verification must use the same robots policy, persisted hostname lease/pacing, Retry-After/backoff, redirect allowlist, and SSRF checks. Every redirect destination needs its own robots decision before it is fetched.

Only verify an ATS mapping when an employer-controlled hiring page links to that board; provider hostnames, URL shapes, and stored URLs alone do not prove ownership. Career-section navigation and page-level vacancy prose are crawl signals, not job listings. Search-filter links and career utilities (for example, team/country filters, recommendations, and talent communities) are not specific vacancies; retain exact job-ID links.

Operator-supplied alternative evidence URLs are limited to the employer host or its subdomains and still go through the controlled robots-aware fetch path. A blocked homepage does not authorize fetching a disallowed path; a rate-limited host is not retried within that employer batch. Alternative evidence only helps locate a feed and never substitutes for exact feed identity, completeness, and at least one accepted listing.

For batched enrichment samples, validate that every candidate maps to exactly one sampled employer and that the employer keys are unique before making network requests. Save protected-fetch outcomes locally before database persistence so a failed transaction can be retried without repeating the crawl.

**Why:** A separate verification fetch can bypass crawler protections, while shared ATS domains, stale URLs, and generic career pages can misattribute employers or create false vacancies. Missing sample keys can also fan candidate URLs out across employers; database rollback cannot undo the external requests already made. Blocked healthcare homepages need a controlled way to use independently supplied first-party evidence without turning a robots denial or rate limit into permission to retry.

**How to apply:** Route all company-site network access through the controlled fetch layer. Derive stable keys from normalized employer names when the sample has no IDs, validate candidate-to-employer mappings and per-employer limits before fetching, and enforce non-empty unique keys in the writer. Keep first-party evidence URLs with verified mappings, reject navigation-only links and career filters as vacancy evidence, preserve exact posting IDs, and leave uncertain robots/rate/network outcomes inconclusive rather than marking them live.
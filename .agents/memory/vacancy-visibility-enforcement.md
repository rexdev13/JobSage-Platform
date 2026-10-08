---
name: Vacancy visibility enforcement
description: Durable rules for keeping expired, closed, missing, stale, and evidence-less vacancies out of every candidate action path.
---

Candidate visibility is not centralized merely because a shared status function exists. Raw SQL counts and match queries, detail responses, URL checks, Smart Apply lookups, and application creation must enforce the same inputs and negative-state precedence.

**Why:** A Phase 1 launch review found repeated gaps where the main role list was correct but company counts, click checks, or application creation could still treat an expired or evidence-less vacancy as actionable. A bounded legacy-evidence window also failed when individual callers omitted its timestamp.

**How to apply:** Whenever vacancy status inputs change, audit both TypeScript callers and raw SQL predicates. Pass every migration-grace field explicitly, make HTTP 200 subordinate to expiry/closure, keep stale rows non-actionable, and add path-specific tests for counts, opening checks, and application creation.

When SQL mirrors a TypeScript guard like `sourceType === "company_site" && ...`, make the non-company branch NULL-safe (for example, `source_type IS DISTINCT FROM 'company_site' OR ...`). `NOT (source_type = 'company_site' AND ...)` evaluates to NULL for legacy rows with a NULL source type and can silently exclude them.

**Why:** A production inventory audit showed SQL three-valued logic dropping legacy rows that the TypeScript conditional would keep.

**How to apply:** Check nullability whenever translating conditional visibility logic into a SQL `NOT`/`AND` predicate, and compare per-source counts against the runtime helper.

Company-site vacancies with manager titles stay hidden from candidate lists and actions until their role review is approved with a valid four-digit SOC code and an HTTPS evidence URL. Eligibility review is separate from liveness: approval or rejection must never itself mark a vacancy live, dead, or closed. Preserve an approval only while employer, source, external ID, URL, and title remain unchanged.

**Why:** Manager-role sponsorship eligibility depends on the occupation evidence, while vacancy liveness describes whether the listing still exists. Conflating them can expose unreviewed roles or incorrectly close valid listings.

**How to apply:** Keep the review predicate aligned across counts, lists, details, clicks, and applications. On every feed refresh, compare the complete role identity before carrying forward review evidence; do not let review status alter liveness.
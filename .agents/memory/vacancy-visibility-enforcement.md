---
name: Vacancy visibility enforcement
description: Durable rules for keeping expired, closed, missing, stale, and evidence-less vacancies out of every candidate action path.
---

Candidate visibility is not centralized merely because a shared status function exists. Raw SQL counts and match queries, detail responses, URL checks, Smart Apply lookups, and application creation must enforce the same inputs and negative-state precedence.

**Why:** A Phase 1 launch review found repeated gaps where the main role list was correct but company counts, click checks, or application creation could still treat an expired or evidence-less vacancy as actionable. A bounded legacy-evidence window also failed when individual callers omitted its timestamp.

**How to apply:** Whenever vacancy status inputs change, audit both TypeScript callers and raw SQL predicates. Pass every migration-grace field explicitly, make HTTP 200 subordinate to expiry/closure, keep stale rows non-actionable, and add path-specific tests for counts, opening checks, and application creation.
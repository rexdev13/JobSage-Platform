---
name: Monthly Readiness quota
description: Calendar-month reset rules for candidate vacancy Readiness Checks.
---

Candidates receive three new free Readiness Checks per calendar month across both sponsor-vacancy and role analyses. Count records generated since the first day of the current UTC month. Booster packs and active Pro access remain unchanged.

**Why:** A lifetime allowance blocked long-term candidates permanently, while a monthly limit keeps AI spending predictable and restores access regularly. On 2026-10-04, the user changed the free allowance from ten to three across the backend, frontend and API contract.

**How to apply:** Use one combined counter for both analysis tables, reset at 00:00 UTC on the first day of each month, preserve seven-day cached results, and expose the next reset date in usage responses.
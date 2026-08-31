---
name: Monthly Readiness quota
description: Calendar-month reset rules for candidate vacancy Readiness Checks.
---

Candidates receive ten new Readiness Checks per calendar month across both sponsor-vacancy and role analyses. Count records generated since the first day of the current UTC month.

**Why:** A lifetime allowance blocked long-term candidates permanently, while a monthly limit keeps AI spending predictable and restores access regularly.

**How to apply:** Use one combined counter for both analysis tables, reset at 00:00 UTC on the first day of each month, preserve seven-day cached results, and expose the next reset date in usage responses.
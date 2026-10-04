---
name: Monthly Readiness quota
description: Calendar-month reset rules for candidate vacancy Readiness Checks.
---

Candidates receive three new free Readiness Checks per calendar month across both sponsor-vacancy and role analyses. Count records generated since the later of the first day of the current UTC month and the candidate's latest admin reset. Admin resets must preserve previous analyses and purchased balances.

**Why:** A lifetime allowance blocked long-term candidates permanently, while a monthly limit keeps AI spending predictable and restores access regularly. The user specified three free checks and explicitly required that quota resets never delete historical analyses.

**How to apply:** Use one combined counter for both analysis tables, reset at 00:00 UTC on the first day of each month, preserve seven-day cached results, and expose the next reset date in usage responses.

Paid offers use fixed UK prices: a new Booster Pack grants 20 checks for £4.99 one-time; Pro costs £15.99/month and permits unlimited checks while active. Existing purchased balances are retained.

**Why:** The user specified GBP pricing and a twenty-check pack for the UK platform; these are product prices, not a live currency-conversion calculation.

**How to apply:** Align checkout terms and customer-facing copy with these offers. Do not retroactively reduce balances or change the free monthly allowance when updating paid offers.

Verify purchases launched from an already-open Readiness sheet in a real browser, not only component tests with a mocked sheet.

**Why:** Component tests passed while the actual sheet overlay intercepted clicks on the upgrade offer. Opening the quota control in the sidebar did not exercise the stacked-dialog failure.

**How to apply:** Start from a vacancy card's Readiness Check on a role without a cached analysis, reach a real quota denial, and buy the offer while the same sheet remains mounted.
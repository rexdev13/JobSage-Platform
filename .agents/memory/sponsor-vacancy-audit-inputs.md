---
name: Sponsor vacancy audit inputs
description: Safe source selection and coverage reporting for sponsor-vacancy audit merges.
---

Each sponsor-vacancy audit merge must use explicitly selected, current source directories and the current sponsor register snapshot. Never auto-select dated historical outputs. Rows from a partial source run can be evaluated individually, but partial or truncated runs must remain labeled as incomplete and cannot be used to claim full coverage.

**Why:** Reusing older artifacts can make expired or historical roles appear current, mix incompatible runs, or overstate how completely a source was searched.

**How to apply:** Check each source run's status, list every input directory explicitly, preserve partial-source flags in the final report, and inspect the blocked-row output before any import decision.

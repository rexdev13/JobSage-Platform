---
name: Himalayas comparison scope
description: User-selected geography and historic sample handling for JOBSAGE's free-feed comparison.
---

For the free-feed comparison, include Himalayas listings eligible for UK candidates and worldwide listings, and exclude older unfiltered global samples from the filtered comparison. Retain those older rows; do not delete them.

**Why:** The user chose a UK-relevant scope to make the large global catalog manageable without discarding existing development data.

**How to apply:** Filter for UK eligibility while allowing worldwide roles. Use the current filtered-run metadata/version when reporting results, and report older global rows separately.

## Filtered-search pagination inconsistency

The public search API can return empty intermediate pages followed by later nonempty pages. An empty page alone is not proof of exhaustion. Keep provider-total mismatches under review, and independently enforce UK/worldwide eligibility on returned rows.

**Why:** Bounded live checks on 2026-10-07 confirmed later listings after an earlier empty page, while responses contained fewer rows than the documented page/count contract implied. The published OpenAPI contract alone did not explain the live mismatch.

**How to apply:** Traverse only within the provider's declared page bounds and ordinary request budgets. Compare cumulative raw rows against its total at the end; do not claim complete coverage when they disagree. Revalidate upstream behavior before removing these safeguards.

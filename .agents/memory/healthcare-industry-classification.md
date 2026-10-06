---
name: Healthcare industry classification
description: Industry labels can omit healthcare employers relevant to NHS Trust and hospital coverage.
---

Do not rely only on `industry = 'Healthcare'` when assembling a healthcare or NHS Trust coverage batch. Relevant NHS Trust and hospital rows can be classified under `Public Services`.

**Why:** A production snapshot for ODS website matching had additional NHS/hospital/healthcare-named rows outside the Healthcare industry label; using only that label would miss some NHS Trusts.

**How to apply:** Include the Healthcare cohort and a bounded name-based search for NHS, hospital, and healthcare terms in other industries. Keep exact entity matching and normal evidence checks; do not widen matching to fuzzy names.

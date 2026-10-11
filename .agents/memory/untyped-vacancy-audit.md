---
name: Untyped live vacancy audits
description: Audit coverage for fresh live vacancies whose source type is NULL.
---

Include live, recently verified vacancies with `source_type IS NULL` in location and candidate-visibility audits. Do not infer that these records are company-site or job-board entries; classify their stored location evidence directly.

**Why:** A production audit found a sizeable fresh-live cohort with no source type. Omitting NULL-source rows would understate the candidate-visible population and miss records that still pass liveness checks.

**How to apply:** Define the live/recent cohort independently of source type, then group NULL-source rows explicitly and apply the same location and action gates used for typed sources.

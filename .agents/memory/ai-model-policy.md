---
name: JOBSAGE AI model policy
description: User-selected model standardization and verified integration capabilities.
---

For JOBSAGE, use a tiered model policy: keep `gpt-4o-mini` on routine workflows, and retain the previously used stronger models (`gpt-4o` and `gpt-5.4-mini`) where those models were already assigned to nuanced or accuracy-sensitive tasks. Do not assume technical support means quality parity.

**Why:** The user initially asked to standardize on mini, then clarified on 2026-10-10 that they do not want reduced accuracy and chose stronger models for complex tasks. Preserve quality-sensitive routes rather than optimizing uniformity.

**How to apply:** Use gpt-4o for factual CV drafting/extraction, tailored application and interview writing, identity checks, candidate/job-fit analysis, and consequential vacancy assessment; retain gpt-5.4-mini for grounded contact lookup. Keep gpt-4o-mini on routine nudges, simple labels, and operational summaries. Before downgrading quality-sensitive work, compare reviewed representative outputs. Live synthetic probes confirmed mini accepts image, PDF, and cited web-search inputs; they did not establish answer-quality equivalence.

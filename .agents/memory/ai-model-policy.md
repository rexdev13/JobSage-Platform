---
name: JOBSAGE AI model policy
description: User-selected model standardization and verified integration capabilities.
---

For JOBSAGE, use a tiered model policy: keep `gpt-4o-mini` on routine workflows, and retain the previously used stronger models (`gpt-4o` and `gpt-5.4-mini`) where those models were already assigned to nuanced or accuracy-sensitive tasks. Do not assume technical support means quality parity.

**Why:** The user initially asked to standardize on mini, then clarified on 2026-10-10 that they do not want reduced accuracy and chose stronger models for complex tasks. Preserve quality-sensitive routes rather than optimizing uniformity.

**How to apply:** Keep mini on existing routine/model-light paths; preserve gpt-4o for complex candidate-facing writing, structured CV extraction, identity checks, Smart Apply, and consequential vacancy lookup, and gpt-5.4-mini for grounded contact lookup. Before downgrading any of these, compare reviewed representative outputs. Live synthetic probes confirmed mini can technically handle image input, PDF file input, and Responses web search; they did not establish answer-quality equivalence.

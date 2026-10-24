---
name: JOBSAGE AI model policy
description: User-selected model standardization and verified integration capabilities.
---

For JOBSAGE, use a tiered model policy: keep `gpt-4o-mini` on routine workflows and `gpt-4o` on nuanced or accuracy-sensitive tasks. Keep the `gpt-5.4-mini` contact lookup available behind an explicit opt-in, but disabled by default.

**Why:** The user initially asked to standardize on mini, then clarified on 2026-10-10 that they do not want reduced accuracy and chose stronger models for complex tasks. On 2026-10-11, they separately chose to disable GPT-backed contact website lookup while keeping a reversible path; this does not change the stronger-model policy for other workflows.

**How to apply:** Use gpt-4o for factual CV drafting/extraction, tailored application and interview writing, identity checks, candidate/job-fit analysis, and consequential vacancy assessment. Keep gpt-5.4-mini contact lookup disabled unless the user explicitly sets `CONTACT_WEB_SEARCH_ENABLED=true`; database-only contact harvesting remains separate. Keep gpt-4o-mini on routine nudges, simple labels, and operational summaries. Before downgrading quality-sensitive work, compare reviewed representative outputs. Live synthetic probes confirmed mini accepts image, PDF, and cited web-search inputs; they did not establish answer-quality equivalence.

For browser tests of AI-assisted candidate flows, prefer deterministic mocked model responses for routine regression runs. Live CV-enhancement checks call the configured Replit AI integration and consume AI credits; run them only with synthetic candidate data and disclose the usage. Synthetic identity images must never be treated as evidence that real-person verification works.

**Why:** A live browser run exercised all three CV rewrite modes and confirmed the synthetic no-face ID case remained pending review. Those checks are useful for integration validation, but they spend credits and cannot establish identity-match accuracy.

**How to apply:** Use synthetic CVs and test accounts for any live model probe. Keep automated coverage repeatable with a mocked AI boundary; separately run live calls only when validating provider wiring or the actual model integration.

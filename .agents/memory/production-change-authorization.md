---
name: Production change authorization
description: Production scope and release boundary for JOBSAGE sponsor-vacancy audit work.
---

For JOBSAGE sponsor-vacancy audits, production vacancy writes are authorized only for the reviewed cohort. Do not deploy, publish, or push code without explicit permission, and do not mutate unrelated production data. Hard deletes are not authorized for an audit pass; leave unowned or inconclusive rows untouched. Keep destructive production cleanup disabled unless the user separately approves a specific run.

**Why:** Reviewed imports rely on the released validation and proof path; bypassing it could affect production outside the audited cohort. A legacy in-process cleanup has deleted rows using only stale/dead fields, so the production schedule itself must not be assumed safe.

**How to apply:** Before any production vacancy write, confirm the guarded route is released and the exact reviewed cohort is the only target. Do not publish or bypass the application route without permission. For cleanup, check logs and disable the in-process production schedule before another tick; require explicit confirmation and importer ownership before any later deletion.

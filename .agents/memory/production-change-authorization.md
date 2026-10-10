---
name: Production change authorization
description: Production scope and release boundary for JOBSAGE sponsor-vacancy audit work.
---

For JOBSAGE sponsor-vacancy audits, production vacancy writes are authorized only for the reviewed cohort. Do not deploy, publish, or push code without explicit permission, and do not mutate unrelated production data. If the guarded write path requires a release, stop at that boundary rather than trying a direct database write.

**Why:** Reviewed imports rely on the released validation and proof path; bypassing it could affect production outside the audited cohort.

**How to apply:** Before any production vacancy write, confirm the guarded route is released and the exact reviewed cohort is the only target. Do not publish or bypass the application route without permission.

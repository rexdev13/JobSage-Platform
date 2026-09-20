---
name: Reed HTML employer markup
description: Current public Reed job-card employer extraction constraint
---

Reed job cards can retain `job-card` and `job-card-title` QA markers while moving the employer name into the recruiter anchor inside `job-posted-by`; `company-name-link` is not reliable.

**Why:** The employer-only parser silently dropped current Reed cards before strict sponsor matching, leaving very few persisted Reed vacancies even though live Reed searches returned matching adverts.

**How to apply:** Support both the legacy explicit employer marker and the posted-by recruiter link, then keep exact/deep-link validation and sponsor-name matching unchanged.
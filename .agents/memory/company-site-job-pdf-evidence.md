---
name: First-party job-description PDF evidence
description: Safety boundary for job-description PDFs hosted under employer media paths.
---

Do not treat an arbitrary first-party `/media/` PDF as a vacancy. A PDF linked from an explicit current/open vacancies listing may be a candidate posting, but confirm the role and active status from the document or listing, and capture a real application or contact destination. Keep unrelated policy/media files excluded; do not use the PDF itself as the apply destination without evidence.

**Why:** Employer CMSs often store job descriptions in media directories, while generic media paths also contain policies, statements, and unrelated files. Broadly allowing media links would create false vacancies and could send candidates to a non-application document.

**How to apply:** Add a narrowly-scoped document extraction path only when the first-party page explicitly lists current roles. Preserve same-host SSRF, response-size, request-deadline, and pacing controls, and test both legitimate role PDFs and unrelated media PDFs.
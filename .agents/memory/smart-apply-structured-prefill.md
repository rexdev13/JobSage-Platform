---
name: Smart Apply structured prefill
description: Safety and evidence rules for filling structured third-party application controls from JOBSAGE data.
---

Structured application controls may be filled automatically from exact, candidate-saved profile facts. Missing or ambiguous employment, training, qualification, and reference details must remain blank and be reported as unavailable; defaults such as assuming a UK country because a vacancy is in the UK are not candidate evidence.

**Why:** Third-party forms often encode repeatable history rows with opaque names. Guessing row values or using API defaults can create false application claims, while sending sensitive controls for mapping removes candidate control.

**How to apply:** Use only saved candidate facts for automatic profile prefill; keep missing values null. Humanize control names with their section and repeat index; map repeated evidence newest-first; require exact select/radio option matches; never overwrite existing values; exclude sensitive and candidate-confirmation controls from automatic fill and AI mapping.
---
name: Smart Apply structured prefill
description: Safety and evidence rules for filling structured third-party application controls from JOBSAGE data.
---

Structured application controls may be filled from exact profile facts or server-side CV extraction, but missing or ambiguous employment, training, qualification, and reference details must remain blank and be reported as unavailable.

**Why:** Third-party forms often encode repeatable history rows with opaque names. Guessing row values can create false candidate records, while sending sensitive controls for mapping removes candidate control.

**How to apply:** Humanize control names with their section and repeat index; map repeated evidence newest-first; require exact select/radio option matches; never overwrite existing values; exclude sensitive and candidate-confirmation controls from both fill and AI generation.
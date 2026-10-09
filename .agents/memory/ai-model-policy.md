---
name: JOBSAGE AI model policy
description: User-selected model standardization and verified integration capabilities.
---

For JOBSAGE, use `gpt-4o-mini` wherever the required capability is supported. Keep specialist image-generation and audio models only for capabilities the general text/vision model cannot replace.

**Why:** The user explicitly chose “Use gpt-4o-mini wherever supported” on 2026-10-10. Do not independently upgrade individual features to stronger models.

**How to apply:** Preserve this choice when adding AI features. Check capability through the project's actual integration before declaring a model unsuitable. On 2026-10-10, live synthetic probes through this integration confirmed `gpt-4o-mini` image input, PDF file input, and Responses web search with a search-call result and URL citation. Public API assumptions alone would have incorrectly excluded this model from the existing grounded-search paths. Acceptance does not establish output accuracy for every task.

---
name: Job-board profession precedence
description: Durable rules for deterministic job-board title classification
---

Job-board titles need explicit coverage for common abbreviations and role families, and IT-specific signals must win over broad engineering terms such as “engineer.” Clinical support titles should remain unclassified unless they clearly identify a regulated profession.

**Why:** A broad `engineer` match misclassified network/cloud roles, while sparse title vocabularies left education, IT, and allied-health vacancies out of category counts.

**How to apply:** Expand bounded title patterns with representative UK job-board wording, keep category order intentional, and add regression cases for both positive matches and support/admin false positives. Do not change crawl limits to compensate for classification gaps.
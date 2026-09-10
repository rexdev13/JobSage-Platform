---
name: Answer Library safety
description: Trust boundaries for capturing and reusing candidate answers across applications.
---

The Answer Library may persist only candidate-authored values from explicitly allowlisted safe question categories. Profile fills, AI insertions, memory restores, restricted or ambiguous fields, and provenance-free legacy page-memory strings are ineligible.

**Why:** DOM events alone do not identify who supplied a value, and the older page cache stored raw strings without provenance. Reclassifying those values as candidate-authored could silently retain or reuse sensitive or generated content.

**How to apply:** Keep programmatic-write provenance suppression around every extension fill, deny unknown sensitivity, preserve existing DOM values, and use dedicated answer-library storage. Do not repurpose Smart Apply drafts or application notes for synchronization.
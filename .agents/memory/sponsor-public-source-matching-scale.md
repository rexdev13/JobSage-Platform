---
name: Sponsor public-source matching scale
description: Performance constraint for global matching against large cached public-register datasets.
---

For global sponsor coverage against large CQC, GIAS, or Charity Commission caches, constrain fuzzy candidates using rare organization-name tokens before checking location. Broad town/county buckets can make the cross-source scan exceed practical command time limits.

**Why:** Matching a six-figure sponsor list against hundreds of thousands of cached records exceeded a five-minute run when candidate sets were widened by common location tokens.

**How to apply:** Preserve the matching threshold and ambiguity rules, but use an index that guarantees all qualifying high-similarity candidates remain reachable without expanding common location buckets.
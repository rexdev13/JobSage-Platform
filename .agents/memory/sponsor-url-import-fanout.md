---
name: Sponsor URL import fan-out
description: Safety rules for reconciling sponsor website and careers URLs across development and production records.
---

Only fan out a source URL to production rows when their complete normalized identity signatures agree. A compatible manual crosswalk selects its one reviewed target instead of triggering fan-out. Write only blank destination fields; preserve populated production URLs and hold conflicts for review. Store held candidates in a durable review queue that is separate from vacancy-discovery inputs.

**Why:** Repeated sponsor rows can represent the same legal employer, but a partial or fuzzy match can merge distinct organisations. Preserving conflicting URLs and isolating review data prevents an import from silently changing production or expanding vacancy coverage prematurely.

**How to apply:** When building cross-environment sponsor URL imports, compare the full identity signature before sharing a candidate across rows, honor reviewed single-target mappings, guard writes against concurrent changes, and keep vacancy ingestion blocked until the URL changes are applied and read-only verified.
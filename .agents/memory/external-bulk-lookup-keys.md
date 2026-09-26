---
name: External bulk lookup keys
description: Safely joining results from third-party company website lookup services.
---

**Rule:** Send only the company name, useful location fields, and a synthetic lookup key to external bulk-enrichment services. Keep internal database IDs in a local-only mapping file.

**Why:** Website finders need public company identity data, not JOBSAGE's internal record IDs. A synthetic key still allows returned results to be joined reliably without disclosing internal identifiers.

**How to apply:** When preparing a vendor upload, generate unique per-row keys, validate they map one-to-one to the source rows, and retain the key-to-ID mapping locally. Do not upload the mapping file.
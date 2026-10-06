---
name: Vacancy board deduplication
description: Concurrency and liveness rules for writing adverts discovered from multiple job boards.
---

Shared board writes must lock deterministic canonical-URL and organisation/title/location fingerprint keys inside the database transaction. Legacy rows must be matched by normalized URL path, normalized fingerprint, and board/external ID before deciding to insert. For known ATS postings with provider, board URL, and external ID evidence, preserve distinct external IDs even when title and location fingerprints match; use that ATS identity for repeat-import matching instead of fingerprint fallback.

Per-source observations must be persisted separately from the shared vacancy row. Collapse exact repeats from one source, but preserve distinct external IDs from the same source and retain cross-source sightings until the transactional writer records each observation.

**Why:** Candidate and background discovery can run concurrently across server instances, so process-local caches and select-then-insert can create duplicate adverts. A Circle Workday feed showed that distinct ATS listings can share title/location fingerprints, while syndicated public feeds require multiple source observations on one vacancy.

**How to apply:** Any new board adapter must normalize into the shared pipeline, preserve the same lock keys, and retain source identity through the transaction. Keep fingerprint fallback for generic and legacy rows, but do not merge distinct known external IDs. Schedule link verification only after the write transaction commits.
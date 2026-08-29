---
name: Vacancy board deduplication
description: Concurrency and liveness rules for writing adverts discovered from multiple job boards.
---

Shared board writes must lock deterministic canonical-URL and organisation/title/location fingerprint keys inside the database transaction. Legacy rows must be matched by normalized URL path, normalized fingerprint, and board/external ID before deciding to insert.

**Why:** Candidate and background discovery can run concurrently across server instances. Process-local caches and select-then-insert alone can create duplicate adverts, while one global lock would unnecessarily serialize unrelated employers.

**How to apply:** Any new board adapter must normalize into the shared pipeline and preserve the same keys. Schedule link verification only after the write transaction commits so the verifier cannot race an uncommitted row.
---
name: Direct-feed host evidence
description: Securely validate ATS postings served on a custom employer domain.
---

For direct ATS feeds that return posting URLs on an employer-controlled host different from the vendor's board host, permit that posting host only when it is tied to verified first-party evidence. Carry that evidence from the persisted mapping through every scheduler, one-off, and promotion import path; if it is dropped, the parser must fail closed even when the feed is valid.

**Why:** A Pinpoint feed used the employer's branded careers hostname while its feed lived on the vendor subdomain. The parser correctly rejected those URLs when one execution path omitted the saved first-party evidence.

**How to apply:** When adding a provider with custom posting hosts, trace the evidence alongside the mapping across every import entrypoint and test the path that invokes the importer, not only the connector parser.

For Circle Health Group's Workday CXS feed, vacancy inserts must come only from the exact verified direct-feed mapping and a complete snapshot; general website discovery can be diagnostic but is never an insertion source. The feed reports its result total on the first page, then reports `total: 0` on continuation pages that still contain postings. Treat the first-page total as authoritative, but require the accumulated row count to match it exactly, every JR ID to be unique, and every posting path's base JR ID to match `bulletFields`. A numeric slug-collision suffix such as `-1` may follow the path's JR ID.

**Why:** The live Circle feed exposed both the zero-total continuation behavior and the optional numeric path suffix. Rejecting either blocks valid listings; accepting pages without exact counts and identity checks risks incomplete or mismatched imports.

**How to apply:** Keep every Circle insert behind the verified mapping and complete direct-feed snapshot gate. Accept only a zero continuation total with returned rows, keep nonzero totals consistent with the first page, and retain uniqueness, path, and ID checks.

One-off full-board snapshots need a bounded multi-minute deadline that includes provider pagination and shared per-host pacing. Never bypass pacing to make a run finish faster.

**Why:** The live Circle importer took nearly five minutes end to end to reach exact-link verification, so a short fetch budget leaves little margin for a complete, safely paced snapshot.

**How to apply:** Give large direct-feed snapshots a finite budget with headroom for normal host delays. Keep page, row-count, identity, host, and response-size checks unchanged.
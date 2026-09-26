---
name: Direct-feed host evidence
description: Securely validate ATS postings served on a custom employer domain.
---

For direct ATS feeds that return posting URLs on an employer-controlled host different from the vendor's board host, permit that posting host only when it is tied to verified first-party evidence. Carry that evidence from the persisted mapping through every scheduler, one-off, and promotion import path; if it is dropped, the parser must fail closed even when the feed is valid.

**Why:** A Pinpoint feed used the employer's branded careers hostname while its feed lived on the vendor subdomain. The parser correctly rejected those URLs when one execution path omitted the saved first-party evidence.

**How to apply:** When adding a provider with custom posting hosts, trace the evidence alongside the mapping across every import entrypoint and test the path that invokes the importer, not only the connector parser.
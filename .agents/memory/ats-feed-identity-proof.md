---
name: ATS feed identity proof
description: Trust rules for verifying a direct ATS feed belongs to the sponsor employer.
---

A direct ATS feed is verified only when the feed payload itself contains one or more explicit employer identity claims, every claim matches the target employer after Unicode normalization, case folding, and whitespace normalization, the feed is complete, and at least one listing is accepted. Missing or conflicting identity claims stay unresolved; an empty feed is never positive identity evidence.

**Why:** A first-party link to a board does not prove that the feed behind it belongs to the sponsor employer, and an empty response cannot establish either ownership or a usable vacancy source.

**How to apply:** Keep the same exact-identity and nonempty-listing gate across discovery reports, mapping review, and mapping import. Do not infer feed ownership from the requested employer name, URL, legal-suffix stripping, or fuzzy similarity.

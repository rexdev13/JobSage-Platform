---
name: Unified role ID routing
description: Ordering rule for resolving catalogue, employer-job, and sponsor-vacancy IDs across candidate application flows.
---

Unified candidate role IDs occupy overlapping threshold-style ranges, so every resolver must test the Sponsor vacancy range before the broader employer-job range. This applies to application enrichment, Smart Apply context, tracking, and any future role lookup.

**Why:** Treating every ID above the employer-job offset as an employer job caused Sponsor Smart Apply and tracker records to query the wrong source and lose the selected vacancy/company identity.

**How to apply:** Reuse the central Sponsor ID predicate/conversion helpers. Never implement a standalone “greater than employer offset” branch without first excluding or resolving Sponsor vacancy IDs.
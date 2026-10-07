---
name: Cross-sector vacancy coverage
description: The user's product objective for broader automated vacancy collection and the quality constraint that goes with it.
---

The product objective is dependable, automated vacancy discovery across sectors and source types, especially job boards and verified employer websites, connected to truthful Apply and Send CV actions.

**Why:** The user asked for an architecture handoff to guide an agent building better automatic coverage. Existing collection is source-bounded and cannot guarantee every vacancy.

**How to apply:** Measure coverage, freshness, precision, and recall by sector/provider. Preserve verified employer/source evidence, distinguish no-results from failure, and never claim universal completeness or infer vacancy sponsorship from employer sponsor status. See `.agents/outputs/vacancy-system-architecture-handoff-2026-10-06.md` for the current architecture and proposed direction.

## Provider-total verification

Do not treat a source's `complete` outcome as proof that all provider-reported results were consumed when pagination ends on an empty or no-new-listings page. If the cursor has not reached the reported end, retain existing observations and mark coverage for review; report raw fetched rows separately from sponsor-matched imports.

**Why:** A production Jobs.ac.uk sweep ended on an empty page before its reported result total, while the adapter still classified the run as complete. That is a coverage gap even when missing-record reconciliation is disabled.

**How to apply:** For every paginated adapter with a reported total, verify the cursor/end condition against that total and add a regression test for empty or duplicate-only pages before the end. Keep source visibility and prior observations unchanged until coverage is validated.

## Coverage investigation scope

When the user asks why Opportunities is not being populated, investigate job-board collection, company-site collection, and employer email acquisition across sectors. Do not substitute application submission or tracker issues for that diagnosis.

**Why:** The user explicitly corrected an investigation that focused on Smart Apply instead of the vacancy/contact supply problem. They require explanations rooted in current code, not assumptions about earlier implementations.

**How to apply:** Trace current worker wiring and candidate filters, compare against production run history, and distinguish implemented adapters from deployed and scheduled adapters. Treat old handoffs and historical counts as leads to verify, not current operational proof.

## Employer-universe seeding

Companies House monthly live-company data provides legal-company identity, status, registered address, and SIC classifications, but not employer websites or vacancies. An SIC match is a candidate lead, not proof that a company actively operates in that sector or hires.

**Why:** Expansion beyond licensed sponsors needs broader seed data, but legal registration data cannot establish an employer's hiring activity or vacancy coverage.

**How to apply:** Use Companies House only to seed candidate identities; crosswalk SIC codes, deduplicate legal entities and brands, then independently verify employer domains and hiring sources. Do not use its row count as a sector-coverage denominator. Source: https://www.gov.uk/guidance/companies-house-data-products


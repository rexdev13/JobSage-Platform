---
name: Cross-sector vacancy coverage
description: The user's product objective for broader automated vacancy collection and the quality constraint that goes with it.
---

The product objective is dependable, automated vacancy discovery across sectors and source types, especially job boards and verified employer websites, connected to truthful Apply and Send CV actions.

**Why:** The user asked for an architecture handoff to guide an agent building better automatic coverage. Existing collection is source-bounded and cannot guarantee every vacancy.

**How to apply:** Measure coverage, freshness, precision, and recall by sector/provider. Preserve verified employer/source evidence, distinguish no-results from failure, and never claim universal completeness or infer vacancy sponsorship from employer sponsor status. See `.agents/outputs/vacancy-system-architecture-handoff-2026-10-06.md` for the current architecture and proposed direction.

## Coverage investigation scope

When the user asks why Opportunities is not being populated, investigate job-board collection, company-site collection, and employer email acquisition across sectors. Do not substitute application submission or tracker issues for that diagnosis.

**Why:** The user explicitly corrected an investigation that focused on Smart Apply instead of the vacancy/contact supply problem. They require explanations rooted in current code, not assumptions about earlier implementations.

**How to apply:** Trace current worker wiring and candidate filters, compare against production run history, and distinguish implemented adapters from deployed and scheduled adapters. Treat old handoffs and historical counts as leads to verify, not current operational proof.

## Employer-universe seeding

Companies House monthly live-company data provides legal-company identity, status, registered address, and SIC classifications, but not employer websites or vacancies. An SIC match is a candidate lead, not proof that a company actively operates in that sector or hires.

**Why:** Expansion beyond licensed sponsors needs broader seed data, but legal registration data cannot establish an employer's hiring activity or vacancy coverage.

**How to apply:** Use Companies House only to seed candidate identities; crosswalk SIC codes, deduplicate legal entities and brands, then independently verify employer domains and hiring sources. Do not use its row count as a sector-coverage denominator. Source: https://www.gov.uk/guidance/companies-house-data-products


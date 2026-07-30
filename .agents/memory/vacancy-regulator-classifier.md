---
name: Sponsor vacancy regulator classifier
description: Pitfalls when classifying sponsor-register vacancies to a healthcare regulator by keywords
---

- The sponsor-licence register spans EVERY industry (~128k orgs). Generic title words ("consultant", "surgeon") misclassify: "Environmental Consultant" is not GMC; "Veterinary Surgeon" must be blocklisted.
- Regex stem alternations (`cardiolog`, `physiotherap`, `plumb`) silently never match if the whole group has a trailing `\b` — "cardiologist" has no word boundary after "cardiolog". Put `\b` only on full-word alternatives, never after the group of stems.
- Unclassified titles are only shown to clinical candidates when the sponsoring org's register `industry` is healthcare-related, and are bottom-ranked (matchScore capped at 25).

**Why:** first live run surfaced piri-piri-shop cashiers and environmental consultants on a doctor's Opportunities page.
**How to apply:** any change to `sponsorVacancyRoles.ts` patterns — verify against real data via `curl /api/roles` with a candidate session, not just unit tests.

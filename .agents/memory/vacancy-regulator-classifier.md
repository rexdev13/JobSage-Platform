---
name: Sponsor vacancy regulator classifier
description: Pitfalls when classifying sponsor-register vacancies to a healthcare regulator by keywords
---

- The sponsor-licence register spans EVERY industry (~128k orgs). Generic title words ("consultant", "surgeon") misclassify: "Environmental Consultant" is not GMC; "Veterinary Surgeon" must be blocklisted.
- Regex stem alternations (`cardiolog`, `physiotherap`, `plumb`) silently never match if the whole group has a trailing `\b` — "cardiologist" has no word boundary after "cardiolog". Complete words and finite suffix groups need an ending boundary, or `nurse` also matches `nursery`.
- When titles contain signals for multiple professions, resolve specific conflicts before the general pattern order. Dental nurses and pharmacists must not become NMC matches merely because a nursing word is also present.
- Candidate feeds drop unclassified sponsor vacancies even when the employer industry is healthcare-related; industry fallback remains useful only for internal review and must not make ambiguous roles appear relevant.

**Why:** live runs surfaced unrelated retail roles for doctors and nursery, dental, support-grade, and editorial pages for nurses.
**How to apply:** any change to `sponsorVacancyRoles.ts` patterns — verify against real data via `curl /api/roles` with a candidate session, not just unit tests.

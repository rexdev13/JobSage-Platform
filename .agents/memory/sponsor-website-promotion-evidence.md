---
name: Sponsor website promotion evidence
description: Safety evidence and reporting rules for promoting employer website candidates.
---

Treat domain similarity as supporting evidence, not proof that a website belongs to an employer. A high source confidence and a page that mentions the employer are not enough by themselves. Automatic promotion also needs a meaningful brand/domain match, corroborated geography, secure same-site evidence, and no conflicting stored website.

**Why:** A saved-sample dry run gave perfect scores to partial matches on generic trade wording and a single name token. Substring matching alone can promote a directory or unrelated organization even when the source confidence is high.

**How to apply:** Run a dry classification first and inspect the automatic set before writing. Update blank website fields only, crawl only approved employers, and distinguish successful, partial, and failed discovery runs in reports. Do not describe repeat-import verification as performed when no vacancy batch was extracted.

### Live status is not page identity

A recently verified `live` company-site vacancy row is not enough to establish a valid employer or careers source. Stored examples can be application forms, navigation pages, guides, or other non-role content under a bounded legacy-evidence grace period. Keep employer-source approval separate from vacancy eligibility; use the rollout’s current role extraction, UK-location, fresh-liveness, and application-link checks before treating a vacancy as candidate-visible.

**Why:** The development review found active legacy rows whose stored titles and URLs did not consistently represent a current job advert, even though they remained within the grace window.

**How to apply:** During sponsor website reviews, use role rows as corroboration only when the URL/title/evidence actually supports a role. Report legacy and structured evidence separately, and do not let source approval bypass vacancy-level gates.


### Human review: unknown geography is not a mismatch

Keep the automated promotion classifier strict: it still requires positive geography corroboration. In an explicitly requested human review whose bar is “no geography mismatch,” missing location evidence is unresolved rather than a mismatch. A source may be approved only when stronger same-site employer/careers identity evidence exists; record unknown geography as a remaining risk and never infer that its vacancies are UK-eligible.

**Why:** Some fetched employer pages identify the employer but do not state a location, while the human-review request can distinguish absence of a mismatch from affirmative location proof. Vacancy geography remains a separate candidate-visibility gate.

**How to apply:** Use this distinction only for the explicitly scoped human review; do not weaken automatic promotion, vacancy liveness, or candidate-facing location checks.

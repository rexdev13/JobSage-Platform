---
name: Candidate sponsor matching
description: Why broad vacancy searches require stricter sponsor-name matching than employer-scoped searches
---

Candidate-wide job-board searches must use exact normalized identities, explicit aliases, or at least two distinctive contained name words. Do not reuse loose employer-scoped fuzzy overlap for this path.

**Why:** A broad NHS result set compared against the full sponsor register can select unrelated legal entities that share generic words or places such as London, House, Street, Medical, College, or Homerton. Employer-scoped searches have a much smaller ambiguity surface.

Candidate-time discovery must refresh asynchronously while candidate endpoints immediately serve the current verified cache.

**Why:** Polite pagination across a materially useful search window can take several seconds; awaiting it in the listing endpoint left Opportunities stuck loading even though verified cached vacancies were already available.

Candidate feeds must exclude sponsor vacancies that cannot be classified into the candidate's professional category; do not retain them as bottom-ranked 0% matches.

**Why:** Ambiguous titles such as generic clerical roles are confusing and make a small feed look inaccurate even when they belong to licensed sponsors.

**How to apply:** Keep broad candidate discovery conservative and audit listed-employer-to-sponsor pairs when changing normalization, aliases, generic-word lists, or match thresholds. Unknown matches should be dropped, not guessed. Trigger slow discovery without awaiting it in request handlers, deduplicate concurrent refreshes by profile/search key, and let later requests consume the expanded cache. Internal/admin review may retain ambiguous vacancies, but candidate-facing lists may not.
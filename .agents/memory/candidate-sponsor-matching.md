---
name: Candidate sponsor matching
description: Why broad vacancy searches require stricter sponsor-name matching than employer-scoped searches
---

Candidate-wide job-board searches must use exact normalized identities, explicit aliases, or at least two distinctive contained name words. Do not reuse loose employer-scoped fuzzy overlap for this path.

**Why:** A broad NHS result set compared against the full sponsor register can select unrelated legal entities that share generic words or places such as London, House, Street, Medical, College, or Homerton. Employer-scoped searches have a much smaller ambiguity surface.

**How to apply:** Keep broad candidate discovery conservative and audit listed-employer-to-sponsor pairs when changing normalization, aliases, generic-word lists, or match thresholds. Unknown matches should be dropped, not guessed.
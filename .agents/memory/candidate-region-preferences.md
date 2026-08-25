---
name: Candidate region preferences
description: Defines the separate persistence model for candidate profile regions and the Opportunities page filter.
---

Treat “Preferred UK Region(s)” in the Professional Profile and the region controls on Opportunities as the same account-wide matching preference, stored through the profile API.

**Why:** Candidates expect a region selected in either screen to remain consistent everywhere. The preference affects server-side matching and must follow the candidate across devices rather than living only in browser state.

**How to apply:** Both screens should read the saved profile value and write changes through the profile API. Keep the controls clearly labelled and validate values against the standard UK region list.
---
name: Candidate region preferences
description: Defines the separate persistence model for candidate profile regions and the Opportunities page filter.
---

Treat “Preferred UK Region(s)” in the Professional Profile as the account-wide matching preference, stored by the profile API. Treat the Opportunities-page region controls as a display refinement, saved locally for the signed-in user on that device and initially populated from the account preference.

**Why:** The profile preference affects server-side matching and must follow the candidate across devices. The Opportunities controls are intended to temporarily narrow the already returned list without silently changing the candidate’s broader matching preference.

**How to apply:** Keep the two controls clearly labelled. Do not make an Opportunities filter overwrite profile data; persist it locally and validate restored region values against the standard UK region list.
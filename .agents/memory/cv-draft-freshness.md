---
name: Factual CV draft freshness
description: Candidate-confirmed profile changes invalidate reviewed AI CV drafts without deleting their editable content.
---

Reviewed factual CV drafts must be treated as unapproved whenever a Maker source fact changes, whether the fact came from the Professional Profile or a candidate-confirmed source CV. Preserve the draft text for review, but clear its reviewed state so it cannot be downloaded as approved until the candidate reviews or regenerates it. Readiness “I have this” claims remain separate self-attestations and do not trigger this invalidation.

**Why:** The Maker uses shared profile facts across career profiles, so a previously reviewed draft can silently become inaccurate after a profile edit.

**How to apply:** Keep profile-save invalidation at the boundary for Maker fields (profession, specialty, qualification, experience, registration, languages, city, and preferred region), invalidate source-linked drafts when reviewed source-CV fields change, and refresh the career-profile query after saves.
---
name: Career profile activation
description: Product behavior and UX for switching the active candidate career profile.
---

**Rule:** Keep one career profile active at a time. Candidates switch the active profile from a visible Active/Not active control on each profile card; the active profile guides role matching and pre-fills the uploaded-CV rewrite target.

**Why:** The user requested a direct way to use another career profile, while the existing product uses one active profile for matching and rewrite suggestions.

**How to apply:** Activating an inactive profile must make it active, deactivate the previous profile, and persist after reload. Do not allow the only active profile to be turned off without activating another.

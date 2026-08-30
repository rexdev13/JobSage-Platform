---
name: Send CV delivery semantics
description: Durable product and delivery rules for vacancy-level candidate CV outreach.
---

Send CV is a vacancy-level outreach action, not an application-state shortcut. It must never disable or hide the normal Apply action, and its sent/resend state must remain separate.

**Why:** Candidates may send a CV and still complete the employer's formal application. Treating outreach as Applied hid valid next actions and distorted matching and tracker state.

**How to apply:** Use the persisted matched-role reference, record every delivery attempt before outbound email, expose pending/delivered/failed states, attach an owned PDF, and resolve only stored employer/sponsor contacts or the operations fallback. Do not run AI contact enrichment in the send path.
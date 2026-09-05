---
name: Send CV delivery semantics
description: Durable product and delivery rules for vacancy-level candidate CV outreach.
---

Send CV is a vacancy-level outreach action, not an application-state shortcut. It must never disable or hide the normal Apply action, and its sent/resend state must remain separate.

**Why:** Candidates may send a CV and still complete the employer's formal application. Treating outreach as Applied hid valid next actions and distorted matching and tracker state.

**How to apply:** Use the persisted matched-role reference, record every delivery attempt before outbound email, expose pending/delivered/failed states, attach an owned PDF, and resolve only stored employer/sponsor contacts or the operations fallback. Do not run AI contact enrichment in the send path.

Candidate-facing Send CV actions must be gated by the server's persisted
recipient lookup, and their requests must explicitly require a direct contact.
Legacy/API-triggered sends may retain the operations fallback, but an advertised
direct send must reject rather than silently changing to that fallback.

**Why:** A client-only contact guess can become stale or omit employer-account
addresses, while silently routing a candidate-facing direct send to operations
misrepresents both the recipient and delivery outcome.

**How to apply:** Return only a boolean eligibility signal to candidate clients,
hide Send CV unless it is true, and have the send endpoint reject an operations
resolution when the UI's direct-contact requirement is set.

When a Send CV sponsor has no specific live vacancy, open the company-level
Smart Apply outreach assistant rather than fabricating or selecting a role.

**Why:** Direct-contact sponsors can still receive a truthful speculative CV
outreach, but vacancy-specific questions and claims require real vacancy evidence.

**How to apply:** Give the assistant the real company and speculative-outreach
context, keep CV delivery and tracking intact, and do not require the browser
extension for this first-party company outreach flow.
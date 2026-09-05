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

The Opportunities Send CV tab is vacancy-specific: group matched vacancies by
employer and never offer a company-general send from that tab.

**Why:** Candidates need to know which exact role receives their CV, and the
tracker/email must retain the vacancy title, role identity, and exact link.

**How to apply:** Build the tab from the shared matched-role feed, retain
email-only vacancy rows with direct contacts, and pass the vacancy title, role
ID, source metadata, and exact vacancy URL into every send.
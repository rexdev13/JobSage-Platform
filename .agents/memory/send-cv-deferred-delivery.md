---
name: Send CV deferred delivery
description: Candidate Send CV requests without a verified employer destination remain pending instead of using the operations inbox.
---

Candidate-facing Send CV must not guess an employer address or route CV documents to the operations inbox when no verified destination exists. Save the CV, optional cover letter, vacancy context, and a pending delivery attempt with no recipient; dispatch can happen later when a verified contact is available. The Send CV tab should retain all matched vacancies regardless of whether an employer email is available.

**Why:** A missing contact is an operational follow-up state, not a candidate error, and sending personal documents to an operations fallback is not equivalent to employer delivery. The user explicitly wants vacancies without email to remain visible rather than disappear from Send CV.

**How to apply:** Do not use email availability as a filter on the Send CV tab; show pending delivery clearly when there is no verified recipient. Preserve vacancy liveness gates for the Send CV action, but keep the vacancy visible and explain why sending is temporarily unavailable when its link is not live. Distinguish pending no-destination records from failed provider delivery.
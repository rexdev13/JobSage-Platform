---
name: Send CV deferred delivery
description: Candidate Send CV requests without a verified employer destination remain pending instead of using the operations inbox.
---

Candidate-facing Send CV must not guess an employer address or route CV documents to the operations inbox when no verified destination exists. Save the CV, optional cover letter, vacancy context, and a pending delivery attempt with no recipient; dispatch can happen later when a verified contact is available.

**Why:** A missing contact is an operational follow-up state, not a candidate error, and sending personal documents to an operations fallback is not equivalent to employer delivery.

**How to apply:** Keep Send CV visible without direct-contact evidence, preserve Apply/Smart Apply liveness gates, and distinguish pending no-destination records from failed provider delivery.
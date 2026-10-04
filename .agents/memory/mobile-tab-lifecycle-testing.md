---
name: Mobile tab-return testing
description: Distinguish headless lifecycle-handler checks from genuine mobile tab transitions.
---

Do not treat headless browser tab activation as proof of a real mobile focus/visibility transition. Verify the opener's actual visibility and focus states and distinguish simulated lifecycle-event checks from genuine tab-return verification.

**Why:** The test browser kept the JOBSAGE opener visible and focused even while an employer tab was foregrounded. Repeating tab activation could not demonstrate the real return event, although explicit lifecycle-event simulation verified the handler and its persisted confirmation behavior.

**How to apply:** Instrument lifecycle events when testing the assisted flow. Test database tracking, confirmation, reminders and error handling independently. Retain a visible manual confirmation fallback and report any real-device verification limitation honestly.
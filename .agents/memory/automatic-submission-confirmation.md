---
name: Automatic submission confirmation
description: Reliability rule for promoting a JOBSAGE-tracked outbound application after an ATS confirmation signal.
---

Automatic employer-site confirmation must only promote an existing JOBSAGE click record. It must never create a new application from a heuristic, must serialize with click creation on the same user-and-exact-URL key, and should retry only a brief missing-record response.

**Why:** A fast external form can submit before the asynchronous first-party click write has committed. Without shared serialization and a bounded retry, a genuine confirmation can receive a terminal “not found” response; allowing an insert instead risks false applications.

**How to apply:** When adding a new confirmation source or changing click tracking, preserve the original outbound URL as the identity, use the same concurrency key for creation and promotion, and keep confirmation retries short and limited to the missing tracked-record case.
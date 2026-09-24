---
name: Detached company-site verification
description: How post-discovery URL checks are queued and safely drained from one-off development runners.
---

Company-site vacancy ingestion can start post-commit URL verification as detached, in-memory work. The discovery/job call may return before these checks finish; closing that process's database pool can interrupt verification, leaving inserted vacancies unverified. The queue itself is not durable.

**Why:** A bounded development resume run returned after writing vacancy rows, but its short-lived CLI closed the pool while the detached verifier was still running. The persisted rows survived, while their verification did not.

**How to apply:** For a precise recovery set, query the exact development vacancy IDs and their effective URLs (`application_url` when present, otherwise `url`), then await `verifyCompanySiteStoredLink(id, url, deadlineMs)` for each before closing the pool. Do not use the detached queue as a recovery API. Use the broad durable liveness sweep only when its wider selection is acceptable.
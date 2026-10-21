---
name: Production audit target identity
description: Safely reconcile platform production read-only queries with a separately configured read-only audit connection.
---

Production SQL readers and a project's production proof/read-only connection may report different PostgreSQL server fingerprints even when they read the same application data. Do not weaken fingerprint checks or assume matching database names establish target identity.

**Why:** Production reads during the vacancy baseline were served by distinct PostgreSQL endpoints. Matching independently queried, stable application-row anchors confirmed the audit connection reached the intended production dataset; the repository's explicit read-only transaction checks remained in force.

**How to apply:** Keep the audit connection read-only, require the project safety helper for its selected mode, compare a small deterministic anchor sample from both authorized production read paths, and abort on any mismatch.

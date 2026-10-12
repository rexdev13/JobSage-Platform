---
name: Mobile and compliance implementation boundaries
description: Owner-set safety constraints for ongoing JOBSAGE mobile and compliance work.
---

Implementation work in this scope is source and isolated-fixture work only. Keep production account deletion disabled. Do not deploy, submit to app stores, run production writes or deletions, test with real customers, buy services, or expose credentials.

**Why:** The owner explicitly restricted this continuation to implementation that does not create production, customer, financial, or store-release effects.

**How to apply:** Make progress in code and isolated tests; do not use a live database or external service to validate destructive behavior. Surface remaining owner/operator evidence only after completing independent source work.

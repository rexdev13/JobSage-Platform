---
name: Staging-only k6 load testing
description: Capacity tests must use local or isolated non-production targets and synthetic accounts.
---

Load testing for JOBSAGE must default to local or explicitly provisioned non-production staging. The runner must reject the production custom domain and must not use real customer credentials or real vacancy-ingestion traffic.

**Why:** The application shares database writers with vacancy ingestion, and a load test against production could create real user, email, AI, or crawler side effects.

**How to apply:** Keep k6 scripts write-light, make eligibility evaluation opt-in, use synthetic consented profiles, and treat 100k/1M profiles as plans requiring external distributed generators and isolated infrastructure.
---
name: Vacancy action liveness
description: Product boundary between vacancy-specific actions and employer-level speculative outreach.
---

Vacancy-specific Apply and Send CV actions require a matching stored vacancy URL whose shared status is currently `live`. Dead URLs remain explicit evidence and must never collapse to email-only. Stale, unverified, and inconclusive URLs are non-actionable until the existing checker verifies them; submission rejects rather than running a synchronous recheck.

**Why:** Converting dead evidence into a missing URL made closed vacancies look like valid email-only outreach, while synchronous checks would add latency and duplicate existing liveness infrastructure.

**How to apply:** Preserve URL/status evidence through API contracts and validate URL identity plus status at submission. Keep genuinely URL-less and explicitly employer-level speculative outreach available when a direct contact exists.
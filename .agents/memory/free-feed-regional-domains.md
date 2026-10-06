---
name: Free-feed regional domains
description: Public vacancy feeds may link to country-specific first-party hosts rather than the API endpoint's host.
---

Do not assume listing URLs share the API endpoint's hostname or TLD. Inspect a bounded live page, then allow only observed provider domains while keeping HTTPS and exact job-detail path checks; do not wildcard other TLDs or relax path validation. A parser-version change should also clear stale source backoff so the corrected parser can be retried promptly.

**Why:** Arbeitnow's API endpoint returned listings across localized first-party domains, and the original host allowlist rejected most rows. A parser-version bump alone was initially delayed by the prior invalid-record backoff.

**How to apply:** Sample actual provider URLs through the existing safe-fetch path before relying on a source. Update host and classifier tests together, and ensure parser changes can restart the affected source without waiting through an obsolete failure cooldown.
